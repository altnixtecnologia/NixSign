-- NixSign - Multi-tenant phase 1 (safe / non-destructive)
-- Goal: prepare SaaS account model without breaking current production data.
-- Safety rules of this migration:
-- 1) No DROP TABLE / DROP COLUMN
-- 2) No DELETE / UPDATE on existing business records
-- 3) Existing documents and signatures remain untouched

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Core SaaS entities
-- ---------------------------------------------------------------------

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  owner_user_id uuid null,
  status text not null default 'active' check (status in ('active', 'inactive', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_members (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'manager', 'member', 'billing')),
  status text not null default 'active' check (status in ('invited', 'active', 'disabled')),
  invited_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index if not exists idx_tenant_members_user_id on public.tenant_members(user_id);
create index if not exists idx_tenant_members_tenant_id on public.tenant_members(tenant_id);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text null,
  price_cents integer not null default 0,
  currency text not null default 'BRL',
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly', 'yearly', 'one_time')),
  max_users integer null,
  max_documents_per_month integer null,
  max_storage_mb integer null,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  provider text not null default 'manual' check (provider in ('manual', 'stripe', 'pagarme', 'asaas')),
  provider_customer_id text null,
  provider_subscription_id text null,
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'canceled', 'paused')),
  trial_ends_at timestamptz null,
  current_period_start timestamptz null,
  current_period_end timestamptz null,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_tenant_id on public.subscriptions(tenant_id);
create index if not exists idx_subscriptions_status on public.subscriptions(status);

create table if not exists public.tenant_usage_monthly (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period_ym text not null check (period_ym ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  documents_created integer not null default 0,
  signatures_collected integer not null default 0,
  storage_bytes bigint not null default 0,
  updated_at timestamptz not null default now(),
  unique (tenant_id, period_ym)
);

create index if not exists idx_tenant_usage_monthly_tenant on public.tenant_usage_monthly(tenant_id);

create table if not exists public.tenant_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'manager', 'member', 'billing')),
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz not null,
  invited_by uuid null,
  accepted_by uuid null,
  accepted_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_tenant_invites_tenant_id on public.tenant_invites(tenant_id);
create index if not exists idx_tenant_invites_email on public.tenant_invites(email);

create table if not exists public.audit_events (
  id bigserial primary key,
  tenant_id uuid null references public.tenants(id) on delete set null,
  actor_user_id uuid null,
  event_type text not null,
  target_type text null,
  target_id text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_events_tenant_id on public.audit_events(tenant_id);
create index if not exists idx_audit_events_event_type on public.audit_events(event_type);
create index if not exists idx_audit_events_created_at on public.audit_events(created_at desc);

-- ---------------------------------------------------------------------
-- Add tenant_id to current business tables (nullable and safe)
-- No backfill is done here.
-- ---------------------------------------------------------------------

do $$
begin
  if to_regclass('public.documentos') is not null then
    alter table public.documentos add column if not exists tenant_id uuid null;
    create index if not exists idx_documentos_tenant_id on public.documentos(tenant_id);
  end if;
end $$;

do $$
begin
  if to_regclass('public.assinaturas') is not null then
    alter table public.assinaturas add column if not exists tenant_id uuid null;
    create index if not exists idx_assinaturas_tenant_id on public.assinaturas(tenant_id);
  end if;
end $$;

do $$
begin
  if to_regclass('public.documentos') is not null and to_regclass('public.tenants') is not null then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'fk_documentos_tenant_id'
    ) then
      alter table public.documentos
      add constraint fk_documentos_tenant_id
      foreign key (tenant_id) references public.tenants(id) on delete set null;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('public.assinaturas') is not null and to_regclass('public.tenants') is not null then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'fk_assinaturas_tenant_id'
    ) then
      alter table public.assinaturas
      add constraint fk_assinaturas_tenant_id
      foreign key (tenant_id) references public.tenants(id) on delete set null;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Auto-update updated_at
-- ---------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tenants_updated_at on public.tenants;
create trigger trg_tenants_updated_at
before update on public.tenants
for each row execute function public.set_updated_at();

drop trigger if exists trg_tenant_members_updated_at on public.tenant_members;
create trigger trg_tenant_members_updated_at
before update on public.tenant_members
for each row execute function public.set_updated_at();

drop trigger if exists trg_plans_updated_at on public.plans;
create trigger trg_plans_updated_at
before update on public.plans
for each row execute function public.set_updated_at();

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Optional: enable RLS only on NEW tables (safe for current app)
-- Existing tables (documentos/assinaturas) are untouched on RLS in this phase.
-- ---------------------------------------------------------------------

alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.subscriptions enable row level security;
alter table public.tenant_usage_monthly enable row level security;
alter table public.tenant_invites enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists tenants_select_member on public.tenants;
create policy tenants_select_member
on public.tenants
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenants.id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists tenant_members_select_self_tenant on public.tenant_members;
create policy tenant_members_select_self_tenant
on public.tenant_members
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_members.tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin')
      and tm.status = 'active'
  )
);

drop policy if exists subscriptions_select_member_tenant on public.subscriptions;
create policy subscriptions_select_member_tenant
on public.subscriptions
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = subscriptions.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists tenant_usage_select_member_tenant on public.tenant_usage_monthly;
create policy tenant_usage_select_member_tenant
on public.tenant_usage_monthly
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_usage_monthly.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists tenant_invites_select_admin_tenant on public.tenant_invites;
create policy tenant_invites_select_admin_tenant
on public.tenant_invites
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_invites.tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin')
      and tm.status = 'active'
  )
);

drop policy if exists audit_events_select_admin_tenant on public.audit_events;
create policy audit_events_select_admin_tenant
on public.audit_events
for select
to authenticated
using (
  tenant_id is null
  or exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = audit_events.tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin')
      and tm.status = 'active'
  )
);

commit;
