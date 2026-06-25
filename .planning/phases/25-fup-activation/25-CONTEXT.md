# Phase 25: FUP Activation Trigger - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Ativar `fup_enabled` automaticamente para leads recém-criados quando `fup_config` existe e está habilitada para o `brain_type` — sem intervenção manual no banco, FUP operacional em produção imediatamente após configuração.

**Inclui:** Modificação de `upsertLead()` para aceitar `brainType` e consultar `fup_config`, lógica de ativação condicional apenas em INSERT (não UPDATE), ajustes no BrainRunner para passar `brainType` ao LeadService.

**Não inclui:** Migração de leads existentes, nova coluna de opt-out, dashboard de FUP, FUP iniciado por tool call.

</domain>

<decisions>
## Implementation Decisions

### Trigger de Ativação (upsertLead)

- **D-01:** `upsertLead()` recebe parâmetro opcional `brainType?: string`. Quando informado, consulta `fup_config` para decidir se ativa FUP.
- **D-02:** Na INSERÇÃO (lead novo): se `fup_config` existe para o `brainType` E `enabled = true`, seta `fup_enabled = true` no lead criado.
- **D-03:** No UPDATE (lead existente): `fup_enabled` NUNCA é alterado — preserva o estado atual do lead. Isso garante que opt-out manual (operador setou `fup_enabled = false`) seja respeitado.
- **D-04:** Se `fup_config` não existir para o `brainType` (ou `brainType` não informado), comportamento silencioso: `fup_enabled = false` (default da tabela). Sem warning no log.

### Cálculo do Primeiro fup_next_at

- **D-05:** `fup_next_at` NÃO é calculado em `upsertLead()`. Lead é criado com `fup_enabled = true` mas `fup_next_at = NULL`. O FupScheduler calcula no primeiro tick de polling.
- **D-06:** FupScheduler exige `last_message_at IS NOT NULL` para processar lead. Lead recém-criado sem mensagem não entra no ciclo de FUP — FUP só ativa após a primeira mensagem real.

### Leads Existentes

- **D-07:** Leads que já existem no banco (antes da Phase 25) NÃO são tocados. Permanecem com `fup_enabled = false`. Operador ativa manualmente se necessário via SQL.

### Fluxo de Dados

- **D-08:** BrainRunner.run() passa `brainType` do Brain ao chamar `leadService.upsertLead()`. O `brainType` já está disponível no contexto do Brain (IBrain.type).

### Claude's Discretion

- Implementação da query a `fup_config`: pode ser SELECT inline em `upsertLead()` ou cache no LeadService
- Estrutura interna do conditional insert vs update (Drizzle onConflictDoUpdate com lógica condicional)
- Nome exato do parâmetro: `brainType` ou `options?: { brainType?: string }`

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements e Roadmap

- `.planning/REQUIREMENTS.md` — FUP-01, FUP-02: referências originais do sistema FUP
- `.planning/ROADMAP.md` §Phase 25 — Success Criteria: 3 critérios a verificar

### Decisões de Fases Anteriores

- `.planning/phases/22-fup-autom-tico/22-CONTEXT.md` — D-08 (elegibilidade), D-19 (resetFup mantém fup_enabled): lógica de FUP já definida
- `.planning/phases/19-database-foundation/19-CONTEXT.md` — D-10, D-11: schema de FUP em leads

### Código de Referência

- `packages/core/src/leads/lead-service.ts` — LeadService atual: `upsertLead()`, `resetFup()`, padrão de métodos SQL
- `packages/database/src/schema/tables.ts` — schema Drizzle: `leads` (fupEnabled, fupStep, fupNextAt), `fupConfig` (brainType PK, enabled)
- `packages/core/src/fup/fup-scheduler.ts` — FupScheduler: lógica de elegibilidade existente (fup_enabled = true AND ia_ativada = true AND fup_next_at <= NOW())

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `LeadService.upsertLead()`: já usa `onConflictDoUpdate` com `target: leads.numero` — estrutura pronta para lógica condicional INSERT vs UPDATE
- `fupConfig` table: `brainType` como PK, `enabled` boolean — query simples `SELECT enabled FROM fup_config WHERE brain_type = ?`
- `drizzle(sql)` já disponível no LeadService via construtor

### Established Patterns

- Dependências opcionais no BrainRunner: mesmo padrão de `eventPublisher` — parâmetro opcional, comportamento silencioso quando ausente
- Query inline em métodos do LeadService: `touchLastMessage()`, `resetFup()` fazem queries diretas sem cache

### Integration Points

- `BrainRunner.run()` linha ~180: chama `leadService.upsertLead(numero, uniqueId, nome)` — adicionar `this.brain.type` como quarto parâmetro
- `packages/core/src/index.ts`: sem mudança de exports — LeadService já exportado

</code_context>

<specifics>
## Specific Ideas

- Query a `fup_config` pode usar `eq(fupConfig.brainType, brainType)` do Drizzle — mesmo padrão do FupScheduler
- Retorno de `upsertLead()` já é `Promise<Lead>` — pode incluir `fupEnabled` no objeto retornado para logging/debug

</specifics>

<deferred>
## Deferred Ideas

- Migração em massa de leads existentes para `fup_enabled = true` — operador faz manualmente se necessário
- Coluna `fup_opted_out` para distinção explícita de opt-out — YAGNI, lógica INSERT-only é suficiente
- Cache de `fup_config` no LeadService — query simples, sem necessidade de otimização prematura

</deferred>

---

*Phase: 25-fup-activation*
*Context gathered: 2026-06-24*
