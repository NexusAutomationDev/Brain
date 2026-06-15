---
phase: quick
plan: 260614-vcu
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/transport/src/webhook/handler.ts
  - packages/transport/src/__tests__/unit/webhook-auth.test.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "Request sem Authorization header retorna 401 Unauthorized"
    - "Request com token errado retorna 401 Unauthorized"
    - "Request com WEBHOOK_TOKEN correto no header Authorization: Bearer <token> processa normalmente"
    - "Se WEBHOOK_TOKEN não estiver configurado no env, webhook retorna 503 (fail closed, nunca aceita request sem token)"
  artifacts:
    - path: "packages/transport/src/webhook/handler.ts"
      provides: "Middleware de autenticação Bearer token no POST /api/v1/webhook"
    - path: "packages/transport/src/__tests__/unit/webhook-auth.test.ts"
      provides: "Testes unitários cobrindo os 4 cenários de auth"
  key_links:
    - from: "createWebhookApp()"
      to: "WEBHOOK_TOKEN env var"
      via: "process.env.WEBHOOK_TOKEN lido a cada request"
      pattern: "process\\.env\\.WEBHOOK_TOKEN"
---

<objective>
Proteger o endpoint POST /api/v1/webhook com autenticação Bearer token.

Purpose: O webhook está exposto sem autenticação — qualquer cliente pode enviar eventos e consumir o Brain SDR. O token configurável via ENV garante que apenas integradores autorizados disparem o agente.

Output: handler.ts atualizado com verificação de Authorization header + testes unitários cobrindo todos os cenários de auth.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Adicionar autenticação Bearer token ao createWebhookApp</name>
  <files>
    packages/transport/src/webhook/handler.ts
    packages/transport/src/__tests__/unit/webhook-auth.test.ts
  </files>
  <behavior>
    - Sem WEBHOOK_TOKEN no env + qualquer request → 503 { error: "Service unavailable — webhook not configured" } (fail closed, mesmo padrão do /reload-prompts com ADMIN_TOKEN)
    - Com WEBHOOK_TOKEN configurado + sem Authorization header → 401 { error: "Unauthorized" }
    - Com WEBHOOK_TOKEN configurado + Authorization: Bearer token_errado → 401 { error: "Unauthorized" }
    - Com WEBHOOK_TOKEN configurado + Authorization: Bearer TOKEN_CORRETO → processa normalmente (200 ok / 400 / 500 conforme a lógica existente)
    - Não revelar se o token está ausente vs incorreto (ambos retornam a mesma mensagem de erro)
    - Log warn para tentativas não autorizadas (sem logar o valor do token recebido)
  </behavior>
  <action>
    FASE RED: Criar packages/transport/src/__tests__/unit/webhook-auth.test.ts com os 5 casos acima.
    Rodar `cd /root/Brain && bun test packages/transport/src/__tests__/unit/webhook-auth.test.ts` — DEVE FALHAR (comportamento ainda não existe).

    FASE GREEN: Modificar createWebhookApp() em packages/transport/src/webhook/handler.ts:
    1. No início do handler app.post("/api/v1/webhook", async (c) => {...}), ANTES de parsear o body, adicionar bloco de autenticação:
       - Ler `const webhookToken = process.env.WEBHOOK_TOKEN;`
       - Se !webhookToken → retornar c.json({ error: "Service unavailable — webhook not configured" }, 503)
       - Ler `const authHeader = c.req.header("Authorization");`
       - Extrair token: `const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;`
       - Se !bearer || bearer !== webhookToken → logger.warn({}, "/api/v1/webhook unauthorized attempt") + retornar c.json({ error: "Unauthorized" }, 401)
       - Seguir para o fluxo normal de parse do body se autenticado

    Rodar `cd /root/Brain && bun test packages/transport/src/__tests__/unit/webhook-auth.test.ts` — DEVE PASSAR.

    IMPORTANTE: O header é Authorization: Bearer <token> (padrão HTTP). NÃO usar X-Webhook-Token (inconsistente com REST).
    IMPORTANTE: Não logar o valor do token recebido no warn — apenas a mensagem de tentativa não autorizada.
    IMPORTANTE: A comparação deve ser de igualdade simples de string (===). Não usar crypto.timingSafeEqual por ora — o benefício é marginal em endpoints HTTP onde timing já é ruidoso por RTT.
  </action>
  <verify>
    <automated>cd /root/Brain && bun test packages/transport/src/__tests__/unit/webhook-auth.test.ts</automated>
  </verify>
  <done>
    Todos os testes de auth passam. O endpoint retorna 503 sem WEBHOOK_TOKEN, 401 sem/errado token, e processa normalmente com token correto.
  </done>
</task>

