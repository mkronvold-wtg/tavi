FROM node:26-bookworm@sha256:70b4206f32b0aaa37f4d018475ec0f4f3a9624aa4ceb06d8377718de843452dc AS builder

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

FROM node:26-bookworm-slim@sha256:81502e860176e63695d769d3d1a2d3a403abc1c27c6a02169b765f3e43b60ede AS runtime

WORKDIR /app
ENV NODE_ENV=production

# The runtime executes Node directly; remove the unused npm CLI and its vulnerable transitive packages.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=builder --chown=node:node /app/apps/web/dist ./dist
COPY --from=builder --chown=node:node /app/apps/web/scripts/serve-dist.mjs ./scripts/serve-dist.mjs
COPY --from=builder --chown=node:node /app/infra/docker/web-entrypoint.sh ./web-entrypoint.sh

USER node

ENTRYPOINT ["sh", "/app/web-entrypoint.sh"]
