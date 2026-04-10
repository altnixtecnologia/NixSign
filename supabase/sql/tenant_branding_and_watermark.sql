-- NixSign - Tenant branding and watermark (safe / non-destructive)
-- Goal:
-- 1) Enable per-tenant brand identity (name, document, contact, logo)
-- 2) Enable per-tenant watermark customization for signed PDFs
-- 3) Keep compatibility with legacy behavior when no tenant config exists
-- Safety rules:
-- - No DROP TABLE / DROP COLUMN
-- - No DELETE / UPDATE on existing business records
-- - Existing signed documents remain untouched

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Prerequisites
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.tenants') is null then
    raise exception
      using
        errcode = 'P0001',
        message = 'Dependencia ausente: tabela public.tenants nao existe.',
        hint = 'Execute antes: supabase/sql/multitenant_phase1_safe.sql';
  end if;

  if to_regclass('public.tenant_members') is null then
    raise exception
      using
        errcode = 'P0001',
        message = 'Dependencia ausente: tabela public.tenant_members nao existe.',
        hint = 'Execute antes: supabase/sql/multitenant_phase1_safe.sql';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Tenant branding and watermark configuration
-- ---------------------------------------------------------------------
create table if not exists public.tenant_branding (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  company_display_name text not null default 'NixSign',
  company_legal_name text null,
  company_tax_id text null,
  primary_email text null,
  secondary_email text null,
  logo_public_url text null,
  watermark_enabled boolean not null default true,
  watermark_mode text not null default 'logo' check (watermark_mode in ('logo', 'text', 'both', 'none')),
  watermark_image_url text null,
  watermark_text text null,
  watermark_opacity numeric(4,3) not null default 0.150 check (watermark_opacity >= 0.050 and watermark_opacity <= 0.500),
  watermark_scale numeric(4,3) not null default 0.300 check (watermark_scale >= 0.100 and watermark_scale <= 1.000),
  company_google_numeric_id text null,
  signature_company_label text not null default 'Assinatura da empresa',
  signature_client_label text not null default 'Assinatura do cliente',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tenant_branding_primary_email on public.tenant_branding (lower(primary_email));
create index if not exists idx_tenant_branding_company_name on public.tenant_branding (company_display_name);

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

drop trigger if exists trg_tenant_branding_updated_at on public.tenant_branding;
create trigger trg_tenant_branding_updated_at
before update on public.tenant_branding
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Ensure each tenant has a branding row
-- ---------------------------------------------------------------------
create or replace function public.ensure_tenant_branding_row(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_owner_email text;
begin
  if p_tenant_id is null then
    return;
  end if;

  select lower(coalesce(u.email, ''))
    into v_owner_email
  from public.tenants t
  left join auth.users u on u.id = t.owner_user_id
  where t.id = p_tenant_id;

  insert into public.tenant_branding (
    tenant_id,
    company_display_name,
    company_legal_name,
    primary_email,
    secondary_email
  )
  select
    t.id,
    coalesce(nullif(trim(t.display_name), ''), 'NixSign'),
    nullif(trim(t.display_name), ''),
    nullif(v_owner_email, ''),
    'altnixtecnologia@gmail.com'
  from public.tenants t
  where t.id = p_tenant_id
  on conflict (tenant_id) do update
    set company_display_name = coalesce(nullif(trim(excluded.company_display_name), ''), public.tenant_branding.company_display_name),
        company_legal_name = coalesce(public.tenant_branding.company_legal_name, excluded.company_legal_name),
        primary_email = coalesce(public.tenant_branding.primary_email, excluded.primary_email),
        secondary_email = coalesce(public.tenant_branding.secondary_email, excluded.secondary_email),
        updated_at = now();
end;
$$;

grant execute on function public.ensure_tenant_branding_row(uuid) to authenticated;

create or replace function public.trg_tenants_seed_branding()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  perform public.ensure_tenant_branding_row(new.id);
  return new;
end;
$$;

drop trigger if exists trg_tenants_seed_branding on public.tenants;
create trigger trg_tenants_seed_branding
after insert on public.tenants
for each row execute function public.trg_tenants_seed_branding();

-- Backfill for existing tenants
insert into public.tenant_branding (
  tenant_id,
  company_display_name,
  company_legal_name,
  primary_email,
  secondary_email
)
select
  t.id,
  coalesce(nullif(trim(t.display_name), ''), 'NixSign'),
  nullif(trim(t.display_name), ''),
  nullif(lower(coalesce(u.email, '')), ''),
  'altnixtecnologia@gmail.com'
from public.tenants t
left join auth.users u on u.id = t.owner_user_id
on conflict (tenant_id) do nothing;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.tenant_branding enable row level security;

drop policy if exists tenant_branding_select_member on public.tenant_branding;
create policy tenant_branding_select_member
on public.tenant_branding
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_branding.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists tenant_branding_insert_admin on public.tenant_branding;
create policy tenant_branding_insert_admin
on public.tenant_branding
for insert
to authenticated
with check (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_branding.tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin', 'manager')
      and tm.status = 'active'
  )
);

drop policy if exists tenant_branding_update_admin on public.tenant_branding;
create policy tenant_branding_update_admin
on public.tenant_branding
for update
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_branding.tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin', 'manager')
      and tm.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_branding.tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin', 'manager')
      and tm.status = 'active'
  )
);

commit;
