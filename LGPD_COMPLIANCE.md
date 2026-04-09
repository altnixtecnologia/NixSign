# NixSign - Checklist LGPD (Operacional e Técnico)

Este checklist complementa o código. Conformidade LGPD depende de processo + governança + tecnologia.

## 1) Governança mínima
- Definir controlador e operador em contrato.
- Nomear encarregado (DPO) e manter canal de atendimento.
- Publicar política de privacidade e versão vigente.
- Manter registro de operações de tratamento (ROPA).

## 2) Bases legais e finalidade
- Assinatura digital: execução de contrato e exercício regular de direitos.
- Coletar somente dados necessários para assinatura e auditoria.
- Revisar periodicamente finalidade e retenção.

## 3) Direitos do titular (art. 18)
- Canal para solicitações de acesso, correção, anonimização, portabilidade, eliminação e revogação.
- Prazo interno para resposta (com triagem, validação de identidade e resposta documentada).
- Registrar cada solicitação e decisão.

## 4) Segurança
- RLS em tabelas sensíveis após validação em staging.
- Credenciais segregadas por ambiente e rotação periódica.
- Logs de auditoria com IP server-side, user-agent e data/hora UTC.
- Backup e teste de restauração periódicos.

## 5) Incidentes
- Plano de resposta a incidente de dados pessoais.
- Fluxo para avaliação de risco e eventual comunicação à ANPD e titulares.
- Registro de lições aprendidas e ações corretivas.

## 6) Evidência para litígio
- Preservar cadeia de custódia dos documentos assinados.
- Versionar termo/política e armazenar hash da versão aceita.
- Evitar edição manual de registros de assinatura após conclusão.

## Aviso
Este material é apoio técnico. Para validação jurídica final, usar revisão com advogado especializado em proteção de dados.
