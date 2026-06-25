---
phase: 19-database-foundation
verified: 2026-06-23T22:00:00Z
status: human_needed
score: 5/5
overrides_applied: 0
human_verification:
  - test: "Aplicar migration 0007 em banco com dados existentes (leads preexistentes)"
    expected: "ALTER TABLE leads ADD COLUMN sem erro; leads existentes mantêm valores default corretos (fup_enabled=false, fup_step=0, fup_next_at=NULL, last_message_at=NULL)"
    why_human: "SUMMARY 02 verificou contra banco de teste vazio. SC 1 exige verificação em banco com dados existentes — não há como confirmar programaticamente sem banco real"
deferred:
  - truth: "BrainRunner.run() cancela todos os FUPs pendentes ao receber mensagem (segunda parte do FUP-06)"
    addressed_in: "Phase 22"
    evidence: "Phase 22 Success Criteria 2: 'Quando o lead responde, todos os FUPs pendentes são cancelados e last_message_at é atualizado'"
---

# Phase 19: Database Foundation — Verification Report

**Phase Goal:** Schema estável para v1.4 disponível para todos os Brains — tabelas e colunas criadas em migration única antes que qualquer feature de RAG, Tool Events ou FUP seja implementada
**Verified:** 2026-06-23T22:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Migration `0007_v1_4_foundation` aplica sem erro em banco limpo e em banco com dados existentes | PARTIAL — banco limpo verificado; banco com dados requer human | SUMMARY 02: psql verification passou para banco `brain_test` limpo. Banco com dados existentes não confirmado. |
| 2 | Tabela `knowledge_chunks` existe com colunas `collection`, `embedding`, `content`, `embedding_model`, `chunk_index`, `total_chunks` e metadados obrigatórios não-nulos | VERIFIED | `0007_v1_4_foundation.sql` linha 1-11: `CREATE TABLE "knowledge_chunks"` com todas as colunas NOT NULL; `knowledgeChunks` exportado em `tables.ts` linha 105-116 |
| 3 | Tabela `fup_config` existe com colunas de configuração de intervalos, horários, dias e fuso horário | VERIFIED | `0007_v1_4_foundation.sql` linhas 13-23: `CREATE TABLE "fup_config"` com `intervals_seconds integer[]`, `min_hour`, `max_hour`, `allowed_days text[]`, `timezone`; `fupConfig` exportado em `tables.ts` linha 121-137 |
| 4 | Tabela `leads` possui colunas `fup_enabled`, `fup_step`, `fup_next_at` e `last_message_at` | VERIFIED | `0007_v1_4_foundation.sql` linhas 25-31: 4 ADD COLUMNs corretos; `tables.ts` linhas 93-96: 4 campos Drizzle adicionados à definição de `leads` |
| 5 | `BrainRunner.run()` chama `LeadService.touchLastMessage()` a cada mensagem recebida, atualizando `last_message_at` incondicionalmente | VERIFIED | `runner.ts` linha 192: `await this.leadService.touchLastMessage(lead.uniqueId)` antes de `if (!lead.iaAtivada)` linha 196; 3 testes confirmam em `runner-fup.test.ts` |

**Score:** 5/5 truths verified (SC 1 parcialmente satisfeita por banco limpo; banco com dados requer confirmação humana)

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Cancelamento de FUPs pendentes ao receber mensagem (parte do FUP-06) | Phase 22 | Phase 22 SC 2: "Quando o lead responde, todos os FUPs pendentes são cancelados e `last_message_at` é atualizado" |

