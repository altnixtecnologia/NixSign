-- NixSign - LGPD compliance controls (safe / non-destructive)
-- Goal: add explicit legal-basis metadata, consent evidence and titular request workflow.
-- Safety rules:
-- 1) No DROP TABLE / DROP COLUMN
-- 2) No DELETE / UPDATE on existing business records
-- 3) Existing signed documents remain untouched

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Document-level legal metadata
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.documentos') is not null then
    alter table public.documentos add column if not exists legal_basis text null;
    alter table public.documentos add column if not exists treatment_purpose text null;
    alter table public.documentos add column if not exists retention_until timestamptz null;
    alter table public.documentos add column if not exists contains_personal_data boolean not null default true;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Signature-level legal metadata
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.assinaturas') is not null then
    alter table public.assinaturas add column if not exists consent_version text null;
    alter table public.assinaturas add column if not exists consent_text_hash text null;
    alter table public.assinaturas add column if not exists consent_accepted_at timestamptz null;
    alter table public.assinaturas add column if not exists consent_ip text null;
    alter table public.assinaturas add column if not exists consent_user_agent text null;
    alter table public.assinaturas add column if not exists legal_basis text null;
    alter table public.assinaturas add column if not exists treatment_purpose text null;
    alter table public.assinaturas add column if not exists cpf_cnpj_hash text null;
    alter table public.assinaturas add column if not exists cpf_cnpj_masked text null;
    alter table public.assinaturas add column if not exists signed_at_utc timestamptz null;
  end if;
end $$;

create index if not exists idx_assinaturas_signed_at_utc on public.assinaturas (signed_at_utc desc);
create index if not exists idx_assinaturas_cpf_cnpj_hash on public.assinaturas (cpf_cnpj_hash);
create index if not exists idx_assinaturas_consent_version on public.assinaturas (consent_version);

-- ---------------------------------------------------------------------
-- Utility functions for minimization and evidence
-- ---------------------------------------------------------------------
create or replace function public.mask_cpf_cnpj(input_value text)
returns text
language plpgsql
as $$
declare
  digits text;
begin
  digits := regexp_replace(coalesce(input_value, ''), '\D', '', 'g');
  if length(digits) = 11 then
    return repeat('*', 7) || right(digits, 4);
  elsif length(digits) = 14 then
    return repeat('*', 10) || right(digits, 4);
  end if;
  return null;
end;
$$;

create or replace function public.hash_identifier(input_value text)
returns text
language sql
as $$
  select case
    when coalesce(input_value, '') = '' then null
    else encode(digest(regexp_replace(input_value, '\D', '', 'g'), 'sha256'), 'hex')
  end
$$;

create or replace function public.assinaturas_lgpd_fill()
returns trigger
language plpgsql
as $$
begin
  new.cpf_cnpj_hash := public.hash_identifier(new.cpf_cnpj_signatario);
  new.cpf_cnpj_masked := public.mask_cpf_cnpj(new.cpf_cnpj_signatario);
  if new.signed_at_utc is null then
    new.signed_at_utc := now();
  end if;
  if new.legal_basis is null then
    new.legal_basis := 'execucao_de_contrato_e_exercicio_regular_de_direitos';
  end if;
  if new.treatment_purpose is null then
    new.treatment_purpose := 'assinatura_eletronica_documental';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assinaturas_lgpd_fill on public.assinaturas;
create trigger trg_assinaturas_lgpd_fill
before insert or update on public.assinaturas
for each row execute function public.assinaturas_lgpd_fill();

-- ---------------------------------------------------------------------
-- Data subject rights workflow (Art. 18 LGPD)
-- ---------------------------------------------------------------------
create table if not exists public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('access', 'correction', 'anonymization', 'deletion', 'portability', 'revocation', 'review_automated_decision')),
  status text not null default 'open' check (status in ('open', 'in_review', 'fulfilled', 'denied', 'archived')),
  requester_name text null,
  requester_email text not null,
  requester_document_hash text null,
  requester_document_masked text null,
  request_details text null,
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'rejected')),
  legal_basis text null,
  due_at timestamptz null,
  resolved_at timestamptz null,
  resolver_user_id uuid null,
  resolution_notes text null,
  requester_ip text null,
  requester_user_agent text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_data_subject_requests_status on public.data_subject_requests (status);
create index if not exists idx_data_subject_requests_type on public.data_subject_requests (request_type);
create index if not exists idx_data_subject_requests_email on public.data_subject_requests (requester_email);
create index if not exists idx_data_subject_requests_due_at on public.data_subject_requests (due_at);

commit;
