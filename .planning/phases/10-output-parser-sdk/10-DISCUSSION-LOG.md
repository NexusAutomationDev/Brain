# Phase 10: Output Parser SDK - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-14
**Phase:** 10-output-parser-sdk
**Areas discussed:** Valores de responseMode, Origem do JSON estruturado, BrainStateAnnotation, API pública

---

## Valores de responseMode

| Option | Description | Selected |
|--------|-------------|----------|
| Tipo de mídia da resposta | responseMode indica o que o Brain está enviando: "text", "image", "audio", "video", "document" | ✓ |
| Estado da conversa pós-resposta | responseMode indica o que acontece APÓS a resposta: "continue", "pause", "end" | |
| Modo de entrega da mensagem | responseMode indica como o cliente deve entregar: "text", "caption", "reaction" | |

**User's choice:** Tipo de mídia da resposta

---

| Option | Description | Selected |
|--------|-------------|----------|
| text \| image \| audio \| document | Os 4 tipos mais comuns no WhatsApp Business. Cobre 95% dos casos reais. | ✓ |
| text \| image \| audio \| video \| document | Inclui vídeo desde o início. | |
| Só text por enquanto | v1.2 só entrega contrato estruturado; mídia real fica para v1.3. | |

**User's choice:** `"text" | "image" | "audio" | "document"`
**Notes:** Quando responseMode !== "text", mediaType e mediaUrl tornam-se obrigatórios.

---

## Origem do JSON estruturado

| Option | Description | Selected |
|--------|-------------|----------|
| Nó do grafo monta manualmente | LLM retorna string, nó wraps em BrainOutput antes de retornar ao estado | ✓ |
| .withStructuredOutput() no LLM | LLM é chamado com structured output binding — retorna JSON validado | |
| BrainRunner faz parse pós-invoke | LLM retorna string, BrainRunner faz JSON.parse() + validação Zod na saída | |

**User's choice:** Nó do grafo monta manualmente

---

## BrainStateAnnotation — campo novo ou parse externo

| Option | Description | Selected |
|--------|-------------|----------|
| Novo campo state.brainOutput | BrainStateAnnotation ganha brainOutput: BrainOutput \| null; nó seta, BrainRunner lê | ✓ |
| Parse do content da última AIMessage | Nó serializa BrainOutput como JSON em AIMessage.content; BrainRunner faz JSON.parse() + Zod | |

**User's choice:** Novo campo state.brainOutput

---

## API pública — BrainRunResult vs BrainOutput

| Option | Description | Selected |
|--------|-------------|----------|
| Entrega o pacote direto | BrainRunner.run() retorna BrainOutput \| null diretamente; BrainRunResult removido | ✓ |
| Entrega dentro de um envelope | BrainRunner.run() retorna { output: BrainOutput } \| null | |

**User's choice:** Entrega o pacote direto (BrainOutput | null diretamente)
**Notes:** Usuário pediu explicação não-técnica antes de decidir.

---

## Claude's Discretion

- Localização do schema: `packages/core/src/output/schema.ts`
- Classe de erro na validação de BrainOutput: a critério do planejador
- `mediaType` como string livre (não enum) — óbvio do domínio
- `responseMode: "video"` deferido para pós-v1.2

## Deferred Ideas

- `video` como valor de responseMode — avaliado pós-v1.2
- `mediaType` como enum restrito de MIME types
- Upload base64 em `mediaUrl`
- responseMode indicando estado da conversa ("end", "pause") — pertence às tools da Fase 11
