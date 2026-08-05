FROM node:26-bookworm@sha256:70b4206f32b0aaa37f4d018475ec0f4f3a9624aa4ceb06d8377718de843452dc AS builder

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

FROM node:26-bookworm-slim@sha256:81502e860176e63695d769d3d1a2d3a403abc1c27c6a02169b765f3e43b60ede AS runtime

WORKDIR /app
ENV NODE_ENV=production

# The runtime executes Node directly; remove the unused npm CLI and its vulnerable transitive packages.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=builder --chown=node:node /opt/tavi/worker ./

USER node

CMD ["node", "dist/main.js"]
