# Requirements — Brain Core v1.1

**Milestone:** v1.1 Brain SDR + Infraestrutura Produção
**Status:** Active
**Last updated:** 2026-06-13

---

## v1.1 Requirements

### Transport

- [ ] **TRP-01**: Webhook valida campos obrigatórios (Name, Message, Numero, IDLead) e rejeita com erro se algum faltar
- [ ] **TRP-02**: WebhookTransport.start() injeta runner corretamente (correção GAP-1)
- [ ] **TRP-03**: Transport RabbitMQ via rabbitmq-client consome fila com campos padronizados (Name, Message, Numero, IDLead)
- [ ] **TRP-04**: Nome da fila RabbitMQ configurável via variável de ambiente
- [ ] **TRP-05**: RabbitMQ opera com manual ack/nack, Dead Letter Exchange, prefetch=1 e reconexão automática
- [ ] **TRP-06**: Seleção de transport via ENV `TRANSPORT=webhook|rabbitmq`

### Leads

- [ ] **LEAD-01**: Tabela `leads` (id, unique_id app-generated, nome, numero, ia_ativada, fullpp) criada como substituta de `users`
- [ ] **LEAD-02**: Lead cadastrado automaticamente na primeira mensagem — upsert por `numero`, `unique_id` gerado pela aplicação e nunca sobrescrito
- [ ] **LEAD-03**: Mensagens de lead com `ia_ativada=false` são ignoradas silenciosamente antes de qualquer processamento pelo Brain
- [ ] **LEAD-04**: Brain executa auto-migrate na inicialização — verifica e cria tabelas necessárias antes de aceitar mensagens

### Histórico de Conversas

- [ ] **HIST-01**: `thread_id = lead.unique_id` — conversa vinculada ao lead via PostgresSaver, histórico recuperado automaticamente
- [ ] **HIST-02**: Histórico completo persistido entre sessões — lead retornando dias depois tem contexto anterior recuperado
- [ ] **HIST-03**: trimMessages ativo — limite de mensagens mantidas no contexto configurável via ENV

### Brain SDR

- [ ] **SDR-01**: Brain SDR recebe mensagem, recupera contexto do lead e conduz conversa de atendimento inicial seguindo prompt do banco
- [ ] **SDR-02**: Brain SDR nunca processa lead com `ia_ativada=false` (via LeadService compartilhado)
- [ ] **SDR-03**: Todas as interações do Brain SDR são registradas no banco
- [ ] **SDR-04**: Prompts do Brain SDR armazenados no banco, zero hardcode, atualizáveis sem deploy

- [ ] **SDR-05**: Sub-agente de qualificação — acionado pelo Brain SDR com dois inputs: (1) breve descrição do momento da conversa e (2) ID da sessão. Um serviço de código (não o agente principal) usa o ID da sessão para buscar no banco todo o histórico da conversa separado em mensagens da IA e mensagens do lead, e entrega esse histórico ao sub-agente. O sub-agente usa prompt vindo do banco para analisar o histórico completo e retorna ao Brain principal três campos: **qualificado** (sim/não), **motivo** (por que qualificou ou não) e **próximo passo** (o que o Brain principal deve fazer a seguir)

### Infraestrutura

- [ ] **INFRA-01**: TenantPoolManager ativado em produção no Brain SDR — seleção de banco via `DATABASE_NAME` ENV
- [ ] **INFRA-02**: Lint configurado em todos os pacotes do monorepo

---

## Future Requirements

- Sub-agente de qualificação avançado com SPIN/BANT completo e múltiplos critérios configuráveis — v1.2
- Outros Brains: Suporte, Customer Success, Cobrança, RH, E-commerce, Agendamento — pós v1.1
- `fullpp` com regra de negócio definida — futuro quando necessário
- Memória semântica (embeddings + RAG) ativa em produção — pós v1.1
- Campo `transport` no GET /health — pós v1.1 (deferido per OBS-02)

---

## Out of Scope

- Sub-agente com subgraph LangGraph completo e múltiplos critérios de qualificação — simplificado em SDR-05 para v1.1
- Brain SDR publicando respostas de volta ao RabbitMQ (amqplib-bun large-message bug) — apenas consume em v1.1
- Outros Brains específicos (Suporte, CS, Cobrança) — pós v1.1
- Mecanismo de licenciamento (LICENSE_KEY) — futuro
- UI de gerenciamento de Brains — futuro
- Migração para tenant_id nas tabelas — futuro quando escala demandar

---

## Traceability

> Preenchido pelo roadmapper — mapeia cada REQ-ID à fase que o implementa.

| REQ-ID | Phase | Status |
|--------|-------|--------|
| TRP-01 | Phase 7 | pending |
| TRP-02 | Phase 5 | pending |
| TRP-03 | Phase 7 | pending |
| TRP-04 | Phase 7 | pending |
| TRP-05 | Phase 7 | pending |
| TRP-06 | Phase 7 | pending |
| LEAD-01 | Phase 6 | pending |
| LEAD-02 | Phase 7 | pending |
| LEAD-03 | Phase 7 | pending |
| LEAD-04 | Phase 6 | pending |
| HIST-01 | Phase 8 | pending |
| HIST-02 | Phase 8 | pending |
| HIST-03 | Phase 8 | pending |
| SDR-01 | Phase 9 | pending |
| SDR-02 | Phase 9 | pending |
| SDR-03 | Phase 9 | pending |
| SDR-04 | Phase 9 | pending |
| SDR-05 | Phase 9 | pending |
| INFRA-01 | Phase 9 | pending |
| INFRA-02 | Phase 5 | pending |
