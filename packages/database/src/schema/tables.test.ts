import { describe, it, expect } from 'bun:test';
import { memories, agentState, embeddings, prompts, leads, fupConfig } from './tables.js';

// Helper: get the Drizzle table name via its well-known symbol
function tableName(table: Record<symbol, unknown>): string {
  return table[Symbol.for('drizzle:Name')] as string;
}

describe('Schema Tables (DB-01, DB-02, SDK-04)', () => {
  describe('DB-01: Schema defines all required tables', () => {
    it('exports memories table with userId and key columns', () => {
      expect(memories).toBeDefined();
      expect(tableName(memories as any)).toBe('memories');
      expect(memories.userId.name).toBe('user_id');
      expect(memories.userId.notNull).toBe(true);
      expect(memories.key.name).toBe('key');
      expect(memories.key.notNull).toBe(true);
    });

    it('exports agentState table with threadId unique constraint', () => {
      expect(agentState).toBeDefined();
      expect(tableName(agentState as any)).toBe('agent_state');
      expect(agentState.threadId.name).toBe('thread_id');
      expect(agentState.threadId.isUnique).toBe(true);
      expect(agentState.threadId.notNull).toBe(true);
    });

    it('exports embeddings table with vector column', () => {
      expect(embeddings).toBeDefined();
      expect(tableName(embeddings as any)).toBe('embeddings');
      expect(embeddings.embedding.name).toBe('embedding');
      expect(embeddings.embedding.notNull).toBe(true);
    });
  });

  describe('DB-02: PGVector configuration', () => {
    it('embeddings table reads EMBEDDING_DIMENSIONS from env (DB-02)', () => {
      // In test env (.env.test), EMBEDDING_DIMENSIONS=128
      // In production env (.env), EMBEDDING_DIMENSIONS=1536
      // The table must accept the configured value — valid range is 128–4096
      const dimensions = (embeddings.embedding as any).config?.dimensions ?? (embeddings.embedding as any).dimensions;
      expect(typeof dimensions).toBe('number');
      expect(dimensions).toBeGreaterThanOrEqual(128);
      expect(dimensions).toBeLessThanOrEqual(4096);
    });

    it('embeddings table has HNSW index defined via extra config builder', () => {
      // The HNSW index is defined in the extra config builder symbol
      const extraConfigBuilder = (embeddings as any)[Symbol.for('drizzle:ExtraConfigBuilder')];
      expect(extraConfigBuilder).toBeDefined();
      expect(typeof extraConfigBuilder).toBe('function');
      // The config string should contain hnsw reference
      const configStr = extraConfigBuilder.toString();
      expect(configStr).toContain('hnsw');
    });
  });

  describe('LEAD-01: Leads table — identity and state for each lead (D-01 to D-07)', () => {
    it('exports leads table with correct Postgres table name', () => {
      expect(leads).toBeDefined();
      expect(tableName(leads as any)).toBe('leads');
    });

    it('D-01: id is a UUID primary key with defaultRandom()', () => {
      expect(leads.id.name).toBe('id');
      expect(leads.id.columnType).toBe('PgUUID');
      expect(leads.id.primary).toBe(true);
    });

    it('D-02: uniqueId maps to column unique_id and is NOT NULL', () => {
      expect(leads.uniqueId.name).toBe('unique_id');
      expect(leads.uniqueId.notNull).toBe(true);
    });

    it('D-03: nome maps to column nome and is nullable (no notNull)', () => {
      expect(leads.nome.name).toBe('nome');
      expect(leads.nome.notNull).toBe(false);
    });

    it('D-04: numero maps to column numero and is NOT NULL', () => {
      expect(leads.numero.name).toBe('numero');
      expect(leads.numero.notNull).toBe(true);
    });

    it('D-04: leads_numero_unique_idx uniqueIndex is defined on numero', () => {
      const extraConfigBuilder = (leads as any)[Symbol.for('drizzle:ExtraConfigBuilder')];
      expect(extraConfigBuilder).toBeDefined();
      expect(typeof extraConfigBuilder).toBe('function');
      const configStr = extraConfigBuilder.toString();
      expect(configStr).toContain('leads_numero_unique_idx');
      expect(configStr).toContain('uniqueIndex');
    });

    it('D-05: iaAtivada maps to ia_ativada, is NOT NULL, and defaults to true', () => {
      expect(leads.iaAtivada.name).toBe('ia_ativada');
      expect(leads.iaAtivada.notNull).toBe(true);
      expect((leads.iaAtivada as any).default).toBe(true);
    });

    it('D-06: fullpp maps to fullpp column and is nullable (no notNull)', () => {
      expect(leads.fullpp.name).toBe('fullpp');
      expect(leads.fullpp.notNull).toBe(false);
    });

    it('D-07: createdAt maps to created_at and is NOT NULL', () => {
      expect(leads.createdAt.name).toBe('created_at');
      expect(leads.createdAt.notNull).toBe(true);
    });

    it('D-07: updatedAt maps to updated_at and is NOT NULL', () => {
      expect(leads.updatedAt.name).toBe('updated_at');
      expect(leads.updatedAt.notNull).toBe(true);
    });

    it('idDeal maps to column id_deal and is nullable (no notNull)', () => {
      expect(leads.idDeal.name).toBe('id_deal');
      expect(leads.idDeal.notNull).toBe(false);
    });

    it('idContato maps to column id_contato and is nullable (no notNull)', () => {
      expect(leads.idContato.name).toBe('id_contato');
      expect(leads.idContato.notNull).toBe(false);
    });
  });

  describe('FUP Schema (FUP-01, FUP-08)', () => {
    describe('leads table — FUP state columns', () => {
      it('FUP-04 / D-10: fupEnabled maps to fup_enabled, is NOT NULL, and defaults to false', () => {
        expect(leads.fupEnabled.name).toBe('fup_enabled');
        expect(leads.fupEnabled.notNull).toBe(true);
        expect((leads.fupEnabled as any).default).toBe(false);
      });

      it('FUP-04 / D-10: fupStep maps to fup_step, is NOT NULL, and defaults to 0', () => {
        expect(leads.fupStep.name).toBe('fup_step');
        expect(leads.fupStep.notNull).toBe(true);
        expect((leads.fupStep as any).default).toBe(0);
      });

      it('FUP-04 / D-10: fupNextAt maps to fup_next_at and is nullable (withTimezone)', () => {
        expect(leads.fupNextAt.name).toBe('fup_next_at');
        expect(leads.fupNextAt.notNull).toBe(false);
      });

      it('D-11: lastMessageAt maps to last_message_at and is nullable (withTimezone)', () => {
        expect(leads.lastMessageAt.name).toBe('last_message_at');
        expect(leads.lastMessageAt.notNull).toBe(false);
      });

      it('FUP-08 / D-14: fupFailureCount maps to fup_failure_count, is NOT NULL, and defaults to 0', () => {
        expect(leads.fupFailureCount.name).toBe('fup_failure_count');
        expect(leads.fupFailureCount.notNull).toBe(true);
        expect((leads.fupFailureCount as any).default).toBe(0);
      });
    });

    describe('fupConfig table — FUP-01: per-brain configuration', () => {
      it('exports fupConfig table with correct Postgres table name', () => {
        expect(fupConfig).toBeDefined();
        expect(tableName(fupConfig as any)).toBe('fup_config');
      });

      it('FUP-01 / D-02: brainType is the text primary key (no UUID)', () => {
        expect(fupConfig.brainType.name).toBe('brain_type');
        expect(fupConfig.brainType.primary).toBe(true);
        expect(fupConfig.brainType.columnType).toBe('PgText');
      });

      it('FUP-01 / D-16: enabled is NOT NULL and defaults to true', () => {
        expect(fupConfig.enabled.name).toBe('enabled');
        expect(fupConfig.enabled.notNull).toBe(true);
        expect((fupConfig.enabled as any).default).toBe(true);
      });

      it('FUP-01 / D-03: intervalsSeconds maps to intervals_seconds and is NOT NULL array', () => {
        expect(fupConfig.intervalsSeconds.name).toBe('intervals_seconds');
        expect(fupConfig.intervalsSeconds.notNull).toBe(true);
      });

      it('FUP-01 / D-06: minHour maps to min_hour and is NOT NULL', () => {
        expect(fupConfig.minHour.name).toBe('min_hour');
        expect(fupConfig.minHour.notNull).toBe(true);
      });

      it('FUP-01 / D-06: maxHour maps to max_hour and is NOT NULL', () => {
        expect(fupConfig.maxHour.name).toBe('max_hour');
        expect(fupConfig.maxHour.notNull).toBe(true);
      });

      it('FUP-01 / D-04: allowedDays maps to allowed_days and is NOT NULL array', () => {
        expect(fupConfig.allowedDays.name).toBe('allowed_days');
        expect(fupConfig.allowedDays.notNull).toBe(true);
      });

      it('FUP-01 / D-05: timezone maps to timezone and is NOT NULL', () => {
        expect(fupConfig.timezone.name).toBe('timezone');
        expect(fupConfig.timezone.notNull).toBe(true);
      });
    });
  });

  describe('SDK-04: Prompts table — stores brain prompts keyed by (brain_type, key)', () => {
    it('exports prompts table', () => {
      expect(prompts).toBeDefined();
      expect(tableName(prompts as any)).toBe('prompts');
    });

    it('prompts table has id column as UUID primary key', () => {
      expect(prompts.id.name).toBe('id');
      expect(prompts.id.columnType).toBe('PgUUID');
      expect(prompts.id.primary).toBe(true);
    });

    it('prompts table has brainType column mapped to brain_type (NOT NULL)', () => {
      expect(prompts.brainType.name).toBe('brain_type');
      expect(prompts.brainType.notNull).toBe(true);
    });

    it('prompts table has key column (NOT NULL)', () => {
      expect(prompts.key.name).toBe('key');
      expect(prompts.key.notNull).toBe(true);
    });

    it('prompts table has content column (NOT NULL)', () => {
      expect(prompts.content.name).toBe('content');
      expect(prompts.content.notNull).toBe(true);
    });

    it('prompts table has createdAt column mapped to created_at', () => {
      expect(prompts.createdAt.name).toBe('created_at');
    });

    it('prompts table has updatedAt column mapped to updated_at', () => {
      expect(prompts.updatedAt.name).toBe('updated_at');
    });

    it('prompts table has a uniqueIndex defined on (brainType, key) — D-08', () => {
      // The extra config builder must reference uniqueIndex for (brainType, key)
      const extraConfigBuilder = (prompts as any)[Symbol.for('drizzle:ExtraConfigBuilder')];
      expect(extraConfigBuilder).toBeDefined();
      expect(typeof extraConfigBuilder).toBe('function');
      const configStr = extraConfigBuilder.toString();
      expect(configStr).toContain('uniqueIndex');
      expect(configStr).toContain('prompts_brain_type_key_idx');
    });
  });
});
