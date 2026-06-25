---
phase: 22-fup-autom-tico
reviewed: 2026-06-23T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - packages/core/src/__tests__/unit/fup/fup-business-hours.test.ts
  - packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts
  - packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts
  - packages/core/src/fup/fup-scheduler.ts
  - packages/core/src/index.ts
  - packages/core/src/leads/lead-service.ts
  - packages/core/src/runner/runner.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 22: Code Review Report

**Reviewed:** 2026-06-23T00:00:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Revisão da fase 22 (FUP Automático): FupScheduler, integração no BrainRunner, resetFup no LeadService e suíte de testes unitários cobrindo as regras de negócio críticas.

O código apresenta qualidade geral boa — a arquitetura de duas transações para evitar envio duplicado está correta, os testes cobrem os cenários principais e as convenções de PII (não logar conteúdo de mensagem) são seguidas. Nenhum problema de segurança crítico foi encontrado.

Foram identificados 4 warnings e 3 itens informativos. Os warnings mais relevantes são: (1) a lógica de ativação do scheduler no `init()` falha silenciosamente quando `FUP_WEBHOOK_URL` está configurado mas o checkpointer é `null` — cenário possível em teste ou falha de `_compileGraph()`; (2) o `resetFup` não atualiza `updatedAt`, deixando o campo desatualizado no banco; (3) o `SIGTERM` handler é adicionado via `process.on` sem remoção, causando leak de listeners em cenários de múltiplos `init()` (ex: `refreshPrompts` + reinit).

---

## Warnings

### WR-01: FupScheduler não inicia quando checkpointer é null — falha silenciosa

**File:** `packages/core/src/runner/runner.ts:163`
**Issue:** A condição `if (fupWebhookUrl && this.checkpointer)` só inicia o `FupScheduler` quando ambos estão presentes. Se `_compileGraph()` foi chamado mas o checkpointer não foi salvo (ex: erro de regressão futura) ou se `init()` for chamado em cenário onde `DATABASE_URL` está ausente e `process.exit(1)` não estiver activo (testes com mock parcial), `FUP_WEBHOOK_URL` configurado não produz nem log de aviso. O operador configuraria a ENV e não receberia qualquer indicação de que o FUP não está ativo.

**Fix:** Adicionar log de warn quando `fupWebhookUrl` está configurado mas `this.checkpointer` é null:
```typescript
const fupWebhookUrl = process.env.FUP_WEBHOOK_URL?.trim();
if (fupWebhookUrl) {
  if (!this.checkpointer) {
    this.logger.warn(
      { brainId: this.brain.id },
      "FUP_WEBHOOK_URL configurado mas checkpointer não está disponível — FupScheduler não iniciado"
    );
  } else {
    this.fupScheduler = new FupScheduler({ ... });
    await this.fupScheduler.start();
    ...
  }
}
```

---

### WR-02: resetFup não atualiza updatedAt — campo fica desatualizado no banco

**File:** `packages/core/src/leads/lead-service.ts:135`
**Issue:** O método `resetFup` seta `{ fupNextAt: null, fupStep: 0 }` sem incluir `updatedAt: new Date()`. Todos os outros métodos de mutação do LeadService (`setFullpp`, `setIaAtivada`, `touchLastMessage` via `upsertLead`) incluem `updatedAt`. A ausência aqui é inconsistente — um reset de FUP é uma mudança de estado relevante e `updated_at` não refletirá quando ocorreu. Monitoramento e auditoria baseados em `updated_at` perderão este evento.

O comentário no código indica que `touchLastMessage` intencionalmente omite `updatedAt` por semântica diferente, mas esse raciocínio não se aplica a `resetFup` — este é uma mudança de estado programática, não um evento de mensagem.

**Fix:**
```typescript
async resetFup(uniqueId: string): Promise<void> {
  await this.db
    .update(leads)
    .set({ fupNextAt: null, fupStep: 0, updatedAt: new Date() })  // D-19: fupEnabled intencionalmente ausente
    .where(eq(leads.uniqueId, uniqueId));
}
```

---

### WR-03: Acúmulo de SIGTERM listeners em chamadas múltiplas de init()

**File:** `packages/core/src/runner/runner.ts:182`
**Issue:** O handler `process.on('SIGTERM', ...)` é registrado dentro de `init()` sem verificação prévia nem remoção posterior. Se `init()` for chamado mais de uma vez (ex: após uma falha e re-inicialização, ou em testes), múltiplos handlers serão adicionados ao mesmo processo. O Node.js/Bun emite um `MaxListenersExceededWarning` após 11 listeners e o SIGTERM poderá chamar `close()` múltiplas vezes com referências stale ao estado anterior.

