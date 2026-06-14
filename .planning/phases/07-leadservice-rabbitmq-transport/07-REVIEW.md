---
phase: 07-leadservice-rabbitmq-transport
reviewed: 2026-06-14T03:11:51Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - packages/core/src/leads/lead-service.ts
  - packages/core/src/leads/__tests__/lead-service.test.ts
  - packages/core/src/runner/runner.ts
  - packages/core/src/runner/__tests__/brain-runner.test.ts
  - packages/core/src/runner/__tests__/brain-runner.integration.test.ts
  - packages/core/src/index.ts
  - packages/transport/src/webhook/handler.ts
  - packages/transport/src/webhook/handler.test.ts
  - packages/transport/src/rabbitmq/consumer.ts
  - packages/transport/src/__tests__/unit/rabbitmq/consumer.test.ts
  - packages/transport/src/factory.ts
  - packages/transport/src/factory.test.ts
  - packages/transport/src/index.ts
  - packages/transport/package.json
  - apps/brain-echo/.env.example
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 07: Code Review Report

**Reviewed:** 2026-06-14T03:11:51Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Phase 07 delivers two features: `LeadService` (upsert por `numero` + gate `ia_ativada`) integrado no `BrainRunner`, e `RabbitMQTransport` com retry/DLQ manual via `rabbitmq-client`. O núcleo de ambas as features está correto — o upsert é atômico, o gate `ia_ativada` lê do banco (nunca do payload), e o consumer RabbitMQ implementa o backoff e DLQ conforme as decisões do RESEARCH.md.

Um problema crítico de segurança foi identificado: o corpo completo de payloads inválidos do RabbitMQ é logado antes de ser enviado à DLQ, expondo potencial PII em logs estruturados. Quatro warnings cobrem um non-null assertion sem guarda, um threadId temporário que usa `event.Numero` em vez de `lead.uniqueId` (bug latente documentado como Phase 8), a inconsistência do `console.error` em vez do logger estruturado, e o risco de runner `undefined` silenciosamente passado para `RabbitMQTransport`. Três info items cobrem violações de convenção de localização de arquivos de teste e um `any` no teste de integração.

---

## Critical Issues

### CR-01: PII leaked to logs when RabbitMQ payload fails schema validation

**File:** `packages/transport/src/rabbitmq/consumer.ts:91-96`

**Issue:** When `BrainEventSchema.safeParse(msg.body)` fails, the full raw `msg.body` is written to the error log via `this.logger.error({ body: msg.body }, ...)`. In production, `msg.body` is a JSON object originating from an external system and may contain phone numbers, names, and other PII. Pino serialises the entire object into the structured log record, which flows to whatever log aggregator the customer uses.

**Fix:** Log only non-sensitive metadata. If the shape is known to be partially valid, extract safe fields first; otherwise log a redacted placeholder:

```typescript
// Before (leaks raw body)
this.logger.error(
  { body: msg.body },
  "Invalid BrainEvent from RabbitMQ — sending to DLQ"
);

// After (safe)
this.logger.error(
  { bodyKeys: Object.keys(msg.body ?? {}) },
  "Invalid BrainEvent from RabbitMQ — sending to DLQ"
);
```

---

## Warnings

### WR-01: Non-null assertion on `this.pub` without a null guard

**File:** `packages/transport/src/rabbitmq/consumer.ts:96` and `:123`

**Issue:** `this.pub!.send(dlq, msg.body)` and `await this.pub!.send(dlq, msg.body)` use the non-null assertion operator. `this.pub` is assigned in `start()` but is typed as `undefined` before that. If a message callback fires during the teardown window (after `stop()` is called but before the consumer is fully closed), `this.pub` will be `undefined` and the `!` operator silently bypasses TypeScript's check, causing an unhandled runtime `TypeError: Cannot read properties of undefined (reading 'send')`.

**Fix:** Add an explicit guard before each `pub.send` call:

```typescript
if (!this.pub) {
  this.logger.error({ msgKey }, "Publisher not available — dropping message to DLQ");
  return ConsumerStatus.ACK;
}
await this.pub.send(dlq, msg.body);
```

### WR-02: `threadId` uses `event.Numero` instead of `lead.uniqueId` — correctness bug in current code

**File:** `packages/core/src/runner/runner.ts:169-171`

