# Phase 33: Seed por Tipo de Brain - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-12
**Phase:** 33-Seed por Tipo de Brain
**Areas discussed:** Default fup_config values, Default prompt key='fup' content, brain-echo escopo, Falha de seed — comportamento, FUP message persisted to checkpoint (scope expansion)

---

## Default fup_config values

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| Mesmo default ou por tipo? | Mesmo default p/ todos | Um único conjunto de valores reaplicado para sdr, support e echo | ✓ |
| | Específico por tipo | sdr mais agressivo, support mais espaçado | |
| Cadência (intervals_seconds)? | 1h → 1d → 3d (recomendado) | [3600, 86400, 259200] — mesmo padrão do fixture baseFupConfig | ✓ |
| | 6h → 1d → 3d → 7d | 4 tentativas, menos agressivo | |
| | Você decide | Claude escolhe default razoável | |
| Janela/dias/timezone? | 8–18h, seg–sex, America/Sao_Paulo (recomendado) | Horário comercial BR — mesmo padrão do fixture existente | ✓ |
| | 0–23h, todos os dias, UTC | Sempre elegível, sem restrição | |

**User's choice:** Mesmo default para todos os tipos; [3600, 86400, 259200]; 8–18h seg-sex America/Sao_Paulo.
**Notes:** Nenhuma.

---

## Default prompt key='fup' content

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| Genérico ou por tipo? | Genérico, igual para todos | Texto neutro reusável, cliente customiza depois via UPDATE | ✓ |
| | Tom específico por tipo | sdr comercial, support suporte | |
| Production-ready ou placeholder? | Production-ready genérico | Pode ir pro ar sem customização | ✓ |
| | Placeholder explícito | Texto marcado "personalize isso" | |

**User's choice:** Texto genérico e production-ready.
**Notes:** Nenhuma.

---

## brain-echo escopo

| Option | Description | Selected |
|--------|-------------|----------|
| Inclui echo (recomendado) | Mesmo mecanismo uniforme pros 3 tipos, echo também serve como teste E2E do mecanismo | ✓ |
| Exclui echo | SEED-02/03 aplicam só a sdr/support | |

**User's choice:** Inclui echo.
**Notes:** brain-echo é "validation-only" (não vendido a cliente) segundo o tech debt ledger de PROJECT.md, mas o usuário preferiu manter o mecanismo uniforme sem exceção de código.

---

## Falha de seed — comportamento

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| Fail-fast ou warning? | Fail-fast (recomendado) | SELECT pós-seed confirma linhas esperadas; falha alta se faltar algo, mesmo padrão D-06 | ✓ |
| | Warning apenas | Loga warning, container sobe mesmo assim | |
| Onde validar? | Dentro do runBrainSeed() (recomendado) | Uma vez por deploy, não por instância | ✓ |
| | Em BrainRunner.init() logo depois | Separado do runBrainSeed() | |

**User's choice:** Fail-fast, validação dentro de runBrainSeed().
**Notes:** Referência direta ao Pitfall 2 do PITFALLS.md — o mesmo tipo de bug silencioso que já existe hoje com FUP.

---

## FUP message persisted to checkpoint (scope expansion)

**Contexto:** Ao ser perguntado se restava alguma área cinzenta, o usuário levantou duas dúvidas: (1) se uma edição direta de prompt via SQL afeta a próxima mensagem automaticamente, e (2) se a mensagem de FUP enviada também é gravada na memória/histórico da IA para dar sequência com esse contexto. Investigação de código confirmou: (1) não — prompts são snapshotados em `_compileGraph()`, só atualizam via `/reload-prompts` ou restart; (2) não — `FupScheduler` hoje só lê o checkpoint (`getTuple()`), nunca escreve nele.

| Option | Description | Selected |
|--------|-------------|----------|
| Anotar como ideia futura (recomendado) | Phase 33 fica focada em SEED-01..05; item vira backlog | |
| Incluir na Phase 33 | Expande o escopo desta fase para também alterar FupScheduler | ✓ |

**User's choice:** Incluir na Phase 33 — usuário confirmou explicitamente após o flag de escopo do Claude.
**Notes:** Investigação de viabilidade confirmou que é uma mudança de wiring pequena (FupScheduler já é instanciado dentro de BrainRunner.init() logo após _compileGraph(), onde compiledGraph já existe) — não uma reestruturação arquitetural. Este item expande o texto original de SEED-01..05 em REQUIREMENTS.md; não há requirement numerado para ele ainda (nota deixada em CONTEXT.md para o planner considerar formalizar).

---

## Claude's Discretion

- Estrutura física dos arquivos de seed (`seeds/<brainType>/*.sql` vs `.ts` descriptor).
- Texto exato do prompt `key='fup'` (tom genérico e profissional).
- Nome exato do ENV `SEEDS_FOLDER` e detalhes de onde a validação fail-fast loga/lança erro.

## Deferred Ideas

Nenhuma — a única expansão de escopo levantada (FUP no checkpoint) foi incluída na própria Phase 33, não deferida.
