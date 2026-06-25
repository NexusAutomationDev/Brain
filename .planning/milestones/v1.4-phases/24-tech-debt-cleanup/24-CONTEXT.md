# Phase 24: Tech Debt & Tracker Cleanup - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Corrigir 4 itens de tech debt confirmados pela auditoria v1.4 (WR-01..WR-04) no FupScheduler/LeadService/BrainRunner, confirmar/documentar o estado dos erros TypeScript em `packages/core`, e atualizar o tracker do `REQUIREMENTS.md` para refletir o estado real do código.

Não inclui: novas features, refactoring além do necessário para fechar os WR items, ou mudanças no FupScheduler além dos 4 itens listados.

</domain>

<decisions>
## Implementation Decisions

### WR-01 — Warning log quando checkpointer null

- **D-01:** Adicionar `else if (fupWebhookUrl && !this.checkpointer)` em `runner.ts` após o bloco `if (fupWebhookUrl && this.checkpointer)`. Logar `this.logger.warn({ brainType: this.brain.brainType, hasFupUrl: true }, "FupScheduler not started — checkpointer unavailable")`. Nenhuma mudança no comportamento funcional, apenas visibilidade operacional.

### WR-02 — updatedAt em resetFup()

- **D-02:** Adicionar `updatedAt: new Date()` no `.set()` de `resetFup()` em `packages/core/src/leads/lead-service.ts`. Ficar consistente com os outros métodos do LeadService (`setFullpp`, `setIaAtivada`, `upsert`) que todos incluem `updatedAt`.

### WR-03 — SIGTERM listener cleanup

- **D-03:** Salvar o handler como campo privado da classe: `private readonly _sigtermHandler: () => Promise<void>` inicializado no constructor como arrow function. Em `close()`, chamar `process.off('SIGTERM', this._sigtermHandler)`. Padrão: campo privado + `process.off()` — não usar `removeAllListeners` que afetaria outros handlers externos.

### WR-04 — Delay entre retries

- **D-04:** Delay de **1 segundo fixo** entre tentativas no loop de retry em `_processFupForLead()`. Implementado com `await new Promise((r) => setTimeout(r, 1000))` ao final de cada iteração que falhou (exceto a última). Resolve o thundering herd sem complexidade adicional.

### TypeScript SC-5 — Estado atual

- **D-05:** `bun tsc --noEmit` em `packages/core` retorna **0 erros** hoje (verificado em 2026-06-24). Os 4 erros do audit (lastMessageAt, fupNextAt Drizzle types, TokenUsage, responseMode) foram resolvidos incidentalmente em fases anteriores. SC-5 já está met — o plano deve rodar `tsc --noEmit` como etapa de verificação e documentar o resultado limpo. Nenhum fix de TypeScript é necessário.

### REQUIREMENTS.md Tracker

- **D-06:** Atualizar `REQUIREMENTS.md` com:
  1. `RAG-02`: mudar `[ ]` → `[x]`
  2. `RAG-03`: mudar `[ ]` → `[x]`
  3. Traceability `RAG-02`: "Pending" → "Complete"
  4. Traceability `RAG-03`: "Pending" → "Complete"
  5. Traceability `EVT-03`: corrigir Phase de "Phase 20" → "Phase 22" (implementado em fup-scheduler.ts da Phase 22, não na Phase 20)

### Claude's Discretion

- Ordem exata dos WR fixes dentro do plano (podem ser um plano único ou separados)
- Mensagem exata do warning em WR-01 (desde que inclua brainType e hasFupUrl: true)
- Onde exatamente inserir o delay em WR-04 (antes ou depois do log de warn — não importa)
- Testes de unidade para os fixes WR (verificar se os testes existentes em `fup-scheduler.test.ts` e `lead-service-fup.test.ts` cobrem ou precisam de asserts adicionais)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Auditoria — Fonte dos WR items

- `.planning/v1.4-MILESTONE-AUDIT.md` — seção "Phase 22 — FUP Automático" e "Cross-Phase" com evidência dos WR-01..WR-04 e erros TypeScript; seção "Requirements Coverage" para entender RAG-02/03/EVT-03

### Arquivos Principais a Modificar

- `packages/core/src/runner/runner.ts` — WR-01 (linha ~163, bloco `if (fupWebhookUrl && this.checkpointer)`) e WR-03 (linha ~182, SIGTERM handler; linha ~71-77, método `close()`)
- `packages/core/src/leads/lead-service.ts` — WR-02 (linha ~135, método `resetFup()`)
- `packages/core/src/fup/fup-scheduler.ts` — WR-04 (linhas ~168-247, loop de retry em `_processFupForLead()`)
- `.planning/REQUIREMENTS.md` — atualizar checkboxes RAG-02/03 e traceability EVT-03/RAG-02/RAG-03

### Padrões de Referência

- `packages/core/src/leads/lead-service.ts` — `setFullpp()` e `setIaAtivada()`: referência de como outros métodos incluem `updatedAt: new Date()` (WR-02)
- `packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts` — testes existentes para `_processFupForLead()` (WR-04 pode exigir ajuste nos mocks)
- `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` — testes existentes para `resetFup()` (WR-02 pode exigir assert de `updatedAt`)

### Roadmap

- `.planning/ROADMAP.md` §Phase 24 — Success Criteria 1-6 (referência canônica para o que constitui "done")

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `createLogger()` de `@brain-pkg/observability` — já usado em FupScheduler e BrainRunner; usar o mesmo para o warning WR-01
- `process.off()` — Node/Bun built-in; par simétrico do `process.on()` existente

### Established Patterns

- `updatedAt: new Date()` em Drizzle `.set()`: padrão em todos os outros métodos do LeadService
- `logger.warn({ ... }, "mensagem")` com campos estruturados: padrão Pino já usado no FupScheduler (ex: linha 158)
- `await new Promise((r) => setTimeout(r, ms))`: padrão idiomático para delay em async Bun/Node

### Integration Points

- `runner.ts` init flow: WR-01 vai no bloco após `if (fupWebhookUrl && this.checkpointer)`
- `runner.ts` constructor: WR-03 exige que `_sigtermHandler` seja inicializado como campo (não pode ser definido inline no `process.on()`)
- `fup-scheduler.ts` retry loop: WR-04 delay entre tentativas — não alterar a lógica de `fup_failure_count`

</code_context>

<specifics>
## Specific Ideas

- WR-04: delay de 1s fixo — não exponencial, não configurável via ENV por ora (MVP funcional)
- WR-03: `process.off('SIGTERM', this._sigtermHandler)` — não `removeAllListeners`
- SC-5 (TypeScript): rodar `tsc --noEmit` como passo de verificação; 0 erros é o resultado esperado
- REQUIREMENTS.md: EVT-03 traceability "Phase 20" → "Phase 22" (implementado em fup-scheduler.ts da Phase 22)
- API key GPT disponível em `.env` caso seja necessário para testes durante execução

</specifics>

<deferred>
## Deferred Ideas

- Backoff exponencial para retries FUP (FUP-F01 já no backlog de futuro)
- Prompt 'fup' validado no startup (mencionado no audit como "operational" mas fora dos WR items desta fase)
- `fup_enabled` sem trigger automático — coberto pela Phase 25 (FUP Activation Trigger)
- Configuração de delay via ENV (`FUP_RETRY_DELAY_MS`) — não necessário agora

</deferred>

---

*Phase: 24-tech-debt-cleanup*
*Context gathered: 2026-06-24*
