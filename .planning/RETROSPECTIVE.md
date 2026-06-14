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

## Cross-Milestone Trends

| Milestone | Phases | Plans | Timeline | Requirements | E2E |
|-----------|--------|-------|----------|--------------|-----|
| v1.0 MVP | 4 | 28 | 23 dias | 28/30 (93%) | 3/3 ✅ |
| v1.1 SDR | 5 | 12 | 2 dias | 17/20 satisfied + 3 partial (85%) | 1/2 ✅ (Flow 2 ativado pós-audit) |
