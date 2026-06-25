# Phase 26: FUP Next-At Init Fix - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Fechar o gap bloqueador entre Phase 25 e Phase 22: `LeadService.upsertLead()` deve calcular e persistir `fupNextAt = NOW() + intervals_seconds[0]` (ajustado para business hours) no INSERT quando `fupEnabled=true`, tornando o `FupScheduler._tick()` capaz de processar leads recém-criados.

**Inclui:** Modificação de `upsertLead()` para calcular `fupNextAt` no INSERT; testes de unidade; atualização de spec EVT-04 em REQUIREMENTS.md + verificação do code comment em fup-scheduler.ts.

**Não inclui:** Modificar resetFup() ou touchLastMessage(); novos campos na tabela leads; mudanças no scheduler; features de FUP futuras (FUP-F01, F02, F03).

</domain>

<decisions>
## Implementation Decisions

### Base do Clock do FUP

- **D-01:** `fupNextAt` é calculado no INSERT de `upsertLead()` — `fupNextAt = NOW() + intervals_seconds[0]`, ajustado para próximo slot dentro de business hours (`min_hour`, `max_hour`, `allowed_days`, `timezone` da `fup_config`).
- **D-02:** No fluxo normal do BrainRunner, `upsertLead()` é chamado quando o lead envia a primeira mensagem — portanto INSERT time ≈ tempo da primeira mensagem. Isso satisfaz o requisito de "FUP é apenas quando o lead para de responder ao LLM".
- **D-03:** O FUP clock parte do INSERT, não de `last_message_at`. A semântica é: lead criado pelo BrainRunner na chegada da primeira mensagem → `fupNextAt = now + interval[0]` → se não responder no intervalo, o scheduler processa.
- **D-04:** Query em `upsertLead()` para `fup_config` precisa ser expandida: hoje busca apenas `enabled`, deve passar a buscar também `intervals_seconds`, `min_hour`, `max_hour`, `allowed_days`, `timezone` para calcular o slot correto.

### Compartilhamento de Lógica de Business Hours

- **D-05 (Claude's Discretion):** A lógica de business hours (calcular próximo slot válido) existe no `FupScheduler`. Pode ser:
  - Extraída para `packages/core/src/fup/scheduling-utils.ts` e reutilizada por ambos
  - Duplicada inline em `upsertLead()` (simples, sem refactor extra)
  - Planner decide a abordagem mais adequada ao escopo do plano único.

### EVT-04 — Documentação da Divergência

- **D-06:** REQUIREMENTS.md deve ser atualizado: EVT-04 descreve `event_id = thread_id:tool_call_id` para tool events, mas FUP events usam `event_id = uniqueId:fup:step` (decisão D-17 da Phase 22). A divergência é intencional — FUP não tem `tool_call_id`. Atualizar EVT-04 para incluir essa exceção explicitamente.
- **D-07:** Verificar o code comment em `fup-scheduler.ts` onde `event_id` é construído — garantir que já documenta `uniqueId:fup:step` e o motivo da divergência. Se incompleto, completar.

### Claude's Discretion

- Estratégia de extração vs. duplicação da lógica de business hours (D-05)
- Estratégia interna de query em `upsertLead()` (uma query expandida vs. duas queries separadas)
- Estrutura dos testes de unidade para o novo comportamento de `fupNextAt` no INSERT

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements e Roadmap

- `.planning/REQUIREMENTS.md` — EVT-04 (event_id format), FUP-02 (scheduler elegibilidade): spec a ser atualizada
- `.planning/ROADMAP.md` §Phase 26 — Success Criteria: 4 critérios a verificar

### Decisões de Fases Anteriores

- `.planning/phases/25-fup-activation/25-CONTEXT.md` — D-01 a D-08: contexto de como `upsertLead()` foi modificado na Phase 25 (brainType param, fupEnabled, INSERT-only lógica)
- `.planning/phases/22-fup-autom-tico/22-CONTEXT.md` — D-17 (event_id format `uniqueId:fup:step`), D-09 (cálculo de próximo fupNextAt), D-08 (elegibilidade do scheduler)

### Código de Referência

- `packages/core/src/leads/lead-service.ts` — `upsertLead()`: lógica atual de INSERT, query a `fup_config`, retorno `Promise<Lead>`
- `packages/core/src/fup/fup-scheduler.ts` — `_processFupForLead()`: lógica de business hours para próximo slot; `_tick()`: WHERE clause com `fup_next_at <= NOW()`; D-17 code comment
- `packages/database/src/schema/tables.ts` — schema Drizzle: `leads` (fupEnabled, fupStep, fupNextAt), `fupConfig` (brainType, enabled, intervals_seconds, min_hour, max_hour, allowed_days, timezone)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `LeadService.upsertLead()` — já faz SELECT antes do upsert (linha 40-44) para detectar INSERT vs UPDATE; query a `fup_config` já existe (linhas 50-61); expandir query para incluir campos de business hours
- `fup-scheduler.ts` `_processFupForLead()` — contém lógica de cálculo de próximo slot com business hours; candidata a extração para shared utility
- `fupConfig` Drizzle table — `intervals_seconds`, `min_hour`, `max_hour`, `allowed_days`, `timezone` disponíveis na mesma query

### Established Patterns

- Query inline em LeadService: `touchLastMessage()`, `resetFup()`, `upsertLead()` fazem queries diretas sem cache — sem cache adicional necessário
- INSERT detectado via SELECT prévio: `const isInsert = !existing[0]` — padrão já estabelecido em `upsertLead()`
- Lógica condicional INSERT-only: `fupEnabled` já é passado no `values()` mas ausente do `set{}` do `onConflictDoUpdate()` — mesmo padrão para `fupNextAt`

### Integration Points

- `packages/core/src/leads/lead-service.ts` linhas 50-62: expandir query de `fup_config` para incluir business hours fields
- `packages/core/src/leads/lead-service.ts` linhas 64-88: adicionar `fupNextAt: calculatedTime` no `values()` do INSERT (ausente do `set{}` do UPDATE)
- `packages/core/src/fup/fup-scheduler.ts` D-17 comment: verificar e completar se necessário

</code_context>

<specifics>
## Specific Ideas

- O cálculo de `fupNextAt` segue o mesmo padrão de D-09 da Phase 22: `candidateTime = NOW() + intervals_seconds[0]`; se fora da janela (`min_hour`, `max_hour`, `allowed_days`, `timezone`), avança para próximo slot válido
- `fupNextAt` deve ser `Date | null` — null apenas em UPDATE ou quando `fupEnabled=false`; no INSERT com FUP ativado deve ser sempre um `Date` concreto
- EVT-04 update: adicionar nota "FUP events exception: `event_id = ${lead.uniqueId}:fup:${fup_step}` — FUP events do not have a `tool_call_id`"

</specifics>

<deferred>
## Deferred Ideas

- Reinicialização de `fupNextAt` após `resetFup()` (quando lead responde e depois para de novo) — o presente ciclo não cobre; `touchLastMessage()` poderia calcular `fupNextAt` nesse caso, mas está fora do escopo desta fase
- FUP proativo para leads criados sem mensagem inicial (bulk import, CRM sync) — comportamento diferente da semântica atual; futura feature separada se necessário

</deferred>

---

*Phase: 26-fup-next-at-init-fix*
*Context gathered: 2026-06-24*
