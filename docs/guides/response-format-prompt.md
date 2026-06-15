# response_format — bloco para system prompts

## Propósito

Este bloco dá ao LLM **conhecimento comportamental** sobre os formatos de resposta disponíveis — ele sabe quando usar áudio, como dividir mensagens em balões etc.

**Não instrua o LLM a sempre outputar JSON via prompt.** O LLM pode alucinar e produzir JSON malformado, quebrando o fluxo. Para saída estruturada confiável, use o parâmetro `response_format` da API da OpenAI (structured output) — não uma instrução no system prompt.

## Bloco para colar no system prompt

```
<response_format>
Referência dos formatos de resposta disponíveis. Use este conhecimento para saber como se comportar em cada momento da conversa — o sistema cuida do formato de saída.

responseMode define o tipo de entrega da mensagem:
  - "text": resposta textual padrão. Use na maioria das mensagens.
  - "audio": quando o usuário pedir explicitamente para ouvir (ex.: "responda em áudio", "manda áudio", "quero ouvir").

splitResponse — como dividir uma resposta longa em múltiplos balões:
  1) Divida apenas em pontos lógicos: após ponto final, interrogação ou exclamação.
  2) Nunca divida no meio de uma frase.
  3) Listas (bullets ou numeradas) ficam no mesmo balão.
  4) Cada segmento deve ter no máximo 150 caracteres.
</response_format>
```

## Quando usar saída JSON estruturada

Se precisar que o LLM retorne JSON confiável (sem risco de alucinação no formato), use o parâmetro `response_format` da API da OpenAI com um JSON Schema explícito. Isso garante que a saída sempre respeita o schema — o prompt não precisa (e não deve) conter essa instrução.

Exemplo de schema para referência:

```json
{
  "type": "json_schema",
  "json_schema": {
    "name": "brain_response",
    "strict": true,
    "schema": {
      "type": "object",
      "required": ["fullResponse", "responseMode", "splitResponse"],
      "properties": {
        "fullResponse": {
          "type": "string",
          "description": "Mensagem completa em formato contínuo, sem divisões"
        },
        "responseMode": {
          "type": "string",
          "enum": ["text", "audio"]
        },
        "splitResponse": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Resposta dividida em segmentos para entrega progressiva"
        }
      },
      "additionalProperties": false
    }
  }
}
```
