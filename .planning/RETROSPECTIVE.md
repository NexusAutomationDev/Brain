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

## Cross-Milestone Trends

| Milestone | Phases | Plans | Timeline | Requirements | E2E |
|-----------|--------|-------|----------|--------------|-----|
| v1.0 MVP | 4 | 28 | 23 dias | 28/30 (93%) | 3/3 ✅ |
