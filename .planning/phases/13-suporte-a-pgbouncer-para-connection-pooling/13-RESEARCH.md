# Phase 13: Suporte a PgBouncer para Connection Pooling - Research

**Researched:** 2026-06-15
**Domain:** PostgreSQL connection pooling, PgBouncer compatibility, postgres.js, node-postgres (pg)
**Confidence:** HIGH — todos os pontos críticos verificados via leitura direta do código-fonte instalado

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `prepare: false` setado **sempre** em todas as instâncias `postgres()` — sem flag ENV, sem branch condicional.
- **D-02:** Sem variável `DATABASE_DIRECT_URL` — uma única `DATABASE_URL` para todas as conexões. Sem bifurcação de config.
- **D-03:** Sem flag ENV como `PGBOUNCER_MODE` — o código é sempre PgBouncer-compatible após esta fase.
- **D-04:** Suporte a **ambos os modos**: session mode e transaction mode.
- **D-05:** Compatibilidade do PostgresSaver com transaction mode **deve ser investigada** — decisão final no PLAN.md após pesquisa.
- **D-06:** `pg_advisory_lock()` em `runMigrations()` é **substituído** por row-lock em tabela `_schema_lock` via `BEGIN + SELECT ... FOR UPDATE NOWAIT` em loop.
- **D-07:** Tabela `_schema_lock` criada via `CREATE TABLE IF NOT EXISTS` no início de `runMigrations()` — sem nova migration.
- **D-08:** Comportamento observável de `runMigrations()` permanece idêntico — apenas mecânica de locking muda. API pública não muda.
- **D-09:** `PostgresSaver.fromConnString(dbUrl)` em `qualifier.ts` fechado em `finally` — preferir API tipada; se não existir, usar `(saver as any).db?.end?.()`.
- **D-10:** Alternativa `PostgresSaver.fromPool(sql)` descartada — fix em `finally` é menor e menos invasivo.
- **D-11:** `DATABASE_URL` continua sendo a única variável de conexão.
- **D-12:** `TenantPoolManager` recebe `prepare: false` no `postgres()` config object.
- **D-13:** Testes unitários existentes devem continuar passando.
- **D-14:** Testes de integração para transaction pooling são desejáveis mas não bloqueantes — planner decide escopo.

### Claude's Discretion

- Naming da tabela de lock (`_schema_lock`, `schema_migrations_lock`, etc.)
- Estratégia de retry no `SELECT ... FOR UPDATE NOWAIT` (loop com sleep, ou sem retry)
- Se PostgresSaver é incompatível com transaction mode: documentar limitação ou fazer wrapper — decidir após pesquisa

### Deferred Ideas (OUT OF SCOPE)

- WR-01 (`main()` sem `.catch()`) e WR-02 (timing attack no bearer token) — backlog
- WR-03 (cobertura de testes para 401/503) — backlog
- PgBouncer no docker-compose de desenvolvimento
- Suporte a `PGBOUNCER_MODE` ENV para controle explícito

</user_constraints>

---

## Summary

Esta fase adapta o Brain Core para ser compatível com PgBouncer, com escopo em quatro pontos: (1) adicionar `prepare: false` ao `TenantPoolManager`, (2) substituir `pg_advisory_lock` por row-lock em `runMigrations()`, (3) fechar a conexão do `PostgresSaver` em `qualifier.ts` (CR-01), e (4) investigar a compatibilidade do `PostgresSaver` com transaction mode do PgBouncer.

A investigação de D-05 (compatibilidade PostgresSaver com transaction mode) **produziu resultado definitivo**: o PostgresSaver v1.0.3 usa a biblioteca `pg` (node-postgres v8.21) internamente, que **sempre usa extended query protocol (prepared statements) para queries parametrizadas**. Não há opção de pool-level para desabilitar isso em `pg` v8.21. Portanto, PostgresSaver é **incompatível com PgBouncer transaction mode** em versões < 1.21. Em PgBouncer ≥ 1.21 com `max_prepared_statements > 0`, a compatibilidade existe. A solução não-invasiva e recomendada é documentar que o PostgresSaver requer **session mode** (ou PgBouncer ≥ 1.21).

