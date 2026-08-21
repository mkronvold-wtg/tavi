FROM node:26-bookworm@sha256:0353e48e0e8a993db87b720c242f54b207059d1bcc0106534896e8a11054c837 AS builder

WORKDIR /app
ARG PNPM_VERSION=10.33.0
ARG TAVI_BUILD_SHA=local
ARG TAVI_BUILD_DATE=local
RUN npm install --global "pnpm@${PNPM_VERSION}"

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/schemas/package.json packages/schemas/package.json

RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages packages

RUN pnpm install --frozen-lockfile --offline

RUN pnpm --filter @tavi/config build \
  && pnpm --filter @tavi/schemas build \
  && pnpm --filter @tavi/api prisma:generate \
  && pnpm --filter @tavi/api build \
  && pnpm --filter @tavi/api deploy --legacy --prod /opt/tavi/api

WORKDIR /opt/tavi/api
RUN ./node_modules/.bin/prisma generate \
  && test -f node_modules/.prisma/client/default.js \
    -o -n "$(find node_modules -type f -path '*/.prisma/client/default.js' | head -n 1)" \
  && test -n "$(find node_modules -name 'schema-engine-debian-openssl-3*' -type f | head -n 1)"

FROM node:26-bookworm-slim@sha256:cd565714d4da3e84bfd341e31448f81d47c6362198f152345297c9c1154e6341 AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV TMPDIR=/tmp

# High UID satisfies KSV-0020/0021; keep the existing node username for COPY --chown.
# libssl3 provides libssl.so.3 for Prisma's schema-engine (slim does not ship it; openssl CLI is not required).
RUN groupmod -g 10001 node \
  && usermod -u 10001 -g 10001 node \
  && apt-get update \
  && apt-get install -y --no-install-recommends libssl3 \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Remove OS utilities not needed at runtime to eliminate associated CVEs
# (tar: CVE-2026-18477, gzip: CVE-2026-41991, libacl1: CVE-2026-54370).
RUN apt-get remove --purge -y gzip libacl1 tar && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /opt/tavi/api ./

USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/main"]
