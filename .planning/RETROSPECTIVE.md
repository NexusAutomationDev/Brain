# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

---

## Milestone: v1.0 — MVP

**Shipped:** 2026-06-13
**Phases:** 4 | **Plans:** 28 | **Timeline:** 23 dias (2026-05-21 → 2026-06-13)
**Commits:** 234 | **TypeScript LOC:** ~7.094

### What Was Built

- Monorepo scaffold (pnpm workspaces + Turborepo) com PostgreSQL + PGVector, TenantPoolManager LRU, migrations versionadas
- Pacotes de domínio completos: memory 3-layer (long-term/short-term/semantic), AI/LangGraph + PostgresSaver, transport webhook idempotente, Langfuse observability
- Brain SDK: IBrain interface, BrainRunner lifecycle (init→run→refreshPrompts), ToolsRegistry, prompts no banco de dados
- EchoBrain Docker image (419MB) com validação E2E: SC-2 (webhook→LLM→reply) e SC-3 (estado persiste após docker restart) verificados por humano

### What Worked

- **Wave-based execution**: separar plans em waves (Wave 0 = stubs, Wave 1 = implementação, Wave N = gap closure) manteve o contexto limpo e os blockers explícitos
- **Nyquist compliance como gate**: exigir stubs de teste antes de implementar forçou interface design first e evitou acoplamento implícito
- **Human checkpoint (04-04)**: delegar SC-2 e SC-3 para verificação manual com LLM real capturou o que testes unitários não podiam — o contrato E2E real funcionando
- **postgres.js sobre bun:sql**: decisão tomada cedo (D-02) evitou bug de conexão travada; zero friction nos 4 phases seguintes
- **Gap closure plans explícitos**: quando uma phase terminava com gaps (01-04, 01-05, 02-08..10), criar um plan dedicado ao invés de corrigir silenciosamente manteve o histórico legível

### What Was Inefficient

- **REQUIREMENTS.md traceability nunca atualizado**: todos os 30 requirements ficaram como `Pending` no arquivo durante todo o desenvolvimento — foi preciso confiar no audit para saber o status real; a tabela de traceability foi inútil como ferramenta de tracking
- **02-VERIFICATION.md stale**: o arquivo mostrou `gaps_found` por causa de `EMBEDDING_DIMENSIONS=10` em `.env.test`; o problema foi resolvido mas o VERIFICATION.md nunca foi re-verificado, gerando ruído falso no audit
- **Phase 4 VALIDATION.md draft**: `nyquist_compliant: false` permaneceu mesmo com a phase 100% completa — a atualização do arquivo foi esquecida
- **WebhookTransport.start() latent trap**: a decisão arquitetural de bypassar WebhookTransport em brain-echo (usando createWebhookApp direto) foi pragmática mas deixou uma armadilha latente para futuros consumidores do ITransport interface

### Patterns Established

- **`manual/` para scripts exploratórios**: convenção do CLAUDE.md funcionou — scripts de teste manual ficaram fora do repo
- **`__tests__/unit/` e `__tests__/integration/`**: separação clara; testes de integração com `skip guard` para CI sem infra (DB/Docker) funcionaram bem
- **Decisões como ADR inline**: registrar decisions (D-01..D-15) nas phases manteve o contexto localizado; para v2 considerar ADR-NNNN.md formal
- **`runMigrations` exportável**: refatorar para injeção de `Sql` antes de usar em brain-echo (04-00) foi decisão certa — enabledou testes de migração sem acoplamento

### Key Lessons

1. **Traceability tables precisam de automação**: manter manualmente REQUIREMENTS.md traceability é erro-propenso; para v2 considerar script que lê SUMMARY.md files e atualiza status automaticamente
2. **VERIFICATION.md tem shelf-life curto**: um arquivo de verificação que fica stale após 1 gap closure é mais ruído do que sinal; re-verificar após cada gap closure plan é overhead mas necessário para confiança
3. **O ITransport interface cria contrato implícito**: qualquer classe que implementa ITransport precisa ser funcional via interface — não apenas via uso direto. A WebhookTransport.start() bug só foi descoberta no audit, não durante desenvolvimento
4. **Embedding dimensions são lock-in**: `EMBEDDING_DIMENSIONS` deve ser decision point explícito no início de cada milestone — irreversível após primeira migration

