# Phase 19: Database Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-23
**Phase:** 19-database-foundation
**Areas discussed:** fup_config escopo, Intervalos FUP, Dias permitidos, knowledge_chunks deduplication

---

## fup_config — Escopo da Configuração

| Option | Description | Selected |
|--------|-------------|----------|
| Singleton global | 1 linha por banco, sem brain_type. SELECT * LIMIT 1. | |
| Por brain_type | 1 linha por tipo de Brain, brain_type como PK | ✓ |

**User's choice:** Por brain_type, com brain_type como Primary Key (text) — sem UUID separado.
**Notes:** O usuário optou por flexibilidade futura: SDR, Suporte, CS podem ter ritmos de FUP diferentes.

---

## fup_config — PK e Identificação

| Option | Description | Selected |
|--------|-------------|----------|
| brain_type como PK | text brain_type PRIMARY KEY. Desvio consciente do padrão UUID. | ✓ |
| UUID PK + brain_type UNIQUE | Consistente com todas as outras tabelas. | |

**User's choice:** brain_type como PK.
**Notes:** Simplifica o upsert por tipo de Brain; aceita o desvio do padrão UUID das outras tabelas.

---

## Intervalos de FUP — Formato dos Steps

| Option | Description | Selected |
|--------|-------------|----------|
| integer[] na fup_config | Coluna intervals_seconds integer[]. Simples, sem JOINs. | ✓ |
| Tabela separada fup_steps | Normalizada, com FK. Mais JOINs. | |
| JSONB | Flexível mas sem tipagem. | |

**User's choice:** integer[] na fup_config (coluna `intervals_seconds`).
**Notes:** YAGNI — array é suficiente para 3-10 steps. Tabela separada não agrega valor no v1.4.

---

## Dias Permitidos — Representação no Banco

| Option | Description | Selected |
|--------|-------------|----------|
| text[] allowed_days | Ex: {'mon','tue','wed','thu','fri'}. Legível. | ✓ |
| Boolean por coluna | 7 colunas (mon_enabled ... sun_enabled). Verboso. | |
| Integer bitmask | Compacto mas opaco. Requer bitwise em código. | |

**User's choice:** text[] (coluna `allowed_days`).
**Notes:** Legibilidade e facilidade de validação em TypeScript foram os fatores decisivos.

---

## knowledge_chunks — Identificador de Deduplicação

| Option | Description | Selected |
|--------|-------------|----------|
| Sem source_id (delete e re-insere) | Simples. Phase 21 apaga coleção e re-insere. YAGNI. | ✓ |
| source_id text nullable | Permite atualizar chunks de documento específico. | |

**User's choice:** Sem source_id — Phase 21 deleta por collection e re-insere.
**Notes:** RAG-F01 (re-indexação por documento) é requisito futuro; não vale a complexidade agora.

---

## Claude's Discretion

- Tipos SQL para campos não especificados (createdAt, updatedAt, etc.)
- Constraints CHECK para min_hour/max_hour (0–23)
- Nomenclatura em snake_case seguindo padrão existente

## Deferred Ideas

- `source_id` em knowledge_chunks — RAG-F01, futuro
- Índice HNSW em knowledge_chunks — Out of Scope (REQUIREMENTS.md), criado manualmente pós-ingestão
- Tabela separada `fup_steps` — desnecessário até steps precisarem de metadados próprios
- Boolean columns individuais por dia — alternativa se queries por dia específico forem necessárias
