---
phase: 06-leads-schema-migration
verified: 2026-06-14T01:44:59Z
status: passed
score: 9/9
overrides_applied: 0
human_verification:
  - test: "Brain inicializa contra banco vazio e cria tabela leads antes de aceitar mensagem"
    expected: "runner.init() conclui sem erro e tabela leads existe no banco após startup"
    why_human: "Requer banco PostgreSQL vivo para executar runMigrations() + verificar schema criado"
  - test: "Startup race condition prevenida com múltiplas instâncias concorrentes"
    expected: "Segunda instância aguarda bloqueada até a primeira liberar o pg_advisory_lock — nenhuma colisão de migration"
    why_human: "Requer subir duas instâncias simultâneas contra o mesmo banco para observar serialização"
---

# Phase 6: Leads Schema + Migration — Verification Report

**Phase Goal:** Tabela `leads` existe no banco com constraint UNIQUE em `numero`, e o Brain verifica/cria tabelas automaticamente na inicialização — nunca aceita mensagens sem schema pronto
**Verified:** 2026-06-14T01:44:59Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

Fontes de must-haves: ROADMAP.md Success Criteria (4 itens) + PLAN 01 frontmatter (5 truths) + PLAN 02 frontmatter (5 truths). Após deduplicação e merge, 9 truths distintos verificáveis programaticamente + 2 itens que requerem banco vivo (Steps 7b/8).

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Migration SQL cria tabela `leads` (id, unique_id, nome, numero, ia_ativada, fullpp) com UNIQUE constraint em `numero` | VERIFIED | `0004_even_rick_jones.sql` linha 1-13: `CREATE TABLE "leads"` com 8 colunas e `CREATE UNIQUE INDEX "leads_numero_unique_idx"` |
| 2 | Tabela `users` não é removida — migration é aditiva | VERIFIED | `export const users` preservado em `tables.ts` linha 15; SQL 0004 não contém `DROP TABLE users` |
| 3 | leadsTable definida em tables.ts com todos os campos D-01 a D-07 | VERIFIED | Todos os 8 campos presentes: id (uuid PK), unique_id (text NOT NULL), nome (text nullable), numero (text NOT NULL), ia_ativada (boolean NOT NULL DEFAULT true), fullpp (boolean nullable), created_at, updated_at |
| 4 | UNIQUE constraint em `numero` presente na definição Drizzle | VERIFIED | `tables.ts` linha 99: `uniqueIndex('leads_numero_unique_idx').on(table.numero)` |
| 5 | Schema `leads` exportado do barrel e disponível para outros pacotes | VERIFIED | `packages/database/src/index.ts` linha 2: `export * from './schema/tables.js'` — `export const leads` em tables.ts é auto-exportado |
| 6 | `_journal.json` tem entry idx:4 apontando para a migration correta | VERIFIED | `_journal.json` linha 34-37: `"idx": 4, "tag": "0004_even_rick_jones"` |
| 7 | runMigrations() adquire pg_advisory_lock antes de migrate() | VERIFIED | `migrate.ts` linha 17: `await sql\`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})\`` — ANTES do try block que chama migrate() |
| 8 | BrainRunner.init() chama runMigrations() antes de loadPrompts() | VERIFIED | `runner.ts` linhas 97→103→103: `await runMigrations(...)` na linha 97, `loadPrompts()` na linha 103 — ordem garantida |
| 9 | apps/brain-echo/src/index.ts não chama runMigrations() diretamente | VERIFIED | Grep encontrou apenas comentários de documentação (linhas 2 e 26) — zero chamadas reais a `runMigrations()` |

**Score:** 9/9 truths verificados programaticamente

### Deferred Items

Nenhum item verificado foi deferido para fases futuras.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/database/src/schema/tables.ts` | leadsTable Drizzle definition exportada | VERIFIED | `export const leads = pgTable('leads', {...})` — linha 81, todos os campos D-01 a D-07 presentes |
| `packages/database/src/migrate.ts` | runMigrations() com advisory lock | VERIFIED | MIGRATION_LOCK_KEY=7316882, pg_advisory_lock antes do try, pg_advisory_unlock no finally |
| `packages/database/src/migrations/0004_even_rick_jones.sql` | SQL de criação da tabela leads com UNIQUE constraint | VERIFIED | CREATE TABLE "leads" com 8 colunas, CREATE UNIQUE INDEX leads_numero_unique_idx |
| `packages/database/src/migrations/meta/_journal.json` | Journal atualizado com entry idx:4 | VERIFIED | Entry idx:4 com tag "0004_even_rick_jones" presente |
| `packages/core/src/runner/runner.ts` | BrainRunner.init() com runMigrations() integrado | VERIFIED | import + campo migrationsFolder + atribuição no constructor + await runMigrations() em init() |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/database/src/schema/tables.ts` | `packages/database/src/index.ts` | `export * from './schema/tables.js'` | WIRED | Barrel re-exporta tudo de tables.ts — `leads` incluído automaticamente |
| `packages/database/src/migrate.ts` | PostgreSQL advisory lock | `sql\`SELECT pg_advisory_lock(7316882)\`` | WIRED | Chamada blocking na linha 17, antes do try; unlock no finally linha 25 |
| `packages/core/src/runner/runner.ts` | `packages/database/src/migrate.ts` | `import { runMigrations } from '@brain-pkg/database'` | WIRED | Import na linha 11 + `await runMigrations(this.sql, migrationsFolder)` na linha 97 |
| `BrainRunner.init()` | `runMigrations()` | `await runMigrations(this.sql, migrationsFolder)` | WIRED | Chamada na linha 97 de runner.ts, ANTES de loadPrompts() na linha 103 |