### Cost Observations

- Stack choices (Bun + Hono + Drizzle + LangGraph) provaram-se corretos para o use case; zero substituições de library durante o milestone
- 3 gap closure plans em Phase 2 (02-08, 02-09, 02-10) representaram ~27% do esforço da phase — indicativo de que SC validations devem ser executadas mais cedo no ciclo (antes de Wave 3+)

---

## Milestone: v1.1 — Brain SDR + Infraestrutura Produção

**Shipped:** 2026-06-14
**Phases:** 5 (5-9) | **Plans:** 12 | **Timeline:** 2 dias (2026-06-13 → 2026-06-14)
**Commits:** ~124

### What Was Built

- Transport padronizado: BrainEvent → {Name, Message, Numero, IDLead}, DedupCache removido, WebhookTransport com constructor injection e fail-fast ConfigurationError
- Schema `leads` com advisory lock em runMigrations() + BrainRunner auto-migrate; ESLint ativado nos 7 pacotes via turbo run lint
- LeadService com upsert atômico, gate ia_ativada no BrainRunner, RabbitMQTransport com ack manual e DLQ explícita
- Histórico de conversas persistente: thread_id = lead.uniqueId via PostgresSaver, context window com slice(-N) no nó do grafo
- Brain SDR: grafo ReAct 2-nós, sub-agente de qualificação stateless, prompts no banco, TenantPoolManager em produção, Dockerfile multi-stage

### What Worked

- **Milestone curto (2 dias)**: escopo bem definido pela v1.0 + audit list permitiu execução densa sem deriva; cada phase tinha SC claros
- **Nyquist Wave 0 forçando TDD**: scaffolding de testes antes da implementação (09-00 antes de 09-01..03) identificou problemas de interface no qualifier.ts antes da implementação — fallback gracioso foi pensado no design, não adicionado como patch
- **rabbitmq-client sobre amqplib-bun**: decisão correta — DLQ implementada sem dependência de configuração de broker; testes passaram limpos; sem problemas Bun
- **Sub-agente stateless com PostgresSaver.getTuple()**: ler histórico sem checkpointer próprio foi elegante — evita acumulação de snapshots do sub-agente e acopla ao mesmo PostgresSaver que o Brain principal
- **Audit pós-execução com gap closure commits**: GAP-1 e GAP-3 identificados pelo audit foram corrigidos em commits atômicos rastreáveis — o audit não foi apenas documentação, foi gatilho de ação

### What Was Inefficient

- **_journal.json nunca atualizado automaticamente para migrations SQL manuais**: migration 0005 foi criada como SQL manual sem passar pelo drizzle-kit generate — Drizzle silenciosamente a ignorou; só descoberto no audit; custo: 2 commits extras pós-audit para fix
- **OPENAI_API_KEY vs API_KEY no .env**: desalinhamento entre o que o .env de dev usava e o que factory.ts lia ficou como GAP-2 — não bloqueante em prod mas indica que o .env.example deveria ser gerado a partir do factory.ts, não criado manualmente
- **apps/brain-sdr sem lint script**: a spec do INFRA-02 dizia "todos os pacotes do monorepo" mas o brain-sdr (como app, não pacote) ficou de fora do turbo lint pipeline sem ninguém notar até o audit; a spec deveria ter sido mais explícita sobre apps vs packages
- **Dois Dockerfiles divergentes**: brain-echo usa MIGRATIONS_DIR (errado), brain-sdr usa MIGRATIONS_FOLDER (correto, alinhado com runner.ts); a divergência foi aceita mas indica que deveria existir um template base de Dockerfile no SDK

### Patterns Established

