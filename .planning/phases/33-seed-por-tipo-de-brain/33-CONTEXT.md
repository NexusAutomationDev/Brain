# Phase 33: Seed por Tipo de Brain - Context

**Gathered:** 2026-08-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Cada imagem de Brain (sdr, support, echo) semeia, na inicialização, apenas os prompts e a configuração de FUP do seu próprio `brain_type` — sem contaminação cruzada entre tipos. FUP passa a funcionar out-of-the-box em qualquer banco novo, de forma idempotente, sem tocar o fluxo de migrations do Drizzle (`runMigrations()`/`_schema_lock` intocados) e sem qualquer migration destrutiva/retroativa para bancos de clientes já em produção que aplicaram 0002/0005/0010.

Escopo confirmado nesta discussão inclui, além do seed em si (SEED-01..05 do REQUIREMENTS.md), uma mudança de mecanismo adjacente que o usuário pediu explicitamente para entrar nesta fase: `FupScheduler` passa a persistir a mensagem de FUP enviada no checkpoint da conversa (ver D-08 abaixo) — isso é uma expansão além do texto original de SEED-01..05, confirmada pelo usuário durante a discussão, não uma leitura livre de escopo por parte do Claude.

</domain>

<decisions>
## Implementation Decisions

### Default `fup_config` values (SEED-02)
- **D-01:** Mesmo default de `fup_config` para todos os brain_types (sdr, support, echo) — não há variação por tipo nesta fase.
- **D-02:** `intervals_seconds = [3600, 86400, 259200]` (1h → 1d → 3d, 3 tentativas). Mesmo padrão já usado no fixture de teste `baseFupConfig` (`packages/core/src/leads/__tests__/lead-service.test.ts:146-152`).
- **D-03:** `min_hour=8`, `max_hour=18`, `allowed_days=['mon','tue','wed','thu','fri']`, `timezone='America/Sao_Paulo'` — horário comercial BR, mesmo padrão do fixture de teste existente.
- **D-04:** `enabled=true` no seed (ativa fup_enabled automaticamente via `LeadService.upsertLead()` — comportamento já existente, ver ARCHITECTURE.md).

### Default prompt `key='fup'` content (SEED-03)
- **D-05:** Texto único e genérico, igual para sdr/support/echo — sem variação de tom por tipo nesta fase.
- **D-06:** Conteúdo pensado como **production-ready genérico** (não um placeholder marcado "customize isso") — deve poder ir pro ar sem edição obrigatória, resolvendo SEED-03 (FUP out-of-the-box) sem exigir ação do cliente. Cliente pode customizar depois via `UPDATE prompts` (ver nota operacional abaixo sobre `/reload-prompts`).

### Escopo do brain-echo (SEED-02/03 aplicam a echo também)
- **D-07:** brain-echo (hoje descrito como "validation-only" no tech debt ledger de PROJECT.md — não vendido a cliente) **recebe o mesmo seed** de `fup_config` + prompt `key='fup'` que sdr/support. Nenhuma exceção de código por tipo — os 3 brain_types hoje registrados passam pelo mesmo mecanismo uniformemente.

### Comportamento de falha de seed (Pitfall 2 do PITFALLS.md)
- **D-08:** Fail-fast. Após `runBrainSeed()` inserir os dados, uma validação (`SELECT`) confirma que `fup_config` e `prompts(key='fup')` existem para o `brain_type` daquele Brain; se algo faltar, o container falha a inicialização com erro alto — mesmo padrão de fail-fast D-06 já usado em `BrainRunner.init()` para `promptKeys` ausentes. **Reversibility:** reversible — é uma checagem adicional, não uma mudança de schema; pode ser relaxada para warning depois sem migration.
- **D-09:** A validação pós-seed roda **dentro de `runBrainSeed()`**, no mesmo lock/escopo do resto do seed — uma vez por deploy (via o mesmo row-lock de `runMigrations()`), não uma vez por instância do container.

