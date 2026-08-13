# apps/brain-echo/Dockerfile
# Build context: raiz do monorepo (D-08)
# Uso: docker build -f apps/brain-echo/Dockerfile . -t brain-echo

# ─────────────────────────────────────────────────────────────
# Stage 1: builder
# Usa node:22-slim para ter npm/pnpm disponíveis para instalação de deps
# e compilação TypeScript. oven/bun:1 não inclui npm (requerido pelo pnpm CLI).
# ─────────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

# Copiar manifests do workspace primeiro (cache layer para deps)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
# Copiar tsconfig base (necessário para compilação dos packages)
COPY tsconfig.base.json ./
# Copiar turbo.json (Turborepo pipeline para pnpm build)
COPY turbo.json ./

# Copiar todos os packages e o app target
COPY packages/ ./packages/
COPY apps/brain-echo/ ./apps/brain-echo/

# Instalar pnpm na versão exata do projeto (npm disponível em node:22-slim)
RUN npm install -g pnpm@11.5.3

# Instalar dependências — --frozen-lockfile garante reprodutibilidade
RUN pnpm install --frozen-lockfile

# Compilar packages em ordem de dependência.
# Cada package usa `tsc` com composite + references; compilar os dependentes primeiro
# garante que os .d.ts já existam quando o package dependente for compilado.
# Nota: pnpm build (turbo) falha porque o tsconfig.base.json mapeia @brain-pkg/* para src/,
# fazendo o tsc incluir arquivos fonte externos no rootDir de cada package.
# Compilar em sequência com --filter evita esse problema via project references.
RUN pnpm --filter @brain-pkg/shared build
RUN pnpm --filter @brain-pkg/database build
RUN pnpm --filter @brain-pkg/observability build
RUN pnpm --filter @brain-pkg/ai build
RUN pnpm --filter @brain-pkg/transport build
RUN pnpm --filter @brain-pkg/memory build
RUN pnpm --filter @brain-pkg/core build
RUN pnpm --filter @brain-app/echo build

# ─────────────────────────────────────────────────────────────
# Stage 2: runner
# Imagem final com apenas artefatos de produção
# ─────────────────────────────────────────────────────────────
FROM oven/bun:1 AS runner
WORKDIR /app

# node_modules do root — contém symlinks pnpm para workspace packages
COPY --from=builder /app/node_modules ./node_modules

# Workspace packages compilados (dist/) + package.json — os symlinks em node_modules apontam
# para packages/<name>/, e o runtime lê package.json para resolver o campo "main".
# Pitfall 3: estrutura de diretórios DEVE ser idêntica ao builder para symlinks funcionarem.
# Pitfall: package.json de cada workspace é obrigatório — sem ele o runtime falha em
# "Cannot find module" mesmo com o dist presente.
COPY --from=builder /app/packages/ai/dist ./packages/ai/dist
COPY --from=builder /app/packages/ai/package.json ./packages/ai/package.json
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/package.json
COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/database/package.json ./packages/database/package.json
COPY --from=builder /app/packages/memory/dist ./packages/memory/dist
COPY --from=builder /app/packages/memory/package.json ./packages/memory/package.json
COPY --from=builder /app/packages/observability/dist ./packages/observability/dist
COPY --from=builder /app/packages/observability/package.json ./packages/observability/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/transport/dist ./packages/transport/dist
COPY --from=builder /app/packages/transport/package.json ./packages/transport/package.json

# node_modules por package — pnpm coloca deps externas não-workspace aqui
COPY --from=builder /app/packages/ai/node_modules ./packages/ai/node_modules
COPY --from=builder /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=builder /app/packages/memory/node_modules ./packages/memory/node_modules
COPY --from=builder /app/packages/observability/node_modules ./packages/observability/node_modules
COPY --from=builder /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder /app/packages/transport/node_modules ./packages/transport/node_modules

# App brain-echo compilado + node_modules do app
COPY --from=builder /app/apps/brain-echo/dist ./apps/brain-echo/dist
COPY --from=builder /app/apps/brain-echo/node_modules ./apps/brain-echo/node_modules

# Migrations SQL — NÃO estão em dist/, DEVEM ser copiadas explicitamente (Pitfall 1)
# Copiadas para /app/migrations/ — path configurado via ENV MIGRATIONS_DIR
COPY --from=builder /app/packages/database/src/migrations ./migrations

# Seed por brain_type (SEED-02/SEED-03) — SÓ o subfolder deste tipo (echo), NUNCA a árvore
# completa seeds/ (Pitfall 3 — separação física, não apenas filtro de query em runtime).
COPY --from=builder /app/packages/database/src/seeds/echo ./seeds

# Variáveis de ambiente padrão
ENV PORT=3000
ENV NODE_ENV=production
# MIGRATIONS_DIR: informa ao entrypoint onde encontrar os arquivos SQL em runtime
ENV MIGRATIONS_DIR=/app/migrations
# SEEDS_FOLDER: informa a runBrainSeed() onde encontrar os arquivos .sql do seed deste brain_type
# NOTA: nome correto é SEEDS_FOLDER (consistente com sdr/support), mesmo que este Dockerfile
# use a variável legada MIGRATIONS_DIR para migrations — inconsistência pré-existente, fora
# de escopo desta fase (ver read_first do plano).
ENV SEEDS_FOLDER=/app/seeds

# Usuário não-root para segurança (bun image já tem usuário 'bun')
USER bun

CMD ["bun", "apps/brain-echo/dist/index.js"]