Todas as outras mudanças desta fase são altamente localizadas, de baixo risco e compatíveis com o stack existente.

**Primary recommendation:** Implementar as 4 mudanças em tasks sequenciais. Para D-05, documentar a limitação do PostgresSaver (requer PgBouncer session mode ou versão ≥ 1.21) em vez de tentar contornar a limitação do driver `pg`.

---

## Project Constraints (from CLAUDE.md)

Diretivas obrigatórias extraídas do CLAUDE.md:

| Diretiva | Detalhe |
|----------|---------|
| **Runtime** | Bun — todas as dependências devem ser compatíveis |
| **ORM** | Drizzle — não usar TypeORM ou Prisma |
| **Driver principal** | `postgres.js` (não `bun:sql`) — `prepare: false` é opção nativa |
| **Driver do checkpointer** | `pg` (node-postgres) — usado internamente pelo PostgresSaver; NÃO substituir |
| **Testes** | `bun test` — estrutura em `__tests__/unit/` e `__tests__/integration/` |
| **Commits** | Conventional Commits com emoji — sem "Co-Authored-By: Claude" |
| **Sem variável nova** | DATABASE_DIRECT_URL explicitamente rejeitada (D-02) |
| **Sem flag ENV** | PGBOUNCER_MODE explicitamente rejeitada (D-03) |

---

## Standard Stack

### Drivers em uso nesta fase

| Library | Version | Purpose | Observação |
|---------|---------|---------|------------|
| `postgres` (postgres.js) | ^3.x (instalado) | Driver principal — TenantPoolManager, migrate.ts | `prepare: false` é opção nativa e documentada [VERIFIED: código-fonte lido] |
| `pg` (node-postgres) | 8.21.0 | Driver interno do PostgresSaver (LangGraph) | Sem opção de disable prepared statements em pool level [VERIFIED: código-fonte lido] |
| `@langchain/langgraph-checkpoint-postgres` | ^1.0.3 (instalado: 1.0.3) | PostgresSaver — checkpointer do LangGraph | Usa `pg` Pool internamente; expõe `end()` method [VERIFIED: dist/index.js lido] |
| `drizzle-orm` | ^0.45.x | ORM — migrate() dentro de runMigrations() | Recebe `Sql` injetado, não cria conexão própria |

### Sem instalações novas necessárias

Todos os pacotes necessários já estão instalados. Esta fase é **zero novas dependências**.

---

## Architecture Patterns

### Padrão 1: `prepare: false` em postgres.js

**O que faz:** Desabilita prepared statements no protocolo extended query. postgres.js passa a usar simple query protocol para todas as queries, tornando-se compatível com PgBouncer em qualquer modo.

**Onde aplicar:** `packages/database/src/pool-manager.ts` — dentro do `postgres({...})` call em `getPool()`.

**Exemplo:**
```typescript
// Source: postgres.js README + CLAUDE.md stack decision D-01
pool = postgres({
  ...this.baseConfig,
  database: databaseName,
  max: this.baseConfig.max,
  idle_timeout: this.baseConfig.idle_timeout,
  prepare: false,          // D-01: sempre ativo — PgBouncer-compatible
  onnotice: () => {},
});
```

**Compatibilidade com setup sem PgBouncer:** `prepare: false` funciona normalmente sem PgBouncer — postgres.js apenas usa o caminho de query mais simples. Sem degradação funcional. [VERIFIED: postgres.js docs + CLAUDE.md]

Também aplicar no bloco CLI de `migrate.ts` (o `import.meta.main` block):
```typescript
const sql = postgres(connectionString, { max: 1, prepare: false });
```

### Padrão 2: Row-lock para serialização de migrations

**O que faz:** Substitui `pg_advisory_lock` (session-scoped, quebra em PgBouncer transaction mode) por lock de linha em tabela dedicada, que é transaction-scoped e 100% compatível com qualquer modo PgBouncer.

