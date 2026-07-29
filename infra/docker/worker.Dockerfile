FROM node:26-bookworm@sha256:219fc9da91e7f29a9f32290ff598cdf8886fd68f421ff515c8f93434da39a271 AS builder

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

FROM node:26-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder --chown=node:node /opt/tavi/worker ./

USER node

CMD ["node", "dist/main.js"]
