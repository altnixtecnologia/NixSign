-- Security hardening draft for Assinador de Documentos
-- IMPORTANT:
-- 1) Run first in a staging project.
-- 2) Backup production before applying.
-- 3) Validate admin and signing flows after each block.

begin;

-- 1) Prevent duplicate signatures per document
create unique index if not exists ux_assinaturas_documento_id
on public.assinaturas (documento_id);

commit;

-- ---------------------------------------------------------------------
-- OPTIONAL BLOCK (RLS): apply only after staging validation
-- ---------------------------------------------------------------------
-- begin;
--
-- alter table public.documentos enable row level security;
-- alter table public.assinaturas enable row level security;
--
-- -- Admin: full access to own documents
-- drop policy if exists documentos_admin_all on public.documentos;
-- create policy documentos_admin_all
-- on public.documentos
-- for all
-- to authenticated
-- using (admin_id = auth.uid() or admin_id is null)
-- with check (admin_id = auth.uid() or admin_id is null);
--
-- -- Authenticated signer: read only documents that have public signature link
-- drop policy if exists documentos_signer_read on public.documentos;
-- create policy documentos_signer_read
-- on public.documentos
-- for select
-- to authenticated
-- using (link_assinatura is not null);
--
-- -- Signatures: admin can read signatures from own documents
-- drop policy if exists assinaturas_admin_read on public.assinaturas;
-- create policy assinaturas_admin_read
-- on public.assinaturas
-- for select
-- to authenticated
-- using (
--   exists (
--     select 1
--     from public.documentos d
--     where d.id = assinaturas.documento_id
--       and (d.admin_id = auth.uid() or d.admin_id is null)
--   )
-- );
--
-- -- Signer can insert only own signature
-- drop policy if exists assinaturas_signer_insert on public.assinaturas;
-- create policy assinaturas_signer_insert
-- on public.assinaturas
-- for insert
-- to authenticated
-- with check (google_user_id = auth.uid());
--
-- commit;