**Por que advisory lock quebra:** `pg_advisory_lock()` é session-scoped — ele persiste enquanto a conexão de banco estiver aberta. Em PgBouncer transaction mode, o proxy pode retornar a conexão ao pool após cada transação, fazendo o advisory lock ser "perdido" entre queries. Uma instância que faz `SELECT pg_advisory_lock(...)` pode perder o lock antes de chamar `SELECT pg_advisory_unlock(...)` porque a segunda query vai para uma conexão diferente.

**Implementação para D-06/D-07:**

```typescript
// Source: D-06 + D-07 do CONTEXT.md
export async function runMigrations(sql: Sql, migrationsFolder: string): Promise<void> {
  // D-07: Cria tabela de lock idempotentemente — DDL direto, sem migration
  await sql`CREATE TABLE IF NOT EXISTS _schema_lock (id INTEGER PRIMARY KEY, locked_at TIMESTAMPTZ)`;
  await sql`INSERT INTO _schema_lock (id, locked_at) VALUES (1, NOW()) ON CONFLICT (id) DO NOTHING`;

  // D-06: Loop com SELECT ... FOR UPDATE NOWAIT — lock de linha, transaction-scoped
  let acquired = false;
  while (!acquired) {
    try {
      await sql.begin(async (tx) => {
        await tx`SELECT id FROM _schema_lock WHERE id = 1 FOR UPDATE NOWAIT`;
        // Lock adquirido dentro desta transação — executar migrations
        const db = drizzle(sql);
        await tx`CREATE EXTENSION IF NOT EXISTS vector`;
        await migrate(db, { migrationsFolder });
        acquired = true;
        // lock liberado automaticamente ao fim da transação
      });
    } catch (err: unknown) {
      // NOWAIT lança "could not obtain lock" (55P03) quando outra instância segura o lock
      if (isLockNotAvailable(err)) {
        await sleep(100); // aguarda e tenta novamente
        continue;
      }
      throw err;
    }
  }
}
```

**Observação importante:** `drizzle(sql)` e `migrate(db, ...)` devem ser chamados dentro ou fora da transação do postgres.js com cuidado. O `migrate()` do drizzle usa o `sql` injetado para criar suas próprias conexões — se chamado dentro de `sql.begin()`, pode ter comportamento inesperado. Alternativa mais segura: fazer o lock com uma transação separada e executar a lógica principal após confirmar o lock. O planner deve decidir a estrutura exata.

**Alternativa simplificada (sem retry):** Se apenas uma instância sobe por vez (cenário atual), omitir o loop e lançar erro se o lock não estiver disponível:

```typescript
// Versão sem retry — apropriada se restart automático pelo Docker é aceitável
await sql.begin(async (tx) => {
  try {
    await tx`SELECT id FROM _schema_lock WHERE id = 1 FOR UPDATE NOWAIT`;
  } catch (err) {
    if (isLockNotAvailable(err)) {
      throw new Error('[migrate] Outra instância está executando migrations — aguarde e reinicie');
    }
    throw err;
  }
  // migrations aqui...
});
```

### Padrão 3: Fechar PostgresSaver em finally (CR-01)

**O que faz:** Corrige o leak de conexão em `qualifier.ts` onde `PostgresSaver.fromConnString()` cria um `pg.Pool` interno que nunca é fechado.

**API verificada do PostgresSaver v1.0.3:** [VERIFIED: dist/index.js, linha 371]
```typescript
async end() {
  return this.pool.end();
}
```
`saver.end()` existe e é o método correto. Não é necessário usar `(saver as any).db?.end?.()`.

**Fix para D-09:**
```typescript
// qualifier.ts — runQualificationAgent(), inside try block
const saver = PostgresSaver.fromConnString(dbUrl);
try {
  const tuple = await saver.getTuple({
    configurable: { thread_id: sessionId },
  });
  // ... resto da lógica inalterado ...
  return finalResult;
} finally {
  await saver.end(); // fecha o pg.Pool interno — API pública tipada
}
```

### Padrão 4: Compatibilidade do PostgresSaver com PgBouncer (D-05)

**Resultado da investigação (D-05):**

