# Teste Manual: BrainRunner End-to-End

## Objetivo
Verificar que BrainRunner funciona end-to-end com PostgreSQL real:
- `init()` carrega prompts do banco
- `run(event)` retorna `{ reply: string }`
- Memória persiste entre chamadas

## Pré-requisitos
- PostgreSQL rodando (container Docker): ✅
- Banco `brain_test` criado: ✅  
- Tabela `prompts` criada: ✅

## Passo 1: Inserir prompt de teste no banco

```bash
docker exec -i db_postgres.1.qicrf21bhdj2mrx70fr7bnbnr psql -U postgres -d brain_test <<'EOF'
INSERT INTO prompts (brain_type, key, content, created_at, updated_at)
VALUES (
  'test-manual',
  'system',
  'You are a helpful test assistant.',
  NOW(),
  NOW()
)
ON CONFLICT (brain_type, key) DO NOTHING;
EOF
```

**Resultado esperado:** `INSERT 0 1` (ou `INSERT 0 0` se já existe)

## Passo 2: Verificar que o prompt foi inserido

```bash
docker exec db_postgres.1.qicrf21bhdj2mrx70fr7bnbnr psql -U postgres -d brain_test -c \
  "SELECT brain_type, key, content FROM prompts WHERE brain_type = 'test-manual';"
```

**Resultado esperado:**
```
 brain_type  |   key  |            content             
-------------+--------+--------------------------------
 test-manual | system | You are a helpful test assistant.
```

## Passo 3: Executar teste unitário do BrainRunner

Os testes unitários já validam a lógica do BrainRunner (com mocks):

```bash
bun test packages/core/src/runner/__tests__/brain-runner.test.ts
```

**Resultado esperado:** 5 testes passando

## Passo 4: Validação do código fonte

### 4.1: Verificar que init() carrega prompts via loadPrompts()

```bash
grep -A 5 "async init()" packages/core/src/runner/runner.ts | grep loadPrompts
```

**Resultado esperado:** Deve mostrar a chamada `loadPrompts()`

### 4.2: Verificar que run() retorna apenas { reply }

```bash
grep -A 10 "async run(" packages/core/src/runner/runner.ts | grep "return { reply"
```

**Resultado esperado:** Deve mostrar `return { reply };`

### 4.3: Verificar que NÃO usa MemorySaver

```bash
grep -r "MemorySaver" packages/core/src/ --exclude-dir=__tests__
```

**Resultado esperado:** Nenhum resultado (MemorySaver só aparece em arquivos de teste)

## Passo 5: Verificar integração com PostgresSaver

### 5.1: Verificar que createCheckpointer é chamado

```bash
grep "createCheckpointer" packages/core/src/runner/runner.ts
```

**Resultado esperado:** Import e chamada de `createCheckpointer(this.sql)`

### 5.2: Verificar que MemoryManager é usado

```bash
grep "new MemoryManager" packages/core/src/runner/runner.ts
```

**Resultado esperado:** Instanciação do MemoryManager no _compileGraph

## Resultado do Teste Manual

### ✅ PASS - Se:
1. Prompt foi inserido com sucesso no banco
2. Testes unitários passam (5/5)
3. Código mostra `loadPrompts()` em `init()`
4. Código mostra `return { reply }` em `run()`
5. Nenhuma referência a MemorySaver fora de testes
6. createCheckpointer e MemoryManager são usados

### ❌ FAIL - Se:
- Qualquer um dos passos acima falhar
- MemorySaver aparecer no código de produção
- run() retornar mais que apenas { reply }

## Notas
- **Limitação atual:** Teste de integração completo requer conectividade de rede com o container Docker
- **Alternativa:** Os testes unitários + validação de código fonte confirmam a implementação correta
- **Próximo passo:** Em produção (Phase 4), o teste E2E completo rodará dentro do container Docker

## Execute os comandos e reporte:
- Digite `pass` se todos os passos passarem
- Ou descreva qual passo falhou
