---
phase: 01
slug: foundation
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-12
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Test code → production code | Test files import production modules; no security boundary | None (test-only) |
| File system → monorepo config | Root package.json, pnpm-workspace.yaml, turbo.json are developer-controlled | Build configuration |
| tsconfig paths → package resolution | Path aliases resolve to local packages only | Module identifiers |
| Application → PostgreSQL | Connection strings contain credentials; must be env-only | DATABASE_URL (sensitive) |
| Schema definition → database | DDL operations are privileged; schema validated before migration | DDL statements |
| Tenant A database ↔ Tenant B database | Connection pool enforces database isolation | Per-tenant credentials |
| Migration script → database schema | DDL operations with container-fail-on-error behavior | DDL statements |
| Application → Logs | Log output may contain sensitive data; must redact credentials | Log fields |
| Public → Health endpoint | Health check exposes system state; must not leak credentials | Status booleans only |
| HTTP client → GET /health | Any client may call without authentication in Phase 1 | Health status |
| performHealthCheck → PostgreSQL | Health check executes SELECT 1 to verify connectivity | TCP connection |
| drizzle-kit generate | Reads TypeScript schema from filesystem; no DB connection required | Local TS files |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-00-01 | N/A | Test scaffolds | accept | Wave 0 creates only test stubs with no production impact | closed |
| T-01-01 | Denial of Service | Turborepo cache | accept | Local-only; no production impact | closed |
| T-01-02 | Tampering | pnpm-lock.yaml | mitigate | `package.json:4` — `"packageManager": "pnpm@11.5.3"` pinned; `pnpm-lock.yaml` committed | closed |
| T-01-03 | Information Disclosure | Build artifacts in dist/ | accept | Local dev only; production images built in isolated CI | closed |
| T-01-04 | Elevation of Privilege | npm scripts in package.json | mitigate | `package.json:9–15` — all scripts are `turbo run <task>`; no sudo or privileged operations | closed |
| T-02-01 | Information Disclosure | DATABASE_URL in logs | mitigate | `pool-manager.ts:41` — `onnotice: () => {}`; DATABASE_URL never passed to any logger context | closed |
| T-02-02 | Information Disclosure | EMBEDDING_DIMENSIONS mismatch | mitigate | `tables.ts:8–11` — range guard throws on `< 128 \|\| > 4096`; `.env.example:12` — documented with warning | closed |
| T-02-03 | Tampering | SQL injection via schema | accept | Drizzle ORM type-safe builders; no raw SQL strings in table definitions | closed |
| T-02b-01 | Denial of Service | Connection pool exhaustion | mitigate | `pool-manager.ts:22` — `LRUCache { max: 20 }`; `idle_timeout` 300s limits total connections | closed |
| T-02b-02 | Tampering | SQL injection via pool manager | accept | `databaseName` used as `postgres()` config identifier, not interpolated into SQL | closed |
| T-02b-03 | Elevation of Privilege | Tenant A accessing Tenant B | mitigate | `pool-manager.ts:36–44` — isolated `postgres({ database: databaseName })` per tenant | closed |
| T-02b-04 | Denial of Service | Migration failure restart loop | mitigate | `migrate.ts:9` — `process.exit(1)` on missing URL; `migrate.ts:29` — `process.exit(1)` in catch | closed |
| T-03-01 | Information Disclosure | Logs containing credentials | mitigate | `logger.ts:8–13` — `LogContext` limited to identifiers only; JSDoc prohibits credential fields | closed |
| T-03-02 | Information Disclosure | Health check exposing credentials | mitigate | `health.ts:17–26` — `HealthCheckResult` exposes only `status`, `checks.db`, `version?`, `timestamp` | closed |
| T-03-03 | Denial of Service | Health check query timeout | accept | SELECT 1 fast path (<1ms); postgres.js has built-in query timeouts | closed |
| T-03-04 | Information Disclosure | Tenant context leakage in logs | accept | Intentional for debugging; logs are internal-only (not exposed to end users) | closed |
| T-04-01 | Tampering | drizzle-kit generate | accept | Reads only local TypeScript files; no external input received | closed |
| T-04-02 | Information Disclosure | Generated SQL files | mitigate | `0000_lyrical_scrambler.sql` — DDL only (`CREATE TABLE`, `CREATE INDEX`); no credentials | closed |
| T-04-03 | Denial of Service | tsconfig exclude pattern absent | accept | Already fixed (T-04-03); no external attack surface | closed |
| T-05-01 | Information Disclosure | GET /health response | mitigate | `server.ts:13,21–32` — response is `HealthCheckResult` only; no DATABASE_URL, stack traces, or table names | closed |
| T-05-02 | Denial of Service | GET /health endpoint | accept | Low-value target; SELECT 1 cost per request; Phase 1 no-auth acceptable | closed |
| T-05-03 | Spoofing | Sql instance in performHealthCheck | accept | Sql constructed by TenantPoolManager with env credentials; no external injection path | closed |
| T-05-04 | Tampering | Hono app routing | accept | Only GET /health exposed; no write routes; Hono prevents path traversal on static routes | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01-01 | T-01-01 | Turborepo cache corruption is local-only (dev/CI); no production impact | gsd-security-auditor | 2026-06-12 |
| AR-01-02 | T-01-03 | Build artifacts in dist/ are local dev only; production images use isolated CI build | gsd-security-auditor | 2026-06-12 |
| AR-01-03 | T-02-03 | Drizzle ORM type-safe builders eliminate SQL injection in schema — no raw SQL strings | gsd-security-auditor | 2026-06-12 |
| AR-01-04 | T-02b-02 | `databaseName` is used as `postgres()` config option, not interpolated into SQL string | gsd-security-auditor | 2026-06-12 |
| AR-01-05 | T-03-03 | SELECT 1 is a fast-path query (<1ms); postgres.js provides built-in timeouts | gsd-security-auditor | 2026-06-12 |
| AR-01-06 | T-03-04 | Tenant context (tenantId, brainId, sessionId) in logs is intentional for debugging; logs are internal-only | gsd-security-auditor | 2026-06-12 |
| AR-01-07 | T-04-01 | drizzle-kit generate reads only local TS files; no network access or external input | gsd-security-auditor | 2026-06-12 |
| AR-01-08 | T-04-03 | tsconfig exclude pattern was missing but already fixed; no external attack surface exposed | gsd-security-auditor | 2026-06-12 |
| AR-01-09 | T-05-02 | GET /health without rate limiting acceptable in Phase 1 development; SELECT 1 cost is minimal | gsd-security-auditor | 2026-06-12 |
| AR-01-10 | T-05-03 | Sql instance constructed from env credentials by TenantPoolManager; no external injection path in Phase 1 | gsd-security-auditor | 2026-06-12 |
| AR-01-11 | T-05-04 | Only GET /health route exposed; Hono framework prevents path traversal on static routes | gsd-security-auditor | 2026-06-12 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-12 | 23 | 23 | 0 | gsd-security-auditor (agent a970533b136815fad) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-12
