# Consultar conversa via SQL

Como ler o histórico completo de mensagens de um lead diretamente no banco.

## Como o histórico funciona

O histórico de conversa (usuário + IA) fica na tabela `checkpoint_blobs`, gerenciada automaticamente pelo LangGraph via `PostgresSaver`. Cada turno é adicionado ao checkpoint do `thread_id` do lead — nunca sobrescrito.

A tabela `memories` é separada e guarda apenas dados de perfil de longo prazo (ex: última mensagem trocada). Ver seção abaixo.

## Query: mensagens de uma conversa

```sql
SELECT
  (msg->>'type') AS tipo_construtor,
  msg->'kwargs'->>'id'      AS id_mensagem,
  CASE
    WHEN msg->'kwargs'->'id' @> '["langchain_core","messages","HumanMessage"]'
      THEN 'usuario'
    WHEN msg->'kwargs'->'id' @> '["langchain_core","messages","AIMessage"]'
      THEN 'ia'
    ELSE 'outro'
  END AS lado,
  msg->'kwargs'->>'content' AS conteudo
FROM checkpoint_blobs,
     jsonb_array_elements(convert_from(blob, 'UTF8')::jsonb) AS msg
WHERE thread_id = 'SEU_ID_LEAD_AQUI'
  AND channel   = 'messages'
ORDER BY octet_length(blob), ordinality;
```

> Substitua `'SEU_ID_LEAD_AQUI'` pelo `IDLead` enviado no webhook. Esse valor é o `thread_id` do checkpoint.

### Exemplo de resultado

```
 lado    | conteudo
---------+----------------------------------------------------------
 usuario | qual seu nome ?
 ia      | Fala! Eu sou o Gabriel, especialista da Porto Maravilha
 usuario | qual vc tem mesmo ?
 ia      | Temos o Luzes do Rio, o Pixinguinha...
 usuario | Pixinguinha
 ia      | Show, você escolheu o Pixinguinha Residencial!
```

## Query simplificada: só o último snapshot

Para ver apenas o estado atual da conversa (snapshot mais recente):

```sql
SELECT
  msg->'kwargs'->>'content' AS conteudo,
  CASE
    WHEN msg->'kwargs'->'id' @> '["langchain_core","messages","HumanMessage"]'
      THEN 'usuario'
    ELSE 'ia'
  END AS lado
FROM (
  SELECT convert_from(blob, 'UTF8')::jsonb AS msgs
  FROM checkpoint_blobs
  WHERE thread_id = 'SEU_ID_LEAD_AQUI'
    AND channel   = 'messages'
  ORDER BY octet_length(blob) DESC
  LIMIT 1
) latest,
jsonb_array_elements(msgs) WITH ORDINALITY AS msg
ORDER BY ordinality;
```

## Para que serve a tabela `memories`?

A tabela `memories` é um store de **perfil de longo prazo** (chave/valor por lead). Ela não é o que dá contexto ao LLM — isso é papel dos checkpoints.

Hoje ela guarda o último turno de cada lead:

```sql
SELECT user_id, key, value FROM memories;
-- { "lastUserMessage": "...", "lastReply": "...", "conversationId": "..." }
```

**Uso previsto (fases futuras):**
- Resumos de conversa persistidos após encerramento do lead
- Preferências e dados coletados (nome, interesse, budget)
- Qualquer dado estruturado que precisa sobreviver além da janela de contexto do LLM

Por enquanto funciona como cache do último turno. O contexto real do LLM vem dos `checkpoint_blobs`.