**Nota:** O ROADMAP atribuiu FUP-06 à Phase 19, mas a Phase 19 Success Criteria (SC 5) escopo apenas `touchLastMessage()`. O cancelamento de FUPs pendentes não tem infraestrutura disponível em Phase 19 (o scheduler ainda não existe) e está explicitamente no contrato de Phase 22 SC 2.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/database/src/migrations/0007_v1_4_foundation.sql` | DDL completo para knowledge_chunks, fup_config e ADD COLUMNs em leads | VERIFIED | 32 linhas; 2 CREATE TABLE + 4 ADD COLUMN; vector(1536), integer[], text[] corretos |
| `packages/database/src/migrations/meta/_journal.json` | Registro de migration idx=7 | VERIFIED | Entry `{"idx":7,"tag":"0007_v1_4_foundation","breakpoints":true}` confirmada |
| `packages/database/src/schema/tables.ts` | Schema Drizzle atualizado — exporta knowledgeChunks e fupConfig, leads com 4 colunas FUP | VERIFIED | `export const knowledgeChunks` (linha 105), `export const fupConfig` (linha 121); `fupEnabled`, `fupStep`, `fupNextAt`, `lastMessageAt` em leads (linhas 93-96) |
| `packages/database/src/__tests__/integration/migration-v14.test.ts` | 13 testes de scaffold Wave 0 | VERIFIED | 13 pass, 0 fail confirmado: `bun test packages/database/src/__tests__/integration/migration-v14.test.ts` |
| `packages/core/src/leads/lead-service.ts` | Método touchLastMessage() para FUP-06 | VERIFIED | `async touchLastMessage(uniqueId: string): Promise<void>` linha 116; `db.update(leads).set({ lastMessageAt: new Date() }).where(eq(leads.uniqueId, uniqueId))` linhas 117-120 |
| `packages/core/src/runner/runner.ts` | Chamada a touchLastMessage() antes do gate ia_ativada | VERIFIED | Linha 192: `await this.leadService.touchLastMessage(lead.uniqueId)`; gate em linha 196 — ordem correta confirmada |
| `packages/core/src/runner/__tests__/runner-fup.test.ts` | 3 testes de integração BrainRunner + touchLastMessage | VERIFIED | 3 pass, 0 fail confirmado: `bun test packages/core/src/runner/__tests__/runner-fup.test.ts` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `tables.ts` | `0007_v1_4_foundation.sql` | Definições Drizzle refletem DDL SQL | VERIFIED | `knowledgeChunks` → `knowledge_chunks`; `fupConfig` → `fup_config`; colunas FUP em leads mapeadas corretamente |
| `_journal.json` | `0007_v1_4_foundation.sql` | Entry idx=7 referencia o arquivo SQL | VERIFIED | `"tag": "0007_v1_4_foundation"` com `"idx": 7` confirmado |
| `runner.ts` | `lead-service.ts` | `this.leadService.touchLastMessage(lead.uniqueId)` ANTES de `if (!lead.iaAtivada)` | VERIFIED | Linha 192 precede linha 196 no mesmo método `run()` |
| `lead-service.ts` | Schema Drizzle (leads) | `db.update(leads).set({ lastMessageAt }).where(eq(leads.uniqueId, uniqueId))` | VERIFIED | `lastMessageAt` existe em `leads` (tables.ts linha 96); update correto em lead-service.ts linha 119 |
| `tables.ts` | `index.ts` (@brain-pkg/database) | `export * from './schema/tables.js'` | VERIFIED | `index.ts` usa `export *` — `knowledgeChunks` e `fupConfig` automaticamente disponíveis |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `lead-service.ts` touchLastMessage | `lastMessageAt: new Date()` | `new Date()` — timestamp gerado em runtime | Sim — `new Date()` é valor real não-hardcoded | FLOWING |
| `runner.ts` | `lead.uniqueId` passado para touchLastMessage | `upsertLead()` que busca do banco | Sim — uniqueId vem do resultado do upsert | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 13 scaffold tests passam | `bun test packages/database/src/__tests__/integration/migration-v14.test.ts` | 13 pass, 0 fail | PASS |
| 3 runner-fup tests passam | `bun test packages/core/src/runner/__tests__/runner-fup.test.ts` | 3 pass, 0 fail | PASS |
| 8 lead-service tests passam | `bun test packages/core/src/leads/__tests__/lead-service.test.ts` | 8 pass, 0 fail | PASS |
| migration SQL tem 2 CREATE TABLE | `grep -c "CREATE TABLE" 0007_v1_4_foundation.sql` | 2 | PASS |
| journal contém tag 0007 | `jq '.entries[] \| select(.tag=="0007_v1_4_foundation")'` | `{"idx":7,...}` | PASS |
| tables.ts exporta knowledgeChunks e fupConfig | `grep "export const knowledgeChunks\|export const fupConfig" tables.ts` | 2 matches | PASS |
| touchLastMessage antes do gate no runner | `grep -n "touchLastMessage\|iaAtivada" runner.ts` | linha 192 < linha 196 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| FUP-04 | 19-01-PLAN.md | Estado de FUP de cada lead persistido com fup_step, fup_next_at, fup_enabled em leads | SATISFIED | migration 0007 ADD COLUMN fup_enabled, fup_step, fup_next_at; tables.ts campos fupEnabled, fupStep, fupNextAt; + last_message_at também adicionado |
| FUP-06 | 19-02-PLAN.md | BrainRunner.run() cancela FUPs pendentes e atualiza last_message_at | PARTIAL — touchLastMessage implementado; cancelamento de FUPs pendentes em Phase 22 | runner.ts linha 192 + lead-service.ts; cancelamento aguarda scheduler Phase 22 |

**Orphaned requirements check:** REQUIREMENTS.md mapeia apenas FUP-04 e FUP-06 para Phase 19. Nenhum requisito orphaned.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (nenhum) | — | — | — | — |

Scan realizado em todos os 7 arquivos modificados/criados. Nenhum TODO/FIXME/PLACEHOLDER/stub encontrado. Nenhum `return null` ou array vazio hardcoded em fluxo de dados real.

### Falhas de Teste Pre-Existentes (fora do escopo Phase 19)

`bun test packages/database packages/core` reporta 2 falhas em `brain-runner.integration.test.ts`. Este arquivo existia antes da Phase 19 (confirmado via `git show HEAD~6`) e requer PostgreSQL real via `POSTGRES_URL`/`TEST_DATABASE_URL`. O ambiente CI atual não tem banco disponível. As falhas são timeouts de `beforeEach`/`afterEach`, não relacionadas a código de Phase 19. SUMMARY 02 reportou 156 pass / 5 skip quando DB estava disponível.

### Human Verification Required

#### 1. Migration em banco com dados existentes

**Teste:** Aplicar `0007_v1_4_foundation` em banco PostgreSQL que já tem leads cadastrados (pelo menos 5-10 leads com `numero`, `unique_id`, `ia_ativada` preexistentes).

**Procedimento:**
```bash
# Verificar estado antes
psql $DATABASE_URL -c "SELECT COUNT(*) FROM leads;"

