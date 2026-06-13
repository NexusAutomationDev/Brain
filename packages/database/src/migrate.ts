import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Sql } from 'postgres';

/**
 * Exportável: chamado pelo entrypoint de apps/brain-echo no startup.
 * Recebe Sql injetado — sem criar nova conexão.
 * Lança erro em caso de falha (o caller decide se faz process.exit).
 */
export async function runMigrations(sql: Sql, migrationsFolder: string): Promise<void> {
  const db = drizzle(sql);
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await migrate(db, { migrationsFolder });
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