### FUP message persisted to checkpoint (escopo expandido, confirmado pelo usuário)
- **D-10:** `FupScheduler` passa a gravar a mensagem de FUP efetivamente enviada no checkpoint/histórico LangGraph do lead (via um mecanismo equivalente a `BrainRunner.injectMessage()`/`compiledGraph.updateState()`), para que a próxima resposta real do LLM tenha esse contexto disponível. **Reversibility:** costly — `FupScheduler` hoje só recebe `{sql, brainType, checkpointer, eventPublisher, fupWebhookUrl}` (`fup-scheduler.ts:43-55`) e não tem acesso a `compiledGraph`; é preciso estender `FupSchedulerOptions` e passar `compiledGraph` (ou um callback `injectMessage`) na instanciação dentro de `BrainRunner.init()` (`runner.ts:219-226`, logo após `_compileGraph()` em `runner.ts:203` — o `compiledGraph` já existe nesse escopo, então é wiring pequeno, não reestruturação). Reverter depois exigiria remover a chamada de escrita e decidir o que fazer com mensagens já persistidas.
  - Confirmado: hoje `FupScheduler` só **lê** o checkpoint via `checkpointer.getTuple()` (`fup-scheduler.ts:284-289`), nunca escreve. A mensagem enviada hoje só sai via `_sendFupWebhook()` (`fup-scheduler.ts:172-173, 306-326`) e evento fire-and-forget — nunca vira parte do histórico que o LLM vê no próximo turno real.
  - **Nota para o planner/researcher:** este item expande o escopo declarado de SEED-01..05 em REQUIREMENTS.md — não há requirement numerado para ele ainda. Vale checar com o usuário se isso deve virar um requirement formal (ex. SEED-06) antes do plano, ou se o CONTEXT.md aqui é suficiente como registro da decisão.

### Nota operacional (não é uma decisão de implementação, mas relevante para teste/UAT desta fase)
- Prompts são carregados uma vez em `BrainRunner.init()` e ficam "snapshotados" no closure do grafo compilado (`runner.ts:189`, `runner.ts:263-267`) — uma edição direta via SQL em `prompts.content` **não** afeta a próxima mensagem automaticamente; requer `POST /reload-prompts` (admin-token) ou restart do container. Isso é comportamento existente, fora do escopo desta fase, mas relevante ao validar o conteúdo do prompt `fup` seedado (D-05/D-06) durante UAT — um teste que edita o prompt via SQL e espera efeito imediato vai falhar por esse motivo, não por bug do seed.

### Claude's Discretion
- Estrutura física dos arquivos de seed (`packages/database/src/seeds/<brainType>/*.sql` vs. `.ts` descriptor) e nome exato da função/assinatura (`runBrainSeed(sql, brainType, seedsFolder)`) — pesquisa em ARCHITECTURE.md já propõe uma forma concreta; Claude segue essa proposta salvo problema técnico encontrado no planning.
- Texto exato do prompt `key='fup'` (D-06) — Claude escreve um texto genérico e profissional; usuário pode revisar/ajustar no plano ou depois via SQL.
- Nome exato do ENV `SEEDS_FOLDER` e onde exatamente a validação fail-fast (D-08/D-09) loga/lança erro — detalhe de implementação.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Pesquisa do milestone v1.6 (já cobre Phase 33 em detalhe — "Part A")
- `.planning/research/ARCHITECTURE.md` §"Part A — Per-brain-type scoped seeding" — desenho recomendado completo: `packages/database/src/seeds/<brainType>/`, `runBrainSeed(sql, brainType, seedsFolder)`, `SEEDS_FOLDER` ENV, Dockerfile por tipo, ordem de chamada em `BrainRunner.init()`, Strategy B (não tocar 0002/0005/0010)
- `.planning/research/PITFALLS.md` — Pitfall 1 (não renomear/mover migrations existentes), Pitfall 2 (seed silencioso — base do D-08/D-09 desta fase), Pitfall 3 (separar por imagem física, não só por filtro de query), Pitfall 4 (backfill de bancos já contaminados — já decidido Out of Scope em PROJECT.md/REQUIREMENTS.md)

