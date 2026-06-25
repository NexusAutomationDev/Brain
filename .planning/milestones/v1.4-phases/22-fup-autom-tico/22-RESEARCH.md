# Phase 22: FUP Automático - Research

**Researched:** 2026-06-23
**Domain:** Scheduler background, LLM one-shot, SELECT FOR UPDATE SKIP LOCKED, timezone IANA, retry com failure_count
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Canal de Saída do FUP**
- D-01: Canal de entrega é `FUP_WEBHOOK_URL` ENV — scheduler faz POST para esta URL com payload `{ Name, Numero, Message, IDLead }` (mesmo formato do webhook de entrada).
- D-02: Se `FUP_WEBHOOK_URL` estiver ausente na inicialização, o FupScheduler não inicia — silencioso, sem erro de startup.
- D-03: Sem autenticação no POST para `FUP_WEBHOOK_URL` — endpoint privado/interno do operador.

**Localização e Ciclo de Vida do FupScheduler**
- D-04: `FupScheduler` é inicializado dentro de `BrainRunner.init()` e parado em `BrainRunner.close()`.
- D-05: Intervalo de polling configurável via ENV `FUP_POLL_INTERVAL_MS` (default: `30000`).
- D-06: `FupScheduler` recebe o `sql` injetado no BrainRunner — reutiliza a conexão existente.
- D-07: Concorrência: query usa `SELECT ... FOR UPDATE SKIP LOCKED`. Instâncias que perdem pulsam silenciosamente.

**Elegibilidade e Processamento de FUP**
- D-08: Lead elegível quando: `fup_enabled = true` AND `ia_ativada = true` AND `fup_next_at <= NOW()` AND `fup_step < len(intervals_seconds)`. Filtro adicional: `fup_config.enabled = true` para o `brain_type`.
- D-09: Ao processar: incrementar `fup_step`, calcular próximo `fup_next_at` respeitando janela de horário/dias. Se fora da janela: agendar para próximo slot válido.
- D-10: Último FUP: após envio bem-sucedido, setar `ia_ativada = false` AND `fup_enabled = false`.

**Prompt e Geração de Conteúdo (FUP-03)**
- D-11: Prompt FUP vem da tabela `prompts` com `key = 'fup'` para o `brain_type`.
- D-12: Chamada LLM one-shot via `PostgresSaver.getTuple(thread_id)` — recupera mensagens do lead; sem invocar grafo completo.
- D-13: Se `key='fup'` não existir, loga `logger.warn` e pula o lead sem processar. Sem fallback hardcoded.

**Resiliência e Retry (FUP-08)**
- D-14: `fup_failure_count integer NOT NULL DEFAULT 0` — nova coluna na tabela `leads`. Incrementar a cada falha. Se `>= 3`, setar `fup_enabled = false` e logar `logger.error`. Reset a cada FUP bem-sucedido.
- D-15: Retry imediato dentro do mesmo tick: até 3 tentativas com backoff simples.

**EVT-03 — Evento de FUP via EventPublisher**
- D-16: Ao enviar FUP com sucesso, `eventPublisher.publish([fupEvent])` fire-and-forget.
- D-17: Estrutura do evento FUP (EVT-03): `{ event_id: "${lead.uniqueId}:fup:${fup_step}", action: "fup", lead: { id, nome, numero }, result: { step, message }, timestamp }`.
- D-18: `FupScheduler` recebe `eventPublisher: IEventPublisher | null` no construtor — injetável para testes.

**FUP-06 — Cancelamento ao Receber Mensagem**
- D-19: `BrainRunner.run()` chama `LeadService.resetFup(uniqueId)` que seta `fup_next_at = NULL` e `fup_step = 0`. `fup_enabled` permanece `true`.

### Claude's Discretion

- Localização exata: `packages/core/src/fup/fup-scheduler.ts`
- Nome da coluna de retry: `fup_failure_count`
- Estrutura interna do tick (batch size, limite de leads por tick)
- LLM provider para chamada one-shot do FUP (reutilizar `createLLM()` do BrainRunner)
- Formato exato do payload POST para `FUP_WEBHOOK_URL`

### Deferred Ideas (OUT OF SCOPE)