O PostgresSaver v1.0.3 usa `pg.Pool` (node-postgres v8.21) internamente. A biblioteca `pg` usa o **extended query protocol** (prepared statements) automaticamente para qualquer query com parâmetros (`$1`, `$2`, etc.) — conforme método `requiresPreparation()` verificado em `node_modules/.pnpm/pg@8.21.0/node_modules/pg/lib/query.js`. [VERIFIED: código-fonte lido]

Todas as queries do PostgresSaver têm parâmetros: `UPSERT_CHECKPOINT_BLOBS_SQL` usa `$1..$6`, `UPSERT_CHECKPOINTS_SQL` usa `$1..$6`, etc. [VERIFIED: dist/sql.js lido]

**Não existe opção `prepare: false` no nível de Pool na `pg` v8.21.** O único mecanismo seria passar `queryMode: 'simple'` por query individual — opção não documentada e não acessível na API pública do PostgresSaver. [VERIFIED: defaults.js, connection-parameters.js, pool.js lidos]

**Conclusão para D-05:**

| Modo PgBouncer | PostgresSaver | Ação necessária |
|----------------|---------------|-----------------|
| Session mode | Compatível | Nenhuma — funciona hoje |
| Transaction mode (PgBouncer < 1.21) | **Incompatível** | Documentar — não usar |
| Transaction mode (PgBouncer ≥ 1.21, `max_prepared_statements > 0`) | Compatível | Documentar requisito de versão |

**Recomendação para o planner:** Documentar a limitação em comentário no `createCheckpointer()` e em arquivo de documentação. Não tentar contornar via wrapper — o custo é alto e foge do escopo desta fase.

---

## Don't Hand-Roll

| Problema | Não Construir | Usar em vez | Por quê |
|----------|---------------|-------------|---------|
| Serialização de migrations | Lock caseiro com Redis/arquivo | Row-lock em `_schema_lock` com `FOR UPDATE NOWAIT` | Self-contained, transaction-scoped, sem infra adicional |
| Detecção de erro de lock | Parse de string de erro | Comparar `(err as any).code === '55P03'` (PostgreSQL error code) | Código padrão para "lock not available" — estável entre versões |
| Fechar pg.Pool do PostgresSaver | `(saver as any).db?.end?.()` | `await saver.end()` | Método público tipado existe na v1.0.3 |

**Key insight:** A incompatibilidade do `pg` com PgBouncer transaction mode NÃO é um bug do projeto — é uma limitação conhecida e documentada do driver `pg`. A solução correta é documentar o requisito (session mode ou PgBouncer ≥ 1.21), não tentar monkeypatching.

---

## Common Pitfalls

### Pitfall 1: `pg_advisory_lock` em Transaction Mode perde o lock entre queries

**O que vai errado:** `pg_advisory_lock()` é session-scoped no PostgreSQL. Em PgBouncer transaction mode, após cada transação concluída, a conexão física pode ser retornada ao pool e entregue a outro cliente. Se `SELECT pg_advisory_lock(N)` for chamado em uma query e `SELECT pg_advisory_unlock(N)` em outra, a segunda pode ir para uma conexão diferente — que não tem o lock.

**Por que acontece:** `pg_advisory_lock()` associa o lock à sessão (conexão física), não à transação. PgBouncer transaction mode troca de conexão física entre transações.

**Como evitar:** Substituir por `SELECT ... FOR UPDATE NOWAIT` dentro de uma transação explícita (`BEGIN`/`COMMIT`). Row locks são transaction-scoped — liberados ao fim da transação independente de qual conexão física for usada.

**Warning signs:** migrations rodando concorrentemente com dados corrompidos, ou erro `ERROR: Advisory lock 7316882 already held` ao reiniciar.

---

### Pitfall 2: postgres.js `sql.begin()` e drizzle `migrate()` na mesma transação

**O que vai errado:** `drizzle-orm`'s `migrate()` usa internamente o `Sql` injetado para criar suas próprias queries. Chamar `migrate(drizzle(sql), ...)` dentro de `sql.begin(async tx => ...)` pode resultar em conflito: o `sql` (connection pool) e o `tx` (sub-transaction) são objetos diferentes. O `migrate()` pode usar uma conexão do pool principal em vez da transação corrente.

