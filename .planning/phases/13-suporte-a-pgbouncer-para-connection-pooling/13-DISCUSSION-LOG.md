# Phase 13: Suporte a PgBouncer para Connection Pooling - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-15
**Phase:** 13-suporte-a-pgbouncer-para-connection-pooling
**Areas discussed:** Escopo da fase, Modo PgBouncer alvo, Estratégia de migrations, PostgresSaver + PgBouncer

---

## Escopo da fase

| Option | Description | Selected |
|--------|-------------|----------|
| Sim, corrigir CR-01 aqui | CR-01 piora com PgBouncer; fix no qualifier.ts em finally ou refatorar para fromPool(sql) | ✓ |
| Não, fase separada | CR-01 vai para backlog como quick task | |

**User's choice:** CR-01 incluído no escopo desta fase.

| Option | Description | Selected |
|--------|-------------|----------|
| Sim, incluir docker-compose | PgBouncer service no docker-compose de dev | |
| Não, só código | Clientes configuram PgBouncer externamente | ✓ |

**User's choice:** Apenas código SDK — sem docker-compose com PgBouncer.

---

## Modo PgBouncer alvo

| Option | Description | Selected |
|--------|-------------|----------|
| Session mode | Advisory locks funcionam, mais simples | |
| Transaction mode | Máxima eficiência, requer refatoração de lock e prepared statements | |
| Ambos (session + transaction) | Código detecta via ENV ou sempre-compatível | ✓ |

**User's choice:** Suporte a ambos os modos.

| Option | Description | Selected |
|--------|-------------|----------|
| ENV opt-in: PGBOUNCER_MODE=session\|transaction | Flag explícita, comportamento atual quando ausente | |
| Sempre compatível (sem flag) | prepare: false por padrão em todas as conexões | ✓ |

**User's choice:** Sempre compatível — sem flag ENV, prepare: false sempre.

---

## Estratégia de migrations

| Option | Description | Selected |
|--------|-------------|----------|
| Row-lock em tabela schema_locks | BEGIN + SELECT FOR UPDATE NOWAIT — compatível com transaction mode | ✓ |
| Manter advisory lock, documentar limitação | pg_advisory_lock permanece; transaction mode não suporta auto-migrate | |
| Externalizar para init container | Remove o problema do lock completamente, muda deployment model | |

**User's choice:** Row-lock em tabela `_schema_lock`.

| Option | Description | Selected |
|--------|-------------|----------|
| Migration usa DATABASE_DIRECT_URL | Conexão direta ao PG para migrations; DATABASE_URL via PgBouncer para operações normais | |
| Migration passa pelo PgBouncer | Uma URL para tudo | ✓ |

**User's choice:** Uma URL só — sem DATABASE_DIRECT_URL. Mas como o advisory lock é substituído por row-lock (transaction-compatible), migrations funcionam via PgBouncer em qualquer modo.

---

## PostgresSaver + PgBouncer

| Option | Description | Selected |
|--------|-------------|----------|
| Direto ao PG via DATABASE_DIRECT_URL | Evita incompatibilidades do pg driver com PgBouncer transaction mode | |
| Via PgBouncer (DATABASE_URL) | PostgresSaver passa pelo PgBouncer — risco de incompatibilidade com transaction mode | ✓ |

**User's choice:** PostgresSaver via DATABASE_URL (PgBouncer) — sem separação de URL.

**Notes:** Usuário explicitamente rejeitou DATABASE_DIRECT_URL. Sem nenhuma variável nova de ENV.

| Option | Description | Selected |
|--------|-------------|----------|
| Aceitar que session mode é o modo suportado para o checkpointer | PostgresSaver + session mode documentado | |
| Investigar e testar na fase, decidir no PLAN.md | Researcher verifica compatibilidade do langgraph-checkpoint-postgres com transaction mode | ✓ |

**User's choice:** Investigar na fase — researcher deve verificar compatibilidade antes de planejar.

---

## Claude's Discretion

- Naming da tabela de lock para migrations
- Estratégia de retry no SELECT FOR UPDATE NOWAIT
- Se PostgresSaver for incompatível com transaction mode: documentar ou fazer wrapper

## Deferred Ideas

- WR-01, WR-02, WR-03 da Phase 12 review — backlog
- PgBouncer service no docker-compose — fora do escopo
- PGBOUNCER_MODE ENV flag — rejeitada em favor de sempre-compatível