- `FUP_REPLY_QUEUE` (RabbitMQ dedicado para saída de FUP)
- Autenticação no POST para FUP_WEBHOOK_URL
- Backoff exponencial no retry de FUP (FUP-F01)
- Dashboard de status de FUPs (FUP-F02)
- FUP por segmento de leads (FUP-F03)
- EVT-F01: retry com backoff exponencial no canal de eventos
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FUP-01 | Configuração de FUP em tabela `fup_config` — não em ENV | Schema já existe em 0007_v1_4_foundation.sql: `fup_config` com brain_type PK, intervals_seconds[], min_hour, max_hour, allowed_days[], timezone |
| FUP-02 | Scheduler com SELECT FOR UPDATE SKIP LOCKED para múltiplas instâncias | postgres.js tagged template suporta literais SQL arbitrários; padrão `FOR UPDATE NOWAIT` já usado em migrate.ts — SKIP LOCKED é sintaxe idêntica |
| FUP-03 | Conteúdo gerado por LLM one-shot usando histórico via PostgresSaver.getTuple | `getCheckpoint()` em packages/memory/src/short-term.ts já usa `checkpointer.getTuple({ configurable: { thread_id } })`; `channel_values.messages` contém histórico |
| FUP-05 | Ao enviar último FUP: `ia_ativada = false` e `fup_enabled = false` | LeadService já tem `setIaAtivada()`; `fupEnabled` está em Drizzle schema; update atômico via drizzle `.update().set()` |
| FUP-06 | BrainRunner.run() cancela FUPs pendentes ao receber mensagem | `touchLastMessage()` já existe; novo método `resetFup()` segue padrão idêntico |
| FUP-07 | Se janela não permitir envio, agendar para próximo slot válido | `Intl.DateTimeFormat.formatToParts()` com timeZone extrai hora e weekday em qualquer IANA tz; loop de avanço hora a hora até encontrar slot válido |
| FUP-08 | Re-tentar até 3 vezes antes de marcar falha | Padrão de `retryMap` do RabbitMQTransport adaptado; nova coluna `fup_failure_count` via nova migration |
</phase_requirements>

---

## Summary

A Phase 22 constrói o `FupScheduler` — um scheduler background que roda dentro do ciclo de vida do `BrainRunner` e envia follow-ups personalizados via LLM para leads silenciosos. Toda a infraestrutura de suporte (schema de banco, EventPublisher, LeadService, createLLM, PostgresSaver) já está implementada nas fases anteriores. Esta fase é principalmente de montagem e integração.

O domínio técnico central é: polling periódico com locking pessimista (`SELECT FOR UPDATE SKIP LOCKED`), geração de texto one-shot com LLM, cálculo de slot válido por timezone IANA com `Intl.DateTimeFormat`, retry com contador persistente no banco, e publicação de eventos fire-and-forget via EventPublisher existente.

Uma única migration nova é necessária para adicionar a coluna `fup_failure_count` à tabela `leads` — não incluída na migration 0007 porque foi decidida em CONTEXT.md como nova coluna desta fase.

**Primary recommendation:** Implementar `FupScheduler` em `packages/core/src/fup/fup-scheduler.ts` seguindo exatamente o padrão de ciclo de vida do `EventPublisher` (campo `private | null`, init condicional, close em `BrainRunner.close()`). Usar postgres.js tagged template diretamente para o SELECT FOR UPDATE SKIP LOCKED — Drizzle ORM não suporta esta cláusula nativamente.

---

## Standard Stack

### Core (já disponível no projeto)

| Library | Versão | Propósito | Por que usar |
|---------|--------|-----------|--------------|
| `postgres` (postgres.js) | instalada | Raw SQL para SELECT FOR UPDATE SKIP LOCKED | Drizzle não suporta SKIP LOCKED; tagged template é o padrão já usado em migrate.ts |
| `drizzle-orm` | 0.45.x | Updates do banco (fup_step, fup_next_at, etc.) | Padrão do projeto para operações Drizzle |
| `@langchain/langgraph-checkpoint-postgres` | 1.0.x | `getTuple()` para histórico da conversa | Já usado via packages/memory; FupScheduler acessa checkpointer diretamente |
| `@brain-pkg/ai` (`createLLM`) | local | Instância de LLM para geração one-shot do FUP | Mesma factory usada pelo BrainRunner — zero nova dependência |
| `@brain-pkg/observability` (`createLogger`) | local | Logging estruturado | Padrão pino do projeto |
| `Intl.DateTimeFormat` (built-in) | Bun 1.x | Cálculo de hora/dia em timezone IANA | Disponível em Bun 1.3.2; sem dependência externa necessária |

### Sem dependências novas

Esta fase **não requer instalação de nenhum novo pacote**. Todo o stack necessário já está instalado:
- Timezone: `Intl.DateTimeFormat` (built-in, verificado em Bun 1.3.2) [VERIFIED: Bash test]
- HTTP para FUP_WEBHOOK_URL: `fetch` (built-in Bun)
- Banco: postgres.js + drizzle-orm (já instalados)
- LLM: `@brain-pkg/ai` createLLM (local)
- Eventos: `IEventPublisher` (local, Phase 20)

---

## Architecture Patterns

### Estrutura de arquivos a criar

```
packages/core/src/
├── fup/
│   ├── fup-scheduler.ts        # classe FupScheduler + IFupScheduler interface
│   └── __tests__/
│       └── unit/
│           └── fup-scheduler.test.ts   # testes unitários com mocks
packages/database/src/migrations/
└── 0008_fup_failure_count.sql   # ADD COLUMN fup_failure_count
```

### Arquivos existentes a modificar

```
packages/core/src/
├── runner/runner.ts             # integrar FupScheduler no ciclo de vida
├── leads/lead-service.ts        # adicionar resetFup()
├── index.ts                     # barrel export FupScheduler, IFupScheduler
packages/database/src/
├── schema/tables.ts             # adicionar fupFailureCount ao schema leads
```