### Data-Flow Trace (Level 4)

Não aplicável a esta fase — os artefatos são schema definitions, migration runners e lifecycle hooks, não componentes que renderizam dados dinâmicos. Não há estado derivado de fetch/query sendo renderizado.

### Behavioral Spot-Checks

| Comportamento | Comando | Resultado | Status |
|---------------|---------|-----------|--------|
| Typecheck packages/database sem erros | `cd packages/database && bun run typecheck` | Exit 0, sem output | PASS |
| Typecheck packages/core sem erros | `cd packages/core && bun run typecheck` | Exit 0, sem output | PASS |
| Typecheck apps/brain-echo sem erros | `cd apps/brain-echo && bun run typecheck` | Exit 0, sem output | PASS |
| Build monorepo completo (8/8) | `bun run build` (raiz) | `Tasks: 8 successful, 8 total` | PASS |
| Commits referenciados nas SUMMARYs existem no git | `git log --oneline \| grep HASH` | 3844905, 34a6c63, 4d06099, a72aebd — todos encontrados | PASS |
| brain-echo sem import/call direto a runMigrations | `grep "runMigrations" apps/brain-echo/src/index.ts` | Apenas 2 linhas de comentário — zero chamadas reais | PASS |
| Brain inicializa contra banco vazio (runtime) | Requer banco vivo | N/A — sem servidor | SKIP |
| Advisory lock serializa duas instâncias concorrentes | Requer 2 instâncias | N/A — sem runtime | SKIP |

### Requirements Coverage

| Requirement | Plano | Descrição | Status | Evidência |
|-------------|-------|-----------|--------|-----------|
| LEAD-01 | 06-01, 06-02 | Tabela `leads` (id, unique_id, nome, numero, ia_ativada, fullpp) criada como substituta de `users` | SATISFIED | leadsTable com todos os campos definida em tables.ts; SQL 0004 cria a tabela no banco; users preservada (aditiva) |
| LEAD-04 | 06-01, 06-02 | Brain executa auto-migrate na inicialização — verifica e cria tabelas necessárias antes de aceitar mensagens | SATISFIED (código) / NEEDS HUMAN (runtime) | BrainRunner.init() chama runMigrations() com advisory lock antes de loadPrompts(); fail-fast com process.exit(1) se MIGRATIONS_FOLDER ausente; verificação em banco real necessária para confirmar comportamento em produção |

Nenhum REQ-ID adicional mapeado para Phase 6 em REQUIREMENTS.md além de LEAD-01 e LEAD-04.

### Anti-Patterns Found

Nenhum anti-pattern encontrado nos arquivos modificados nesta fase:
- Sem TODO/FIXME/HACK/PLACEHOLDER
- Sem `return null` ou implementações vazias
- Sem props hardcoded com `[]` ou `{}`
- Lógica de migration é substantiva (not stub): advisory lock + try/finally + logging estruturado

| Arquivo | Linha | Padrão | Severidade | Impacto |
|---------|-------|--------|------------|---------|
| — | — | Nenhum | — | — |

### Human Verification Required

#### 1. Brain Inicializa Contra Banco Vazio

**Test:** Subir um banco PostgreSQL limpo (sem nenhuma tabela), configurar `DATABASE_URL` e `MIGRATIONS_FOLDER` apontando para `packages/database/src/migrations`, e executar `bun src/index.ts` em `apps/brain-echo`.

**Expected:** `runner.init()` conclui sem erro; logs mostram `[migrate] Advisory lock adquirido`, `[migrate] Migrations concluídas com sucesso`, `BrainRunner initialized`; inspecionar o banco confirma que a tabela `leads` existe com os campos corretos.

**Why human:** Requer banco PostgreSQL vivo. A verificação programática apenas confirma que o código chama `runMigrations()` — não que o SQL aplica com sucesso e a tabela é criada.

#### 2. Startup Race Condition Prevenida com Advisory Lock

**Test:** Subir duas instâncias de `brain-echo` simultaneamente contra o mesmo banco (em terminais separados), observar os logs de ambas.

**Expected:** Uma instância imprime `[migrate] Advisory lock adquirido` primeiro; a outra fica bloqueada em `[migrate] Aguardando advisory lock...` até a primeira terminar e imprimir `[migrate] Advisory lock liberado`. Nenhuma race condition — apenas uma migration por vez.

**Why human:** Requer infraestrutura de runtime concorrente — impossível verificar serialização de advisory lock sem executar múltiplas instâncias reais contra PostgreSQL.

### Gaps Summary

Nenhum gap. Todos os 9 truths verificáveis programaticamente passaram. Os 2 itens de verificação humana são sobre comportamento runtime (banco vivo + concorrência) — não representam gaps de implementação, mas confirmações de integração que o código existente suporta corretamente.

---

_Verified: 2026-06-14T01:44:59Z_
_Verifier: Claude (gsd-verifier)_
