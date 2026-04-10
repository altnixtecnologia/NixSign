-- NixSign - Hotfix RLS recursion on tenant_members
-- Fixes: ERROR 42P17 (infinite recursion detected in policy for relation "tenant_members")
-- Safe / non-destructive:
-- - No DROP TABLE / DROP COLUMN
-- - No DELETE on business records
-- - Only policy/function adjustments

begin;

do $$
begin
  if to_regclass('public.tenant_members') is null then
    raise exception
      using
        errcode = 'P0001',
        message = 'Dependencia ausente: tabela public.tenant_members nao existe.',
        hint = 'Execute antes: supabase/sql/multitenant_phase1_safe.sql';
  end if;
end
$$;

-- Helper: check active membership bypassing RLS recursion
create or replace function public.is_tenant_member(
  p_tenant_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
set row_security = off
as $$
begin
  if p_tenant_id is null or p_user_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = p_user_id
      and tm.status = 'active'
  );
end;
$$;

-- Helper: check admin role bypassing RLS recursion
create or replace function public.is_tenant_admin(
  p_tenant_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
set row_security = off
as $$
begin
  if p_tenant_id is null or p_user_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = p_user_id
      and tm.role in ('owner', 'admin')
      and tm.status = 'active'
  );
end;
$$;

grant execute on function public.is_tenant_member(uuid, uuid) to authenticated;
grant execute on function public.is_tenant_admin(uuid, uuid) to authenticated;

-- Rebuild tenant_members policies without self-recursive subqueries
drop policy if exists tenant_members_select_self_tenant on public.tenant_members;
drop policy if exists tenant_members_insert_admin_tenant on public.tenant_members;
drop policy if exists tenant_members_update_admin_tenant on public.tenant_members;
drop policy if exists tenant_members_delete_admin_tenant on public.tenant_members;

create policy tenant_members_select_self_tenant
on public.tenant_members
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_tenant_admin(tenant_id)
);

create policy tenant_members_insert_admin_tenant
on public.tenant_members
for insert
to authenticated
with check (
  public.is_tenant_admin(tenant_id)
);

create policy tenant_members_update_admin_tenant
on public.tenant_members
for update
to authenticated
using (
  public.is_tenant_admin(tenant_id)
)
with check (
  public.is_tenant_admin(tenant_id)
);

create policy tenant_members_delete_admin_tenant
on public.tenant_members
for delete
to authenticated
using (
  public.is_tenant_admin(tenant_id)
);

-- Optional hardening: keep dependent policies robust by using helpers
drop policy if exists tenants_select_member on public.tenants;
create policy tenants_select_member
on public.tenants
for select
to authenticated
using (
  public.is_tenant_member(id)
);

drop policy if exists tenant_invites_select_admin_tenant on public.tenant_invites;
create policy tenant_invites_select_admin_tenant
on public.tenant_invites
for select
to authenticated
using (
  public.is_tenant_admin(tenant_id)
);

drop policy if exists tenant_invites_insert_admin_tenant on public.tenant_invites;
create policy tenant_invites_insert_admin_tenant
on public.tenant_invites
for insert
to authenticated
with check (
  public.is_tenant_admin(tenant_id)
);

drop policy if exists tenant_invites_update_admin_tenant on public.tenant_invites;
create policy tenant_invites_update_admin_tenant
on public.tenant_invites
for update
to authenticated
using (
  public.is_tenant_admin(tenant_id)
)
with check (
  public.is_tenant_admin(tenant_id)
);

drop policy if exists tenant_clients_select_member on public.tenant_clients;
create policy tenant_clients_select_member
on public.tenant_clients
for select
to authenticated
using (
  public.is_tenant_member(tenant_id)
);

drop policy if exists tenant_clients_insert_manager on public.tenant_clients;
create policy tenant_clients_insert_manager
on public.tenant_clients
for insert
to authenticated
with check (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_clients.tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin', 'manager')
      and tm.status = 'active'
  )
);

drop policy if exists tenant_clients_update_manager on public.tenant_clients;
create policy tenant_clients_update_manager
on public.tenant_clients
for update
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_clients.tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin', 'manager')
      and tm.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_clients.tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin', 'manager')
      and tm.status = 'active'
  )
);

drop policy if exists tenant_clients_delete_admin on public.tenant_clients;
create policy tenant_clients_delete_admin
on public.tenant_clients
for delete
to authenticated
using (
  public.is_tenant_admin(tenant_id)
);

commit;