### Pattern 1: Ciclo de Vida do FupScheduler no BrainRunner

**O que é:** FupScheduler como dependência opcional de ciclo de vida igual ao EventPublisher.

**Exemplo:** [VERIFIED: packages/core/src/runner/runner.ts]

```typescript
// Em BrainRunner:
private fupScheduler: FupScheduler | null = null;

// Em init(), após inicializar eventPublisher:
const fupWebhookUrl = process.env.FUP_WEBHOOK_URL?.trim();
if (fupWebhookUrl) {
  this.fupScheduler = new FupScheduler({
    sql: this.sql,
    brainType: this.brain.brainType,
    checkpointer,           // o mesmo criado em _compileGraph()
    eventPublisher: this.eventPublisher,
    fupWebhookUrl,
  });
  await this.fupScheduler.start();
}

// Em close():
if (this.fupScheduler) {
  await this.fupScheduler.stop();
  this.fupScheduler = null;
}
```

**Problema de acesso ao checkpointer:** O checkpointer é criado em `_compileGraph()` como variável local. Para injetar no FupScheduler, o `checkpointer` precisa ser salvo como campo privado do BrainRunner.

```typescript
// Adicionar em BrainRunner:
private checkpointer: PostgresSaver | null = null;

// Em _compileGraph():
this.checkpointer = await createCheckpointer(dbUrl);
```

### Pattern 2: SELECT FOR UPDATE SKIP LOCKED via postgres.js tagged template

**O que é:** Lock pessimista para evitar que múltiplas instâncias enviem o mesmo FUP.

**Referência:** [VERIFIED: packages/database/src/migrate.ts linha 51 — FOR UPDATE NOWAIT]

```typescript
// FupScheduler._tick() — dentro de sql.begin()
async _tick(): Promise<void> {
  await this.sql.begin(async (tx) => {
    // Buscar leads elegíveis e travar atomicamente
    const rows = await tx`
      SELECT l.*, fc.intervals_seconds, fc.min_hour, fc.max_hour,
             fc.allowed_days, fc.timezone
      FROM leads l
      JOIN fup_config fc ON fc.brain_type = ${this.brainType}
      WHERE l.fup_enabled = true
        AND l.ia_ativada = true
        AND l.fup_next_at <= NOW()
        AND l.fup_step < array_length(fc.intervals_seconds, 1)
        AND fc.enabled = true
        AND l.fup_failure_count < 3
      LIMIT ${BATCH_SIZE}
      FOR UPDATE OF l SKIP LOCKED
    `;
    
    for (const row of rows) {
      await this._processFupForLead(tx, row);
    }
  });
}
```

**Importante:** `FOR UPDATE OF l SKIP LOCKED` — o `OF l` especifica qual tabela travar quando há JOIN.

### Pattern 3: Cálculo de Próximo Slot Válido (FUP-07)

**O que é:** `Intl.DateTimeFormat.formatToParts()` extrai hora e dia da semana em timezone IANA.

**Referência:** [VERIFIED: Bash — `new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(date)` retorna `[{type:'weekday',value:'Tue'},{type:'hour',value:'19'}]`]

```typescript
function getNextValidSlot(
  from: Date,
  minHour: number,
  maxHour: number,
  allowedDays: string[],   // ['mon','tue','wed','thu','fri']
  timezone: string
): Date {
  const candidate = new Date(from);
  
  // Avançar por slots de 1 hora até encontrar janela válida (max 14 dias)
  for (let i = 0; i < 14 * 24; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(candidate);
    
    const weekday = parts.find(p => p.type === 'weekday')?.value?.toLowerCase(); // 'mon', 'tue'...
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
    
    if (allowedDays.includes(weekday!) && hour >= minHour && hour < maxHour) {
      return candidate;
    }
    
    candidate.setTime(candidate.getTime() + 3600_000); // +1 hora
  }
  
  // Fallback: não encontrou slot em 14 dias — retornar +24h (nunca deve acontecer com config válida)
  return new Date(from.getTime() + 86400_000);
}
```

**Pitfall de timezone:** `Intl.DateTimeFormat` com `hour12: false` retorna `'24'` para meia-noite em alguns locales. Normalizar para 0: `hour === 24 ? 0 : hour`.

### Pattern 4: Geração de Conteúdo LLM One-Shot (FUP-03)

**O que é:** Recuperar histórico via `checkpointer.getTuple()` e invocar LLM diretamente sem passar pelo grafo.

**Referência:** [VERIFIED: packages/memory/src/short-term.ts — `checkpointer.getTuple({ configurable: { thread_id: threadId } })`]

