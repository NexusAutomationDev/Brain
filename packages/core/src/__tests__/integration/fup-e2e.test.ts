/**
 * Teste de integração E2E do FupScheduler — rodando contra PostgreSQL real.
 *
 * Cobre FUP-02 (scheduler processa lead elegível, SELECT FOR UPDATE SKIP LOCKED)
 * e FUP-05 (último step desativa ia_ativada=false e fup_enabled=false).
 *
 * LLM mockado via monkey-patch em _generateFupMessage — sem custo de API.
 * Webhook HTTP mockado via substituição de globalThis.fetch — sem dependência de rede.
 *
 * Requer PostgreSQL real via DATABASE_URL. Todos os testes são skipados graciosamente
 * quando DATABASE_URL não está configurado no ambiente.
 *
 * Para executar:
 *   DATABASE_URL=postgres://user:pass@localhost:5432/dbname \
 *   MIGRATIONS_FOLDER=packages/database/src/migrations \
 *   bun test packages/core/src/__tests__/integration/fup-e2e.test.ts
 */

import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import path from "path";
import postgres from "postgres";
import { runMigrations } from "@brain-pkg/database";
import { FupScheduler } from "../../fup/fup-scheduler.js";

// --- Configuração de skip ---
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_FUP = !!DATABASE_URL;

// Pasta de migrations: ENV ou fallback para packages/database/src/migrations
const MIGRATIONS_FOLDER =
  process.env.MIGRATIONS_FOLDER ??
  path.join(import.meta.dir, "../../../../../packages/database/src/migrations");

// Identificadores únicos para não colidir com dados de produção
const BRAIN_TYPE = "sdr-fup-e2e";
const LEAD_UNIQUE_ID = "fup-e2e-lead-1";
const LEAD_NUMERO = "5511000000001";
const FUP_WEBHOOK_URL = "http://localhost:19999/fup-test";

// Estado compartilhado entre testes
let sql: ReturnType<typeof postgres> | null = null;
let scheduler: FupScheduler | null = null;
let fetchCallCount = 0;
let lastFetchBody: Record<string, unknown> | null = null;
let originalFetch: typeof globalThis.fetch;

// --- Mock do checkpointer ---
const mockCheckpointer = {
  getTuple: async (_config: { configurable: { thread_id: string } }) => ({
    checkpoint: {
      channel_values: {
        messages: [],
      },
    },
  }),
};

// --- Mock do eventPublisher ---
const mockEventPublisher = {
  publish: mock(async (_events: unknown[]) => {}),
  close: mock(async () => {}),
};

