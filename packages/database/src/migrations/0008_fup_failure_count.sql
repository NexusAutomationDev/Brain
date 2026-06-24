-- FUP-08: Adiciona contador de falhas de FUP por lead.
-- Persistente no banco para sobreviver a restarts do scheduler.
-- DEFAULT 0 NOT NULL — leads existentes herdam zero falhas sem necessidade de backfill.
ALTER TABLE "leads" ADD COLUMN "fup_failure_count" integer DEFAULT 0 NOT NULL;