```typescript
// FupScheduler._generateFupMessage()
async _generateFupMessage(
  lead: LeadRow,
  fupPrompt: string,
  checkpointer: PostgresSaver
): Promise<string> {
  const threadId = lead.uniqueId;
  
  // Recuperar histórico da conversa
  const tuple = await checkpointer.getTuple({ configurable: { thread_id: threadId } });
  const messages: BaseMessage[] = (tuple?.checkpoint?.channel_values?.messages as BaseMessage[]) ?? [];
  
  // Montar contexto: últimas N mensagens (janela de contexto — ex: últimas 10)
  const recentMessages = messages.slice(-10);
  
  // Chamada LLM one-shot: system = fupPrompt, messages = histórico + instrução
  const llm = await createLLM();
  const response = await llm.invoke([
    new SystemMessage(fupPrompt),
    ...recentMessages,
    new HumanMessage("Gere uma mensagem de follow-up personalizada para este lead."),
  ]);
  
  return typeof response.content === 'string' 
    ? response.content 
    : JSON.stringify(response.content);
}
```

**Nota:** `channel_values` é `Record<string, unknown>` — cast explícito para `BaseMessage[]` é necessário.

### Pattern 5: Retry com fup_failure_count (FUP-08)

**O que é:** Contador persistente no banco — diferente do retryMap in-memory do RabbitMQTransport.

**Por que persistente:** O scheduler pode travar, reiniciar ou ter múltiplas instâncias. Contador in-memory seria perdido. O `fup_failure_count` no banco sobrevive a restarts.

```typescript
// FupScheduler._processFupForLead() — lógica de retry
async _processFupForLead(tx: TransactionSql, lead: LeadRow): Promise<void> {
  let lastErr: unknown;
  
  for (let attempt = 1; attempt <= MAX_FUP_ATTEMPTS; attempt++) {
    try {
      const message = await this._generateFupMessage(lead, fupPrompt, this.checkpointer);
      await this._sendFupWebhook(lead, message);
      
      // Sucesso: reset failure_count, avançar step, calcular próximo slot
      await tx`
        UPDATE leads SET
          fup_step = ${lead.fupStep + 1},
          fup_next_at = ${nextAt},
          fup_failure_count = 0,
          updated_at = NOW()
        WHERE unique_id = ${lead.uniqueId}
      `;
      
      // Publicar EVT-03
      this.eventPublisher?.publish([fupEvent]).catch(() => {});
      return;
    } catch (err) {
      lastErr = err;
      this.logger.warn({ err, uniqueId: lead.uniqueId, attempt }, 'FUP attempt failed');
      // retry simples sem delay (D-15: backoff simples para v1.4)
    }
  }
  
  // Falhou 3x: incrementar fup_failure_count no banco
  const newCount = (lead.fupFailureCount ?? 0) + 1;
  if (newCount >= MAX_FUP_FAILURES) {
    // Desativar FUP permanentemente para este lead
    await tx`
      UPDATE leads SET
        fup_failure_count = ${newCount},
        fup_enabled = false,
        updated_at = NOW()
      WHERE unique_id = ${lead.uniqueId}
    `;
    this.logger.error({ uniqueId: lead.uniqueId, failures: newCount, lastErr }, 'FUP falhou 3 vezes — desativando');
  } else {
    await tx`
      UPDATE leads SET fup_failure_count = ${newCount}, updated_at = NOW()
      WHERE unique_id = ${lead.uniqueId}
    `;
  }
}
```

### Pattern 6: LeadService.resetFup() (FUP-06)

**O que é:** Reset do estado de FUP quando lead responde.

**Referência:** [VERIFIED: packages/core/src/leads/lead-service.ts — padrão de `touchLastMessage()` e `setIaAtivada()`]

```typescript
// Adicionar em LeadService:
async resetFup(uniqueId: string): Promise<void> {
  await this.db
    .update(leads)
    .set({ fupNextAt: null, fupStep: 0 })  // fupEnabled permanece true
    .where(eq(leads.uniqueId, uniqueId));
}
```

### Anti-Patterns a Evitar

- **FOR UPDATE sem SKIP LOCKED em múltiplas instâncias:** Causa deadlock ou espera indefinida. Sempre usar SKIP LOCKED para o scheduler — instâncias que não obtêm o lock pulam silenciosamente.
- **Retry in-memory para failure_count:** O contador seria perdido em restart. Usar `fup_failure_count` persistido no banco.
- **Invocar o grafo LangGraph completo para gerar FUP:** O grafo executa o fluxo inteiro do Brain (tools, routing, etc.). FUP é one-shot — usar `llm.invoke()` diretamente com histórico.
- **Await na publicação de EVT-03:** Deve ser fire-and-forget (`publish(...).catch(() => {})`) — nunca bloquear o tick do scheduler.
- **Criar nova instância do checkpointer no FupScheduler:** Checkpointer usa conexão pg separada. Reutilizar a instância criada em `_compileGraph()` via campo `private checkpointer`.
- **Usar `setInterval` em Bun sem `clearInterval` no stop():** Vazar timer causa problemas em testes e shutdown limpo. Armazenar o timer ID e chamar `clearInterval` em `stop()`.

---

## Don't Hand-Roll

