import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Sql } from 'postgres';

const MIGRATION_LOCK_KEY = 7316882; // D-14: chave fixa arbitrária para advisory lock

/**
 * Exportável: chamado pelo entrypoint de apps/brain-echo no startup.
 * Recebe Sql injetado — sem criar nova conexão.
 * Lança erro em caso de falha (o caller decide se faz process.exit).
 *
 * D-13: pg_advisory_lock blocking — segunda instância aguarda até a primeira terminar.
 * D-15: lock é por database no PostgreSQL — isolamento multi-tenant automático.
 */
export async function runMigrations(sql: Sql, migrationsFolder: string): Promise<void> {
  console.log('[migrate] Aguardando advisory lock para migrations...');
  await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
  console.log('[migrate] Advisory lock adquirido — iniciando migrations');
  try {
    const db = drizzle(sql);
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await migrate(db, { migrationsFolder });
    console.log('[migrate] Migrations concluídas com sucesso');
  } finally {
    await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    console.log('[migrate] Advisory lock liberado');
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
  const sql = postgres(connectionString, { max: 1 });
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
