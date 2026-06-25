// LEAD-02: LeadService — cadastro automático de leads por numero + gate ia_ativada (D-01, D-02, D-03)
// D-01: localização packages/core — junto ao BrainRunner (único consumidor em v1.1)
// D-02: classe com sql injetado no construtor; métodos upsertLead + getByNumero
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { leads, fupConfig } from "@brain-pkg/database";
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
   * LEAD-02 + FUP-02: Upsert atômico por numero.
   * - INSERT se numero não existe — cria lead com uniqueId e nome fornecidos.
   * - UPDATE se numero já existe — atualiza nome e updatedAt; uniqueId NUNCA é sobrescrito.
   * - Phase 25: Se brainType fornecido E lead novo, consulta fup_config e ativa fup_enabled automaticamente.
   *
   * @param numero - Número do WhatsApp/CRM (chave única de identificação)
   * @param uniqueId - IDLead do payload (gerado pela integração, nunca sobrescrito no update)
   * @param nome - Nome opcional do lead (vem de event.Name)
   * @param brainType - Brain type para consultar fup_config e ativar FUP automaticamente (opcional)
   */
  async upsertLead(numero: string, uniqueId: string, nome?: string, brainType?: string): Promise<Lead> {
    // Step 1: Check if lead already exists (D-03: UPDATE never changes fupEnabled)
    const existing = await this.db
      .select()
      .from(leads)
      .where(eq(leads.numero, numero))
      .limit(1);

    const isInsert = !existing[0];

    // Step 2: Query fup_config only on INSERT with brainType (D-02, D-04)
    let fupEnabled = false; // default per leads table schema
    if (isInsert && brainType) {
      const configRows = await this.db
        .select({ enabled: fupConfig.enabled })
        .from(fupConfig)
        .where(eq(fupConfig.brainType, brainType))
        .limit(1);

      // D-02: activate FUP only if config exists AND enabled = true
      // D-04: silent when config missing — no warning, just default to false
      if (configRows[0]?.enabled === true) {
        fupEnabled = true;
      }
    }

    // Step 3: Upsert with fupEnabled (only affects INSERT)
    const rows = await this.db
      .insert(leads)
      .values({
        numero,
        uniqueId,
        nome: nome ?? null,
        fupEnabled, // only used on INSERT; default (false) when UPDATE path
      })
      .onConflictDoUpdate({
        target: leads.numero,
        set: {
          // LEAD-02: uniqueId ausente do set — nunca sobrescrito após primeiro insert
          // D-03: fupEnabled ausente do set — preserva valor atual no UPDATE
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

  /**
   * TOOLS-STD-01: Atualiza leads.fullpp por uniqueId.
   * Usado por createPauseSessionTool (pause_session).
   *
   * @param uniqueId - lead.uniqueId (IDLead canonical = thread_id do BrainRunner)
   * @param value - novo valor de fullpp
   */
  async setFullpp(uniqueId: string, value: boolean): Promise<void> {
    await this.db
      .update(leads)
      .set({ fullpp: value, updatedAt: new Date() })
      .where(eq(leads.uniqueId, uniqueId));
  }

  /**
   * TOOLS-STD-02: Atualiza leads.iaAtivada por uniqueId.
   * Usado para atualização avulsa de iaAtivada fora do contexto de tool.
   * Nota: finish_conversation faz update atômico direto — este método é para uso avulso.
   *
   * @param uniqueId - lead.uniqueId (IDLead canonical = thread_id do BrainRunner)
   * @param value - novo valor de iaAtivada
   */
  async setIaAtivada(uniqueId: string, value: boolean): Promise<void> {
    await this.db
      .update(leads)
      .set({ iaAtivada: value, updatedAt: new Date() })
      .where(eq(leads.uniqueId, uniqueId));
  }

  /**
   * FUP-06: Atualiza last_message_at do lead para NOW() por uniqueId.
   * Chamado por BrainRunner.run() ANTES do gate ia_ativada — FUP-06 exige
   * atualização a cada mensagem recebida, inclusive quando ia_ativada=false.
   *
   * D-11: last_message_at é DISTINTO de updatedAt — rastreia especificamente
   * quando o humano enviou mensagem (não mudanças programáticas como setIaAtivada).
   * Por isso NÃO incluímos updatedAt no set desta operação.
   *
   * @param uniqueId - lead.uniqueId (IDLead canonical = thread_id do BrainRunner)
   */
  async touchLastMessage(uniqueId: string): Promise<void> {
    await this.db
      .update(leads)
      .set({ lastMessageAt: new Date() })
      .where(eq(leads.uniqueId, uniqueId));
  }

  /**
   * FUP-06 / D-19: Reseta o estado de FUP quando o lead responde.
   * Seta fup_next_at = NULL e fup_step = 0.
   * fup_enabled permanece true — lead continua elegível para novo ciclo se silenciar novamente.
   *
   * Chamado por BrainRunner.run() após touchLastMessage(), antes do gate ia_ativada.
   *
   * @param uniqueId - lead.uniqueId (IDLead canonical)
   */
  async resetFup(uniqueId: string): Promise<void> {
    await this.db
      .update(leads)
      // WR-02: updatedAt incluído para consistência com setFullpp() e setIaAtivada().
      // fupEnabled intencionalmente ausente — D-19: lead permanece elegível para novo ciclo.
      .set({ fupNextAt: null, fupStep: 0, updatedAt: new Date() })
      .where(eq(leads.uniqueId, uniqueId));
  }
}
