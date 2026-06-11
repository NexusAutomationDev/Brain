import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);  // D-08: Container fails startup
  }

  // Use max: 1 to avoid interleaved DDL and deadlocks
  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql);

  try {
    console.log('Starting migrations...');

    // Create PGVector extension first (DB-02)
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    console.log('PGVector extension enabled');

    // Run Drizzle migrations (D-07: automatic on container startup)
    await migrate(db, { migrationsFolder: './src/migrations' });
    console.log('Migrations completed successfully');
    process.exit(0);  // Success
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);  // D-08: Container fails startup if migration fails
  } finally {
    await sql.end();
  }
}

runMigrations();