| Problema | Não construir | Usar ao invés | Por que |
|----------|---------------|----------------|---------|
| Timezone awareness | Biblioteca de datas própria | `Intl.DateTimeFormat.formatToParts()` (built-in) | Disponível em Bun 1.x sem deps; suporta todos os timezones IANA |
| LLM client para FUP | Client LLM separado | `createLLM()` de `@brain-pkg/ai` | Reutiliza pool de conexão, configuração de provider, mesma factory |
| Acesso ao histórico | Query manual nas tabelas checkpoint | `checkpointer.getTuple()` | API oficial da LangGraph; evita acoplar ao schema interno do PostgresSaver |
| Lock de concorrência | Controle via Redis/flag em banco | `SELECT FOR UPDATE SKIP LOCKED` | Nativo ao PostgreSQL; sem infra extra; já usado no projeto (migrate.ts) |
| Publicação de eventos | HTTP client próprio | `IEventPublisher` (Phase 20) | Interface já testada, suporta webhook e RabbitMQ, injetável para testes |

---

## Migration Necessária (fup_failure_count)

A coluna `fup_failure_count` foi decidida em CONTEXT.md D-14 mas **não está na migration 0007**. [VERIFIED: cat 0007_v1_4_foundation.sql — sem fup_failure_count]

Também o `fupFailureCount` não está no schema Drizzle `tables.ts`. [VERIFIED: cat packages/database/src/schema/tables.ts — tabela leads não tem fupFailureCount]

**Ação necessária — Wave 0 da Phase 22:**

1. Criar `packages/database/src/migrations/0008_fup_failure_count.sql`:
```sql
ALTER TABLE "leads" ADD COLUMN "fup_failure_count" integer DEFAULT 0 NOT NULL;
```

2. Atualizar `packages/database/src/schema/tables.ts` — adicionar campo `leads`:
```typescript
fupFailureCount: integer('fup_failure_count').notNull().default(0),
```

3. Atualizar `packages/database/src/migrations/meta/_journal.json` — nova entrada idx=8.

---

## Common Pitfalls

### Pitfall 1: `FOR UPDATE` sem `OF tabela` em query com JOIN

**O que vai errado:** `FOR UPDATE SKIP LOCKED` sem `OF l` em query que faz JOIN com `fup_config` causa erro PostgreSQL: "FOR UPDATE cannot be applied to the nullable side of an outer join" (ou tenta travar fup_config também).

**Por que acontece:** PostgreSQL requer especificar qual tabela travar quando há JOIN.

**Como evitar:** Sempre usar `FOR UPDATE OF l SKIP LOCKED` (onde `l` é o alias de `leads`).

**Sinal de alerta:** Erro PostgreSQL `55P03` ou `0A000` no log durante o tick do scheduler.

### Pitfall 2: `Intl.DateTimeFormat` retorna `'24'` para meia-noite

**O que vai errado:** Em alguns locales/engines, `hour12: false` retorna `'24'` para meia-noite em vez de `'0'`. Se `hour >= maxHour` com maxHour=18, e `hour === 24`, a comparação não funciona.

**Por que acontece:** Comportamento histórico do ECMA-402 — corrigido mas pode variar.

**Como evitar:** Normalizar: `const hour = parseInt(hourVal, 10) % 24;`

### Pitfall 3: `channel_values.messages` pode ser undefined para leads sem histórico

**O que vai errado:** Lead com `fup_enabled = true` mas sem conversa ainda (thread_id sem checkpoint) — `getTuple()` retorna `undefined`. Acesso a `.checkpoint.channel_values.messages` lança `TypeError`.

**Por que acontece:** Lead pode ter sido inserido com `fup_enabled = true` via seed/admin antes da primeira conversa.

**Como evitar:**
```typescript
const tuple = await checkpointer.getTuple({ configurable: { thread_id: threadId } });
const messages: BaseMessage[] = (tuple?.checkpoint?.channel_values?.messages as BaseMessage[]) ?? [];
```
Sempre usar optional chaining + fallback para array vazio.

### Pitfall 4: Tick do scheduler sem transação — condição de corrida entre instâncias

**O que vai errado:** Verificar elegibilidade e atualizar `fup_next_at` em operações separadas fora de uma transação — duas instâncias podem processar o mesmo lead.

**Por que acontece:** Sem transação, outra instância vê o lead como elegível entre o SELECT e o UPDATE.

**Como evitar:** Envolver toda a lógica do tick (`SELECT FOR UPDATE SKIP LOCKED` + UPDATE + envio) dentro de `sql.begin()`.

**Exceção:** O HTTP call para `FUP_WEBHOOK_URL` e a geração LLM **não podem** ficar dentro da transação (transações longas bloqueiam o pool). Abordagem: dentro da transação, marcar o lead como "em processamento" (ex: `fup_next_at = NOW() + 5min` temporariamente), fechar transação, fazer HTTP/LLM, abrir nova transação para commit final.