**Como evitar:** Estruturar o locking e as migrations em etapas separadas. Uma abordagem segura:
1. Adquirir o lock em uma transação curta dedicada que retorna sem liberar até as migrations terminarem (usando `SELECT ... FOR UPDATE` dentro de uma única transação que envolve tudo).
2. Ou usar `sql.begin()` apenas para o lock check, e após confirmar que o lock foi adquirido, executar `migrate()` fora do `begin()` block mas antes do commit.

O planner deve escolher a abordagem e validar com o comportamento esperado do postgres.js.

---

### Pitfall 3: `saver.end()` não existe em versões anteriores do PostgresSaver

**O que vai errado:** D-09 menciona `preferir API tipada; se não existir, usar (saver as any).db?.end?.()`. A pesquisa confirmou que `end()` **existe** na v1.0.3. Mas a declaração de typescript (`index.d.ts`) pode não exportar o método — fazer `saver.end()` com tipagem incorreta resulta em erro TypeScript mesmo que funcione em runtime.

**Como evitar:** Verificar as typings exportadas. Se `end()` não aparecer no tipo, usar o cast seguro: `await (saver as PostgresSaver & { end(): Promise<void> }).end()`.

**Verificação rápida:**
```bash
grep -n "end" packages/ai/node_modules/@langchain/langgraph-checkpoint-postgres/dist/index.d.ts
```

---

### Pitfall 4: `_schema_lock` table criada dentro de transaction mode pool pode falhar

**O que vai errado:** `CREATE TABLE IF NOT EXISTS _schema_lock` é um DDL. Em PgBouncer transaction mode, DDL statements autocommitem implicitamente no PostgreSQL e não podem ser combinados com statements transacionais em algumas versões do protocolo.

**Como evitar:** Executar `CREATE TABLE IF NOT EXISTS` e `INSERT ... ON CONFLICT DO NOTHING` fora do bloco `sql.begin()` — antes de tentar adquirir o lock. Como são idempotentes, rodar sem transação é seguro.

---

### Pitfall 5: PostgresSaver `end()` chamado antes do `getTuple()` retornar

**O que vai errado:** Se a lógica em `qualifier.ts` usar `finally` incorretamente (ex: chamar `saver.end()` antes do `await compiledQualificationGraph.invoke()`), o pool do PostgresSaver é fechado enquanto ainda há queries pendentes.

**Como evitar:** O `finally` deve ficar no bloco do `saver.getTuple()` e seus consumidores diretos. O `compiledQualificationGraph.invoke()` não usa o `saver` — ele é stateless. A estrutura correta:
```
saver = PostgresSaver.fromConnString(dbUrl)
try {
  tuple = await saver.getTuple(...)
  // usa tuple
} finally {
  await saver.end()  // saver não é mais necessário após getTuple
}
// usa result aqui (sem saver)
```

---

## Code Examples

### `prepare: false` no TenantPoolManager

```typescript
// packages/database/src/pool-manager.ts
// Source: postgres.js README; CLAUDE.md D-01
pool = postgres({
  ...this.baseConfig,
  database: databaseName,
  max: this.baseConfig.max,
  idle_timeout: this.baseConfig.idle_timeout,
  prepare: false,      // ← adicionado: D-01, D-12
  onnotice: () => {},
});
```

### Row-lock para migrations (esqueleto do `_schema_lock`)

```typescript
// packages/database/src/migrate.ts — substituição do advisory lock (D-06/D-07)
// Detectar erro PostgreSQL de lock não disponível
function isLockNotAvailable(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '55P03' // lock_not_available
  );
}

export async function runMigrations(sql: Sql, migrationsFolder: string): Promise<void> {
  // D-07: Tabela criada idempotentemente — fora de qualquer transação (DDL autocommit)
  await sql`CREATE TABLE IF NOT EXISTS _schema_lock (id INTEGER PRIMARY KEY, locked_at TIMESTAMPTZ)`;
  await sql`INSERT INTO _schema_lock (id, locked_at) VALUES (1, NOW()) ON CONFLICT (id) DO NOTHING`;

  // D-06: Lock transacional — incompatível advisory_lock → FOR UPDATE NOWAIT
  // Estratégia de retry: planner decide (loop com sleep vs throw imediato)
  // ...acquire lock, run migrate, lock released at tx end...
}
```