- **TDD com Wave 0 em phases de app (não só packages)**: funcionou bem em Phase 9; SHOULD ser padrão para qualquer novo Brain app
- **createTransport(runner) como único ponto de entrada**: pattern correto — app passa runner, factory seleciona transport via ENV, ITransport.start() é chamado uniformemente; elimina hardcode de Hono em index.ts
- **Drizzle migrations: SEMPRE via drizzle-kit generate, nunca SQL manual**: SQL manual sem journal entry é silenciosamente ignorado; qualquer migration nova deve passar pelo drizzle-kit generate para registrar no _journal.json + criar snapshot
- **boundQualifyTool como closure de injeção de prompt**: padrão elegante para injetar dependências do banco em tools do LangGraph — evita props drilling e mantém a tool pura para testes

### Key Lessons

1. **Drizzle journal é inviolável**: qualquer SQL de migration que não estiver no _journal.json não existe para o Drizzle. Nunca criar arquivos .sql na pasta migrations sem passar pelo drizzle-kit generate (ou adicionar entry + snapshot manualmente com atenção)
2. **Apps precisam do mesmo rigor de lint que packages**: turbo run lint deve incluir todos os diretórios apps/; a separação apps/ vs packages/ no turbo.json é uma armadilha fácil de esquecer
3. **Audit pós-execução é essencial, não opcional**: os dois blockers de v1.1 (GAP-1, GAP-3) não teriam sido encontrados por testes unitários — só o audit de integração E2E os surfaceou. O audit deve ser parte do Definition of Done para qualquer milestone
4. **ITransport.start() deve ser o único ponto de boot**: todo Brain app deve chamar createTransport(runner).start() em vez de instanciar diretamente WebhookTransport ou Hono — o pattern foi estabelecido em v1.1, deve ser documentado no SDK

### Cost Observations

- Timeline de 2 dias vs 23 dias do v1.0: o v1.0 estabeleceu a base; o v1.1 construiu sobre ela — a aceleração é esperada e saudável
- 2 commits pós-audit (GAP-1 e GAP-3) representaram ~1.6% do total; overhead razoável para um processo de audit
- Sub-agente de qualificação: implementado em ~45 min graças ao padrão PostgresSaver.getTuple() já conhecido da fase anterior

---

## Milestone: v1.2 — Output Parser + Tool Contracts

**Shipped:** 2026-06-15
**Phases:** 4 (10-13) | **Plans:** 11 | **Timeline:** 2 dias (2026-06-14 → 2026-06-15)
**Commits:** 122 | **Files changed:** 163 | **Lines:** +13.153

### What Was Built

- Output Parser SDK: `BrainOutput` type em shared, `BrainOutputSchema` Zod com `superRefine` em core, `BrainRunner.run()` valida saída e lança `BrainOutputValidationError` — contrato de saída estruturado em todos os Brains
- Tool Contracts SDK: `createPauseSessionTool(sql)` e `createFinishConversationTool(sql)` como factories; `BRAIN_TOOLS` ENV como whitelist CSV em `enableTool()`; `BrainBuildContext.sql?` injetado pelo BrainRunner
- Brain SDR migrado para contrato v1.2: 3 tools no ToolNode LangGraph, webhook retorna `{ fullResponse, responseMode }` (breaking change — campo `reply` removido), 25/25 testes passando
- PgBouncer compatibility: `prepare: false` em TenantPoolManager, row-lock transacional via `_schema_lock` substitui `pg_advisory_lock`, `saver.end()` em `finally` corrige CR-01 connection leak

### What Worked

