FROM node:26-bookworm@sha256:219fc9da91e7f29a9f32290ff598cdf8886fd68f421ff515c8f93434da39a271 AS builder

WORKDIR /app
ARG PNPM_VERSION=10.33.0
ARG TAVI_BUILD_SHA=local
ARG TAVI_BUILD_DATE=local
ENV VITE_TAVI_BUILD_SHA=${TAVI_BUILD_SHA}
ENV VITE_TAVI_BUILD_DATE=${TAVI_BUILD_DATE}
RUN npm install --global "pnpm@${PNPM_VERSION}"

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY infra/docker/web-entrypoint.sh infra/docker/web-entrypoint.sh

RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages packages
RUN chmod +x infra/docker/web-entrypoint.sh

RUN pnpm install --frozen-lockfile --offline

RUN pnpm --filter @tavi/config build \
  && pnpm --filter @tavi/schemas build \
  && pnpm --filter @tavi/web build

FROM node:26-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder --chown=node:node /app/apps/web/dist ./dist
COPY --from=builder --chown=node:node /app/apps/web/scripts/serve-dist.mjs ./scripts/serve-dist.mjs
COPY --from=builder --chown=node:node /app/infra/docker/web-entrypoint.sh ./web-entrypoint.sh

USER node

ENTRYPOINT ["sh", "/app/web-entrypoint.sh"]
