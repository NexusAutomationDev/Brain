// FUP-01 a FUP-08, EVT-03: FupScheduler — scheduler background para follow-ups automáticos
// D-04: Ciclo de vida gerenciado pelo BrainRunner (init/close)
// D-05: FUP_POLL_INTERVAL_MS ENV (default 30000ms)
// D-06: sql injetado pelo BrainRunner (mesmo pool)
// D-07: SELECT FOR UPDATE OF l SKIP LOCKED — concorrência segura
// T-22-03: Logar apenas lead.uniqueId em warns — nunca conteúdo de mensagem (PII)
// T-22-04: Logar apenas hasFupUrl: true no init — nunca a URL completa

import type { Sql } from "postgres";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { createLLM } from "@brain-pkg/ai";
import { createLogger } from "@brain-pkg/observability";
import type { IEventPublisher, ToolEvent } from "../events/event-publisher.js";

// Interface local para o checkpointer — evita dependência direta de
// @langchain/langgraph-checkpoint-postgres no packages/core (dependência transitiva via @brain-pkg/ai).
// Descreve apenas o método getTuple usado pelo FupScheduler.
export interface ICheckpointerLike {
  getTuple(config: { configurable: { thread_id: string } }): Promise<CheckpointTupleLike | undefined>;
}

interface CheckpointTupleLike {
  checkpoint?: {
    channel_values?: Record<string, unknown>;
  };
}

// Constantes de módulo — configuráveis futuramente via ENV (D-05, D-15)
const FUP_POLL_INTERVAL_MS = parseInt(process.env.FUP_POLL_INTERVAL_MS ?? "30000", 10);
const BATCH_SIZE = 10;
const MAX_FUP_ATTEMPTS = 3;
const MAX_FUP_FAILURES = 3;
// Intervalo temporário para marcar lead "em processamento" dentro da transação curta.
// Garante que outra instância não selecione o mesmo lead enquanto LLM + HTTP rodam fora da tx.
const FUP_PROCESSING_LOCK_MINUTES = 10;

export interface IFupScheduler {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface FupSchedulerOptions {
  sql: Sql;
  brainType: string;
  checkpointer: ICheckpointerLike;
  eventPublisher: IEventPublisher | null;  // D-18: injetável; null = sem publicação
  fupWebhookUrl: string;  // D-01: obrigatório — caller verifica presença antes de construir
}

export class FupScheduler implements IFupScheduler {
  private readonly logger = createLogger();
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: FupSchedulerOptions) {}