**Issue:** The comment acknowledges this as a Phase 8 placeholder, but the current code is objectively wrong from the moment it ships. `lead.uniqueId` is already available in the same function scope (line 155). Using `event.Numero` means the LangGraph `thread_id` (and thus the entire conversation history) is keyed on the phone number, not the lead's canonical identifier. If the same contact ever messages from two different numbers, or if `IDLead` differs from `Numero` (which is the intent of the design), two separate checkpointer threads exist for the same lead. The `lead` object is already available — the fix is one line and has no dependencies on Phase 8 work.

```typescript
// Before
const threadId = event.Numero;

// After — lead is already available (upserted on line 155)
const threadId = lead.uniqueId;
```

### WR-03: `console.error` in webhook handler instead of structured logger

**File:** `packages/transport/src/webhook/handler.ts:59`

**Issue:** `console.error({ err }, "BrainRunner.run() failed")` bypasses the pino logger used everywhere else in the codebase. `console.error` does not produce structured JSON, does not include the pino log level field, and does not route to log aggregators correctly. The `{ err }` object will be stringified via `[object Object]` rather than serialized with pino's error serializer.

`createLogger` is already imported by the sibling `consumer.ts` in the same package; it should be used here too.

**Fix:**

```typescript
import { createLogger } from "@brain-pkg/observability";

// At module level or injected:
const logger = createLogger();

// Inside the catch block:
logger.error({ err }, "BrainRunner.run() failed");
```

### WR-04: `createTransport` silently passes `undefined` runner to `RabbitMQTransport`

**File:** `packages/transport/src/factory.ts:27`

**Issue:** `RabbitMQTransport` constructor signature is `constructor(private readonly runner: IBrainRunnerLike)` — `runner` is required. However, `createTransport(runner?: IBrainRunnerLike)` accepts an optional `runner` and passes it with a non-null assertion (`runner!`) to bypass the type error. If `createTransport()` is called without a runner when `TRANSPORT=rabbitmq`, `runner!` satisfies TypeScript but `undefined` is passed at runtime. The consumer will then call `this.runner.run(...)` and throw `TypeError: Cannot read properties of undefined (reading 'run')` on the first message, with no diagnostic pointing to the misconfiguration site.

**Fix:** Add an explicit runtime guard before constructing `RabbitMQTransport`:

```typescript
case "rabbitmq":
  if (!runner) {
    throw new ConfigurationError(
      "RabbitMQTransport requires a runner — inject via createTransport(runner)",
      { transport: "rabbitmq" }
    );
  }
  return new RabbitMQTransport(runner);
```

---

## Info

### IN-01: `handler.test.ts` and `factory.test.ts` placed outside `__tests__/` directory

**File:** `packages/transport/src/webhook/handler.test.ts` and `packages/transport/src/factory.test.ts`

**Issue:** Project convention (CLAUDE.md — "Organização de Testes") requires all test files to live under a `__tests__/` directory and never alongside implementation files. `handler.test.ts` is co-located with `handler.ts` in `src/webhook/`, and `factory.test.ts` is co-located with `factory.ts` in `src/`. The correctly placed test is `src/__tests__/unit/rabbitmq/consumer.test.ts`. Inconsistency makes test discovery harder and violates the declared structure.

**Fix:** Move both files:
- `src/webhook/handler.test.ts` → `src/__tests__/unit/webhook/handler.test.ts`
- `src/factory.test.ts` → `src/__tests__/unit/factory.test.ts`

### IN-02: `any` type in integration test graph node callback

**File:** `packages/core/src/runner/__tests__/brain-runner.integration.test.ts:57`

**Issue:** `async (state: any) => {` uses an explicit `any` annotation. `BrainStateAnnotation` is imported from `@brain-pkg/ai` on line 14 — its state type should be derivable via `typeof BrainStateAnnotation.State` or the annotation's inferred type.

**Fix:**

```typescript
// Import the state type or use typeof annotation
graph.addNode("respond", async (_state) => {
  return { messages: [...] };
});
```

### IN-03: `.env.example` contains a literal placeholder LLM API key pattern

**File:** `apps/brain-echo/.env.example:31`

**Issue:** `OPENAI_API_KEY=sk-...` uses the `sk-` prefix which matches the OpenAI key pattern. While this is only an example file and clearly not a real key, automated secret-scanning tools (e.g., GitHub secret scanning, Gitleaks) may flag or block commits containing this prefix. Using a clearly fake format avoids false positives.

**Fix:** Use a clearly non-valid placeholder:

```
OPENAI_API_KEY=your-openai-api-key-here
```

---

_Reviewed: 2026-06-14T03:11:51Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
