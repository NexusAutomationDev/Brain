import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { agents } from './schema/tables.js';
import type { Sql } from 'postgres';

/**
 * HANDOFF-04/D-06/D-07: Resolve um nome de agente destino contra a tabela `agents`.
 * Leitura sempre live (sem snapshot em compile-time) — nova linha em `agents` fica
 * imediatamente utilizável, sem qualquer /reload equivalente.
 *
 * Query parametrizada via Drizzle (eq()) — nunca interpolação de string — previne SQL injection
 * mesmo que `name` venha eventualmente de um argumento de tool validado pelo LLM (Phase 35).
 *
 * Nunca logar/serializar a linha completa nem o resultado completo aqui (Pitfall 2, T-34-05) —
 * connectionString é uma credencial em texto plano; apenas name/brainType sao campos logaveis.
 */
export type AgentConnectionResult =
  | { ok: true; connectionString: string; brainType: string }
  | { ok: false; reason: 'not_found' | 'disabled' };

/**
 * @param sql - postgres.js Sql instance do tenant (injetado, sem criar nova conexão)
 * @param name - nome do agente destino (agents.name, PK)
 */
export async function getAgentConnection(sql: Sql, name: string): Promise<AgentConnectionResult> {
  const db = drizzle(sql);
  const rows = await db.select().from(agents).where(eq(agents.name, name)).limit(1);
  const row = rows[0];

  if (!row) {
    return { ok: false, reason: 'not_found' };
  }
  if (!row.enabled) {
    return { ok: false, reason: 'disabled' };
  }
  return { ok: true, connectionString: row.connectionString, brainType: row.brainType };
}
