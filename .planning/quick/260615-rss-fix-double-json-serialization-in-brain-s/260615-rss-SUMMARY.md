---
quick_id: 260615-rss
status: complete
date: 2026-06-15
---

# Summary: Fix Double JSON Serialization in brain-sdr

## O que estava errado

O bloco `<response_format>` no system prompt do SDR (banco `sdr/system`) continha:
> "Você deve sempre produzir um JSON conforme o response_format."

Isso fazia o LLM outputar JSON como conteúdo da resposta. O webhook retornava:
```json
{ "status": "ok", "fullResponse": "{\"fullResponse\": \"Fala!...\", \"responseMode\": \"text\", ...}" }
```

## Decisão

Não parsear JSON do output do LLM — risco de alucinação e JSON malformado.
O bloco `<response_format>` deve ser **referência comportamental** para o LLM, não instrução de output.

## O que foi feito

**1. System prompt no banco** — removida a instrução de output JSON do bloco `<response_format>`:
```
ANTES: "Você deve sempre produzir um JSON conforme o response_format."
DEPOIS: "Referência dos formatos de resposta disponíveis. Use este conhecimento para saber
         como se comportar em cada momento da conversa — o sistema cuida do formato de saída."
```

**2. `docs/guides/response-format-prompt.md`** — reescrito para:
- Explicar que o bloco é conhecimento comportamental, não instrução de output
- Mostrar o bloco correto (sem instrução JSON)
- Documentar quando usar OpenAI structured output para JSON confiável

## Resultado

O LLM responde em texto puro. O webhook retorna corretamente:
```json
{ "status": "ok", "fullResponse": "Fala! Tudo certo? Sou Gabriel...", "responseMode": "text" }
```
