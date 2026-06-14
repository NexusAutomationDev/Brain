# Phase 6: Leads Schema + Migration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-13
**Phase:** 06-leads-schema-migration
**Areas discussed:** Schema da tabela leads, Hook do auto-migrate, Advisory lock

---

## Schema da tabela `leads`

### fullpp — tipo do campo

| Option | Description | Selected |
|--------|-------------|----------|
| text (texto livre) | Prompt completo, URL ou outro dado de texto | |
| jsonb (objeto estruturado) | Dados extras em formato livre | |
| text nullable — Claude decide | Sem regra de negócio definida | |

**User's choice:** Boolean (true/false) — "no caso e follow up ai vai ser ou true ou false"
**Notes:** Campo é flag booleana "follow up IA", sem regra de negócio em v1.1

---

### ia_ativada — valor padrão

| Option | Description | Selected |
|--------|-------------|----------|
| DEFAULT true (ativo por padrão) | Lead criado já está ativo | ✓ |
| DEFAULT false (inativo por padrão) | Requer ativação explícita | |

**User's choice:** DEFAULT true
**Notes:** Faz sentido para SDR — toda mensagem nova inicia ativa

---

### nome e unique_id — nullability e geração

| Option | Description | Selected |
|--------|-------------|----------|
| nome nullable, unique_id = crypto.randomUUID() | Nome pode ser vazio; UUID gerado pela app | |
| nome NOT NULL default empty string | Evita nullable mas semanticamente igual | |
| nome nullable, unique_id = gen_random_uuid() postgres | Postgres gera o UUID | |

**User's choice:** nome nullable + unique_id vem do código passado pelo webhook ou rabbit
**Notes:** "o nome da pessoa sim, pode ser nulo. Número não pode ser nulo e o ID externo vai ser preenchido pelo código que vai ser impassado pelo webhook ou rabbit"

---

### unique_id — origem do valor

| Option | Description | Selected |
|--------|-------------|----------|
| IDLead do payload | Usado diretamente como unique_id | ✓ |
| Gerado pela app na primeira mensagem | crypto.randomUUID() | |

**User's choice:** IDLead do payload
**Notes:** Revisão de decisão STATE.md "nunca do payload direto" — IDLead do payload IS o unique_id

---

## Hook do auto-migrate

### Onde runMigrations() é chamada

| Option | Description | Selected |
|--------|-------------|----------|
| BrainRunner.init() — SDK cuida automaticamente | Todo Brain ganha auto-migrate sem esforço | ✓ |
| server.ts do app — cada app chama explicitamente | Mais controle, mais boilerplate | |

**User's choice:** BrainRunner.init()

---

### Como BrainRunner sabe o caminho das migrations

| Option | Description | Selected |
|--------|-------------|----------|
| ENV MIGRATIONS_FOLDER | Flexível, sem hardcode no SDK | ✓ |
| IBrain.migrationsFolder getter | Mais OOP, adiciona contrato ao IBrain | |
| Hardcoded no BrainRunner | Simples mas acopla ao layout do pacote | |

**User's choice:** ENV MIGRATIONS_FOLDER

---

## Advisory Lock

### Comportamento quando outra instância já está migrando

| Option | Description | Selected |
|--------|-------------|----------|
| Blocking — aguarda indefinidamente | pg_advisory_lock(), espera até terminar | ✓ |
| Non-blocking com timeout | pg_try_advisory_lock(), retry configurable | |

**User's choice:** Blocking

---

### Lock key

| Option | Description | Selected |
|--------|-------------|----------|
| Número fixo arbitrário | Mais simples | |
| Claude decide o número | Qualquer constante funciona | ✓ |

**User's choice:** Claude decide
**Notes:** Usuário confirmou entendimento do advisory lock e da arquitetura multi-instância (2× Brain SDR no mesmo banco, coordenados automaticamente pelo lock por database)

---

## Claude's Discretion

- Número exato do advisory lock key
- Estratégia de geração do SQL de migration (drizzle-kit generate ou raw SQL)
- Mensagem de log para migration completa vs. aguardando lock

## Deferred Ideas

- Remover tabela `users` → v2
- Validação de formato do `unique_id` → v2
- Timeout configurável no advisory lock → avaliar em produção