- **Separação type vs schema em camadas distintas**: `BrainOutput` interface em shared (sem Zod), `BrainOutputSchema` em core (com Zod) evitou ciclo de dependência ai→core completamente — zero refatoração necessária após a decisão inicial
- **Factory pattern para tools com closure**: `createPauseSessionTool(sql)` seguiu o padrão já estabelecido do `boundQualifyTool` — a consistência tornou a implementação trivial
- **Duck typing IBrainRunnerLike em transport**: evitar import de `@brain-pkg/core` em packages/transport via duck typing foi clean e impediu ciclo de dependência
- **Row-lock via tabela `_schema_lock` (PgBouncer)**: substituição de `pg_advisory_lock` por row-lock transacional foi a solução correta — `pg_advisory_lock` é connection-scoped e silenciosamente falha sob pool rotation
- **Nyquist Wave 0 como gate de qualidade**: todas as 4 fases chegaram ao audit com `nyquist_compliant: true` — stubs de teste antes da implementação continuou sendo a pattern mais valiosa do projeto

### What Was Inefficient

- **REQUIREMENTS.md traceability nunca atualizado (novamente)**: pela 3ª vez consecutiva, os 8 checkboxes de REQUIREMENTS.md ficaram como `[ ]` durante todo o desenvolvimento — o audit teve que ser a fonte de verdade. A tabela de traceability precisa de automação ou deve ser eliminada como artefato
- **qualifier.ts com `postgres()` sem `prepare: false` (TD-01)**: Phase 13 entregou PgBouncer compatibility no TenantPoolManager mas perdeu uma instância direta de `postgres()` no qualifier.ts — a inconsistência só foi descoberta no audit de integração, não durante a phase
- **BRAIN_TOOLS whitelist com cobertura parcial (TD-03)**: o contrato documentado em TOOLS-ENV-01 ("apenas tools habilitadas no ToolsRegistry") não cobre tools bound diretamente em `buildGraph()` — a spec foi satisfeita tecnicamente mas o comportamento observável diverge da intenção
- **`enableTool("sdr", "pause_session/finish_conversation")` inerte**: Phase 12 registrou as tools no ToolsRegistry mas elas já estavam bound diretamente em buildGraph() — código morto descoberto somente no audit

### Patterns Established

- **`IBrainRunnerLike` como contrato local em transport**: duck typing para evitar import cross-package é padrão a seguir quando dois pacotes não podem ter dependência direta
- **Zod em core, tipos puros em shared**: sempre que um schema de validação é necessário, o tipo fica em shared (sem deps) e o schema Zod fica em core — padrão a documentar no SDK guide
- **Factories com closure sobre `sql`**: toda tool que precisa de acesso ao banco deve ser uma factory function que recebe `sql` e retorna `StructuredTool` — não usar variável global nem DI container
- **`prepare: false` como requisito universal**: qualquer `postgres()` criado fora do `TenantPoolManager` deve ter `prepare: false` explicitamente — adicionar ao checklist de code review

### Key Lessons

1. **Audit de integração ainda encontra gaps que testes unitários não encontram**: TD-01 (qualifier.ts sem prepare:false) e TD-03 (whitelist inerte para tools em buildGraph()) foram invisíveis para os testes de cada phase mas visíveis no audit cross-phase — o audit não é opcional
2. **Cobertura de specs deve incluir "quais code paths passam por esse mecanismo"**: TOOLS-ENV-01 estava tecnicamente correto mas não especificou quais tools passam por `getTools()` vs quais são bound diretamente — a ambiguidade virou tech debt
3. **REQUIREMENTS.md como tracking tool não funciona sem automação**: 3 milestones, 3 vezes com todos os checkboxes `[ ]` ao final. Para v1.3, ou automatizar a atualização via gsd-tools, ou substituir por um formato que não exija manutenção manual
4. **Breaking changes precisam de migration guide explícito**: remover o campo `reply` do webhook (Phase 12) é breaking change para consumidores (WhatsApp/CRM) — deveria haver um documento de migration, não apenas um comentário em SUMMARY.md

### Cost Observations

- Timeline de 2 dias = mesmo ritmo do v1.1; o projeto atingiu velocidade de cruzeiro em phases bem-scoped
- Sem substituições de biblioteca: todas as decisões de stack de v1.0 continuaram válidas
- Phase 10 teve 5 plans (vs 2 esperados): gap closure plans (10-04, 10-05) foram necessários para fechar PARSER-02; indica que o scope inicial de output parser subestimou a complexidade de reconstruir dist/ e corrigir mocks de bun

