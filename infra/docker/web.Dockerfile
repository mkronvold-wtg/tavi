FROM node:26-bookworm@sha256:0353e48e0e8a993db87b720c242f54b207059d1bcc0106534896e8a11054c837 AS builder

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

FROM node:26-bookworm-slim@sha256:cd565714d4da3e84bfd341e31448f81d47c6362198f152345297c9c1154e6341 AS runtime

WORKDIR /app
ENV NODE_ENV=production

# High UID satisfies KSV-0020/0021; keep the existing node username for COPY --chown.
RUN groupmod -g 10001 node \
  && usermod -u 10001 -g 10001 node

# The runtime executes Node directly; remove the unused npm CLI and its vulnerable transitive packages.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Remove OS utilities not needed at runtime to eliminate associated CVEs
# (gzip: CVE-2026-41991, libacl1: CVE-2026-54370, tar: CVE-2026-18477).
RUN apt-get remove --purge -y gzip libacl1 tar && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/apps/web/dist ./dist
COPY --from=builder --chown=node:node /app/apps/web/scripts/serve-dist.mjs ./scripts/serve-dist.mjs
COPY --from=builder --chown=node:node /app/infra/docker/web-entrypoint.sh ./web-entrypoint.sh

# Serve /runtime-config.js from dist while writing the file on /tmp (writable under readOnlyRootFilesystem).
RUN ln -sfn /tmp/runtime-config.js /app/dist/runtime-config.js

USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4173').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["sh", "/app/web-entrypoint.sh"]
