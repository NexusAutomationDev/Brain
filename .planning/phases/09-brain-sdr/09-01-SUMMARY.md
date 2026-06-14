---
phase: "09-brain-sdr"
plan: "01"
subsystem: database/migrations
tags: [seed, prompts, sdr, migration, idempotency]
completed_at: "2026-06-14T21:15:00Z"
duration_minutes: 5
tasks_completed: 1
tasks_total: 1
files_created: 1
files_modified: 0

dependency_graph:
  requires: ["09-00"]
  provides: ["prompts seed para brain_type='sdr'"]
  affects: ["packages/database/src/migrations/", "BrainRunner.init() bootstrap path"]

tech_stack:
  added: []
  patterns: ["migration SQL idempotente com ON CONFLICT DO NOTHING"]

key_files:
  created:
    - packages/database/src/migrations/0005_brain_sdr_prompts.sql
  modified: []

decisions:
  - "brain_type='sdr' (não 'brain-sdr') alinhado com sdrBrain.brainType — divergência causaria process.exit(1) no BrainRunner.init()"
  - "ON CONFLICT (brain_type, key) DO NOTHING garante que múltiplas instâncias rodando init() simultaneamente não causam constraint violation"

requirements_satisfied: [SDR-04]
---

# Phase 09 Plan 01: Brain SDR Prompt Seed Migration Summary

Migration SQL com seed dos prompts do Brain SDR — dois INSERTs idempotentes para brain_type='sdr'.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Criar migration 0005_brain_sdr_prompts.sql com seed SDR | a810b25 | packages/database/src/migrations/0005_brain_sdr_prompts.sql |

## What Was Built

`packages/database/src/migrations/0005_brain_sdr_prompts.sql` — migration SQL com dois INSERTs idempotentes que fazem seed dos prompts do Brain SDR no banco PostgreSQL.

**Prompt 'system':** Instrui o Brain SDR a conduzir conversas de atendimento comercial no WhatsApp, com guidelines de tom profissional, perguntas abertas para qualificação, limites de tamanho de mensagem (3-4 frases) e acionamento da ferramenta `qualify_lead` quando o lead demonstrar interesse suficiente.

**Prompt 'qualification':** Instrui o sub-agente de qualificação a analisar histórico de conversa e retornar JSON estruturado com `{"qualificado": bool, "motivo": string, "proximo_passo": string}` — critérios BANT implícitos (necessidade, autoridade, urgência, budget).

Ambos os INSERTs usam `ON CONFLICT (brain_type, key) DO NOTHING` — migration é append-only, segura para múltiplas instâncias e pode ser re-executada sem efeitos colaterais.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None — migration é SQL puro com conteúdo completo dos prompts. Sem valores hardcoded vazios ou placeholders.

## Threat Flags

None — nenhuma superfície de segurança nova além do que foi documentado no threat model do plano.

## Self-Check: PASSED

- FOUND: packages/database/src/migrations/0005_brain_sdr_prompts.sql
- FOUND: commit a810b25 (✨ feat(09-01): add migration 0005 with Brain SDR prompt seeds)
