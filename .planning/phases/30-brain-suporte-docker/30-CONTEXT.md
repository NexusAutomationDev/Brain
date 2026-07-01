# Phase 30: Brain Suporte Docker - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

`apps/brain-support` ganha uma imagem Docker multi-stage independente (padrão do `apps/brain-sdr/Dockerfile`, adaptado) que builda, sobe, migra e atende mensagens — pronta para entrega a clientes (SUP-06). O escopo foi ampliado durante a discussão para incluir dois itens correlatos descobertos na investigação (fix do Dockerfile do brain-sdr e CI/CD de publish), ambos aprovados explicitamente pelo usuário — ver decisões abaixo.

</domain>

<decisions>
## Implementation Decisions

### Dockerfile do brain-support
- **D-01:** Multi-stage idêntico ao padrão `apps/brain-sdr/Dockerfile` (builder `node:22-slim` + pnpm + `tsc` por package em sequência de dependência; runner `oven/bun:1`, `USER bun` non-root).
- **D-02:** Build stage deve compilar e copiar **todos** os packages que `@brain-app/support` depende transitivamente: `shared`, `database`, `observability`, `ai`, `transport`, `memory`, `embeddings`, `core` — nessa ordem de dependência (ver D-03 sobre o gap descoberto).
- **D-03 (gap corrigido no mesmo esforço):** O `Dockerfile` atual do `apps/brain-sdr` **não builda nem copia `packages/embeddings`**, apesar do código do brain-sdr importar `@brain-pkg/embeddings` desde a Phase 28 — a imagem de produção do brain-sdr está provavelmente quebrada hoje (`Cannot find module '@brain-pkg/embeddings'` em runtime). Usuário confirmou corrigir isso **na mesma fase**: aplicar o `RUN pnpm --filter @brain-pkg/embeddings build` + `COPY --from=builder .../packages/embeddings/dist` + `.../package.json` + `.../node_modules` no Dockerfile do brain-sdr, usando o padrão correto recém-escrito para brain-support como referência.
- **D-04:** Migrations continuam usando o padrão real já em produção — `packages/database/src/migrations` **compartilhado** entre todos os Brains (mesmo padrão do brain-sdr), copiado para `/app/migrations` via `ENV MIGRATIONS_FOLDER=/app/migrations`. **Não** criar `apps/brain-support/migrations/` isolado, mesmo que o checklist "Como Criar um Novo Brain" do `CLAUDE.md` documente migrations por-Brain — essa divergência entre documentação e prática real é conhecida e aceita; isolar migrations é fora de escopo desta fase (ficou anotado no backlog, ver `<deferred>`).
- **D-05:** Zero referências a `brain-sdr`/`brain-echo` no Dockerfile do brain-support (mesmo anti-pattern check que a Phase 9 aplicou ao brain-sdr).

### .dockerignore
- **D-06:** Criar um `.dockerignore` na **raiz do repo** (contexto de build é `.` para todos os Brains via `docker build -f apps/<brain>/Dockerfile .`) cobrindo `node_modules`, `.env*`, `.git`, `dist` de fora do builder, etc. Usuário optou por corrigir para **todos os Brains de uma vez** (brain-sdr, brain-echo, brain-support), não só brain-support — nenhum Brain tem `.dockerignore` hoje.

### Validação end-to-end
- **D-07:** Validação deve ser um **round-trip completo e real**, não apenas revisão de código/grep (diferente de como a Phase 9 validou o Dockerfile original do brain-sdr). Sequência:
  1. `docker build -f apps/brain-support/Dockerfile . -t brain-support` deve concluir sem erro.
  2. Subir um **Postgres efêmero isolado** (container pgvector descartável, criado só para este teste) — **nunca** o Postgres de produção do host (`db_postgres`, que serve outros serviços live no mesmo swarm: traefik, dockgate, webhookgateway, etc). Aplicar `DATABASE_NAME` próprio de teste.
  3. Rodar o container `brain-support` apontando para esse Postgres efêmero; confirmar `runMigrations()` com advisory lock aplica as migrations e `GET /health` retorna status `ok`.
  4. Enviar uma mensagem de teste real via `POST /api/v1/webhook` (com `LLM_PROVIDER`/`API_KEY` reais do `.env` local) e confirmar que a resposta é um `BrainOutput` válido (`fullResponse` + `responseMode`).
  5. Derrubar/limpar o Postgres efêmero e o container de teste ao final — nada deve persistir tocando a infraestrutura de produção do host.