---

## Milestone: v1.3 — MCP Integration + Dynamic responseMode

**Shipped:** 2026-06-16
**Phases:** 4 (14-17) | **Plans:** 9 | **Timeline:** 2 dias (2026-06-15 → 2026-06-16)
**Commits:** 92 | **Files changed:** 145 | **Lines:** +14.132 / -1.051

### What Was Built

- TD-01 fix: `qualifier.ts` com `prepare: false` — sub-agente de qualificação compatível com PgBouncer transaction mode; static analysis test PGB-TD01 previne regressão
- MCP Integration: `BrainRunner._compileGraph()` carrega `MultiServerMCPClient` no startup, regista tools em `BrainBuildContext.mcpTools`, fallback gracioso se servidor inacessível, SIGTERM limpo em 511ms
- brain-sdr e brain-echo integrados com MCP tools em `bindTools()` + `ToolNode`; suporte a `handleToolErrors: true`; teste de integração real contra servidor MCP externo
- `createRespondTool()` factory stateless: LLM escolhe `responseMode` (text/audio/image/undefined) via schema-as-tool — eliminando hardcode e sendo multi-provider
- `routeAfterLlm` + nó `respond` em brain-sdr e brain-echo: router detecta chamada `respond` e encaminha para nó dedicado; UAT 2/2 com OpenAI + Anthropic
- Token Usage Exposure: `BrainStateAnnotation.tokenUsage` com sum reducer acumula tokens de todos os nós llm do turno; exposto em HTTP response e logado no RabbitMQ consumer

### What Worked

