# Requirements: Brain Core v1.4

**Defined:** 2026-06-23
**Core Value:** Infraestrutura de agentes modular onde novos Brains são criados definindo apenas prompts, tools, embeddings e fluxos — sem reescrever a base.

## v1.4 Requirements

Requirements para o milestone v1.4. Cada um mapeia para fases do roadmap.

### RAG — Base de Conhecimento Semântica

- [x] **RAG-01**: Operador pode enviar texto e nome de coleção via POST /api/v1/ingest e o sistema chunka, embede e armazena no pgvector, autenticado via INGEST_TOKEN
- [x] **RAG-02**: LLM pode buscar contexto relevante chamando a tool `search_knowledge(query, collections[])` que retorna trechos ordenados por similaridade
- [x] **RAG-03**: `search_knowledge` aceita array de coleções e busca em múltiplas coleções simultaneamente numa única chamada
- [x] **RAG-04**: Cada chunk armazenado registra collection_name, embedding_model, chunk_index e total_chunks como metadados não-nulos

### EVT — Eventos de Tools (Canal de Saída)

- [x] **EVT-01**: Brain publica eventos de resultado de tools em canal separado (webhook via TOOL_EVENTS_URL ou RabbitMQ via TOOL_EVENTS_QUEUE) configurável via ENV, sem bloquear o fluxo principal
- [x] **EVT-02**: Quando qualify_lead, pause_session ou finish_conversation produzem resultado, o evento `{ action, lead: { id, nome, numero }, result }` é publicado automaticamente no canal de saída
- [x] **EVT-03**: Quando FUP envia mensagem, publica evento `{ action: "fup", lead, result: { step, message } }` no canal de saída
- [x] **EVT-04**: Cada evento carrega `event_id` derivado de `thread_id:tool_call_id` para permitir deduplicação idempotente pelo consumidor. **Exceção FUP:** eventos de FUP usam `event_id = ${lead.uniqueId}:fup:${fup_step}` — FUP events não têm `tool_call_id` (D-17 da Phase 22, decisão intencional).

### FUP — Follow-up Automático

- [x] **FUP-01**: Configuração de FUP (intervalos em segundos, hora mínima, hora máxima, dias permitidos, fuso horário IANA) é armazenada em tabela `fup_config` no banco — não em ENV
- [ ] **FUP-02**: Scheduler background detecta leads silenciosos (last_message_at + limiar via ENV) e processa FUPs usando SELECT FOR UPDATE SKIP LOCKED para segurança em múltiplas instâncias
- [x] **FUP-03**: Conteúdo de cada FUP é gerado por chamada LLM one-shot usando o histórico da conversa (via PostgresSaver.getTuple) e o prompt "fup" do banco — sem invocar o grafo completo
- [x] **FUP-04**: Estado de FUP de cada lead é persistido no banco com colunas fup_step, fup_next_at e fup_enabled na tabela leads — sem estado em memória
- [x] **FUP-05**: Ao enviar o último FUP da sequência configurada, o sistema seta ia_ativada = false e fup_enabled = false automaticamente
- [x] **FUP-06**: BrainRunner.run() cancela todos os FUPs pendentes e atualiza last_message_at do lead a cada mensagem recebida
- [x] **FUP-07**: Se a janela de horário ou dias não permitir envio no momento calculado, o scheduler agenda para o próximo slot válido em vez de descartar
- [x] **FUP-08**: Se LLM ou transport falhar ao enviar FUP, o sistema re-tenta até 3 vezes (failure_count) antes de marcar a etapa como falha e logar alerta

## Requisitos Futuros

Deferidos para próximos milestones. Monitorados mas fora do roadmap atual.

### RAG — Futuro

- **RAG-F01**: Re-indexação de coleção ao trocar modelo de embedding (operação de manutenção)
- **RAG-F02**: Endpoint DELETE /api/v1/ingest/:collection para limpar coleção inteira
- **RAG-F03**: Interface de monitoramento de coleções (quais existem, quantos chunks, modelo em uso)

### FUP — Futuro

- **FUP-F01**: FUP iniciado por tool call explícita do LLM (além do modo silêncio automático)
- **FUP-F02**: Dashboard de status de FUPs por lead (etapa atual, próximo envio, histórico)
- **FUP-F03**: FUP por segmento de leads (grupos com config de FUP diferentes)

### EVT — Futuro

- **EVT-F01**: Retry com backoff exponencial no canal de eventos (v1.4 é fire-and-forget)
- **EVT-F02**: Dead letter queue para eventos que falharam após N tentativas

## Out of Scope

Features explicitamente excluídas deste milestone.

| Feature | Motivo |
|---------|--------|
| RAG com banco de vetores externo (Pinecone, Qdrant) | pgvector já está na stack; separar infra não agrega valor neste estágio |
| Interface admin de coleções RAG | Complexidade de UI desnecessária; ingest via API é suficiente |
| FUP iniciado por event externo (webhook de entrada) | Trigger por silêncio cobre o caso de uso SDR; outros triggers ficam para v1.5 |
| Re-indexação automática ao trocar modelo de embedding | Operação manual de manutenção; automação requer blue-green que escapa do escopo |
| HNSW index na migration inicial | Index HNSW deve ser criado manualmente pós-ingestão (tabela vazia → index inútil) |
| Eventos para RAG search_knowledge | Resultado fica inline na conversa do LLM; não precisa de notificação externa |

## Traceability

Preenchido pelo roadmapper após criação do roadmap.

| Requirement | Phase | Status |
|-------------|-------|--------|
| RAG-01 | Phase 21 | Complete |
| RAG-02 | Phase 23 | Complete |
| RAG-03 | Phase 23 | Complete |
| RAG-04 | Phase 21 | Complete |
| EVT-01 | Phase 20 | Complete |
| EVT-02 | Phase 20 | Complete |
| EVT-03 | Phase 22 | Complete |
| EVT-04 | Phase 20 | Complete |
| FUP-01 | Phase 22 | Complete |
| FUP-02 | Phase 26 | Pending |
| FUP-03 | Phase 22 | Complete |
| FUP-04 | Phase 19 | Complete |
| FUP-05 | Phase 22 | Complete |
| FUP-06 | Phase 19 | Complete |
| FUP-07 | Phase 22 | Complete |
| FUP-08 | Phase 22 | Complete |

**Coverage:**
- v1.4 requirements: 16 total
- Mapped to phases: 16 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-23*
*Last updated: 2026-06-25 — Phase 26 gap closure: FUP-02 reset [ ], traceability Phase 22→26 Pending*
