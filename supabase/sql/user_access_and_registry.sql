-- NixSign - User access and tenant registry (safe / non-destructive)
-- Goal:
-- 1) Enable login with created users (email/password or Google)
-- 2) Support user management per tenant (members + invites)
-- 3) Add tenant-level client registry
-- Safety rules:
-- - No DROP TABLE / DROP COLUMN
-- - No DELETE / UPDATE on existing document/signature business records
-- - Existing signed documents remain untouched

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- User profile catalog (linked to auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text null,
  full_name text null,
  phone text null,
  avatar_url text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_profiles_email on public.user_profiles (email);

-- Keep profile fields in sync when auth user is created/updated.
create or replace function public.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_name text;
begin
  v_email := lower(coalesce(new.email, ''));
  v_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');

  if v_name is null then
    v_name := nullif(split_part(v_email, '@', 1), '');
  end if;

  insert into public.user_profiles (user_id, email, full_name, is_active)
  values (new.id, nullif(v_email, ''), v_name, true)
  on conflict (user_id) do update
    set email = excluded.email,
        full_name = coalesce(public.user_profiles.full_name, excluded.full_name),
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_auth_user_profile_insert on auth.users;
create trigger trg_auth_user_profile_insert
after insert on auth.users
for each row execute function public.sync_auth_user_profile();

drop trigger if exists trg_auth_user_profile_update on auth.users;
create trigger trg_auth_user_profile_update
after update of email, raw_user_meta_data on auth.users
for each row execute function public.sync_auth_user_profile();

-- Backfill profiles for existing auth users.
insert into public.user_profiles (user_id, email, full_name, is_active)
select
  u.id,
  nullif(lower(coalesce(u.email, '')), ''),
  coalesce(
    nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(split_part(lower(coalesce(u.email, '')), '@', 1), '')
  ),
  true
from auth.users u
on conflict (user_id) do update
  set email = excluded.email,
      full_name = coalesce(public.user_profiles.full_name, excluded.full_name),
      updated_at = now();

-- ---------------------------------------------------------------------
-- Tenant client registry (customer catalog per tenant)
-- ---------------------------------------------------------------------
create table if not exists public.tenant_clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  display_name text not null,
  email text null,
  phone text null,
  document_id text null,
  notes text null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tenant_clients_tenant_id on public.tenant_clients (tenant_id);
create index if not exists idx_tenant_clients_email on public.tenant_clients (email);
create index if not exists idx_tenant_clients_display_name on public.tenant_clients (display_name);

create unique index if not exists ux_tenant_clients_identity
on public.tenant_clients (
  tenant_id,
  lower(coalesce(display_name, '')),
  lower(coalesce(email, ''))
);

-- ---------------------------------------------------------------------
-- Keep updated_at maintained
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

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_tenant_clients_updated_at on public.tenant_clients;
create trigger trg_tenant_clients_updated_at
before update on public.tenant_clients
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Workspace bootstrap and invite acceptance helpers
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.tenant_invites') is not null then
    alter table public.tenant_invites
      alter column token set default replace(gen_random_uuid()::text, '-', '');
    alter table public.tenant_invites
      add column if not exists invited_name text null;
  end if;
end $$;

create or replace function public.ensure_personal_tenant(p_display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_existing_tenant_id uuid;
  v_any_tenant_exists boolean;
  v_email text;
  v_name text;
  v_slug_base text;
  v_slug text;
  v_tenant_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Usuário não autenticado';
  end if;

  select tm.tenant_id
    into v_existing_tenant_id
  from public.tenant_members tm
  where tm.user_id = v_user_id
    and tm.status = 'active'
  order by
    case tm.role
      when 'owner' then 1
      when 'admin' then 2
      when 'manager' then 3
      else 9
    end,
    tm.created_at asc
  limit 1;

  if v_existing_tenant_id is not null then
    return v_existing_tenant_id;
  end if;

  select exists(select 1 from public.tenants) into v_any_tenant_exists;
  if v_any_tenant_exists then
    raise exception 'Acesso não liberado. Solicite convite de um administrador da empresa.';
  end if;

  select
    lower(coalesce(u.email, '')),
    coalesce(
      nullif(trim(coalesce(p_display_name, '')), ''),
      nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''),
      nullif(split_part(lower(coalesce(u.email, '')), '@', 1), ''),
      'Workspace NixSign'
    )
  into v_email, v_name
  from auth.users u
  where u.id = v_user_id;

  v_slug_base := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug_base := trim(both '-' from v_slug_base);
  if v_slug_base = '' then
    v_slug_base := 'nixsign';
  end if;
  v_slug := v_slug_base || '-' || substring(replace(v_user_id::text, '-', '') from 1 for 6);

  insert into public.tenants (slug, display_name, owner_user_id, status)
  values (v_slug, v_name, v_user_id, 'active')
  on conflict (slug) do update
    set display_name = excluded.display_name
  returning id into v_tenant_id;

  insert into public.tenant_members (tenant_id, user_id, role, status)
  values (v_tenant_id, v_user_id, 'owner', 'active')
  on conflict (tenant_id, user_id) do update
    set role = 'owner',
        status = 'active',
        updated_at = now();

  insert into public.user_profiles (user_id, email, full_name, is_active)
  values (v_user_id, nullif(v_email, ''), v_name, true)
  on conflict (user_id) do update
    set email = excluded.email,
        full_name = coalesce(public.user_profiles.full_name, excluded.full_name),
        updated_at = now();

  return v_tenant_id;
end;
$$;

grant execute on function public.ensure_personal_tenant(text) to authenticated;

create or replace function public.accept_pending_invites()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_email text;
  v_invite record;
  v_count integer := 0;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Usuário não autenticado';
  end if;

  select lower(coalesce(u.email, ''))
    into v_email
  from auth.users u
  where u.id = v_user_id;

  if coalesce(v_email, '') = '' then
    return 0;
  end if;

  for v_invite in
    select i.id, i.tenant_id, i.role
    from public.tenant_invites i
    where lower(i.email) = v_email
      and i.status = 'pending'
      and i.expires_at >= now()
  loop
    insert into public.tenant_members (tenant_id, user_id, role, status)
    values (v_invite.tenant_id, v_user_id, v_invite.role, 'active')
    on conflict (tenant_id, user_id) do update
      set role = excluded.role,
          status = 'active',
          updated_at = now();

    update public.tenant_invites
       set status = 'accepted',
           accepted_by = v_user_id,
           accepted_at = now()
     where id = v_invite.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.accept_pending_invites() to authenticated;

-- ---------------------------------------------------------------------
-- RLS policies (safe scope: only new or tenant tables)
-- ---------------------------------------------------------------------
alter table public.user_profiles enable row level security;
alter table public.tenant_clients enable row level security;

-- tenant_members: allow admin/owner management in same tenant
drop policy if exists tenant_members_insert_admin_tenant on public.tenant_members;
create policy tenant_members_insert_admin_tenant
on public.tenant_members
for insert
to authenticated
with check (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_members.tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin')
      and tm.status = 'active'
  )
);