**Abordagem alternativa (mais simples para v1.4):** Fazer o SELECT FOR UPDATE SKIP LOCKED em uma transação curta apenas para obter os leads, processar fora da transação, e depois fazer UPDATE final. O SKIP LOCKED garante que apenas uma instância pega cada lead por polling cycle.

### Pitfall 5: `setInterval` vaza em testes sem `clearInterval`

**O que vai errado:** Testes de `FupScheduler.start()` que não chamam `stop()` deixam o interval ativo, causando falhas em outros testes ou timeout.

**Por que acontece:** `setInterval` continua rodando após o teste terminar.

**Como evitar:** Armazenar `private intervalId: ReturnType<typeof setInterval> | null = null;` e chamar `clearInterval(this.intervalId)` em `stop()`. Garantir `afterEach(() => scheduler.stop())` nos testes.

### Pitfall 6: Checkpointer precisa de campo privado no BrainRunner

**O que vai errado:** O checkpointer é criado como variável local em `_compileGraph()`. FupScheduler precisa da mesma instância (não criar nova — custo de conexão + setup).

**Por que acontece:** `createCheckpointer()` cria uma conexão `pg` separada e chama `setup()`. Criar outra instância duplica conexões.

**Como evitar:** Salvar `this.checkpointer = checkpointer` como campo privado do BrainRunner em `_compileGraph()` e injetar no `FupScheduler` em `init()`.

---

## Code Examples

### FupScheduler — estrutura da classe

```typescript
// Source: padrão de EventPublisher (packages/core/src/events/event-publisher.ts)
import type { Sql, TransactionSql } from "postgres";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { IEventPublisher, ToolEvent } from "../events/event-publisher.js";
import { createLLM } from "@brain-pkg/ai";
import { createLogger } from "@brain-pkg/observability";

const FUP_POLL_INTERVAL_MS = parseInt(process.env.FUP_POLL_INTERVAL_MS ?? "30000", 10);
const BATCH_SIZE = 10;
const MAX_FUP_ATTEMPTS = 3;
const MAX_FUP_FAILURES = 3;

export interface IFupScheduler {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class FupScheduler implements IFupScheduler {
  private readonly logger = createLogger();
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: {
    sql: Sql;
    brainType: string;
    checkpointer: PostgresSaver;
    eventPublisher: IEventPublisher | null;
    fupWebhookUrl: string;
  }) {}

  async start(): Promise<void> {
    this.logger.info({ brainType: this.opts.brainType }, "FupScheduler started");
    this.intervalId = setInterval(() => {
      this._tick().catch((err: unknown) => {
        this.logger.error({ err }, "FupScheduler tick failed unexpectedly");
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
}
```

### LeadService.resetFup() (FUP-06)

```typescript
// Source: padrão de touchLastMessage() em packages/core/src/leads/lead-service.ts
async resetFup(uniqueId: string): Promise<void> {
  await this.db
    .update(leads)
    .set({ fupNextAt: null, fupStep: 0 })
    .where(eq(leads.uniqueId, uniqueId));
}
```

### BrainRunner.run() — integração FUP-06

```typescript
// Source: packages/core/src/runner/runner.ts linha ~220
// Adicionar após touchLastMessage(), antes do gate ia_ativada:
await this.leadService.touchLastMessage(lead.uniqueId);
await this.leadService.resetFup(lead.uniqueId);  // FUP-06: cancelar FUPs pendentes
```

### Payload POST para FUP_WEBHOOK_URL

```typescript
// D-01: mesmo formato do webhook de entrada (BrainEventSchema)
// { Name, Numero, Message, IDLead }
const payload = {
  Name: lead.nome ?? "",
  Numero: lead.numero,
  Message: generatedMessage,
  IDLead: lead.uniqueId,
};
await fetch(this.opts.fupWebhookUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(5000),  // mesmo timeout do EventPublisher (T-20-05)
});
```

---

## State of the Art

| Abordagem Antiga | Abordagem Atual | Desde | Impacto |
|------------------|-----------------|-------|---------|
| Cron job externo (crontab, n8n) | Scheduler embutido no processo | Phase 22 | Sem infra extra; ciclo de vida gerenciado pelo BrainRunner |
| `Temporal.ZonedDateTime` (polyfill) | `Intl.DateTimeFormat.formatToParts()` | Sempre disponível em V8/Bun | Sem dependência; Bun 1.3.2 não tem `Temporal` nativo; `Intl` é suficiente |
| `moment-timezone` / `luxon` | `Intl.DateTimeFormat` (built-in) | ES2020+ | Zero deps; adequado para o caso de uso (verificar hora/dia em TZ) |

---

## Assumptions Log

