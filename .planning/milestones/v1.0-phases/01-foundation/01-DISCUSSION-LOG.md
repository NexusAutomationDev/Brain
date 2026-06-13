# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-11
**Phase:** 1-Foundation
**Areas discussed:** Monorepo structure, Database migrations strategy, Multi-tenant connection pooling, Health check scope

---

## Monorepo structure

| Option | Description | Selected |
|--------|-------------|----------|
| Domain-driven (memory, ai, transport) | Each package is a domain concept. Recommended — aligns with your phase breakdown and makes dependencies clear. | ✓ |
| Layer-driven (core, services, infra) | Packages organized by architectural layer. Common but can blur domain boundaries. | |
| Hybrid (packages/ for shared, libs/ for domain) | Separate shared utilities from domain logic. | |

**User's choice:** Domain-driven (memory, ai, transport)

---

| Option | Description | Selected |
|--------|-------------|----------|
| packages/shared (single package) | One package for types, utils, constants. Simple, but can become a dumping ground. Recommended for v1 — extract later if needed. | |
| packages/types + packages/utils | Separate by concern. More organized but adds dependency management overhead. | ✓ |
| Per-domain (each package has its own shared/) | No global shared package. Forces explicit boundaries but duplicates common code. | |

**User's choice:** packages/types + packages/utils

---

| Option | Description | Selected |
|--------|-------------|----------|
| @brain/* for all packages | Single namespace, packages import via @brain/memory, @brain/ai. Clean and consistent. | |
| @brain-pkg/* for packages, @brain-app/* for apps | Separate namespaces for apps vs packages. More explicit. | ✓ |
| No path aliases (relative imports only) | Explicit dependencies via ../../../. Verbose but no magic. | |

**User's choice:** @brain-pkg/* for packages, @brain-app/* for apps

---

## Database migrations strategy

| Option | Description | Selected |
|--------|-------------|----------|
| drizzle-kit generate + manual review | Generate migration SQL from schema changes, review before applying. Recommended — catches surprises before prod. | |
| drizzle-kit push (dev) + generate (prod) | Push directly in dev for speed, generate for prod safety. Fast iteration, but dev/prod drift risk. | ✓ |
| Always drizzle-kit push | No migration files, always sync schema. Simple but risky — can't review or rollback. | |

**User's choice:** drizzle-kit push (dev) + generate (prod)

---

**User clarification:** Migrações rodam automaticamente no startup do container, forward-only (sem rollback manual)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Falhar o startup (exit 1) | Container não sobe se a migração falhar. Força correção antes de continuar. Recomendado — evita rodar com schema incorreto. | ✓ |
| Logar erro e subir mesmo assim | Tenta subir mesmo com migração falhada. Arriscado — aplicação pode quebrar. | |
| Retry com backoff | Tenta novamente algumas vezes antes de desistir. Útil se o banco ainda não está pronto. | |

**User's choice:** Falhar o startup (exit 1)

---

## Multi-tenant connection pooling

| Option | Description | Selected |
|--------|-------------|----------|
| Pool pequeno (5-10 conexões) | Conservador. Bom para muitos tenants com pouco tráfego cada. | |
| Pool médio (10-20 conexões) | Balanço entre escala e performance. Recomendado para v1. | ✓ |
| Pool grande (20-50 conexões) | Máxima performance por tenant, mas limita quantidade de tenants simultâneos. | |

**User's choice:** Pool médio (10-20 conexões)

---

| Option | Description | Selected |
|--------|-------------|----------|
| 10 tenants | Conservador. Máximo ~200 conexões ao banco (10 pools × 20 conexões). | |
| 20 tenants (roadmap atual) | Roadmap menciona 'max 20 pools'. Máximo ~400 conexões. Recomendado — já documentado. | ✓ |
| 50 tenants | Agressivo. Máximo ~1000 conexões. Só se o Postgres suportar. | |

**User's choice:** 20 tenants (roadmap atual)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Pool permanece ativo | Conexões ficam abertas até ser evicted do LRU por novos tenants. Simples. | |
| Pool fecha após timeout de inatividade | Economiza conexões, mas adiciona complexidade (idle timeout timer). Pode causar latência no próximo request. | ✓ |
| Você decide | Claude escolhe a abordagem mais simples para v1. | |

**User's choice:** Pool fecha após timeout de inatividade

---

| Option | Description | Selected |
|--------|-------------|----------|
| 5 minutos | Agressivo. Libera recursos rapidamente. | ✓ |
| 15 minutos | Balanceado. Evita thrashing em tráfego intermitente. | |
| 30 minutos | Conservador. Mantém pools por mais tempo. | |

**User's choice:** 5 minutos

---

## Health check scope

| Option | Description | Selected |
|--------|-------------|----------|
| Só banco (DB connection test) | Mínimo viável. Recomendado para v1 — transport vem na Phase 2. | |
| Banco + versão do app | Adiciona informação de versão/commit no response. | |
| Você decide | Claude escolhe o mínimo necessário para Phase 1. | ✓ |

**User's choice:** Você decide

---

| Option | Description | Selected |
|--------|-------------|----------|
| JSON estruturado | { "status": "ok", "checks": { "db": "connected" } }. Recomendado — fácil de parsear. | ✓ |
| Texto simples (OK/FAIL) | Response body: "OK" ou "FAIL". Minimalista. | |
| Status code apenas (200/503) | Sem body. Só HTTP status. Extremamente minimalista. | |

**User's choice:** JSON estruturado

---

| Option | Description | Selected |
|--------|-------------|----------|
| 200 (OK) e 503 (Service Unavailable) | 200 quando tudo OK, 503 quando algum check falhar. Padrão recomendado. | |
| 200 sempre, status no JSON | Sempre 200, estado real dentro do JSON. Alguns load balancers precisam disso. | |
| 200/500/503 (granular) | 200 = OK, 500 = erro interno, 503 = dependência falhou. Mais detalhado. | ✓ |

**User's choice:** 200/500/503 (granular)

---

## Claude's Discretion

- Health check pode incluir informação de versão do app (commit hash, build timestamp) no JSON response se útil para debugging

## Deferred Ideas

- RabbitMQ transport implementation → Phase 2
- Langfuse observability → Phase 2
- Transport info no health check response → Phase 2
