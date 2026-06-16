---
phase: 16-dynamic-responsemode
reviewed: 2026-06-16T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - apps/brain-echo/package.json
  - apps/brain-echo/src/__tests__/unit/brain.test.ts
  - apps/brain-echo/src/brain.ts
  - apps/brain-sdr/src/__tests__/unit/brain.test.ts
  - apps/brain-sdr/src/brain.ts
  - docs/guides/response-format-prompt.md
  - packages/core/src/__tests__/unit/output/schema.test.ts
  - packages/core/src/index.ts
  - packages/core/src/output/schema.ts
  - packages/core/src/tools/__tests__/respond.test.ts
  - packages/core/src/tools/respond.ts
  - packages/shared/src/types/index.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 16: Code Review Report

**Reviewed:** 2026-06-16
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Phase 16 introduces dynamic `responseMode` via a `respond` tool (schema-as-tool pattern). The implementation is architecturally sound: `createRespondTool()` is a clean stateless factory, `routeAfterLlm` correctly replaces `toolsCondition`, and the `hasMcpTools` guard in `brain-echo` prevents an unreachable `ToolNode` from crashing. No critical security or data-loss issues were found.

Two warnings were identified: a silent empty-return on the inconsistent-state error path in both `respondNode` implementations, and a fragile dual-check for LangGraph `AIMessage` identity that becomes a silent false-negative if the LLM adapter returns a non-class response object. Three info items cover cross-brain inconsistency and test data that sets misleading expectations.

## Warnings

### WR-01: `respondNode` silently returns `{}` on inconsistent state, leaving `brainOutput: null`

**File:** `apps/brain-echo/src/brain.ts:128-130` / `apps/brain-sdr/src/brain.ts:151-154`

**Issue:** When the `respondNode` cannot find a `respond` tool call in state messages (the `respondCall === null` branch), both implementations call `logger.error(...)` and then `return {}`. Returning an empty object means the `brainOutput` annotation stays `null` (its default). `BrainRunner.run()` then throws `BrainOutputValidationError: "BrainOutput is null"` at line 232 of `runner.ts`. The error is unhandled inside the node — it surfaces as an untyped exception in the runner's call stack, losing the structured error path. Callers see a generic `BrainOutputValidationError` with no indication that the error originated in `respondNode`, making the bug hard to diagnose in production traces.

**Fix:** Return a valid fallback `brainOutput` (matching the D-10 pattern) so the turn completes gracefully and the inconsistency is observable in `brainOutput.responseMode`:

```typescript
if (!respondCall) {
  logger.error("respondNode chamado sem tool_call 'respond' no estado — estado inconsistente");
  return {
    brainOutput: {
      fullResponse: "",
      responseMode: "undefined" as const,
    },
  };
}
```

If a hard error is preferred over degraded output, throw a typed sentinel that `BrainRunner` catches and wraps before re-throwing — do not return `{}` silently.

---

### WR-02: `respondNode` message-type check fails silently if LLM adapter returns non-class response

**File:** `apps/brain-echo/src/brain.ts:122-125` / `apps/brain-sdr/src/brain.ts:146-149`

**Issue:** The reverse loop that finds the `respond` tool call gates entry with:

```typescript
if (msg.getType?.() === "ai" || (msg as any)._getType?.() === "ai") {
```

Both `getType` and `_getType` are optional-chained, so if `msg` is a plain object (no prototype methods) the condition evaluates to `false` and the loop skips all messages. This results in `respondCall === null`, triggering the error path in WR-01 even though the AIMessage is present in state.

In normal operation, `messagesStateReducer` coerces plain `{ role, content }` inputs to typed LangChain message instances, so the LLM response (an `AIMessage` from `llmWithTools.invoke()`) always has `.getType()`. However, if an LLM adapter or future model wraps the response differently (returning a plain object that satisfies the `BaseMessage` interface structurally but not via inheritance), neither check fires. The pattern also duplicates internal-API knowledge (`_getType`) which is undocumented.

**Fix:** Check `tool_calls` directly on the message without relying on type methods, since only `AIMessage` instances carry `tool_calls`:

```typescript
for (let i = messages.length - 1; i >= 0; i--) {
  const msg = messages[i];
  const tc = (msg as AIMessage).tool_calls;
  if (Array.isArray(tc) && tc.length > 0) {
    respondCall = tc.find((c) => c.name === "respond") ?? null;
    if (respondCall) break;
  }
}
```

This is equivalent in practice (only AIMessages have `tool_calls`) and does not rely on prototype methods or private fields.

---

## Info

### IN-01: Inconsistent `contextWindowSize` pattern between brain-echo and brain-sdr

**File:** `apps/brain-echo/src/brain.ts:42-45` vs `apps/brain-sdr/src/brain.ts:79-82`

**Issue:** `brain-echo` captures `contextWindowSize` as a `const` at `buildGraph()` time (closure over ENV at construction). `brain-sdr` defines `getContextWindow()` as a function called inside the LLM node on every invocation (re-reads `process.env` each time). Both are correct in behavior — ENV is typically static after startup — but the inconsistency creates confusion for Brain authors who use these files as implementation templates.

**Fix:** Standardize on one pattern across all brains. The const approach in `brain-echo` is preferable (ENV is read once, value is locked for the lifetime of the graph). Apply the same pattern in `brain-sdr`:

```typescript
// Replace getContextWindow() with:
const contextWindowSize = (() => {
  const n = parseInt(process.env.CONTEXT_WINDOW_MESSAGES ?? "40", 10);
  return n > 0 && isFinite(n) ? n : 40;
})();
// Then use contextWindowSize directly in the LLM node:
const messagesForLLM = state.messages.slice(-contextWindowSize);
```

---

### IN-02: `BrainOutputSchema` tests pass MIME strings for `mediaType`, diverging from production data

**File:** `packages/core/src/__tests__/unit/output/schema.test.ts:28-30`

**Issue:** The test asserts that `mediaType: "image/jpeg"` is a valid value for image mode. In production, the `respondNode` sets `brainOutput.mediaType` from `args.mediaType`, which comes from the `respond` tool schema's enum `["image", "file", "video", "audio"]`. The actual value stored will be `"image"` (not `"image/jpeg"`). Since `BrainOutputSchema.mediaType` is `z.string().optional()` (no format constraint), both pass schema validation. However, the test data misleads readers into believing a MIME string is required or expected, when the actual consumer receives enum labels from the tool schema.

**Fix:** Update the test to use the same enum labels that the production path produces, or add a comment explaining that `mediaType` accepts any string:

```typescript
test("image mode com mediaType + mediaUrl: válido", () => {
  // mediaType é z.string() — aceita MIME ("image/jpeg") ou enum label ("image")
  // Em produção, respondNode passa o valor direto do args do LLM (enum label da tool schema)
  expect(() =>
    BrainOutputSchema.parse({
      fullResponse: "veja a imagem",
      responseMode: "image",
      mediaType: "image",   // enum label conforme respond tool schema
      mediaUrl: "https://example.com/img.jpg",
    })
  ).not.toThrow();
});
```

---

### IN-03: `BrainOutputSchema` tests cover `responseMode` values unreachable via `respond` tool

**File:** `packages/core/src/__tests__/unit/output/schema.test.ts:46-68`

**Issue:** Tests for `responseMode: "image"`, `"video"`, and `"document"` exercise `BrainOutputSchema` in isolation, but these modes are not reachable through the current production path. The `respond` tool schema exposes only `z.enum(["undefined", "text", "audio"])` for `responseMode`. Neither brain populates `brainOutput.responseMode` with `"image"`, `"video"`, or `"document"` through the respond tool — those values can only appear if set manually outside the current architecture. The tests are not wrong (they validate schema rules correctly), but they test code paths that are currently dead ends, which can give false confidence that the image/video/document flow is exercised end-to-end.

**Fix:** Add a comment in the test file flagging these as schema-only tests (not integration-path tests) so future authors know the gap:

```typescript
// NOTA: responseMode "image", "video", "document" são validados pelo BrainOutputSchema mas
// não são atualmente emitidos pelo respond tool (que expõe apenas ["undefined","text","audio"]).
// Estes testes cobrem apenas a regra de validação de schema — o fluxo completo fica pendente
// para RESP-F01 (pós v1.3).
```

---

_Reviewed: 2026-06-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