### Fix CR-01 — PostgresSaver com `end()` tipado

```typescript
// apps/brain-sdr/src/qualifier.ts — runQualificationAgent()
// Source: PostgresSaver v1.0.3 dist/index.js linha 371 — end() é método público
const saver = PostgresSaver.fromConnString(dbUrl);
try {
  const tuple = await saver.getTuple({
    configurable: { thread_id: sessionId },
  });
  // ... lógica inalterada ...
} finally {
  await saver.end(); // fecha pg.Pool interno — sem cast necessário se tipado
}
```

### Comentário de compatibilidade para `createCheckpointer()`

```typescript
// packages/ai/src/graph/checkpointer.ts
/**
 * ...existing docs...
 *
 * PgBouncer compatibility (Phase 13):
 * PostgresSaver uses the `pg` (node-postgres) driver internally, which uses
 * extended query protocol (prepared statements) for all parameterized queries.
 * This is incompatible with PgBouncer transaction mode on versions < 1.21.
 *
 * Supported configurations:
 * - PgBouncer session mode: fully compatible
 * - PgBouncer transaction mode + PgBouncer >= 1.21 with max_prepared_statements > 0: compatible
 * - PgBouncer transaction mode + PgBouncer < 1.21: NOT supported
 * - Direct PostgreSQL (no PgBouncer): always compatible
 */
```

---

## Runtime State Inventory

> Fase de modificação de código — não há rename/rebrand. Checklist preenchido por completude.

| Categoria | Itens encontrados | Ação necessária |
|----------|-------------|------------------|
| Stored data | Nenhum — não há renomeação de tabelas ou colunas | Nenhuma |
| Live service config | Nenhum — PgBouncer é configurado externamente pelos clientes | Nenhuma |
| OS-registered state | Nenhum | Nenhuma |
| Secrets/env vars | `DATABASE_URL` — sem mudança de nome ou valor | Nenhuma |
| Build artifacts | Nenhum — `prepare: false` não altera outputs compilados | Nenhuma |

**Nota:** A tabela `_schema_lock` criada por D-07 é **nova DDL idempotente** via `CREATE TABLE IF NOT EXISTS`. Não é migration registrada no Drizzle. Nenhuma ação em dados existentes.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| postgres.js | TenantPoolManager, migrate.ts | ✓ | ^3.x (instalado) | — |
| `pg` (node-postgres) | PostgresSaver (interno) | ✓ | 8.21.0 | — |
| `@langchain/langgraph-checkpoint-postgres` | createCheckpointer | ✓ | 1.0.3 | — |
| `drizzle-orm` | runMigrations | ✓ | ^0.45.x | — |
| Bun | runtime + test runner | ✓ | 1.3.2 | — |

**Missing dependencies with no fallback:** Nenhum — todas as dependências já instaladas.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bun test (built-in, v1.3.2) |
| Config file | none — bun test sem config |
| Quick run command | `bun test packages/database/src/` |
| Full suite command | `bun test packages/database/src/ packages/ai/src/ apps/brain-sdr/src/` |

### Baseline atual (testes existentes)

