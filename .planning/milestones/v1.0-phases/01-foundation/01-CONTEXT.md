# Phase 1: Foundation - Context

**Gathered:** 2026-06-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 estabelece a fundação do monorepo Brain Core: estrutura de workspaces, database layer com PostgreSQL + PGVector, multi-tenancy via connection pooling, e observabilidade básica (structured logging + health check endpoint). Ao final desta fase, o monorepo compila sem erros, testes rodam via Turborepo, e o database layer aceita conexões multi-tenant com isolamento garantido.

</domain>

<decisions>
## Implementation Decisions

### Monorepo Structure
- **D-01:** Packages organizados por domínio (domain-driven): `packages/memory`, `packages/ai`, `packages/transport`, etc.
- **D-02:** Shared code separado em dois packages: `packages/types` para tipos TypeScript compartilhados, `packages/utils` para utilitários
- **D-03:** TypeScript path aliases com namespaces distintos: `@brain-pkg/*` para packages, `@brain-app/*` para apps
- **D-04:** Estrutura do monorepo: `apps/` (aplicações finais), `packages/` (bibliotecas reutilizáveis)

### Database Migrations Strategy
- **D-05:** Ambiente dev usa `drizzle-kit push` (sync direto sem arquivos de migração); ambiente prod usa `drizzle-kit generate` (gera SQL para revisão)
- **D-06:** Migrações são forward-only (sem rollback manual) — correções vão em novas migrações
- **D-07:** Migrações aplicadas automaticamente no startup do container via script de migração
- **D-08:** Container falha o startup (exit 1) se migração falhar — não sobe com schema incorreto

### Multi-Tenant Connection Pooling
- **D-09:** Pool médio: 10-20 conexões por tenant
- **D-10:** LRU cache mantém até 20 tenants simultâneos em memória (limite máximo de ~400 conexões ao banco)
- **D-11:** Pool de tenant fecha após 5 minutos de inatividade (idle timeout)
- **D-12:** Tenant evicted do LRU recebe novo pool quando voltar a ter requisições

### Health Check Scope
- **D-13:** Health check retorna JSON estruturado: `{ "status": "ok"|"degraded"|"error", "checks": { "db": "connected"|"failed" } }`
- **D-14:** HTTP status codes granulares: 200 = OK, 500 = erro interno, 503 = dependência (DB) falhou
- **D-15:** Roadmap menciona `{ transport: "webhook" }` no response — adicionar quando transport estiver implementado (Phase 2)

### Claude's Discretion
- Health check pode incluir informação de versão do app (commit hash, build timestamp) no JSON response se útil para debugging

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Stack & Architecture
- `.planning/research/STACK.md` — Technology stack decisions (Bun, Hono, Drizzle, pnpm, postgres.js driver)
- `.planning/research/ARCHITECTURE.md` — Multi-tenant architecture patterns
- `CLAUDE.md` — Project conventions and constraints (runtime: Bun, ORM: Drizzle, driver: postgres.js)

### Requirements
- `.planning/REQUIREMENTS.md` — Requirements INFRA-01 through INFRA-04, DB-01 through DB-06, OBS-01, OBS-02
- `.planning/PROJECT.md` — Core value, constraints, key decisions

### Phase Definition
- `.planning/ROADMAP.md` — Phase 1 goal, success criteria, and requirements mapping

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Nenhum código existe ainda — este é o primeiro phase do projeto

### Established Patterns
- A definir durante implementação

### Integration Points
- A definir durante implementação

</code_context>

<specifics>
## Specific Ideas

### Stack Constraints (from PROJECT.md and STACK.md)
- **Runtime:** Bun (não Node.js)
- **Package manager:** pnpm com workspaces (não Bun workspaces devido a regression em Jan 2026)
- **Database driver:** `postgres.js` como adaptador Drizzle (não `bun:sql` devido a bug de stuck connection)
- **Migrations tool:** `drizzle-kit` com driver `postgres.js`

### Multi-Tenancy Model
- 1 banco PostgreSQL por cliente (inicial)
- Seleção via `DATABASE_NAME` env var
- Futuro (fora de v1): migrar para `tenant_id` column quando escala demandar

### Success Criteria Traceability
1. ✓ `pnpm build` sucesso zero erros → D-01, D-02, D-03, D-04
2. ✓ `pnpm test` roda suite completa via Turborepo → D-01
3. ✓ Migração cria tabelas com PGVector column → D-07, D-08
4. ✓ Multi-tenant isolation e LRU eviction → D-09, D-10, D-11, D-12
5. ✓ Structured logging e health check → D-13, D-14

</specifics>

<deferred>
## Deferred Ideas

- RabbitMQ transport implementation → Phase 2 (interface `ITransport` já prevista no design)
- Langfuse observability → Phase 2 (requer LangChain packages que vêm em Phase 2)
- Transport info no health check response → Phase 2 (quando transport existir)

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-06-11*
