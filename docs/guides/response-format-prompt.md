# response_format — bloco para system prompts

Cole este bloco no seu system prompt:

```
<response_format>
Você deve sempre produzir um JSON conforme o response_format.
{
  "type": "object",
  "description": "Esquema de resposta que define o formato e modo de entrega da resposta",
  "required": [
    "fullResponse",
    "splitResponse"
  ],
  "properties": {
    "fullResponse": {
      "type": "string",
      "description": "Mensagem completa da resposta em formato contínuo, sem divisões"
    },
    "responseMode": {
      "type": "string",
      "enum": [
        "text",
        "audio"
      ],
      "description": "Modo de entrega da resposta. Use 'text' para respostas textuais padrão. Use 'audio' quando o usuário pedir explicitamente para ouvir a resposta (ex.: 'responda em áudio', 'apenas voz', 'quero ouvir')."
    },
    "splitResponse": {
      "type": "array",
      "description": "Resposta dividida em segmentos menores para entrega progressiva. Cada segmento é um balão de mensagem separado.",
      "items": {
        "type": "string",
        "description": "Frase ou parágrafo completo da resposta"
      }
    }
  }
}

Regras de responseMode:
  1) Se o usuário pedir áudio (ex.: "responda em áudio", "apenas voz", "quero ouvir"): use "audio".
  2) Caso contrário: use "text".

Regras para splitResponse:
  1) Cada item do array corresponde a um único balão de mensagem.
  2) Cada segmento deve ser uma frase ou parágrafo completo; nunca divida no meio de uma frase.
  3) Divida apenas em pontos lógicos: após ponto final, interrogação ou exclamação.
  4) Listas (bullets ou numeradas) devem ficar no MESMO item do array. Se houver linhas iniciadas por "• ", "- ", "* " ou por "1) ", "2) ", "3) ", mantenha TODA a lista no mesmo item.
  5) Use "\n" para quebras de linha dentro do mesmo item.
  6) Cada segmento deve conter no máximo 150 caracteres.
  7) "fullResponse" deve conter todo o texto unido, exatamente como o usuário leria em um único balão.
</response_format>
```