- **D-08:** Docker CLI e daemon já estão disponíveis neste ambiente de execução (`docker info` responde) — a validação pode e deve ser executada de verdade pelo executor, não apenas descrita.

### docker-compose para teste local
- **D-09:** Criar `apps/brain-support/docker-compose.yml` (ou na raiz, à critério do planner) subindo Postgres (imagem `pgvector/pgvector`, consistente com a imagem já usada em produção neste host) + o serviço `brain-support` juntos, para reproduzir a validação e2e localmente sem precisar lembrar os comandos `docker run` manuais. Nenhum outro Brain tem isso hoje — é uma conveniência nova, aprovada explicitamente pelo usuário (não é scope creep de capability, é tooling de suporte à validação).

### CI/CD — publish workflow (escopo ampliado, aprovado pelo usuário)
- **D-10:** Criar `.github/workflows/publish-brain-support.yml` espelhando exatamente `.github/workflows/publish-brain-sdr.yml` (Docker Buildx build → `docker save` + sha256 → upload pro MinIO via DockGate → publish latest version via DockGate). Ajustar apenas:
  - `APP_NAME: brain-support`
  - `IMAGE_NAME: brain-support`
  - `file: apps/brain-support/Dockerfile`
  - cache scope (`scope=brain-support` em vez de `scope=brain-sdr`)
- **D-11 (revisado):** Trigger de tag usa o **mesmo padrão** do brain-sdr — `v*.*.*` / `v*.*` (não um prefixo próprio). Usuário revisou a decisão original (que propunha `brain-support-v*.*.*`) e confirmou manter igual ao brain-sdr: um push de tag `v1.0.0` dispara **ambos** os workflows (`publish-brain-sdr.yml` e `publish-brain-support.yml`) simultaneamente — comportamento aceito intencionalmente, sem necessidade de tags separadas por app.
- **D-12:** Secrets `DOCKGATE_URL` e `DOCKGATE_UPLOAD_TOKEN` já existem no repo (usados pelo workflow do brain-sdr) — **não** é necessário criar novos secrets, apenas reusar os mesmos no novo workflow.

### Claude's Discretion
- Exato path do `docker-compose.yml` (raiz vs `apps/brain-support/`) — decidir durante planning/execução com base no que for mais consistente com o resto do monorepo.
- Nome do container/serviço no compose, portas expostas, valores de placeholder para ENVs sensíveis.
- Se o fix do Dockerfile do brain-sdr (D-03) deve ser um plano/commit separado do Dockerfile do brain-support, para manter rastreabilidade de código-review — mas ambos pertencem à Phase 30 conforme decidido.
- Estratégia exata para provisionar o Postgres efêmero de teste (ex.: `docker run` direto vs usar o próprio `docker-compose.yml` de D-09 para a validação).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Padrão de referência (Docker/CI-CD existente)
- `apps/brain-sdr/Dockerfile` — padrão multi-stage a replicar/adaptar; contém o gap de `packages/embeddings` (D-03) a corrigir também aqui.
- `.github/workflows/publish-brain-sdr.yml` — padrão de CI/CD a espelhar para brain-support (D-10/D-11/D-12); o comentário do próprio arquivo já antecipa "Para adicionar brain-echo: copiar este workflow, ajustar APP_NAME e IMAGE_NAME".

### Brain Suporte (código-fonte já existente, Phase 29)
- `apps/brain-support/src/index.ts` — entrypoint; ENVs obrigatórias (`DATABASE_HOST/PORT/USER/PASSWORD/NAME`, `DATABASE_URL`).
- `apps/brain-support/package.json` — dependências workspace a compilar no builder stage (`shared`, `database`, `observability`, `ai`, `transport`, `memory`, `embeddings`, `core`).
- `apps/brain-support/.env.example` — ENVs documentadas; `MIGRATIONS_FOLDER=../../packages/database/src/migrations` confirma D-04.