// ----------------------------------------------------------------
describe("FupScheduler E2E — banco PostgreSQL real (FUP-02, FUP-05)", () => {
  beforeAll(async () => {
    if (!RUN_FUP) return;

    // 1. Conectar ao banco real
    sql = postgres(DATABASE_URL!, { prepare: false });

    // 2. Rodar migrations (idempotente — garante schema atualizado)
    await runMigrations(sql, MIGRATIONS_FOLDER);

    // 3. Inserir fup_config para brain_type='sdr-fup-e2e'
    //    intervals_seconds=[1, 2] = 2 steps; min_hour=0, max_hour=23 = sempre elegível
    await sql`
      INSERT INTO fup_config (brain_type, enabled, intervals_seconds, min_hour, max_hour, allowed_days, timezone)
      VALUES (
        ${BRAIN_TYPE},
        true,
        ARRAY[1, 2]::integer[],
        0,
        23,
        ARRAY['mon','tue','wed','thu','fri','sat','sun']::text[],
        'UTC'
      )
      ON CONFLICT (brain_type) DO UPDATE SET
        enabled = true,
        intervals_seconds = ARRAY[1, 2]::integer[],
        min_hour = 0,
        max_hour = 23,
        allowed_days = ARRAY['mon','tue','wed','thu','fri','sat','sun']::text[],
        timezone = 'UTC',
        updated_at = NOW()
    `;

    // 4. Inserir prompt 'fup' para o brain_type do teste
    await sql`
      INSERT INTO prompts (brain_type, key, content)
      VALUES (${BRAIN_TYPE}, 'fup', 'Envie uma mensagem de follow-up')
      ON CONFLICT (brain_type, key) DO UPDATE SET
        content = 'Envie uma mensagem de follow-up',
        updated_at = NOW()
    `;

    // 5. Inserir lead elegível: fup_next_at no passado (NOW() - 1 minute)
    await sql`
      INSERT INTO leads (unique_id, nome, numero, brain_type, fup_enabled, ia_ativada, fup_step, fup_next_at)
      VALUES (
        ${LEAD_UNIQUE_ID},
        'E2E Test Lead',
        ${LEAD_NUMERO},
        ${BRAIN_TYPE},
        true,
        true,
        0,
        NOW() - INTERVAL '1 minute'
      )
      ON CONFLICT (unique_id) DO UPDATE SET
        fup_enabled = true,
        ia_ativada = true,
        fup_step = 0,
        fup_next_at = NOW() - INTERVAL '1 minute',
        fup_failure_count = 0,
        updated_at = NOW()
    `;

    // 6. Substituir globalThis.fetch para capturar chamadas do scheduler._sendFupWebhook()
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCallCount++;
      if (init?.body && typeof init.body === "string") {
        try {
          lastFetchBody = JSON.parse(init.body) as Record<string, unknown>;
        } catch {
          lastFetchBody = null;
        }
      }
      return new Response(null, { status: 200 });
    };

    // 7. Construir o scheduler com todas as dependências mockadas
    scheduler = new FupScheduler({
      sql: sql,
      brainType: BRAIN_TYPE,
      checkpointer: mockCheckpointer,
      eventPublisher: mockEventPublisher,
      fupWebhookUrl: FUP_WEBHOOK_URL,
    });

    // 8. Monkey-patch _generateFupMessage para evitar chamada real ao LLM
    (scheduler as unknown as Record<string, unknown>)._generateFupMessage = async () =>
      "Mensagem de follow-up de teste E2E";
  });

  afterAll(async () => {
    if (!sql) return;

    // Restaurar fetch original
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }

    // Limpar registros inseridos pelo teste
    await sql`DELETE FROM leads WHERE unique_id = ${LEAD_UNIQUE_ID}`;
    await sql`DELETE FROM fup_config WHERE brain_type = ${BRAIN_TYPE}`;
    await sql`DELETE FROM prompts WHERE brain_type = ${BRAIN_TYPE}`;

    await sql.end();
  });

  // ---- Teste 1: Step 0 → Step 1 ----
  test.skipIf(!RUN_FUP)(
    "Step 0 → Step 1: lead elegível é processado, fup_step avança e fup_next_at atualizado",
    async () => {
      const fetchCallsBefore = fetchCallCount;

      // Acionar _tick() diretamente (sem timer)
      await scheduler!._tick();

      // Verificar estado no banco após processamento
      const [lead] = await sql!`
        SELECT fup_step, fup_next_at, ia_ativada, fup_enabled
        FROM leads
        WHERE unique_id = ${LEAD_UNIQUE_ID}
      ` as { fup_step: number; fup_next_at: Date | null; ia_ativada: boolean; fup_enabled: boolean }[];

      expect(lead).toBeDefined();
      // fup_step deve ter avançado de 0 para 1
      expect(lead.fup_step).toBe(1);
      // fup_next_at deve ser no futuro (scheduler calculou próximo slot)
      expect(lead.fup_next_at).not.toBeNull();
      expect(new Date(lead.fup_next_at!).getTime()).toBeGreaterThan(Date.now());
      // ia_ativada e fup_enabled devem permanecer true (ainda não é último step)
      expect(lead.ia_ativada).toBe(true);
      expect(lead.fup_enabled).toBe(true);

      // Verificar que fetch foi chamado uma vez
      expect(fetchCallCount - fetchCallsBefore).toBe(1);
      // Verificar payload do webhook: IDLead deve ser o unique_id do lead
      expect(lastFetchBody).not.toBeNull();
      expect(lastFetchBody!.IDLead).toBe(LEAD_UNIQUE_ID);
    }
  );

  // ---- Teste 2: Step 1 → Último step (ia_ativada=false) ----
  test.skipIf(!RUN_FUP)(
    "Step 1 → último step: ia_ativada=false e fup_enabled=false após último FUP (FUP-05)",
    async () => {
      // Tornar o lead elegível novamente (fup_next_at no passado)
      await sql!`
        UPDATE leads
        SET fup_next_at = NOW() - INTERVAL '1 minute',
            updated_at = NOW()
        WHERE unique_id = ${LEAD_UNIQUE_ID}
      `;

      const fetchCallsBefore = fetchCallCount;

      // Acionar _tick() novamente para processar o segundo (e último) step
      await scheduler!._tick();

      // Verificar estado no banco após último step
      const [lead] = await sql!`
        SELECT fup_step, fup_next_at, ia_ativada, fup_enabled
        FROM leads
        WHERE unique_id = ${LEAD_UNIQUE_ID}
      ` as { fup_step: number; fup_next_at: Date | null; ia_ativada: boolean; fup_enabled: boolean }[];

      expect(lead).toBeDefined();
      // fup_step deve ter avançado de 1 para 2
      expect(lead.fup_step).toBe(2);
      // FUP-05: ia_ativada=false e fup_enabled=false após último step
      expect(lead.ia_ativada).toBe(false);
      expect(lead.fup_enabled).toBe(false);
      // fup_next_at deve ser NULL após último step
      expect(lead.fup_next_at).toBeNull();

      // Verificar que fetch foi chamado pela segunda vez
      expect(fetchCallCount - fetchCallsBefore).toBe(1);
    }
  );

  // ---- Teste 3: _tick() não processa lead desativado ----
  test.skipIf(!RUN_FUP)(
    "_tick() não processa lead com ia_ativada=false (lead já finalizado)",
    async () => {
      // Lead está com ia_ativada=false após teste anterior
      // Tornar elegível por data, mas verificar que não é processado (ia_ativada=false)
      await sql!`
        UPDATE leads
        SET fup_next_at = NOW() - INTERVAL '1 minute',
            updated_at = NOW()
        WHERE unique_id = ${LEAD_UNIQUE_ID}
      `;

      const fetchCallsBefore = fetchCallCount;

      await scheduler!._tick();

      // fetch NÃO deve ter sido chamado — lead tem ia_ativada=false
      expect(fetchCallCount - fetchCallsBefore).toBe(0);

      // Estado do lead não deve ter mudado
      const [lead] = await sql!`
        SELECT ia_ativada, fup_enabled
        FROM leads
        WHERE unique_id = ${LEAD_UNIQUE_ID}
      ` as { ia_ativada: boolean; fup_enabled: boolean }[];

      expect(lead.ia_ativada).toBe(false);
      expect(lead.fup_enabled).toBe(false);
    }
  );
});