| # | Claim | Section | Risco se errado |
|---|-------|---------|-----------------|
| A1 | O `checkpointer.getTuple()` retorna `channel_values.messages` como array de `BaseMessage` | Code Examples (Pattern 4) | Se o formato interno mudou, a extração de mensagens falha — verificar com teste de integração antes de implementar |
| A2 | `setInterval` em Bun funciona corretamente dentro de classe sem binding especial | Architecture Patterns (Pattern 1) | Timer pode não disparar — usar `this._tick.bind(this)` se necessário |
| A3 | `FOR UPDATE OF l SKIP LOCKED` funciona na versão do PostgreSQL do ambiente | Architecture Patterns (Pattern 2) | SKIP LOCKED requer PostgreSQL 9.5+ — [ASSUMED: ambiente usa PostgreSQL 16.x conforme CLAUDE.md] |

---

## Open Questions (RESOLVED)

1. **Checkpointer exposto para o FupScheduler**
   - O que sabemos: `checkpointer` é criado localmente em `_compileGraph()` e não é campo do BrainRunner
   - O que não está claro: Se salvar como `private checkpointer` quebra algum teste existente (runner.ts tem muitos mocks nos testes unitários)
   - Recomendação: Verificar os testes unitários de BrainRunner antes de adicionar o campo; adicionar como campo nullable `private checkpointer: PostgresSaver | null = null`
   - RESOLVED: Campo `private checkpointer: PostgresSaver | null = null` adicionado ao BrainRunner (Plan 03, Task 2). Testes unitários existentes não quebraram — o campo é nullable e inicializado apenas em `_compileGraph()`.

2. **Batch size e limite de leads por tick**
   - O que sabemos: CONTEXT.md marca como "Claude's Discretion"
   - O que não está claro: Volume esperado de leads por cliente
   - Recomendação: `BATCH_SIZE = 10` como constante de módulo, configurável futuramente via ENV. Suficiente para v1.4.
   - RESOLVED: `BATCH_SIZE = 10` definido como constante de módulo em `fup-scheduler.ts` (Plan 02, Task 1). Volume típico por cliente é baixo; constante pode ser promovida a ENV futuramente sem mudança de interface.

3. **Operação LLM + HTTP fora vs dentro da transação**
   - O que sabemos: Operações I/O longas dentro de `sql.begin()` seguram conexão do pool
   - O que não está claro: Se o pool do postgres.js suporta chamadas LLM de 5-10s dentro de transação sem problema
   - Recomendação: Usar transação curta apenas para SELECT FOR UPDATE SKIP LOCKED e marcar lead temporariamente; processar LLM e HTTP fora; finalizar com UPDATE em transação nova.
   - RESOLVED: Abordagem sem transação longa adotada (Plan 02, Task 1). SELECT FOR UPDATE SKIP LOCKED em transação curta marca o lead; LLM e HTTP ocorrem fora da transação; UPDATE final em transação separada. Pool do postgres.js não fica bloqueado.

---

## Environment Availability

| Dependência | Requerida por | Disponível | Versão | Fallback |
|-------------|---------------|------------|--------|----------|
| PostgreSQL | SELECT FOR UPDATE SKIP LOCKED | Assumido | 16.x (CLAUDE.md) | Sem fallback |
| Bun | Runtime | Sim | 1.3.2 | Sem fallback |
| `Intl.DateTimeFormat` | Timezone IANA | Sim [VERIFIED: Bash test] | built-in Bun 1.3.2 | Sem fallback necessário |
| `postgres` (postgres.js) | Raw SQL | Sim [VERIFIED: migrate.ts] | instalado | Sem fallback |
| `createLLM` (packages/ai) | LLM one-shot | Sim [VERIFIED: factory.ts] | local | Sem fallback |
| `IEventPublisher` | EVT-03 | Sim [VERIFIED: event-publisher.ts] | Phase 20 | null (sem publicação) |

---

## Validation Architecture

### Test Framework

| Propriedade | Valor |
|-------------|-------|
| Framework | `bun test` (built-in) |
| Config | nenhum — nativo |
| Quick run | `bun test packages/core/src/__tests__/unit/` |
| Full suite | `bun test packages/core/` |

### Phase Requirements → Test Map