| Arquivo | Status | Cobertura |
|---------|--------|-----------|
| `packages/database/src/migrate.test.ts` | 7 testes passando | `pg_advisory_lock` — precisarão ser atualizados para row-lock |
| `packages/database/src/pool-manager.test.ts` | 7 todos (não implementados) | TenantPoolManager |
| `packages/database/src/schema/tables.test.ts` | (existente) | schema tables |
| `apps/brain-sdr/src/__tests__/unit/brain.test.ts` | (existente) | brain unit tests |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PGB-01 | `prepare: false` presente no `postgres()` call do TenantPoolManager | unit | `bun test packages/database/src/pool-manager.test.ts` | ❌ Wave 0 |
| PGB-02 | `runMigrations()` substitui advisory lock por row-lock | unit | `bun test packages/database/src/migrate.test.ts` | ✅ (tests existem mas precisam ser adaptados) |
| PGB-03 | `runMigrations()` comportamento observável idêntico (migrate() chamado, extension criada) | unit | `bun test packages/database/src/migrate.test.ts` | ✅ (adaptar) |
| PGB-04 | CR-01: `saver.end()` chamado em `finally` de `runQualificationAgent()` | unit | `bun test apps/brain-sdr/src/__tests__/unit/` | ❌ Wave 0 |
| PGB-05 | `prepare: false` no bloco CLI de `migrate.ts` (`import.meta.main`) | unit | `bun test packages/database/src/migrate.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test packages/database/src/migrate.test.ts` (quick — 238ms baseline)
- **Per wave merge:** `bun test packages/database/src/ packages/ai/src/ apps/brain-sdr/src/`
- **Phase gate:** Full suite green antes do `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/database/src/migrate.test.ts` — adaptar mocks de `pg_advisory_lock` para row-lock; adicionar teste para `prepare: false` CLI block (PGB-02, PGB-03, PGB-05)
- [ ] `packages/database/src/pool-manager.test.ts` — implementar testes de `prepare: false` (PGB-01); substituir `it.todo` pelos testes reais (DB-03, DB-04 já têm stubs)
- [ ] `apps/brain-sdr/src/__tests__/unit/qualifier.test.ts` — verificar se existe; adicionar/adaptar teste para `saver.end()` em finally (PGB-04)

---

## Security Domain

> `security_enforcement` não está explicitamente `false` no config — seção incluída.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | no | — |
| V6 Cryptography | no | — |
| V1 Architecture | yes (partial) | Connection string contém credenciais — não logar DATABASE_URL em nenhum nível de log |

### Threat Patterns Específicos desta Fase

| Pattern | STRIDE | Mitigação padrão |
|---------|--------|------------------|
| Log de DATABASE_URL | Information Disclosure | Nunca logar connection strings — já respeitado no stack atual (T-09-03-05) |
| Race condition em migrations | Tampering (data integrity) | Row-lock garante exclusão mútua — D-06 |

**Sem mudanças de surface de ataque:** Esta fase não adiciona endpoints, não muda autenticação, não muda schema de dados de negócio. Risco de segurança incremental é mínimo.

---

## Open Questions

1. **Estrutura exata do row-lock com `sql.begin()` e `drizzle.migrate()`**
   - O que sabemos: `drizzle(sql)` e `migrate(db, ...)` usam o `sql` injetado; `sql.begin()` cria uma sub-transação
   - O que é incerto: se `migrate()` chamado dentro de `sql.begin(async tx => ...)` usa `tx` ou o `sql` original
   - Recomendação: planner deve testar o comportamento e escolher: (a) tudo dentro do `begin()` usando `tx` diretamente, ou (b) lock check em `begin()` separado + migrations fora

2. **Estratégia de retry para `FOR UPDATE NOWAIT`**
   - O que sabemos: D-06 especifica "loop" — planner decide o detalhe
   - O que é incerto: número de retries, tempo de sleep entre tentativas
   - Recomendação: sem retry (throw + Docker restart) é mais simples e suficiente para o cenário atual; loop com 3 retries e 200ms sleep é mais robusto para deploys simultâneos

3. **TypeScript typing do `saver.end()`**
   - O que sabemos: `end()` existe em runtime no dist/index.js v1.0.3
   - O que é incerto: se o `.d.ts` exporta o tipo — verificar antes de codificar
   - Recomendação: verificar com `grep "end" node_modules/.pnpm/@langchain+langgraph-checkpoint-postgres@1.0.3*/node_modules/@langchain/langgraph-checkpoint-postgres/dist/index.d.ts`

---

## Assumptions Log

| # | Claim | Section | Risk se Errado |
|---|-------|---------|---------------|
| A1 | postgres.js `prepare: false` não tem impacto funcional para o workload atual (agents com latência de LLM dominante) | Standard Stack | Baixo — degradação seria apenas de performance (sem prepared stmt cache), não de correção |
| A2 | `drizzle-orm` `migrate()` com `sql` injetado funciona com `sql.begin()` se estruturado corretamente | Architecture Patterns (Padrão 2) | Médio — pode requerer refactor da estrutura de locking |

