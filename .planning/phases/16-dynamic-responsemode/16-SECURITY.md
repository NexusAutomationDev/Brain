---
phase: 16
slug: dynamic-responsemode
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-16
---

# Phase 16 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| LLM → respond tool schema | O LLM gera os valores de `fullResponse`, `responseMode`, `mediaType`, `mediaUrl` — input não confiável que passa pelo schema Zod antes de qualquer processamento | Conteúdo gerado pelo LLM (texto, enum de modo, URL opcional) |
| LLM → mediaUrl | O LLM pode gerar URLs maliciosas ou inválidas no campo `mediaUrl` | URL string — potencialmente de origem desconhecida |
| LLM → args do tool_call respond | O nó `respond` extrai args do tool_call do estado LangGraph sem reprocessamento LLM adicional | fullResponse, responseMode, mediaType, mediaUrl |
| tool_call.id (respondCall.id) | LangGraph/LangChain gera o id; nó respond usa como `tool_call_id` no ToolMessage | ID de correlação interno do grafo |
| state.messages → respondNode | O nó respond percorre mensagens em busca do tool_call respond — não confia em índice fixo | Histórico de mensagens do turno |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-16-01 | Tampering | `respondToolSchema.mediaUrl` | mitigate | `z.string().url()` valida formato URI; downstream não deve fazer fetch cego de `mediaUrl` sem validação adicional de domínio — responsabilidade do consumer | closed |
| T-16-02 | Information Disclosure | `respondToolSchema.fullResponse` | accept | `fullResponse` é o conteúdo gerado pelo LLM para o usuário — exposição intencional, sem PII novo introduzido por este mecanismo | closed |
| T-16-03 | Spoofing | LLM → enum `responseMode` | mitigate | Zod enum restrito a `["undefined", "text", "audio"]` — valores fora do enum são rejeitados com ZodError antes de chegar ao nó respond; `superRefine` adiciona validação cruzada `mediaType`/`mediaUrl` | closed |
| T-16-04 | Denial of Service | `createRespondTool()` invocação | accept | Tool executa em microsegundos (apenas `logger.info` + `return "ok"`) — sem risco de bloqueio ou consumo excessivo de recursos | closed |
| T-16-05 | Tampering | `respondNode` — `args.fullResponse` | accept | `fullResponse` é passado direto para `brainOutput` sem reprocessamento (RESP-02 — intencional); validação de schema Zod já ocorreu antes da invocação da tool | closed |
| T-16-06 | Denial of Service | `routeAfterLlm` — loop infinito de ReAct | accept | Mesmo comportamento existente de `toolsCondition`; LangGraph tem `recursionLimit` padrão (25) que previne loops infinitos | closed |
| T-16-07 | Spoofing | `mediaType` "file" → "document" mapeamento | mitigate | Mapeamento explícito e restrito no nó respond (D-05): apenas `"file"` → `"document"`; outros valores passam sem alteração. `BrainOutputSchema.parse()` valida o resultado final | closed |
| T-16-08 | Repudiation | PITFALL-6 warn log | mitigate | `logger.warn` com conteúdo do texto plano e tag "PITFALL-6" — auditável via pino logs estruturados em ambos os brains | closed |
| T-16-09 | Information Disclosure | `logger.warn` em D-10 — loga content | accept | `content` é a resposta do LLM para o usuário — já seria exposto normalmente ao usuário final; sem PII novo introduzido | closed |
| T-16-10 | Denial of Service | brain-echo `ToolNode` vazio (`mcpTools=[]`) | mitigate | `routeAfterLlm` com guarda `!hasMcpTools` retorna `END` antes de atingir `ToolNode`; teste de regressão confirma o branch nunca é atingido com `mcpTools=[]` | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-16-01 | T-16-02 | `fullResponse` é conteúdo intencional do LLM destinado ao usuário final — a exposição é o comportamento correto do sistema, sem PII novo sendo introduzido por este mecanismo específico | gsd-security-auditor | 2026-06-16 |
| AR-16-02 | T-16-04 | `createRespondTool()` executa apenas `logger.info` + `return "ok"` — latência medida em microsegundos, sem I/O, sem alocações significativas. Risco de DoS via esta tool é negligível. | gsd-security-auditor | 2026-06-16 |
| AR-16-03 | T-16-05 | Passagem direta de `fullResponse` para `brainOutput` é requisito explícito RESP-02 — garantir que o LLM não tenha sua resposta modificada. Validação de schema Zod ocorre antes da invocação. | gsd-security-auditor | 2026-06-16 |
| AR-16-04 | T-16-06 | LangGraph possui `recursionLimit` padrão de 25 iterações — proteção já existente antes desta fase. O padrão `routeAfterLlm` não aumenta o risco em relação ao `toolsCondition` que substituiu. | gsd-security-auditor | 2026-06-16 |
| AR-16-05 | T-16-09 | O conteúdo logado via `logger.warn` (D-10 fallback) é a resposta do LLM que seria transmitida ao usuário de qualquer forma — não há exposição incremental de dados sensíveis. | gsd-security-auditor | 2026-06-16 |

*Accepted risks do not resurface in future audit runs.*

---

## Implementation Evidence

### Mitigations Verified

| Threat ID | File | Evidence |
|-----------|------|----------|
| T-16-01 | `packages/core/src/tools/respond.ts` | `z.string().url()` em `mediaUrl` — PITFALL-5 mitigado; não usa `z.url()` (ZodURL) |
| T-16-03 | `packages/core/src/tools/respond.ts` | `z.enum(["undefined", "text", "audio"])` + `superRefine` para validação cruzada `mediaType`/`mediaUrl` |
| T-16-07 | `apps/brain-sdr/src/brain.ts`, `apps/brain-echo/src/brain.ts` | `const mediaType = args.mediaType === "file" ? "document" : args.mediaType` no nó respond (D-05) |
| T-16-08 | `apps/brain-sdr/src/brain.ts`, `apps/brain-echo/src/brain.ts` | `logger.warn({ content: fullResponse }, "LLM emitiu texto plano sem respond tool — PITFALL-6")` |
| T-16-10 | `apps/brain-echo/src/brain.ts` | `const hasMcpTools = ctx.mcpTools.length > 0;` + `if (!hasMcpTools) return END;` em `routeAfterLlm` |

### Test Coverage

| Threat | Test File | Test Description |
|--------|-----------|-----------------|
| T-16-01, T-16-03 | `packages/core/src/tools/__tests__/respond.test.ts` | 10 testes unitários — schema validation, superRefine, enum enforcement |
| T-16-07, T-16-08, T-16-10 | `apps/brain-sdr/src/__tests__/unit/brain.test.ts` | 16 testes — fallback D-10, bindTools count, routeAfterLlm routing |
| T-16-10 | `apps/brain-echo/src/__tests__/unit/brain.test.ts` | 15 testes — guarda ToolNode vazio com mcpTools=[] |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-16 | 10 | 10 | 0 | gsd-security-auditor (automated) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-16
