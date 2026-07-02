# Phase 28: Embedding SDK - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-30
**Phase:** 28-embedding-sdk
**Areas discussed:** Estrutura do pacote + integração com RAG existente, Fix da migration D-16, Escopo EMBD-05 no BrainRunner, EMBEDDING_PROVIDER independente do LLM_PROVIDER

---

## Estrutura do pacote + integração com RAG existente

| Option | Description | Selected |
|--------|-------------|----------|
| Substituir tudo | IEmbeddingProvider vira a única forma de gerar embedding; search-knowledge.ts e rag/ingest.ts migram | ✓ |
| Coexistir por agora | IEmbeddingProvider só nos pontos novos (BrainRunner); RAG existente não muda | |

**User's choice:** Substituir tudo (recomendado)

| Option | Description | Selected |
|--------|-------------|----------|
| Manter Gemini também | Cria GeminiEmbeddingProvider preservando suporte atual | ✓ |
| Só OpenAI agora | Remove Gemini, conforme mínimo do REQUIREMENTS.md | |

**User's choice:** Manter Gemini também (GeminiEmbeddingProvider)

| Option | Description | Selected |
|--------|-------------|----------|
| Envolver LangChain OpenAIEmbeddings | Consistente com createLLM(), menor esforço | ✓ |
| SDK oficial da OpenAI direto | Mais controle, diverge do padrão do projeto | |

**User's choice:** Envolver LangChain OpenAIEmbeddings (recomendado)

**Notes:** Nenhuma pergunta adicional — usuário seguiu direto para próxima área.

---

## Fix da migration com vector(1536) hardcoded (D-16)

| Option | Description | Selected |
|--------|-------------|----------|
| Ainda não há clientes reais em produção | Fix pode ser mais agressivo | ✓ |
| Já há dados reais de cliente | Precisaria de plano de migração de dados | |

**User's choice:** Ainda não há clientes reais em produção

| Option | Description | Selected |
|--------|-------------|----------|
| Nova migration 0009 com ALTER COLUMN | Preserva histórico imutável do Drizzle | ✓ |
| Editar a migration 0007 diretamente | Mais limpo mas quebra imutabilidade | |
| Gerar a migration dinamicamente via script | Genérico mas diverge do padrão Drizzle | |

**User's choice:** Nova migration 0009 com ALTER COLUMN (recomendado)

| Option | Description | Selected |
|--------|-------------|----------|
| Gerar 0009 a partir do .env no momento do drizzle-kit generate | SQL estático, padrão Drizzle preservado | ✓ |
| runMigrations() interpola EMBEDDING_DIMENSIONS em runtime | Dinâmico mas foge do padrão Drizzle puro | |

**User's choice:** Gerar 0009 a partir do EMBEDDING_DIMENSIONS do .env no momento do drizzle-kit generate (recomendado)

**Notes:** Nenhuma pergunta adicional — usuário seguiu direto para próxima área.

---

## Escopo da escrita semântica no BrainRunner (EMBD-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Embedar mensagem do usuário antes do getContext() (linha 296) | Ativa busca semântica de memória | ✓ |
| Embedar profileValue no saveContext() (linhas 377-385) | Resolve MEM-03 original | ✓ |

**User's choice:** Ambos (multiSelect)

| Option | Description | Selected |
|--------|-------------|----------|
| Bloqueante, faz parte do fluxo principal | getContext() depende do resultado | ✓ |
| Assíncrono, não bloqueia resposta | Exigiria redesenho do fluxo | |

**User's choice:** Bloqueante (recomendado)

| Option | Description | Selected |
|--------|-------------|----------|
| Fallback gracioso — segue sem memória semântica | Mesmo padrão de resiliência do projeto | ✓ |
| Propaga o erro e falha a mensagem | Contraria padrão de resiliência estabelecido | |

**User's choice:** Fallback gracioso (recomendado)

**Notes:** Nenhuma pergunta adicional — usuário seguiu direto para última área.

---

## EMBEDDING_PROVIDER independente do LLM_PROVIDER

| Option | Description | Selected |
|--------|-------------|----------|
| Introduzir EMBEDDING_PROVIDER agora | Já documentada no CLAUDE.md como parte do v1.5 | ✓ |
| Manter acoplado, resolver na Fase 29 | Fica como dívida técnica | |

**User's choice:** Introduzir EMBEDDING_PROVIDER agora (recomendado)

**Notes:** Usuário levantou preocupação extra fora das opções apresentadas — pediu para manter o fallback automático (EMBEDDING_PROVIDER ausente → resolve com base no LLM_PROVIDER) e garantir que trocar de provider não quebra nem exige "re-subir" material já processado.

| Option | Description | Selected |
|--------|-------------|----------|
| Não precisa rebuildar/redeployar a imagem Docker | Confirmação de comportamento já existente | |
| Não precisa re-embedar os dados já salvos | Preocupação real levantada pelo usuário | ✓ |

**User's choice:** Não precisa re-embedar os dados já salvos (knowledge_chunks, memórias)

**Notes:** Isso levou a uma discussão estendida sobre viabilidade técnica. Claude explicou que embeddings de providers/modelos diferentes não são comparáveis (limitação de fato, não de implementação). Usuário pediu pesquisa (WebSearch) para confirmar. Pesquisa 1 (geral pgvector/re-embed) e pesquisa 2 (específica Gemini vs OpenAI) confirmaram: não há solução — troca de provider sempre exige re-embed do conteúdo já processado, mas o texto original não se perde (fica preservado na tabela knowledge_chunks).

Após a confirmação, o usuário inicialmente aceitou deixar a ferramenta de re-embed em lote fora do escopo da Fase 28 ("Sim, esse plano atende"), depois pediu pesquisa adicional de confirmação, e por fim reverteu a decisão: **"então coloca o re-embed nos planos"** — ferramenta de re-embed em lote passa a fazer parte do escopo da Fase 28 (capturada como D-16 em CONTEXT.md, com escopo explicitamente limitado a um reprocessamento básico, não ao pipeline enterprise-grade de zero-downtime).

Decisão final sobre validação de dimensão incompatível: BrainRunner.init() falha rápido com erro claro (D-15), em vez de deixar o Postgres rejeitar o INSERT durante um atendimento real.

---

## Claude's Discretion

- Nome e path exatos do endpoint/script de re-embed.
- Mecanismo exato de filtro por embedding_model no search_knowledge.
- Estrutura interna de arquivos do packages/embeddings.
- Mensagem exata de erro de validação de dimensão no BrainRunner.init().
- Estratégia de batching do re-embed tool (tudo de uma vez vs paginado).

## Deferred Ideas

- Pipeline enterprise-grade de zero-downtime para troca de modelo (shadow index, recalibração de threshold, arquitetura event-driven) — fica para reavaliação futura quando houver volume real de clientes/dados.
- Múltiplos adapters de embedding além de OpenAI/Gemini (Cohere, local) — já Out of Scope em REQUIREMENTS.md, não revisitado.
- Dimensões independentes por tabela (embeddings vs knowledgeChunks) — anotado para possível reavaliação na Fase 29 (Brain Suporte).
