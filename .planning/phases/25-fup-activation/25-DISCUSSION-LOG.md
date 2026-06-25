# Phase 25: FUP Activation Trigger - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-24
**Phase:** 25-fup-activation
**Areas discussed:** Trigger de ativação, Cálculo do primeiro fup_next_at, Leads existentes, Opt-out manual

---

## Trigger de ativação

### Onde deve ocorrer a ativação automática de fup_enabled?

| Option | Description | Selected |
|--------|-------------|----------|
| Em upsertLead() (Recomendado) | Lead recebe fup_enabled = true no momento do cadastro/update se fup_config existe e está enabled para o brain_type | ✓ |
| No startup do Brain | Brain verifica fup_config.enabled e faz UPDATE em massa em todos os leads com fup_enabled = false | |
| No primeiro tick do FupScheduler | Scheduler ativa leads elegíveis (ia_ativada = true, last_message_at != null) no primeiro polling | |

**User's choice:** Em upsertLead() (Recomendado)
**Notes:** Ativação no ponto de criação do lead — mais natural e sem update em massa.

---

### Como upsertLead() saberá se deve ativar FUP?

| Option | Description | Selected |
|--------|-------------|----------|
| Passar brain_type como parâmetro (Recomendado) | upsertLead(numero, uniqueId, nome, brainType?) — se brainType informado, consulta fup_config para decidir | ✓ |
| Injetar fupConfig no LeadService | LeadService recebe fupConfig no construtor (já carregado pelo Brain) e usa em upsertLead() | |
| Query síncrona no upsertLead() | upsertLead() faz SELECT em fup_config toda vez — mais queries, sem dependência externa | |

**User's choice:** Passar brain_type como parâmetro (Recomendado)
**Notes:** Parâmetro opcional mantém compatibilidade com callers existentes.

---

### Se fup_config não existir para o brain_type, qual o comportamento?

| Option | Description | Selected |
|--------|-------------|----------|
| Silencioso (fup_enabled = false) | Sem config = sem FUP. Lead criado normalmente com fup_enabled = false. Mais seguro. | ✓ |
| Warning no log | Igual ao anterior, mas loga logger.warn() para alertar operador que FUP não está configurado. | |

**User's choice:** Silencioso (fup_enabled = false)
**Notes:** Sem ruído no log — operador sabe que precisa configurar fup_config.

---

## Cálculo do primeiro fup_next_at

### Quando deve ser calculado o primeiro fup_next_at?

| Option | Description | Selected |
|--------|-------------|----------|
| No upsertLead() junto com fup_enabled | fup_next_at = NOW() + intervals_seconds[0] (respeitando janela) no momento da criação | |
| No primeiro tick do FupScheduler (Recomendado) | Lead criado com fup_enabled = true mas fup_next_at = NULL. Scheduler calcula no primeiro polling baseado em last_message_at | ✓ |
| Lazy no touchLastMessage() | Quando lead responde, touchLastMessage() calcula fup_next_at = NOW() + intervals_seconds[0] | |

**User's choice:** No primeiro tick do FupScheduler (Recomendado)
**Notes:** Separação de responsabilidades — upsertLead() só ativa, scheduler agenda.

---

### Lead recém-criado sem last_message_at — FupScheduler deve calcular baseado em quê?

| Option | Description | Selected |
|--------|-------------|----------|
| created_at do lead | Primeiro FUP = created_at + intervals_seconds[0]. Lead novo começa a contar do cadastro. | |
| NOW() do tick | Primeiro FUP = NOW() + intervals_seconds[0]. Ignora quando lead foi criado, conta de agora. | |
| Exigir last_message_at (Recomendado) | Se last_message_at é NULL, scheduler pula o lead. FUP só ativa após primeira mensagem real. | ✓ |

**User's choice:** Exigir last_message_at (Recomendado)
**Notes:** FUP só faz sentido após o lead ter conversado — evita FUP para leads "fantasmas".

---

## Leads existentes

### O que fazer com leads existentes no banco (fup_enabled = false)?

| Option | Description | Selected |
|--------|-------------|----------|
| Nada — só novos leads (Recomendado) | Leads existentes permanecem fup_enabled = false. Operador ativa manualmente se quiser. Mais seguro. | ✓ |
| Startup: ativar leads com last_message_at | Brain faz UPDATE em massa: se last_message_at != NULL AND ia_ativada = true, seta fup_enabled = true | |
| Migration script separado | Script SQL de migração manual para operador rodar em produção quando quiser | |

**User's choice:** Nada — só novos leads (Recomendado)
**Notes:** Sem surpresas em produção — operador decide se quer ativar leads antigos.

---

## Opt-out manual

### Como distinguir lead desativado manualmente de lead que nunca foi ativado?

| Option | Description | Selected |
|--------|-------------|----------|
| Nova coluna fup_opted_out (explícita) | Coluna boolean fup_opted_out DEFAULT false. Se true, upsertLead() nunca ativa fup_enabled. | |
| Sem distinção (Recomendado) | fup_enabled = false é o estado. upsertLead() só ativa na INSERÇÃO (novo lead), nunca no UPDATE de lead existente. | ✓ |
| Flag fup_manual_disable | Quando operador seta fup_enabled = false via SQL, também seta fup_manual_disable = true | |

**User's choice:** Sem distinção (Recomendado)
**Notes:** Lógica INSERT-only resolve o problema sem nova coluna — lead existente nunca é reativado automaticamente.

---

## Claude's Discretion

- Implementação da query a fup_config: inline em upsertLead() ou cache
- Estrutura do conditional insert vs update no Drizzle
- Nome do parâmetro: brainType ou options object

## Deferred Ideas

- Migração em massa de leads existentes
- Coluna fup_opted_out explícita
- Cache de fup_config no LeadService