# Aplicar migration (via runMigrations ou psql direto)
psql $DATABASE_URL -f packages/database/src/migrations/0007_v1_4_foundation.sql

# Verificar após — leads existentes devem ter defaults corretos
psql $DATABASE_URL -c "SELECT id, fup_enabled, fup_step, fup_next_at, last_message_at FROM leads LIMIT 5;"
```

**Esperado:**
- Migration aplica sem erro (`ERROR` não aparece)
- `fup_enabled = false` para todos os leads existentes
- `fup_step = 0` para todos os leads existentes
- `fup_next_at = NULL` para todos os leads existentes
- `last_message_at = NULL` para todos os leads existentes

**Por que human:** O SUMMARY 02 verificou contra banco `brain_test` sem leads preexistentes. A SC 1 do ROADMAP exige "banco com dados existentes" explicitamente. Os DEFAULTs do SQL estão corretos (`DEFAULT false`, `DEFAULT 0`, sem NOT NULL para nullable), mas a confirmação contra dados reais não pode ser feita programaticamente aqui.

### Gaps Summary

Nenhum gap bloqueador identificado. Todos os 5 Success Criteria do ROADMAP estão implementados no código. A única verificação pendente (SC 1 — banco com dados existentes) é confirmação de comportamento esperado, não ausência de implementação.

O item FUP-06 "cancelar FUPs pendentes" não é um gap: o ROADMAP Phase 19 SC 5 deliberadamente escopo apenas `touchLastMessage()`, e a lógica de cancelamento está contratualmente em Phase 22 SC 2.

---

_Verified: 2026-06-23T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