<task type="auto">
  <name>Task 2: Atualizar testes existentes do handler para incluir o WEBHOOK_TOKEN</name>
  <files>
    packages/transport/src/webhook/handler.test.ts
  </files>
  <action>
    Os testes existentes em handler.test.ts vão quebrar porque o webhook agora exige autenticação.
    Atualizar TODOS os testes existentes no handler.test.ts para incluir o header correto:
    - Antes de cada request, definir process.env.WEBHOOK_TOKEN = "test-token"
    - Adicionar header Authorization: "Bearer test-token" em todos os requests de teste
    - Usar beforeEach para setar o env e afterEach/afterAll para limpar (delete process.env.WEBHOOK_TOKEN)

    Padrão:
    ```typescript
    beforeEach(() => {
      process.env.WEBHOOK_TOKEN = "test-token";
    });
    afterEach(() => {
      delete process.env.WEBHOOK_TOKEN;
    });
    ```
    E nos requests:
    ```typescript
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer test-token",
    },
    ```

    Rodar `cd /root/Brain && bun test packages/transport/src/webhook/handler.test.ts` — DEVE PASSAR.
  </action>
  <verify>
    <automated>cd /root/Brain && bun test packages/transport/src/webhook/</automated>
  </verify>
  <done>
    Todos os testes do webhook (handler.test.ts + webhook-auth.test.ts) passam. Nenhum teste quebrado na suite de transport.
  </done>
</task>

<task type="auto">
  <name>Task 3: Documentar WEBHOOK_TOKEN no .env do brain-sdr</name>
  <files>
    apps/brain-sdr/.env
  </files>
  <action>
    Adicionar a variável WEBHOOK_TOKEN na seção "--- Transport ---" do .env, logo após PORT:

    ```
    # Token de autenticação para o webhook (Authorization: Bearer <token>)
    # Obrigatório — sem este valor o webhook retorna 503 para todos os requests
    WEBHOOK_TOKEN=gere-um-token-seguro-aqui
    ```

    Gerar um valor seguro de exemplo usando: `openssl rand -hex 32` e substituir o placeholder pelo valor gerado.

    DEPOIS verificar a suite completa de transport:
    `cd /root/Brain && bun test packages/transport/`
  </action>
  <verify>
    <automated>cd /root/Brain && bun test packages/transport/</automated>
  </verify>
  <done>
    .env atualizado com WEBHOOK_TOKEN com valor gerado. Toda a suite packages/transport/ passa sem erros.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Internet → POST /api/v1/webhook | Qualquer cliente HTTP pode tentar enviar eventos ao webhook |
| WEBHOOK_TOKEN env var | Segredo configurado no ambiente Docker do cliente |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-vcu-01 | Spoofing | POST /api/v1/webhook | mitigate | Verificar Authorization: Bearer token contra WEBHOOK_TOKEN env var antes de processar qualquer payload |
| T-vcu-02 | Information Disclosure | handler.ts warn log | mitigate | Log apenas "unauthorized attempt" sem logar o valor do token recebido |
| T-vcu-03 | Denial of Service | fail-open sem token | mitigate | 503 fail-closed quando WEBHOOK_TOKEN não configurado — impede aceitação de requests em estado não configurado |
| T-vcu-04 | Tampering | Timing side-channel | accept | Comparação === simples aceita — timing já é ruidoso por RTT HTTP; timingSafeEqual não agrega em endpoints HTTP |
</threat_model>

<verification>
Executar suite completa de transport após todas as tasks:

```bash
cd /root/Brain && bun test packages/transport/
```

Todos os testes devem passar, incluindo os novos testes de auth.

Verificação manual rápida (com servidor rodando localmente):
- `curl -X POST http://localhost:3001/api/v1/webhook -H "Content-Type: application/json" -d '{}' ` → 401
- `curl -X POST http://localhost:3001/api/v1/webhook -H "Authorization: Bearer token-errado" -H "Content-Type: application/json" -d '{}' ` → 401
- `curl -X POST http://localhost:3001/api/v1/webhook -H "Authorization: Bearer SEU_TOKEN" -H "Content-Type: application/json" -d '{"Name":"Teste","Message":"Olá","Numero":"5511999990001","IDLead":"lead-001"}' ` → 200
</verification>

<success_criteria>
- POST /api/v1/webhook sem token retorna 401 Unauthorized
- POST /api/v1/webhook com token errado retorna 401 Unauthorized
- POST /api/v1/webhook sem WEBHOOK_TOKEN no env retorna 503
- POST /api/v1/webhook com Bearer token correto processa normalmente
- `bun test packages/transport/` passa 100% sem regressões
- WEBHOOK_TOKEN documentado no .env do brain-sdr
</success_criteria>

<output>
Após execução, criar `.planning/quick/260614-vcu-uma-coisa-que-foi-faltando-foi-proteger-/260614-vcu-SUMMARY.md` seguindo o template em @$HOME/.claude/get-shit-done/templates/summary.md
</output>
