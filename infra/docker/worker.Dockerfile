FROM node:26-bookworm@sha256:0353e48e0e8a993db87b720c242f54b207059d1bcc0106534896e8a11054c837 AS builder

WORKDIR /app
ARG PNPM_VERSION=10.33.0
ARG TAVI_BUILD_SHA=local
ARG TAVI_BUILD_DATE=local
RUN npm install --global "pnpm@${PNPM_VERSION}"

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/schemas/package.json packages/schemas/package.json

RUN pnpm install --frozen-lockfile

COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY apps/worker apps/worker
COPY packages/config packages/config
COPY packages/schemas packages/schemas

RUN pnpm install --frozen-lockfile --offline

RUN pnpm --filter @tavi/config build \
  && pnpm --filter @tavi/schemas build \
  && pnpm --filter @tavi/api prisma:generate \
  && pnpm --filter @tavi/worker build \
  && pnpm --filter @tavi/worker deploy --legacy --prod /opt/tavi/worker \
  && GENERATED="$(find /app/node_modules -type f -path '*/.prisma/client/default.js' | head -n 1)" \
  && test -n "$GENERATED" \
  && CLIENT_PKG="$(readlink -f /opt/tavi/worker/node_modules/@prisma/client)" \
  && DEST_NM="$(dirname "$(dirname "$CLIENT_PKG")")" \
  && mkdir -p "$DEST_NM/.prisma" \
  && rm -rf "$DEST_NM/.prisma/client" \
  && cp -a "$(dirname "$GENERATED")" "$DEST_NM/.prisma/client" \
  && test -f "$DEST_NM/.prisma/client/default.js"

FROM node:26-bookworm-slim@sha256:cd565714d4da3e84bfd341e31448f81d47c6362198f152345297c9c1154e6341 AS runtime

WORKDIR /app
ENV NODE_ENV=production

# High UID satisfies KSV-0020/0021; keep the existing node username for COPY --chown.
RUN groupmod -g 10001 node \
  && usermod -u 10001 -g 10001 node

# The runtime executes Node directly; remove the unused npm CLI and its vulnerable transitive packages.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=builder --chown=node:node /opt/tavi/worker ./

USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4100/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/main.js"]
