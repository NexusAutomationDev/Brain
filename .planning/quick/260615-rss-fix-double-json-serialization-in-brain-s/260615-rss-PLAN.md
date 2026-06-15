---
quick_id: 260615-rss
slug: fix-double-json-serialization-in-brain-s
description: fix double json serialization in brain-sdr response output
date: 2026-06-15
must_haves:
  truths:
    - Bloco <response_format> no system prompt é referência comportamental, não instrução de output JSON
    - LLM responde em texto puro — o sistema cuida do formato de saída
    - Guide doc explica a distinção entre conhecimento comportamental vs saída estruturada forçada
  artifacts:
    - docs/guides/response-format-prompt.md
    - sdr/system prompt no banco (atualizado via SQL)
---

# Quick Task 260615-rss: Fix Double JSON Serialization

## Causa raiz

O system prompt do SDR continha no bloco `<response_format>`:
> "Você deve sempre produzir um JSON conforme o response_format."

Essa instrução fazia o LLM outputar JSON como conteúdo da resposta. O código em `brain.ts`
tratava `response.content` como texto puro, colocando o JSON inteiro em `brainOutput.fullResponse`.
Resultado: o webhook retornava o JSON stringificado como `fullResponse`.

## Decisão de design

**Não parsear JSON do output do LLM** — o LLM pode alucinar e gerar JSON malformado, quebrando
o fluxo. O bloco `<response_format>` deve ser **referência comportamental** (o LLM sabe que existe
áudio, splitResponse etc.), não uma instrução de sempre outputar JSON estruturado.

Para saída JSON confiável no futuro: usar `response_format` da API da OpenAI (structured output).

## Tasks

### Task 1 — Atualizar system prompt no banco
- **ação**: Remover instrução "Você deve sempre produzir um JSON" do bloco `<response_format>`;
  manter como referência comportamental apenas
- **via**: SQL UPDATE em `prompts` WHERE `brain_type='sdr'` AND `key='system'`
- **done**: executado diretamente no PostgreSQL

### Task 2 — Atualizar docs/guides/response-format-prompt.md
- **ação**: Reescrever o guide para explicar propósito comportamental vs saída estruturada forçada;
  mostrar o bloco correto e quando usar OpenAI structured output
- **done**: committed