**Todos os outros claims foram verificados via leitura direta do código-fonte.**

---

## State of the Art

| Abordagem Antiga | Abordagem Atual | Quando Mudou | Impacto |
|--------------|------------------|--------------|--------|
| `pg_advisory_lock` (session-scoped) | Row-lock `FOR UPDATE NOWAIT` (transaction-scoped) | Esta fase | Compatibilidade com PgBouncer transaction mode em migrations |
| `PostgresSaver.fromConnString()` sem close | `PostgresSaver.fromConnString()` + `saver.end()` em finally | Esta fase (CR-01) | Elimina connection leak em qualify_lead |
| `postgres()` sem `prepare` option | `postgres({ prepare: false })` | Esta fase | Compatibilidade total com PgBouncer — qualquer modo |

**Deprecated/outdated para este contexto:**
- `pg_advisory_lock` em runMigrations: removido nesta fase
- Pattern de criar PostgresSaver sem fechar: corrigido nesta fase

---

## Sources

### Primary (HIGH confidence — código-fonte lido diretamente)

- `/root/Brain/node_modules/.pnpm/pg@8.21.0/node_modules/pg/lib/query.js` — `requiresPreparation()` confirmado: parameterized queries usam extended protocol
- `/root/Brain/node_modules/.pnpm/pg@8.21.0/node_modules/pg/lib/defaults.js` — confirmado: sem opção `prepare` em pg v8.21
- `/root/Brain/node_modules/.pnpm/@langchain+langgraph-checkpoint-postgres@1.0.3_.../dist/index.js` — `end()` em linha 371; `fromConnString()` usa `new Pool()` interno
- `/root/Brain/node_modules/.pnpm/@langchain+langgraph-checkpoint-postgres@1.0.3_.../dist/sql.js` — todos os SQL statements usam parâmetros `$1..$N`
- `/root/Brain/packages/database/src/pool-manager.ts` — local exato onde `prepare: false` entra
- `/root/Brain/packages/database/src/migrate.ts` — advisory lock atual a ser substituído
- `/root/Brain/apps/brain-sdr/src/qualifier.ts` — CR-01: `PostgresSaver.fromConnString()` sem close em linha 196

### Secondary (MEDIUM confidence — web search + documentação)

- [postgres.js README](https://github.com/porsager/postgres) — `prepare: false` option documentada
- [OpenSourceDB — PgBouncer prepared statement solutions](https://opensource-db.com/how-we-solved-prepared-statement-issues-with-pgbouncers-pooling-modes/) — confirms pg driver uses extended protocol by default
- [PgBouncer 1.21 prepared statement support](https://pganalyze.com/blog/5mins-postgres-pgbouncer-prepared-statements-transaction-mode) — versão mínima para transaction mode + prepared statements
- [RapidClaw — LangGraph + PgBouncer](https://rapidclaw.dev/blog/deploy-langgraph-production-tutorial-2026) — confirma necessidade de session mode para PostgresSaver atrás de pooler

### Tertiary (LOW confidence — contexto adicional)

- [Crunchy Data — Prepared Statements in PgBouncer Transaction Mode](https://www.crunchydata.com/blog/prepared-statements-in-transaction-mode-for-pgbouncer) — histórico do problema

---

## Metadata

**Confidence breakdown:**
- D-01 (`prepare: false`): HIGH — opção documentada do postgres.js
- D-05 (PostgresSaver + transaction mode): HIGH — verificado via source code do pg e PostgresSaver
- D-06/D-07 (row-lock): HIGH — padrão bem estabelecido; único risco é integração com drizzle migrate()
- D-09 (CR-01 fix): HIGH — `end()` confirmado em dist/index.js
- Testes existentes: HIGH — executados e baseline confirmado

**Research date:** 2026-06-15
**Valid until:** 2026-12-15 (estável — depende de versões pinadas que não mudarão nesta fase)