| Req ID | Comportamento | Tipo | Comando Automatizado | Arquivo |
|--------|---------------|------|----------------------|---------|
| FUP-01 | fup_config lida do banco e usada na elegibilidade | unit | `bun test packages/core/src/__tests__/unit/fup-scheduler.test.ts` | ❌ Wave 0 |
| FUP-02 | SELECT FOR UPDATE SKIP LOCKED impede duplo envio | integration | `bun test packages/core/src/runner/__tests__/fup-scheduler.integration.test.ts` | ❌ Wave 0 |
| FUP-03 | LLM one-shot usa histórico do getTuple | unit | `bun test packages/core/src/__tests__/unit/fup-scheduler.test.ts` | ❌ Wave 0 |
| FUP-05 | Último FUP desativa ia_ativada e fup_enabled | unit | `bun test packages/core/src/__tests__/unit/fup-scheduler.test.ts` | ❌ Wave 0 |
| FUP-06 | resetFup() zera fup_next_at e fup_step | unit | `bun test packages/core/src/__tests__/unit/lead-service-fup.test.ts` | ❌ Wave 0 |
| FUP-07 | getNextValidSlot() retorna slot dentro da janela | unit | `bun test packages/core/src/__tests__/unit/fup-scheduler.test.ts` | ❌ Wave 0 |
| FUP-08 | fup_failure_count >= 3 desativa fup_enabled | unit | `bun test packages/core/src/__tests__/unit/fup-scheduler.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Por task commit:** `bun test packages/core/src/__tests__/unit/fup-scheduler.test.ts --bail`
- **Por wave merge:** `bun test packages/core/`
- **Phase gate:** Suite completa verde antes de `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/core/src/__tests__/unit/fup-scheduler.test.ts` — cobre FUP-01, FUP-03, FUP-05, FUP-07, FUP-08 (com mocks de sql, checkpointer, llm, fetch)
- [ ] `packages/core/src/__tests__/unit/lead-service-fup.test.ts` — cobre FUP-06 (resetFup com mock drizzle)
- [ ] `packages/core/src/runner/__tests__/fup-scheduler.integration.test.ts` — cobre FUP-02 (requer PostgreSQL; describeOrSkip pattern)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | não | — |
| V3 Session Management | não | — |
| V4 Access Control | não | — |
| V5 Input Validation | parcial | Não há input externo no scheduler; payload de saída não tem validação de entrada |
| V6 Cryptography | não | — |

### Known Threat Patterns

| Pattern | STRIDE | Mitigação Standard |
|---------|--------|---------------------|
| Log de conteúdo de mensagem gerada por LLM (PII) | Information Disclosure | Logar apenas `lead.uniqueId` e `fupStep` em warn/error — nunca o conteúdo da mensagem (padrão T-20-02 do EventPublisher) |
| fup_webhook_url não sanitizada em log | Information Disclosure | Logar apenas boolean de presença (`hasFupUrl: true`), nunca a URL completa |
| Injeção via conteúdo de mensagem do lead no SQL | Tampering | postgres.js usa prepared statements automáticos para interpolação via tagged template `${variavel}` — sem risco de SQL injection |

---

## Project Constraints (from CLAUDE.md)

- Runtime: Bun 1.x — `setInterval` / `clearInterval` disponíveis nativamente
- ORM: Drizzle 0.45.x — usar para updates; para `FOR UPDATE SKIP LOCKED` usar postgres.js tagged template diretamente
- Testing: `bun test` — Jest-compatible API, `describe`/`test`/`expect`/`mock`, testes em `__tests__/unit/` e `__tests__/integration/`
- Logging: pino via `createLogger()` de `@brain-pkg/observability`
- Arquivos de teste ficam em `__tests__/unit/` ou `__tests__/integration/` dentro do pacote — nunca ao lado dos arquivos de implementação
- Commits: Conventional Commits com emojis obrigatórios, sem "Co-Authored-By: Claude"

---

## Sources

### Primary (HIGH confidence)

- [VERIFIED: packages/database/src/schema/tables.ts] — schema completo de `leads` (fup_enabled, fup_step, fup_next_at, last_message_at) e `fup_config` (brain_type PK, intervals_seconds[], min_hour, max_hour, allowed_days[], timezone)
- [VERIFIED: packages/database/src/migrations/0007_v1_4_foundation.sql] — migration aplicada confirma schema; confirma ausência de `fup_failure_count`
- [VERIFIED: packages/core/src/runner/runner.ts] — ciclo de vida BrainRunner, padrão de dependência opcional (eventPublisher)
- [VERIFIED: packages/core/src/events/event-publisher.ts] — padrão IEventPublisher, fire-and-forget
- [VERIFIED: packages/core/src/leads/lead-service.ts] — padrão de métodos LeadService, touchLastMessage()
- [VERIFIED: packages/database/src/migrate.ts linha 51] — `FOR UPDATE NOWAIT` em postgres.js tagged template — padrão para `SKIP LOCKED`
- [VERIFIED: packages/memory/src/short-term.ts] — `checkpointer.getTuple({ configurable: { thread_id } })`
- [VERIFIED: packages/ai/src/graph/checkpointer.ts] — createCheckpointer, PostgresSaver
- [VERIFIED: packages/ai/src/llm/factory.ts] — createLLM(), multi-provider
- [VERIFIED: Bash — Bun 1.3.2 + Intl.DateTimeFormat] — extração de hora e weekday em timezone IANA funcional

### Secondary (MEDIUM confidence)

- [CITED: @langchain/langgraph-checkpoint/dist/base.d.ts] — `CheckpointTuple.checkpoint.channel_values: Record<string, unknown>` — mensagens extraídas como `channel_values.messages`

### Tertiary (LOW confidence — validar)

- A3: `FOR UPDATE OF l SKIP LOCKED` com alias funciona em PostgreSQL 16.x [ASSUMED — não testado em ambiente real]

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — verificado nos arquivos do projeto
- Architecture: HIGH — padrões explícitos dos arquivos existentes; uma questão em aberto sobre transação (Open Questions 3)
- Pitfalls: HIGH — derivados diretamente do código existente e da análise do schema

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (30 dias — stack estável)
