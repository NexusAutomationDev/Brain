# Phase 14: TD-01 Fix - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Adicionar `prepare: false` à conexão postgres.js em `qualifier.ts` — especificamente em `saveQualificationToMemories` — tornando o sub-agente de qualificação compatível com PgBouncer transaction mode em produção. O escopo é exatamente TD-01: uma mudança de 1 linha + teste de regressão + comment de documentação. Nenhuma outra mudança no qualifier.

</domain>

<decisions>
## Implementation Decisions

### Fix

- **D-01:** Adicionar `prepare: false` em `postgres(dbUrl, { max: 1 })` (linha 28 de `apps/brain-sdr/src/qualifier.ts`) → `postgres(dbUrl, { max: 1, prepare: false })`. Mesma configuração do TenantPoolManager (`D-01, D-12`) e migrate.ts (`D-01`).

### Teste de Regressão

- **D-02:** Claude's Discretion — static analysis test. Adicionar `describe('PGB-TD01: prepare: false em saveQualificationToMemories', ...)` em `qualifier.unit.test.ts` usando regex para verificar que `postgres()` em qualifier.ts passa `prepare: false`. Mesmo padrão de PGB-05 em `migrate.test.ts`.

### Documentação PostgresSaver

- **D-03:** Adicionar comment curto (1-2 linhas) em `qualifier.ts` próximo a `PostgresSaver.fromConnString(dbUrl)` documentando que usa o driver `pg` internamente e referenciar `checkpointer.ts` para modos PgBouncer compatíveis. Não duplicar o bloco completo.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### TD-01

- `apps/brain-sdr/src/qualifier.ts` — arquivo alvo; linha 28 é a mudança principal
- `apps/brain-sdr/src/__tests__/unit/qualifier.unit.test.ts` — testes existentes; adicionar PGB-TD01 aqui
- `packages/database/src/tenant-pool-manager.ts` — referência de padrão: `prepare: false, D-01, D-12`
- `packages/database/src/migrate.ts` — referência de padrão: `prepare: false` com comentário D-01
- `packages/database/src/migrate.test.ts` — referência de padrão para o static analysis test (PGB-05)
- `packages/ai/src/graph/checkpointer.ts` — documentação da limitação PgBouncer do driver `pg` (referência para D-03)

### Requirements

- `.planning/REQUIREMENTS.md` §TD-01 — definição formal do requisito

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `qualifier.unit.test.ts` — já usa `readFileSync` + regex para static analysis; padrão reutilizável diretamente para PGB-TD01
- Padrão regex de PGB-05 em `migrate.test.ts`: `/postgres\([^)]*prepare:\s*false/.test(src)` — copiar e adaptar

### Established Patterns

- `prepare: false` sempre presente em qualquer `postgres()` call no projeto — sem exceção (TenantPoolManager, migrate.ts)
- Static analysis tests em `*.unit.test.ts` usando `readFileSync` + regex são o padrão do projeto para verificar invariantes de código sem I/O externo
- Comments inline no estilo `// PGB-XX: <motivo>` são o padrão para decisões de compatibilidade PgBouncer

### Integration Points

- `PostgresSaver.fromConnString(dbUrl)` usa o driver `pg` (node-postgres v8.21) — não é postgres.js, não aceita opção `prepare: false` no nível do pool. Esta limitação está documentada em `checkpointer.ts` e não faz parte do escopo de TD-01.
- `saveQualificationToMemories` cria uma conexão postgres.js de curta duração (`max: 1`) com `sql.end()` no finally — o `prepare: false` aqui é seguro e não tem side effects.

</code_context>

<specifics>
## Specific Ideas

- Nenhuma referência específica além do padrão já existente no projeto.

</specifics>

<deferred>
## Deferred Ideas

Nenhuma — a discussão ficou dentro do escopo da fase.

</deferred>

---

*Phase: 14-td-01-fix*
*Context gathered: 2026-06-15*