### Roadmap/Requirements
- `.planning/ROADMAP.md` §"Phase 30: Brain Suporte Docker" — goal, success criteria (3 itens), requirement SUP-06.
- `.planning/REQUIREMENTS.md` linha 29/73 — SUP-06 pendente, mapeado para Phase 30.

### Convenção documentada (divergente da prática real — ver D-04)
- `CLAUDE.md` §"Como Criar um Novo Brain" — documenta `migrations/` por-Brain; **não seguido na prática** (migrations compartilhadas em `packages/database/src/migrations`). Downstream agents devem seguir a prática real (brain-sdr), não o texto do checklist, para este item específico.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/brain-sdr/Dockerfile` — 90% reusável como template; apenas trocar `sdr`→`support` nos paths/nomes e corrigir o gap de embeddings (que se aplica a ambos).
- `packages/database/src/migrations/*.sql` + `meta/_journal.json` — migrations compartilhadas já cobrem o schema necessário para brain-support (migration `0010_brain_support_prompts.sql` já existe).

### Established Patterns
- Multi-stage build: `node:22-slim` (builder, tem npm/pnpm) → `oven/bun:1` (runner, sem npm).
- `pnpm --filter <pkg> build` em sequência de dependência (não `pnpm build`/turbo — falha por causa do mapeamento `@brain-pkg/*` → `src/` no `tsconfig.base.json`).
- Cada package copiado no runner precisa de `dist/`, `package.json` E `node_modules` próprio — omitir qualquer um causa `Cannot find module` em runtime (isso é exatamente o que está faltando para `embeddings` no Dockerfile atual do brain-sdr).
- `ENV MIGRATIONS_FOLDER=/app/migrations` (não `MIGRATIONS_DIR` — nome errado usado historicamente pelo brain-echo).
- `USER bun` non-root antes do `CMD` (ASVS L1 V10.2.1, seguido em todas as fases anteriores).

### Integration Points
- Ambiente de execução tem Docker daemon ativo (`docker info` funciona) e um Postgres `pgvector/pgvector:pg14` de produção já rodando no mesmo host Swarm junto com outros serviços live (traefik, dockgate, webhookgateway, portainer, etc.) — validação e2e desta fase deve usar infraestrutura **efêmera e isolada**, nunca os containers de produção do host (D-07).
- `.env` local e `apps/brain-sdr/.env` já têm credenciais reais (`API_KEY`, `LLM_PROVIDER`, `DATABASE_URL`) que podem ser reusadas/adaptadas para a validação e2e real.

</code_context>

<specifics>
## Specific Ideas

- Usuário quer que o fix do gap `packages/embeddings` no Dockerfile do brain-sdr saia junto desta fase, não como item separado.
- Usuário quer .dockerignore corrigido para os 3 Brains de uma vez (brain-sdr, brain-echo, brain-support), não só brain-support.
- Usuário quer CI/CD de publish para brain-support espelhando o padrão exato do brain-sdr, com prefixo de tag próprio (`brain-support-v*.*.*`) para não colidir com o disparo do brain-sdr.

</specifics>

<deferred>
## Deferred Ideas

### Isolar migrations por Brain (alinhar com CLAUDE.md documentado)
Hoje `packages/database/src/migrations` é compartilhado entre todos os Brains — o `CLAUDE.md` documenta migrations isoladas por-Brain (`apps/brain-{tipo}/migrations/`), mas essa não é a prática real. Corrigir essa divergência (mover SQLs, ajustar `_journal.json` por Brain, revalidar brain-sdr) é uma refatoração maior, fora do escopo de SUP-06/Phase 30. Ficou como possível item de backlog/fase futura se o time decidir alinhar documentação e prática.

### Reviewed Todos (not folded)
Nenhum todo pendente foi encontrado com relevância para esta fase (`todo match-phase 30` não retornou matches).

[Nenhuma outra ideia fora de escopo surgiu durante a discussão.]

</deferred>

---

*Phase: 30-brain-suporte-docker*
*Context gathered: 2026-07-01*
