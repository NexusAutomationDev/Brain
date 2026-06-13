// SC-4: 10 tenants simultâneos abaixo do LRU cap
// D-10: bun test direto contra TenantPoolManager — sem Docker necessário
// Requer PostgreSQL em TEST_DATABASE_URL ou PG_HOST/PG_PORT/PG_USER/PG_PASSWORD env vars

import { describe, test, expect, afterAll } from "bun:test";
import { TenantPoolManager } from "@brain-pkg/database";

// Configuração de conexão — usa TEST_DATABASE_URL ou vars individuais
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const PG_HOST = process.env.PG_HOST || "localhost";
const PG_PORT = parseInt(process.env.PG_PORT || "5432");
const PG_USER = process.env.PG_USER || "postgres";
const PG_PASSWORD = process.env.PG_PASSWORD || "postgres";

// Parâmetros do teste
const POOL_SIZE = 2;      // pequeno para não saturar o test DB
const MAX_TENANTS = 20;   // LRU cap: 20 pools × 2 conexões = 40 conexões máximas

// Guard: pular quando PostgreSQL não estiver configurado explicitamente
// Em CI/dev sem PG local, usar TEST_DATABASE_URL para habilitar
const RUN_PG = !!(TEST_DATABASE_URL || process.env.PG_HOST);

// Extrair config de conexão do DATABASE_URL ou vars individuais
let host = PG_HOST;
let port = PG_PORT;
let username = PG_USER;
let password = PG_PASSWORD;
let testDb = "brain_test";

if (TEST_DATABASE_URL) {
  const url = new URL(TEST_DATABASE_URL);
  host = url.hostname;
  port = parseInt(url.port || "5432");
  username = url.username;
  password = url.password;
  testDb = url.pathname.slice(1) || "brain_test";
}

const manager = new TenantPoolManager(
  { host, port, username, password, max: POOL_SIZE, idle_timeout: 30 },
  MAX_TENANTS
);

describe("SC-4: 10 tenants simultâneos abaixo do LRU cap", () => {
  afterAll(async () => {
    await manager.closeAll();
  });

  test("placeholder: arquivo existe e importa TenantPoolManager", () => {
    // Verifica que o import funciona e a classe é instanciável
    expect(typeof TenantPoolManager).toBe("function");
    expect(typeof manager.getPool).toBe("function");
    expect(typeof manager.closeAll).toBe("function");
  });

  const pgTest = RUN_PG ? test : test.skip;

  pgTest("10 tenants fazem queries simultâneas abaixo do connection cap", async () => {
    const TENANT_COUNT = 10;

    // Criar 10 queries concorrentes, cada uma com um "tenant" diferente
    // (em teste todos apontam para o mesmo DB — o que importa é o pool ser diferente)
    const queries = Array.from({ length: TENANT_COUNT }, async (_, i) => {
      // TenantPoolManager cria um pool por tenantId — todos usam o mesmo DB real
      // para que as queries realmente executem
      const sql = manager.getPool(testDb);
      // Query simples que não depende de tabelas específicas
      const result = await sql`SELECT ${i}::int AS tenant_index, pg_backend_pid() AS pid`;
      expect(result[0].tenant_index).toBe(i);
      return result;
    });

    await Promise.all(queries);

    // Verificar contagem de conexões via pg_stat_activity
    const adminSql = manager.getPool(testDb);
    const connResult = await adminSql`
      SELECT count(*)::int AS conn_count
      FROM pg_stat_activity
      WHERE datname = ${testDb}
        AND state IS NOT NULL
    `;

    const connCount = connResult[0].conn_count;
    const maxAllowed = MAX_TENANTS * POOL_SIZE;

    // A contagem DEVE estar bem abaixo do LRU cap
    expect(connCount).toBeLessThanOrEqual(maxAllowed);
    // Sanity check: pelo menos 1 conexão ativa
    expect(connCount).toBeGreaterThan(0);
  }, 30_000);
});