  async start(): Promise<void> {
    // T-22-04: logar apenas presença da URL, nunca a URL completa (pode conter credenciais)
    this.logger.info(
      { brainType: this.opts.brainType, hasFupUrl: true },
      "FupScheduler started"
    );
    // D-05: setInterval com FUP_POLL_INTERVAL_MS; bind para garantir contexto correto
    this.intervalId = setInterval(() => {
      this._tick().catch((err: unknown) => {
        this.logger.error({ err }, "FupScheduler tick falhou inesperadamente");
      });
    }, FUP_POLL_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.logger.info({}, "FupScheduler stopped");
  }

  /** Exportada para testes — não chamada diretamente pelo caller externo */
  async _tick(): Promise<void> {
    // D-07 / Pitfall 4: SELECT FOR UPDATE OF l SKIP LOCKED DEVE estar dentro de sql.begin().
    // Sem transação, o PostgreSQL libera o lock imediatamente após o SELECT — duas instâncias
    // simultâneas podem selecionar o mesmo lead no mesmo ciclo e enviar FUP duplicado (viola FUP-02).
    //
    // Abordagem de duas transações (RESEARCH.md Pitfall 4, Open Questions 3 RESOLVED):
    //   Tx 1 (curta): SELECT FOR UPDATE SKIP LOCKED + UPDATE imediato de fup_next_at para
    //         NOW() + 10min — marca o lead como "em processamento" e fecha o lock.
    //         Outra instância não verá este lead (fup_next_at > NOW()) até o UPDATE final.
    //   Fora da Tx: LLM one-shot + HTTP POST (I/O lento — não pode bloquear o pool).
    //   Tx 2 (curta): UPDATE definitivo com fup_next_at calculado, fup_step incrementado, etc.

    let rows: FupLeadRow[] = [];
    try {
      rows = await this.opts.sql.begin(async (tx) => {
        const selected = await tx`
          SELECT
            l.id,
            l.unique_id AS "uniqueId",
            l.nome,
            l.numero,
            l.fup_step AS "fupStep",
            l.fup_next_at AS "fupNextAt",
            l.fup_failure_count AS "fupFailureCount",
            l.ia_ativada AS "iaAtivada",
            l.fup_enabled AS "fupEnabled",
            fc.intervals_seconds AS "intervalsSeconds",
            fc.min_hour AS "minHour",
            fc.max_hour AS "maxHour",
            fc.allowed_days AS "allowedDays",
            fc.timezone
          FROM leads l
          JOIN fup_config fc ON fc.brain_type = ${this.opts.brainType}
          WHERE l.fup_enabled = true
            AND l.ia_ativada = true
            AND l.fup_next_at <= NOW()
            AND l.fup_step < array_length(fc.intervals_seconds, 1)
            AND fc.enabled = true
            AND l.fup_failure_count < ${MAX_FUP_FAILURES}
          LIMIT ${BATCH_SIZE}
          FOR UPDATE OF l SKIP LOCKED
        ` as FupLeadRow[];

        if (selected.length > 0) {
          // Marcar imediatamente como "em processamento" — impede seleção por outras instâncias
          // enquanto LLM + HTTP rodam fora desta transação.
          const uniqueIds = selected.map((r) => r.uniqueId);
          await tx`
            UPDATE leads
            SET fup_next_at = NOW() + INTERVAL '${tx.unsafe(String(FUP_PROCESSING_LOCK_MINUTES))} minutes',
                updated_at = NOW()
            WHERE unique_id = ANY(${uniqueIds})
          `;
        }

        return selected;
      }) as FupLeadRow[];
    } catch (err: unknown) {
      this.logger.error({ err }, "FupScheduler: falha ao buscar/marcar leads elegíveis");
      return;
    }

    for (const row of rows) {
      await this._processFupForLead(row);
    }
  }

  async _processFupForLead(lead: FupLeadRow): Promise<void> {
    // D-11: buscar prompt 'fup' do banco
    const promptRows = await this.opts.sql`
      SELECT content FROM prompts
      WHERE brain_type = ${this.opts.brainType}
        AND key = 'fup'
      LIMIT 1
    `.catch(() => [] as { content: string }[]) as { content: string }[];

    if (!promptRows[0]) {
      // D-13: sem fallback; loga warn e pula
      this.logger.warn(
        { brainType: this.opts.brainType, uniqueId: lead.uniqueId },
        "FupScheduler: prompt key='fup' não encontrado — pulando lead (D-13)"
      );
      return;
    }

    const fupPrompt = promptRows[0].content;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= MAX_FUP_ATTEMPTS; attempt++) {
      try {
        // D-12: LLM one-shot via getTuple
        const message = await this._generateFupMessage(lead, fupPrompt);
        // D-01: POST para FUP_WEBHOOK_URL com payload { Name, Numero, Message, IDLead }
        await this._sendFupWebhook(lead, message);

        // Sucesso: calcular próximo slot e atualizar banco (Tx 2 — UPDATE definitivo)
        const nextFupStep = lead.fupStep + 1;
        const isLastFup = nextFupStep >= lead.intervalsSeconds.length;

        if (isLastFup) {
          // D-10: último FUP — desativar ia e fup
          await this.opts.sql`
            UPDATE leads SET
              fup_step = ${nextFupStep},
              fup_next_at = NULL,
              fup_failure_count = 0,
              ia_ativada = false,
              fup_enabled = false,
              updated_at = NOW()
            WHERE unique_id = ${lead.uniqueId}
          `;
          this.logger.info(
            { uniqueId: lead.uniqueId, step: nextFupStep },
            "FupScheduler: último FUP enviado — ia_ativada=false, fup_enabled=false (D-10/FUP-05)"
          );
        } else {
          // D-09: avançar step e calcular próximo slot válido (FUP-07)
          const intervalMs =
            (lead.intervalsSeconds[nextFupStep] ??
              lead.intervalsSeconds[lead.intervalsSeconds.length - 1]!) * 1000;
          const rawNextAt = new Date(Date.now() + intervalMs);
          const nextAt = getNextValidSlot(
            rawNextAt,
            lead.minHour,
            lead.maxHour,
            lead.allowedDays,
            lead.timezone
          );

          await this.opts.sql`
            UPDATE leads SET
              fup_step = ${nextFupStep},
              fup_next_at = ${nextAt.toISOString()},
              fup_failure_count = 0,
              updated_at = NOW()
            WHERE unique_id = ${lead.uniqueId}
          `;
        }

        // D-16, EVT-03: publicar evento fire-and-forget
        if (this.opts.eventPublisher) {
          const fupEvent: ToolEvent = {
            event_id: `${lead.uniqueId}:fup:${lead.fupStep}`,  // D-17: idempotente por step
            action: "fup",
            lead: { id: lead.uniqueId, nome: lead.nome ?? null, numero: lead.numero },
            result: JSON.stringify({ step: lead.fupStep, message }),
            timestamp: new Date().toISOString(),
          };
          this.opts.eventPublisher.publish([fupEvent]).catch((err: unknown) => {
            // T-22-03: logar apenas eventId, nunca conteúdo da mensagem (PII)
            this.logger.warn(
              { err, eventId: fupEvent.event_id },
              "FUP EVT-03 publish falhou — ignorando"
            );
          });
        }

        return;  // sucesso — sair do loop de tentativas
      } catch (err) {
        lastErr = err;
        // T-22-03: logar apenas uniqueId, nunca conteúdo da mensagem gerada
        this.logger.warn(
          { err, uniqueId: lead.uniqueId, attempt },
          "FupScheduler: tentativa de FUP falhou"
        );
        // WR-04: delay de 1s fixo entre tentativas — evita thundering herd de 30 calls
        // simultâneos ao LLM em cenário de falha (BATCH_SIZE=10 × 3 retries).
        // Backoff exponencial adiado para FUP-F01.
        if (attempt < MAX_FUP_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    // D-14: falhou MAX_FUP_ATTEMPTS vezes — incrementar fup_failure_count
    const newCount = (lead.fupFailureCount ?? 0) + 1;
    if (newCount >= MAX_FUP_FAILURES) {
      await this.opts.sql`
        UPDATE leads SET
          fup_failure_count = ${newCount},
          fup_enabled = false,
          updated_at = NOW()
        WHERE unique_id = ${lead.uniqueId}
      `;
      // D-14: logger.error quando atinge limite
      this.logger.error(
        { uniqueId: lead.uniqueId, failures: newCount, err: lastErr },
        "FupScheduler: FUP falhou 3 vezes — fup_enabled=false (D-14/FUP-08)"
      );
    } else {
      await this.opts.sql`
        UPDATE leads SET
          fup_failure_count = ${newCount},
          updated_at = NOW()
        WHERE unique_id = ${lead.uniqueId}
      `;
    }
  }

  async _generateFupMessage(lead: FupLeadRow, fupPrompt: string): Promise<string> {
    // D-12: recuperar histórico via getTuple (sem invocar o grafo completo)
    const tuple = await this.opts.checkpointer.getTuple({
      configurable: { thread_id: lead.uniqueId },
    });
    // Pitfall 3: getTuple pode retornar undefined para leads sem conversa
    const messages: BaseMessage[] =
      (tuple?.checkpoint?.channel_values?.messages as BaseMessage[] | undefined) ?? [];

    // Janela de contexto: últimas 10 mensagens
    const recentMessages = messages.slice(-10);

    const llm = await createLLM();
    const response = await llm.invoke([
      new SystemMessage(fupPrompt),
      ...recentMessages,
      new HumanMessage("Gere uma mensagem de follow-up personalizada para este lead."),
    ]);

    return typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);
  }

  private async _sendFupWebhook(lead: FupLeadRow, message: string): Promise<void> {
    // D-01: payload igual ao formato do webhook de entrada (BrainEventSchema)
    // D-03: sem autenticação — endpoint privado do operador
    const payload = {
      Name: lead.nome ?? "",
      Numero: lead.numero,
      Message: message,
      IDLead: lead.uniqueId,
    };
    const response = await fetch(this.opts.fupWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),  // mesmo timeout do EventPublisher (T-20-05)
    });
    if (!response.ok) {
      throw new Error(
        `FUP webhook retornou ${response.status} para lead ${lead.uniqueId}`
      );
    }
  }
}

