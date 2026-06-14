// LEAD-02: LeadService — cadastro automático de leads por numero + gate ia_ativada (D-01, D-02, D-03)
// D-01: localização packages/core — junto ao BrainRunner (único consumidor em v1.1)
// D-02: classe com sql injetado no construtor; métodos upsertLead + getByNumero
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { leads } from "@brain-pkg/database";
import type { Sql } from "postgres";

/** Tipo Lead derivado do schema Drizzle — campos da tabela leads */
export type Lead = typeof leads.$inferSelect;

/**
 * LEAD-02: Gerencia leads — cadastro automático e consulta por numero.
 *
 * D-02: Interface: class LeadService { constructor(sql: Sql) }
 * D-03: Chamado por BrainRunner.run() — não pelos transport handlers.
 *
 * Segurança: iaAtivada vem do banco (upsert), nunca do payload externo.
 */
export class LeadService {
  private readonly db: ReturnType<typeof drizzle>;

  constructor(sql: Sql) {
    this.db = drizzle(sql);
  }

  /**
   * LEAD-02: Upsert atômico por numero.
   * - INSERT se numero não existe — cria lead com uniqueId e nome fornecidos.
   * - UPDATE se numero já existe — atualiza nome e updatedAt; uniqueId NUNCA é sobrescrito.
   *
   * @param numero - Número do WhatsApp/CRM (chave única de identificação)
   * @param uniqueId - IDLead do payload (gerado pela integração, nunca sobrescrito no update)
   * @param nome - Nome opcional do lead (vem de event.Name)
   */
  async upsertLead(numero: string, uniqueId: string, nome?: string): Promise<Lead> {
    const rows = await this.db
      .insert(leads)
      .values({
        numero,
        uniqueId,
        nome: nome ?? null,
      })
      .onConflictDoUpdate({
        target: leads.numero,
        set: {
          // LEAD-02: uniqueId ausente do set — nunca sobrescrito após primeiro insert
          nome: nome ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!rows[0]) {
      throw new Error(`upsertLead returned no rows for numero=${numero}`);
    }

    return rows[0];
  }

  /**
   * Busca lead por numero. Retorna null se não existir.
   *
   * @param numero - Número do WhatsApp/CRM
   */
  async getByNumero(numero: string): Promise<Lead | null> {
    const rows = await this.db
      .select()
      .from(leads)
      .where(eq(leads.numero, numero))
      .limit(1);

    return rows[0] ?? null;
  }
}
