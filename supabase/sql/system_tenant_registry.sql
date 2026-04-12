-- NixSign - System tenant registry (safe / non-destructive)
-- Goal:
-- 1) Store master-managed company profile data for each tenant
-- 2) Control Google login permission per tenant (default OFF)
-- Safety rules:
-- - No DROP TABLE / DROP COLUMN
-- - No DELETE / UPDATE on existing business records
-- - Existing signed documents remain untouched

begin;

do $$
begin
  if to_regclass('public.tenants') is null then
    raise exception
      using
        errcode = 'P0001',
        message = 'Dependencia ausente: tabela public.tenants nao existe.',
        hint = 'Execute antes: supabase/sql/multitenant_phase1_safe.sql';
  end if;
end
$$;

create table if not exists public.tenant_registry (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  company_tax_id text null,
  phone text null,
  cep text null,
  address_line text null,
  address_number text null,
  address_complement text null,
  neighborhood text null,
  city text null,
  state text null,
  owner_name text null,
  owner_email text null,
  allow_google_login boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tenant_registry_owner_email on public.tenant_registry (lower(owner_email));
create index if not exists idx_tenant_registry_company_tax_id on public.tenant_registry (company_tax_id);
create index if not exists idx_tenant_registry_city_state on public.tenant_registry (city, state);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tenant_registry_updated_at on public.tenant_registry;
create trigger trg_tenant_registry_updated_at
before update on public.tenant_registry
for each row execute function public.set_updated_at();

insert into public.tenant_registry (tenant_id, owner_email, owner_name)
select
  t.id,
  nullif(lower(coalesce(u.email, '')), ''),
  coalesce(
    nullif(trim(coalesce(up.full_name, '')), ''),
    nullif(trim(coalesce(t.display_name, '')), '')
  )
from public.tenants t
left join auth.users u on u.id = t.owner_user_id
left join public.user_profiles up on up.user_id = t.owner_user_id
on conflict (tenant_id) do nothing;

alter table public.tenant_registry enable row level security;

drop policy if exists tenant_registry_select_member on public.tenant_registry;
create policy tenant_registry_select_member
on public.tenant_registry
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_registry.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists tenant_registry_insert_manager on public.tenant_registry;
create policy tenant_registry_insert_manager
on public.tenant_registry
for insert
to authenticated
with check (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_registry.tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin', 'manager')
      and tm.status = 'active'
  )
);

drop policy if exists tenant_registry_update_manager on public.tenant_registry;
create policy tenant_registry_update_manager
on public.tenant_registry
for update
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_registry.tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin', 'manager')
      and tm.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_registry.tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin', 'manager')
      and tm.status = 'active'
  )
);

commit;