- **schema-as-tool como solução para responseMode dinâmico**: descoberta de que `withStructuredOutput()` + `bindTools()` são mutuamente exclusivos (langchainjs #7757) e a solução via `createRespondTool()` foram decisões elegantes que funcionaram perfeitamente no UAT multi-provider
- **PITFALL list no PLAN.md**: documentar armadilhas conhecidas (PITFALL-1 a PITFALL-6) antes da implementação evitou todos os pitfalls identificados; nenhum blocker inesperado durante execução das phases 15-16
- **MCP lifecycle em `_compileGraph()`**: inicializar o MCP client uma vez por processo (não por request) foi a decisão correta — SIGTERM limpo em 511ms, sem N conexões simultâneas
- **Nyquist Wave 0 + VALIDATION.md**: 3 de 4 fases com `nyquist_compliant: true` após execução; Phase 14 adicionada retroativamente após audit — o padrão está maduro
- **Audit com re-check pós-fix**: ciclo audit → fix → re-audit funcionou bem; `039330d` fechou RESP-01 que o audit anterior tinha flagged, e o audit seguinte confirmou

### What Was Inefficient

- **REQUIREMENTS.md checkboxes `[ ]` pela 4ª vez consecutiva**: 4/4 milestones com todos os requisitos como `[ ]` durante execução — a traceability table do REQUIREMENTS.md é morta em todos os milestones; não foi resolvida sistematicamente apesar de identificada em v1.2 retrospective
- **Phase 15 VALIDATION.md nunca fechada**: arquivo permanece em `draft` / `nyquist_compliant: false` apesar de Phase 15 estar completamente funcional com 59 testes verdes — erro de processo de não fechar VALIDATION.md no plan de conclusão da phase
- **ROADMAP.md Phase 16 desatualizada**: Phase 16 completou mas ROADMAP.md mostrou `0/2` / `Not started` até o milestone completion — sinal de que a atualização do ROADMAP.md precisa ser parte do protocol de conclusão de phase
- **Phase 17 sem REQ-IDs formais**: features significativas (TOK-01 a TOK-06, D-03 a D-10) implementadas sem rastreabilidade em REQUIREMENTS.md — a phase emergiu organicamente durante v1.3 mas não teve requirements definidos formalmente

### Patterns Established

- **`"streamable_http"` com underscore**: formato correto para MCP transport adapter — hífen lança ValueError sem mensagem clara; documentar em CLAUDE.md para evitar regressão
- **`ResponseMode "undefined"` como sentinela**: LLM precisa de valor de output válido antes de conhecer o modo correto — valor sentinela `"undefined"` (string, não undefined JS) é pattern reutilizável para outros campos dinâmicos
- **BrainStateAnnotation sum reducer para métricas**: `(a, b) => ({...soma})` em uma Annotation é o padrão correto para acumular métricas ao longo de um turno ReAct — reutilizável para latência, custo, etc.
- **Teste de integração real contra MCP externo**: `mcp-connection.test.ts` com `MCP_URL` real (env-gated) é o padrão para testar integrações de terceiros sem mock — quando env não disponível, teste é skipped

### Key Lessons

1. **REQUIREMENTS.md `[ ]` problem: aceitar ou eliminar**: 4 milestones com o mesmo padrão de falha. A tabela de traceability nunca foi atualizada durante execução em nenhum milestone. Para v1.4+: ou automatizar via `gsd-tools` no final de cada phase, ou substituir por audit pós-fase como única fonte de verdade de requirement status
2. **Phase closure deve incluir ROADMAP.md + VALIDATION.md update como tasks explícitas**: as duas omissões mais frequentes em v1.3. Adicionar como tasks obrigatórias no template de conclusão de phase no GSD
3. **Features emergentes precisam de REQ-IDs antes de implementar**: Phase 17 (token usage) foi adicionada organicamente durante v1.3 mas nunca teve requisitos formais — cria gap de rastreabilidade que o audit depois tem que resolver. Se uma feature nova emerge, criar os REQ-IDs antes de começar a implementar
4. **Audit pós-milestone ainda é imprescindível**: mesmo com Nyquist compliance e testes verdes, o audit de v1.3 encontrou 1 gap de integração real (brain-echo `hasOtherToolCall`) que os testes unitários não capturaram — o audit cross-phase é insubstituível

### Cost Observations

- Timeline de 2 dias = consistente com v1.1 e v1.2; velocidade de cruzeiro mantida
- Phase 17 não estava no escopo original de v1.3 e foi concluída em ~3 planos adicionais sem afetar o timeline — indica que o processo absorve bem features emergentes quando o escopo base está bem definido
- MCP integration com `@langchain/mcp-adapters` teve documentação escassa — o PITFALL-list no PLAN.md foi essencial para mitigar os riscos antes de implementar

---

## Milestone: v1.4 — RAG + Eventos de Tools + FUP Automático

**Shipped:** 2026-06-25
**Phases:** 8 (19-26) | **Plans:** 18 | **Timeline:** 3 dias (2026-06-23 → 2026-06-25)
**Commits:** 157 | **Files changed:** 181 | **Lines:** +24.233 / -12.268

### What Was Built

- Database Foundation (Phase 19): migration 0007 com `knowledge_chunks` (pgvector), `fup_config` (IANA timezone, business hours), colunas FUP em `leads` + `touchLastMessage()` integrado ao BrainRunner
- Tool Events (Phase 20): `IEventPublisher` com adapters webhook fire-and-forget (AbortSignal 5s) e RabbitMQ confirm; `NoopEventPublisher` como fallback sem config; event_id = `threadId:tool_call_id`
- RAG (Phase 21): POST /api/v1/ingest com chunker próprio (sem deps) + cosine similarity pgvector + `createSearchKnowledgeTool(sql)` disponível em todos os Brains; 16 testes TDD
- FUP Automático (Phase 22): `FupScheduler` background com SELECT FOR UPDATE SKIP LOCKED, geração LLM one-shot via `PostgresSaver.getTuple()`, slot IANA via `Intl.DateTimeFormat`, retry 3x com `fup_failure_count`, EVT-03 fire-and-forget
- RAG Wiring Fix (Phase 23): `createSearchKnowledgeTool(ctx.sql!)` vinculada no Brain SDR `buildGraph()` — RAG end-to-end funcional
- Tech Debt Cleanup (Phase 24): WR-01..WR-04 corrigidos, 4 erros TypeScript eliminados em packages/core, REQUIREMENTS.md tracker atualizado
- FUP Activation Trigger (Phase 25): `upsertLead()` ativa `fup_enabled=true` automaticamente via `fup_config` para o `brainType` do Brain; BrainRunner passa `brainType` como 4° parâmetro (backward compatible)
- FUP Next-At Init Fix (Phase 26): `fupNextAt = getNextValidSlot(NOW() + intervals_seconds[0], config)` calculado e persistido no INSERT — fecha gap bloqueador FUP-02; leads criados com FUP são imediatamente elegíveis

### What Worked

- **Audit v1.4 identificou gaps antes do planejamento terminar**: Phase 23 (RAG Wiring Fix) e Phase 25-26 (FUP Activation + Next-At Fix) foram planejadas como resposta direta ao audit — o loop audit→gap closure→re-audit convergiu em 3 ciclos
- **Nyquist 8/8 pela primeira vez**: todos os 8 phases com `nyquist_compliant: true` — Wave 0 (test stubs) antes de implementação virou padrão real, não exceção
- **SELECT FOR UPDATE SKIP LOCKED como solução de multi-instância**: elegante, sem infrastructure adicional (Redis, etc.) — a segurança multi-instância do FupScheduler emergiu diretamente do PostgreSQL já em uso
- **getNextValidSlot compartilhado por import direto** (não duplicação): Phase 26 reutilizou a função do FupScheduler sem criar abstração desnecessária — pragmatismo > over-engineering
- **REQUIREMENTS.md tracker atualizado em Phase 24**: pela primeira vez num milestone, os checkboxes foram atualizados sistematicamente durante a execução (Phase 24 tinha o tech debt cleanup explícito como goal)
- **Chunker próprio sem @langchain/textsplitters**: sem dependência adicional; a implementação de recursive character split foi trivial e mais controlável

### What Was Inefficient

- **8 phases vs 4 planejadas**: o milestone começou com Phases 19-22; acabou com 19-26. Phases 23-26 emergiram de gaps reais encontrados pelo audit — isso é correto (não é scope creep), mas indica que o audit deveria ser planejado como parte do milestone, não uma surpresa após execução
- **EVT-03 ownership errado na primeira versão do roadmap**: EVT-03 foi mapeado para Phase 20 mas implementado em Phase 22 — a traceability ficou errada até Phase 24 corrigir. O audit v4 encontrou o "gap" que não era gap — ruído desnecessário que custou 1 ciclo extra
- **fup_failure_count em migration separada (0008)**: deveria ter sido incluído em 0007 desde o início — o FupScheduler claramente precisaria de retry tracking; a migration extra foi tech debt que entrou 1 phase depois do necessário
- **FUP-02 checkbox nunca fechado** (pela 5ª vez consecutiva): o checkbox de REQUIREMENTS.md foi adicionado como Pending em Phase 24 mas a verification E2E humana nunca aconteceu — a pendência carregou para o archive como tech debt

### Patterns Established

- **Gap closure phases como cidadãos de primeira classe**: Phases 23, 25, 26 foram gap closure phases explícitas — não patches silenciosos. O pattern de nomear e rastrear gap closure phases é correto e deve continuar
- **IEventPublisher + NoopEventPublisher como padrão de feature opcional**: quando uma feature (eventos, futuramente métricas) é opcional via ENV, o pattern é interface + Noop + injeção no BrainRunner.init() — sem `if (envConfigured)` espalhados pelo código
- **LeadService como ponto único de mutação de estado de lead**: touchLastMessage, resetFup, upsertLead com fupNextAt — toda lógica de lead state vai para LeadService; BrainRunner apenas delega. Pattern maduro.
- **Factory + closure para tools que precisam de sql**: padrão `createSearchKnowledgeTool(sql)` = mesmo padrão de v1.2; consistência total em todas as tools do core

### Key Lessons

1. **Audit deve ser planejado como fase do milestone, não descoberta após**: as 4 gap closure phases de v1.4 foram necessárias e corretas, mas o planejamento inicial não previa audit time. Para v1.5, incluir "Phase N: Audit + Gap Closure" explicitamente no roadmap com buffer de 2-3 phases
2. **E2E human verification precisa de ambiente real configurado antes do milestone terminar**: FUP-02 carregou como tech debt por 2 milestones porque nunca houve momento definido para fazer a verificação com banco real + FupScheduler. Para v1.5, criar task explícita de human verification durante a phase, não depois
3. **REQUIREMENTS.md checkbox problem resolveu parcialmente em v1.4**: Phase 24 atualizou os checkboxes como goal explícito — funciona quando o tech debt cleanup é uma phase. Para sistematizar, incluir "atualizar REQUIREMENTS.md traceability" como task padrão na conclusão de cada phase (não apenas milestone)
4. **Migration consolidada antes de múltiplas features é o caminho certo**: Phase 19 entregou 1 migration para 3 features (RAG + EVT + FUP) — sem merge conflicts de schema, sem dependências de ordem de migration entre fases. Padrão a seguir: Database Foundation antes de feature phases

### Cost Observations

- 3 dias para 8 phases foi intenso — as últimas 4 phases (23-26) foram gap closure < 1 phase/dia cada, o que explica a velocidade
- Sem substituições de library: stack de v1.0 continua 100% válido após v1.4
- Phase 24 (Tech Debt Cleanup) foi a primeira phase dedicada exclusivamente a corrigir debt acumulado — rendimento alto: WR-01..WR-04 + 4 TS errors + tracker em 3 planos

---

## Cross-Milestone Trends

| Milestone | Phases | Plans | Timeline | Requirements | E2E |
|-----------|--------|-------|----------|--------------|-----|
| v1.0 MVP | 4 | 28 | 23 dias | 28/30 (93%) | 3/3 ✅ |
| v1.1 SDR | 5 | 12 | 2 dias | 17/20 satisfied + 3 partial (85%) | 1/2 ✅ (Flow 2 ativado pós-audit) |
| v1.2 Output Parser | 4 | 11 | 2 dias | 8/8 (100%) | 2/2 ✅ |
| v1.3 MCP + responseMode | 4 | 9 | 2 dias | 9/9 (100%) | 4/5 ✅ (1 flow com intermediate state pollution não-fatal) |
| v1.4 RAG + EVT + FUP | 8 (4 planejadas + 4 gap closure) | 18 | 3 dias | 15/16 checkboxes (16/16 código) | 5/5 ✅ (Flow C E2E runtime pendente — human) |

**Trends:**
- Velocidade: 23 dias (v1.0) → ~2 dias/milestone (v1.1-v1.3) → 3 dias (v1.4, +4 gap closure phases não planejadas)
- Cobertura de requisitos: 93% → 85% → 100% → 100% → 15/16 checkbox (16/16 código) — baseline de 100% implementação mantida
- REQUIREMENTS.md tracking: 0/4 milestones (v1.0-v1.3) com checkboxes atualizados durante execução → v1.4 resolveu via Phase 24 dedicada; ainda não sistematizado por phase
- Nyquist compliance: 0% (v1.0) → parcial (v1.1/v1.2) → 3/4 (v1.3) → **8/8 (v1.4)** — maturidade atingida
- Gap closure phases: orgânicas mas não planejadas — 4/8 phases de v1.4 foram gap closure; necessita de buffer explícito no roadmap de v1.5
- Tech debt carry-over: v1.3→v1.4 (TD-03, TD-04, brain-echo guard) → v1.4→v1.5 (TD-03, TD-04, D-16, FUP-02 human verify)
