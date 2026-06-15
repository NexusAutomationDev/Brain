---
phase: 11
slug: tool-contracts-sdk
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-15
---

# Phase 11 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| ENV → ToolsRegistry | `process.env.BRAIN_TOOLS` lido em runtime — operador do container controla o valor | Nomes de tools (strings internas, sem PII) |
| LangGraph Config → Tool | `config?.configurable?.thread_id` passa pelo LangGraph — BrainRunner seta o thread_id, não o LLM | `lead.uniqueId` (IDLead canonical) |
| tool handler → PostgreSQL | Drizzle UPDATE em `leads` usando `thread_id` do config (não do LLM) | `fullpp`, `ia_ativada` (campos booleanos de controle) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-11-01 | Tampering | `process.env.BRAIN_TOOLS` CSV parsing | accept | Controlado pelo operador do container (não exposto ao usuário final); `.trim()` previne espaços acidentais | closed |
| T-11-02 | Spoofing | `thread_id` via RunnableConfig | mitigate | D-05/D-06: `thread_id` definido pelo BrainRunner (`lead.uniqueId`), nunca do payload do LLM; schema `z.object({})` impede LLM de injetar `lead_id` | closed |
| T-11-03 | Elevation of Privilege | Tool BRAIN_TOOLS bypass | mitigate | Guard em `enableTool()` (não em `getTools()`) — tool não entra no registry se não está na whitelist; silêncio previne enumeração de tools disponíveis (D-07) | closed |
| T-11-04 | Spoofing | `finish_conversation` thread_id | mitigate | Guard `if (!threadId) return "Erro"` — UPDATE sem WHERE é impossível; `threadId` vem do BrainRunner, não do LLM (D-05/D-06) | closed |
| T-11-05 | Tampering | `finish_conversation` atomicidade | mitigate | UPDATE único com `.set({ iaAtivada: false, fullpp: false })` — impossível ter `ia_ativada=false` sem `fullpp=false` (Pitfall 1 mitigado) | closed |
| T-11-06 | Repudiation | Tool invocação sem log | accept | LangSmith traces cobrem a execução do grafo; log explícito da tool seria ruído para v1.2 | closed |
| T-11-07 | Information Disclosure | Factory sql closure leak | accept | `sql` injetado via `BrainBuildContext` (não global); cada instância do Brain tem seu próprio `sql` isolado | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-11-01 | T-11-01 | `BRAIN_TOOLS` é um ENV de configuração de infraestrutura controlado pelo operador do container — não é uma superfície exposta ao usuário final. Parse CSV com `.trim()` mitiga entrada malformada por erro humano. Sem exposição PII. | gsd-security-auditor | 2026-06-15 |
| AR-11-02 | T-11-06 | LangSmith traces capturam a invocação de cada tool dentro do grafo LangGraph. Log adicional dentro da tool duplicaria informação sem agregar rastreabilidade. Aceito para v1.2; logging granular pode ser adicionado em versões futuras se necessário para compliance. | gsd-security-auditor | 2026-06-15 |
| AR-11-03 | T-11-07 | O `sql` é injetado via factory function (closure) no momento em que o Brain é compilado — cada instância de Brain recebe seu próprio `drizzle(sql)`. Não há `sql` global compartilhado. O isolamento é estrutural, não dependente de configuração. | gsd-security-auditor | 2026-06-15 |

---

## Mitigation Evidence

### T-11-02 — Spoofing: thread_id via RunnableConfig
- `pause-session.ts:27`: `const threadId = config?.configurable?.thread_id as string | undefined`
- `finish-conversation.ts:28`: idem
- Schema `z.object({})` em ambas as tools (pause-session.ts:41, finish-conversation.ts:44) — LLM não tem parâmetros para injetar identificador de lead

### T-11-03 — Elevation of Privilege: BRAIN_TOOLS bypass
- `registry.ts:60-61`: `if (this.envWhitelist !== null && !this.envWhitelist.has(toolName)) { return; }` — guard antes de qualquer mutação do registry
- Tool nunca entra no Set de tools permitidas se não está na whitelist
- Return silencioso (sem log, sem erro) previne enumeração das tools disponíveis (D-07)

### T-11-04 — Spoofing: finish_conversation thread_id
- `finish-conversation.ts:29-31`: `if (!threadId) { return "Erro: thread_id não disponível na configuração"; }` — primeiro branch após extração do `threadId`, antes de qualquer operação de banco

### T-11-05 — Tampering: finish_conversation atomicidade
- `finish-conversation.ts:36`: `.set({ iaAtivada: false, fullpp: false, updatedAt: new Date() })` — único `.set()` em único `.update()` chain
- Ambos os campos mutados atomicamente em uma instrução SQL

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-15 | 7 | 7 | 0 | gsd-security-auditor (gsd-secure-phase 11) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-15