### Requisitos e roadmap
- `.planning/REQUIREMENTS.md` §"SEED — Seed por Tipo de Brain" (SEED-01 a SEED-05) — requirements formais desta fase; nota: a decisão D-10 (FUP no checkpoint) expande além do que está escrito aqui, ver nota em D-10
- `.planning/ROADMAP.md` §"Phase 33: Seed por Tipo de Brain" — goal e success criteria formais
- `.planning/PROJECT.md` §"Out of Scope" — confirma que remoção/deprecação retroativa das migrations 0002/0005/0010 está fora de escopo (Strategy B)

### Código existente relevante
- `packages/database/src/migrations/0002_echo_brain_seed.sql`, `0005_brain_sdr_prompts.sql`, `0010_brain_support_prompts.sql` — seeds atuais que permanecem intocados (SEED-05)
- `packages/database/src/migrate.ts` — `runMigrations()`/`_schema_lock` row-lock, mecanismo a não tocar
- `packages/core/src/runner/runner.ts` — `BrainRunner.init()` (ordem: migrations → seed novo → loadPrompts → fail-fast de promptKeys, `runner.ts:130-203`), `injectMessage()` (`runner.ts:287-305`), instanciação do `FupScheduler` (`runner.ts:219-226`)
- `packages/core/src/fup/fup-scheduler.ts` — `FupSchedulerOptions` (linha 43-55), `_generateFupMessage`/leitura de checkpoint (linha 284-289), envio via webhook (linha 172-173, 306-326)
- `packages/database/src/schema/tables.ts` — schema de `prompts` (linha ~65-74) e `fup_config` (linha ~134-149)
- `packages/core/src/prompts/loader.ts` — double-filter `(brand_type, key)`; snapshot em compile-time

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Padrão `ON CONFLICT DO NOTHING` já usado nas 3 migrations de seed existentes (0002/0005/0010) — mesmo idioma para os novos seeds de `fup_config`/`key='fup'`.
- `getNextValidSlot()` (`packages/core/src/fup/fup-scheduler.ts`) já entende o formato de `fup_config` (intervals em segundos, allowed_days em `mon`..`sun` minúsculo, timezone IANA) — os defaults escolhidos (D-02/D-03) usam exatamente esse formato.
- Fixture de teste `baseFupConfig` (`packages/core/src/leads/__tests__/lead-service.test.ts:146-152`) já usa valores praticamente idênticos aos escolhidos aqui — bom ponto de partida/validação cruzada.

### Established Patterns
- Fail-fast D-06 existente em `BrainRunner.init()` para `promptKeys` ausentes é o precedente direto para D-08 (mesma filosofia: falha alta e visível, não warning enterrado em log).
- `FupScheduler` é instanciado dentro de `BrainRunner.init()`, não como processo separado — por isso D-10 é wiring pequeno (compiledGraph já está no mesmo escopo), não uma reestruturação arquitetural.

### Integration Points
- Novo `runBrainSeed()` entra entre `runMigrations()` e `loadPrompts()` em `BrainRunner.init()` (`runner.ts`, ordem atual ~130-203).
- `FupSchedulerOptions` precisa ganhar um novo campo (`compiledGraph` ou callback `injectMessage`) na instanciação em `runner.ts:219-226`.

</code_context>

<specifics>
## Specific Ideas

- Cadência de FUP: 1h → 1d → 3d ([3600, 86400, 259200]), 3 tentativas antes de desativar.
- Janela: 8h-18h, seg-sex, America/Sao_Paulo — horário comercial BR como default de fábrica.
- Prompt `fup` deve soar profissional e genérico o bastante pra ir pro ar sem edição (ex. tom: "notei que você não respondeu, ainda posso ajudar?" — texto exato fica a critério do Claude no planning, ver Claude's Discretion).

</specifics>

<deferred>
## Deferred Ideas

Nenhuma ideia foi adiada para outra fase — a única expansão de escopo levantada durante a discussão (persistir mensagem de FUP no checkpoint) foi confirmada pelo usuário para entrar nesta própria Phase 33 (D-10), não deferida.

</deferred>

---

*Phase: 33-Seed por Tipo de Brain*
*Context gathered: 2026-08-12*
