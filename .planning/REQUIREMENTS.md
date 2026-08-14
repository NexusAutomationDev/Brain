# Requirements: Brain Core — v1.6

**Defined:** 2026-08-12
**Core Value:** Uma infraestrutura de agentes modular onde novos Brains são criados definindo apenas prompts, tools, embeddings e fluxos — sem reescrever a base.

## v1 Requirements

### SEED — Seed por Tipo de Brain

- [x] **SEED-01**: Cada imagem de Brain semeia, na inicialização, apenas os prompts do seu próprio `brain_type` — sem inserir prompts de outros tipos (echo, sdr, support) no banco
- [x] **SEED-02**: Cada Brain tem uma linha padrão de `fup_config` semeada automaticamente na inicialização, se ainda não existir
- [x] **SEED-03**: Cada Brain tem um prompt padrão `key='fup'` semeado automaticamente na inicialização, se ainda não existir — corrige o FUP estar silenciosamente inoperante em bancos novos
- [x] **SEED-04**: O novo mecanismo de seed roda de forma idempotente (`ON CONFLICT DO NOTHING`), independente do fluxo de migrations do Drizzle (`runMigrations()`/`_schema_lock` continuam intocados)
- [x] **SEED-05**: As migrations de seed já existentes (0002, 0005, 0010) permanecem como estão — bancos de clientes já em produção não sofrem migration destrutiva/retroativa

### HANDOFF — Transferência de Lead entre Agentes

- [x] **HANDOFF-01**: Tabela `agents` armazena os agentes de destino conhecidos por um Brain (nome, tipo, connection string do banco destino), configurável via SQL direto sem redeploy
- [x] **HANDOFF-02**: `CREATE EXTENSION IF NOT EXISTS dblink` faz parte da migration padrão compartilhada — não depende mais de ativação manual por banco
- [ ] **HANDOFF-03**: Tool `transfer_lead` disponível para o LLM; o gatilho de "quando transferir" é definido via prompt de cada Brain (sem regra hardcoded no código), seguindo o mesmo padrão de `qualify_lead`/`pause_session`
- [x] **HANDOFF-04**: A tool valida o nome do agente destino contra a tabela `agents` (nome desconhecido ou `enabled=false` retorna erro, sem transferir)
- [ ] **HANDOFF-05**: Resumo do handoff gerado por LLM one-shot a partir do histórico do checkpoint da conversa (mesmo padrão stateless do sub-agente de qualificação e do FUP-03)
- [ ] **HANDOFF-06**: A tool escreve via DBLINK diretamente no banco do agente destino: upsert do lead (numero, nome, unique_id) + o resumo gerado em uma nova coluna `leads.handoff_context`
- [ ] **HANDOFF-07**: O Brain destino, ao processar a próxima mensagem desse lead, lê `handoff_context` automaticamente e o usa como contexto inicial da conversa — depois limpa o campo
- [ ] **HANDOFF-08**: Após confirmação de que a escrita no destino teve sucesso, o Brain de origem desativa o lead (`ia_ativada=false` via `LeadService.setIaAtivada()`) — resolve TD-04 (método existente sem callers de produção)
- [ ] **HANDOFF-09**: Evento `transfer_lead` publicado no canal de eventos existente (`IEventPublisher`) via adição à `TOOL_EVENTS_WHITELIST` — sem nova infraestrutura de notificação
- [x] **HANDOFF-10**: `thread_id` do lead é sempre lido do contexto de execução (nunca do argumento da tool/LLM), seguindo o padrão D-04 das outras tools

## v2 Requirements

### HANDOFF (futuro)

- **HANDOFF-11**: Endpoint HTTP opcional (`POST /api/v1/handoff` ou similar) para notificar/acordar o Brain destino imediatamente após a transferência, permitindo resposta proativa ao lead sem esperar a próxima mensagem chegar
- **HANDOFF-12**: Handoff bidirecional (agente destino devolve o lead ao agente de origem)
- **HANDOFF-13**: Limite de hops / prevenção de loop de transferências entre agentes
- **HANDOFF-14**: UI de administração para a tabela `agents` (hoje: SQL direto, mesmo padrão operacional de `fup_config`)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Endpoint HTTP como mecanismo obrigatório de transferência | Usuário confirmou DBLink como mecanismo principal — endpoint vira melhoria futura opcional (v2) |
| Criptografia da connection string em `agents` | Sem precedente no código hoje (ADMIN_TOKEN também é ENV em texto plano) — mesmo padrão aceito |
| Remoção/deprecação retroativa das migrations 0002/0005/0010 | Strategy B (research ARCHITECTURE.md): aceitar como legado inerte é mais seguro que reescrever histórico de migration em bancos de clientes já em produção |
| Pooling de conexão cross-container tipo TenantPoolManager para o handoff | Substituído por DBLink, que já roda dentro da conexão existente do Brain de origem |
| Round-trip handoff (contexto completo bidirecional, retorno automático) | Fora do escopo declarado do milestone ("transferir para outro agente", não "trocar de ida e volta") |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEED-01 | Phase 33 | Complete |
| SEED-02 | Phase 33 | Complete |
| SEED-03 | Phase 33 | Complete |
| SEED-04 | Phase 33 | Complete |
| SEED-05 | Phase 33 | Complete |
| HANDOFF-01 | Phase 34 | Complete |
| HANDOFF-02 | Phase 34 | Complete |
| HANDOFF-04 | Phase 34 | Complete |
| HANDOFF-10 | Phase 34 | Complete |
| HANDOFF-03 | Phase 35 | Pending |
| HANDOFF-05 | Phase 35 | Pending |
| HANDOFF-06 | Phase 35 | Pending |
| HANDOFF-07 | Phase 35 | Pending |
| HANDOFF-08 | Phase 35 | Pending |
| HANDOFF-09 | Phase 35 | Pending |

Coverage: 15/15 v1 requirements mapped. No orphans.

---
*Requirements defined: 2026-08-12*
*Last updated: 2026-08-12 after ROADMAP.md creation (v1.6) — traceability filled, Phases 33-35*