**Fix:** Guardar a referência ao handler e remover antes de re-registrar, ou usar `process.once`:
```typescript
// Opção 1: usar once (SIGTERM só precisa ser tratado uma vez)
process.once('SIGTERM', async () => {
  this.logger.info({ brainId: this.brain.id }, 'SIGTERM received — shutting down cleanly');
  await this.close();
  process.exit(0);
});

// Opção 2 (se init() puder ser chamado múltiplas vezes):
private _sigtermHandler: (() => Promise<void>) | null = null;

// No início de init():
if (this._sigtermHandler) {
  process.off('SIGTERM', this._sigtermHandler);
}
this._sigtermHandler = async () => { ... };
process.on('SIGTERM', this._sigtermHandler);
```

---

### WR-04: Intervalos de retry sem delay — possível tempestade de requisições ao LLM/webhook

**File:** `packages/core/src/fup/fup-scheduler.ts:168`
**Issue:** O loop `for (let attempt = 1; attempt <= MAX_FUP_ATTEMPTS; attempt++)` executa 3 tentativas consecutivas sem nenhum atraso entre elas (comentário na linha 245 reconhece isso: "retry simples sem delay"). Se o LLM ou o webhook estiver momentaneamente sobrecarregado, as 3 tentativas serão disparadas quase simultaneamente, amplificando a pressão sobre o serviço em vez de dar tempo para recuperação. O comentário menciona "FUP-F01" como trabalho futuro para backoff exponencial.

Embora o comentário documente a ausência de backoff como decisão intencional, o risco real é que BATCH_SIZE=10 leads × 3 tentativas = até 30 chamadas paralelas ao LLM no mesmo tick sem nenhum espaçamento.

**Fix (mínimo — sem mudar a API):** Adicionar um atraso mínimo entre tentativas para evitar amplificação imediata:
```typescript
for (let attempt = 1; attempt <= MAX_FUP_ATTEMPTS; attempt++) {
  try {
    // ...
    return;
  } catch (err) {
    lastErr = err;
    this.logger.warn(...);
    if (attempt < MAX_FUP_ATTEMPTS) {
      // Backoff mínimo: 500ms entre tentativas (evita tempestade de requests)
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}
```

---

## Info

### IN-01: Monkey-patch de _sendFupWebhook no teste usa lógica desnecessariamente complexa

**File:** `packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts:102`
**Issue:** O helper `makeScheduler` sobrescreve `_sendFupWebhook` com uma função que reconstrói manualmente o payload e invoca `fetchMockFn`. A lógica condicional `scheduler["opts" as keyof typeof scheduler] ? ... : ...` (linha 105) é sempre `true` (o campo `opts` sempre existe), tornando a expressão ternária morta. O padrão de monkey-patch é funcional mas mais frágil que injetar o `fetch` via construtor ou campo protegido.

**Sugestão:** Simplificar o monkey-patch para apenas chamar `fetchMockFn` diretamente, sem re-implementar a lógica do payload:
```typescript
(scheduler as unknown as { _sendFupWebhook: Function })._sendFupWebhook = async (_lead: FupLeadRowMock, _message: string) => {
  const response = await fetchMockFn();
  if (!response.ok) throw new Error(`FUP webhook retornou ${response.status}`);
};
```

---

### IN-02: Teste EVT-03 usa setTimeout(10ms) para aguardar fire-and-forget — frágil

**File:** `packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts:253`
**Issue:** Os testes `EVT-03/D-16` e `EVT-03/D-17` usam `await new Promise((resolve) => setTimeout(resolve, 10))` para dar tempo ao fire-and-forget do `eventPublisher.publish()` completar. Esse padrão é sensível à carga do runner de testes — em máquinas lentas ou com alta concorrência de testes, 10ms pode não ser suficiente e o `publishMock` pode não ter sido chamado ainda quando a asserção executa.

**Sugestão:** Converter o `publish` para ser aguardável no teste (usando um `Promise` que resolve quando `publishMock` é chamado) ou fazer o scheduler expor a Promise do publish para que testes possam aguardá-la de forma determinística. Alternativa mínima: usar `await Bun.sleep(0)` (yield para o event loop) em vez de 10ms fixos.

---

### IN-03: FupLeadRow.fupNextAt não é usado após a query — campo desnecessário no SELECT

**File:** `packages/core/src/fup/fup-scheduler.ts:101`
**Issue:** O campo `l.fup_next_at AS "fupNextAt"` é selecionado na query de elegibilidade (linha 101) e existe na interface `FupLeadRow` (linha 327), mas nunca é referenciado no corpo de `_processFupForLead()` ou `_tick()`. O valor não é loggado, não é usado para cálculos e não influencia a lógica. Remover o campo reduz o tamanho do result set sem impacto funcional.

**Sugestão:** Remover `l.fup_next_at AS "fupNextAt"` do SELECT e o campo `fupNextAt` da interface `FupLeadRow`. Atualizar o mock `FupLeadRowMock` nos testes de acordo.

---

_Reviewed: 2026-06-23T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
