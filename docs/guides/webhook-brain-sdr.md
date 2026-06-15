# Webhook — brain-sdr

Endpoint HTTP para envio de mensagens ao Brain SDR.

## Endpoint

```
POST /api/v1/webhook
Content-Type: application/json
```

## Payload

| Campo    | Tipo   | Obrigatório | Descrição                              |
|----------|--------|-------------|----------------------------------------|
| `Name`   | string | sim         | Nome do lead                           |
| `Message`| string | sim         | Mensagem enviada pelo lead             |
| `Numero` | string | sim         | Número de telefone (ex: 5511999999999) |
| `IDLead` | string | sim         | ID único do lead — usado como thread_id no histórico de conversa |

## Resposta

| Campo    | Tipo   | Descrição                                    |
|----------|--------|----------------------------------------------|
| `status` | string | `"ok"` \| `"ignored"` \| `"error"`           |
| `reply`  | string | Resposta gerada pelo Brain (quando `status: "ok"`) |

`status: "ignored"` é retornado quando `ia_ativada=false` para o lead.

## Exemplos

### Primeira mensagem de um lead

```bash
curl -X POST http://localhost:3002/api/v1/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "Name": "João Silva",
    "Message": "Olá, tenho interesse no produto de vocês",
    "Numero": "5511999999999",
    "IDLead": "lead-001"
  }'
```

**Resposta:**
```json
{
  "status": "ok",
  "reply": "Olá! Que ótimo saber do seu interesse. Pode me contar um pouco sobre sua empresa e qual a principal necessidade que você espera resolver com nosso produto?"
}
```

### Continuação da conversa (mesmo IDLead)

```bash
curl -X POST http://localhost:3002/api/v1/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "Name": "João Silva",
    "Message": "Somos uma empresa de 50 funcionários e queremos automatizar nosso processo de vendas",
    "Numero": "5511999999999",
    "IDLead": "lead-001"
  }'
```

> O histórico completo da conversa é recuperado automaticamente via `IDLead`.

### Health check

```bash
curl http://localhost:3002/health
```

**Resposta:**
```json
{ "status": "ok" }
```

## Erros

| Status | Body                                          | Causa                        |
|--------|-----------------------------------------------|------------------------------|
| 400    | `{ "error": "Invalid JSON body" }`            | JSON malformado              |
| 400    | `{ "error": "Invalid BrainEvent", "details": ... }` | Campo ausente ou inválido |
| 500    | `{ "error": "Internal error" }`               | Erro interno do BrainRunner  |

## Portas

| Contexto         | URL                              |
|------------------|----------------------------------|
| Docker (produção)| `http://localhost:3002/api/v1/webhook` |
| Dev local (bun)  | `http://localhost:3001/api/v1/webhook` |