/** Tipo interno — linha retornada pela query de elegibilidade */
interface FupLeadRow {
  id: string;
  uniqueId: string;
  nome: string | null;
  numero: string;
  fupStep: number;
  fupNextAt: Date | null;
  fupFailureCount: number;
  iaAtivada: boolean;
  fupEnabled: boolean;
  intervalsSeconds: number[];
  minHour: number;
  maxHour: number;
  allowedDays: string[];
  timezone: string;
}

/**
 * FUP-07: Calcula o próximo slot de envio válido dado um horário inicial.
 * Avança hora a hora até encontrar slot dentro da janela permitida.
 * Exportada para permitir testes unitários isolados.
 *
 * @param from - Data de início para busca
 * @param minHour - Hora mínima permitida (0-23, inclusivo)
 * @param maxHour - Hora máxima permitida (0-23, exclusivo — ex: 18 = até 17:59)
 * @param allowedDays - Dias permitidos em lowercase inglês: 'mon','tue','wed','thu','fri','sat','sun'
 * @param timezone - IANA timezone string (ex: 'America/Sao_Paulo')
 */
export function getNextValidSlot(
  from: Date,
  minHour: number,
  maxHour: number,
  allowedDays: string[],
  timezone: string
): Date {
  const candidate = new Date(from);

  // Avançar até 14 dias (336 horas) — fallback se config inválida
  for (let i = 0; i < 14 * 24; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(candidate);

    const weekdayVal = parts.find((p) => p.type === "weekday")?.value?.toLowerCase();
    const hourRaw = parts.find((p) => p.type === "hour")?.value ?? "0";
    // Pitfall 2: Intl retorna '24' para meia-noite em alguns locales — normalizar
    const hour = parseInt(hourRaw, 10) % 24;

    if (weekdayVal && allowedDays.includes(weekdayVal) && hour >= minHour && hour < maxHour) {
      return candidate;
    }

    // Avançar 1 hora
    candidate.setTime(candidate.getTime() + 3_600_000);
  }

  // Fallback: config inválida (sem dias permitidos ou janela impossível) — retornar +24h
  return new Date(from.getTime() + 86_400_000);
}