drop policy if exists tenant_members_update_admin_tenant on public.tenant_members;
create policy tenant_members_update_admin_tenant
on public.tenant_members
for update
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_members.tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin')
      and tm.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_members.tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin')
      and tm.status = 'active'
  )
);

-- tenant_invites: allow admin/owner create and revoke
drop policy if exists tenant_invites_insert_admin_tenant on public.tenant_invites;
create policy tenant_invites_insert_admin_tenant
on public.tenant_invites
for insert
to authenticated
with check (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_invites.tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin')
      and tm.status = 'active'
  )
);

drop policy if exists tenant_invites_update_admin_tenant on public.tenant_invites;
create policy tenant_invites_update_admin_tenant
on public.tenant_invites
for update
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
)
with check (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_invites.tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin')
      and tm.status = 'active'
  )
);

-- user_profiles
drop policy if exists user_profiles_select_self_or_scope on public.user_profiles;
create policy user_profiles_select_self_or_scope
on public.user_profiles
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.tenant_members me
    join public.tenant_members target
      on target.tenant_id = me.tenant_id
    where me.user_id = auth.uid()
      and me.status = 'active'
      and me.role in ('owner', 'admin', 'manager')
      and target.user_id = user_profiles.user_id
      and target.status = 'active'
  )
);

drop policy if exists user_profiles_insert_self on public.user_profiles;
create policy user_profiles_insert_self
on public.user_profiles
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists user_profiles_update_self_or_scope on public.user_profiles;
create policy user_profiles_update_self_or_scope
on public.user_profiles
for update
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.tenant_members me
    join public.tenant_members target
      on target.tenant_id = me.tenant_id
    where me.user_id = auth.uid()
      and me.status = 'active'
      and me.role in ('owner', 'admin')
      and target.user_id = user_profiles.user_id
      and target.status = 'active'
  )
)
with check (
  user_id = auth.uid()
  or exists (
    select 1
    from public.tenant_members me
    join public.tenant_members target
      on target.tenant_id = me.tenant_id
    where me.user_id = auth.uid()
      and me.status = 'active'
      and me.role in ('owner', 'admin')
      and target.user_id = user_profiles.user_id
      and target.status = 'active'
  )
);

-- tenant_clients
drop policy if exists tenant_clients_select_member on public.tenant_clients;
create policy tenant_clients_select_member
on public.tenant_clients
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_clients.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
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
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_clients.tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin')
      and tm.status = 'active'
  )
);

commit;
