import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Sql } from 'postgres';

/**
 * Retorna true se o erro PostgreSQL indica que o lock não estava disponível (código 55P03).
 */
function isLockNotAvailable(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '55P03' // lock_not_available (PostgreSQL)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Exportável: chamado pelo entrypoint de apps/brain-echo no startup.
 * Recebe Sql injetado — sem criar nova conexão.
 * Lança erro em caso de falha (o caller decide se faz process.exit).
 *
 * PGB-02: row-lock via _schema_lock — compatível com PgBouncer transaction mode.
 * PGB-03: DDL idempotente (_schema_lock) fora de transação (Pitfall 4 do RESEARCH.md).
 * D-15: lock é por database no PostgreSQL — isolamento multi-tenant automático.
 */
export async function runMigrations(sql: Sql, migrationsFolder: string): Promise<void> {
  // D-07: Criar tabela de lock idempotentemente — DDL fora de transação (Pitfall 4 do RESEARCH.md)
  // CREATE TABLE IF NOT EXISTS é idempotente e seguro sem transação
  await sql`CREATE TABLE IF NOT EXISTS _schema_lock (id INTEGER PRIMARY KEY, locked_at TIMESTAMPTZ)`;
  await sql`INSERT INTO _schema_lock (id, locked_at) VALUES (1, NOW()) ON CONFLICT (id) DO NOTHING`;

  // drizzle(sql) precisa do client raiz (options.parsers) — não pode ser o tx de transação
  const db = drizzle(sql);

  // CREATE EXTENSION deve ser commitado antes de migrate() rodar em conexão separada do pool
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;

  // D-06: Row-lock transaction-scoped — compatível com PgBouncer transaction mode
  // Retry até 3 tentativas com 200ms de sleep entre elas (D-14: comportamento desejável)
  const MAX_RETRIES = 3;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      await sql.begin(async (tx) => {
        // FOR UPDATE NOWAIT: lança erro código 55P03 se outra instância tem o lock
        await tx`SELECT id FROM _schema_lock WHERE id = 1 FOR UPDATE NOWAIT`;

        console.log('[migrate] Row-lock adquirido — iniciando migrations');
        await migrate(db, { migrationsFolder });

        console.log('[migrate] Migrations concluídas com sucesso');
        // Lock liberado automaticamente ao fim da transação
      });
      return; // Sucesso — sair do loop
    } catch (err: unknown) {
      if (isLockNotAvailable(err) && attempt < MAX_RETRIES - 1) {
        attempt++;
        console.log(`[migrate] Lock não disponível — tentativa ${attempt}/${MAX_RETRIES}, aguardando 200ms`);
        await sleep(200);
        continue;
      }
      if (isLockNotAvailable(err)) {
        throw new Error(
          `[migrate] Não foi possível adquirir lock de migrations após ${MAX_RETRIES} tentativas. ` +
          'Outra instância pode estar executando migrations. Reinicie a aplicação.'
        );
      }
      throw err; // Outros erros (ex: migrate() falhou) — propagar imediatamente
    }
  }
}

// Script CLI: mantém comportamento original para `bun src/migrate.ts`
if (import.meta.main) {
  const postgres = (await import('postgres')).default;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  const sql = postgres(connectionString, { max: 1, prepare: false }); // D-01: PgBouncer-compatible
  try {
    console.log('Starting migrations...');
    await runMigrations(sql, './src/migrations');
    console.log('Migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}
