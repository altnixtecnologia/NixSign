-- NixSign - Legal signature evidence hardening (safe / non-destructive)
-- Goal: improve legal audit trail for signatures.
-- Safety rules:
-- 1) No DROP TABLE / DROP COLUMN
-- 2) No DELETE / UPDATE on existing business records
-- 3) Existing signed documents remain untouched

begin;

create table if not exists public.signature_audit_events (
  id bigserial primary key,
  documento_id uuid not null,
  assinatura_id uuid null,
  event_type text not null default 'document_signed',
  signer_auth_user_id uuid null,
  signer_email text null,
  signer_ip text null,
  signer_user_agent text null,
  signer_language text null,
  signer_timezone text null,
  google_provider_user_id text null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_signature_audit_events_documento_id
  on public.signature_audit_events (documento_id);

create index if not exists idx_signature_audit_events_assinatura_id
  on public.signature_audit_events (assinatura_id);

create index if not exists idx_signature_audit_events_occurred_at
  on public.signature_audit_events (occurred_at desc);

create table if not exists public.document_audit_events (
  id bigserial primary key,
  documento_id uuid not null,
  event_type text not null default 'document_created',
  actor_auth_user_id uuid null,
  actor_email text null,
  actor_ip text null,
  actor_user_agent text null,
  actor_language text null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_document_audit_events_documento_id
  on public.document_audit_events (documento_id);

create index if not exists idx_document_audit_events_occurred_at
  on public.document_audit_events (occurred_at desc);

commit;
