FROM node:26-bookworm@sha256:9f94d34c787165dca03b74e5bf9c3bf90e8de79b19aa3d87fe1fa1694bf75c89 AS builder

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

FROM node:26-trixie-slim@sha256:c0753125a3789977aefe869cbebccf70e3cfd7ea84ca48547458f02e4f1d7146 AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV TMPDIR=/tmp

# High UID satisfies KSV-0020/0021; keep the existing node username for COPY --chown.
# libssl3t64 provides libssl.so.3 for Prisma's schema-engine (Trixie slim does
# not ship it; the bookworm package name libssl3 is not in this suite).
# apt-get upgrade picks up Debian 13 security updates (util-linux CVE-2026-53612/53614).
RUN groupmod -g 10001 node \
  && usermod -u 10001 -g 10001 node \
  && apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends libssl3t64 \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# gzip/tar are Essential and libacl1 is a Pre-Depends of coreutils/sed, so
# apt-get remove refuses or would cascade-remove dpkg. Force-purge only these
# unused packages after libssl3t64 is installed. schema-engine needs
# libssl.so.3, not gzip/tar/libacl1. Production migrate invokes the Prisma
# CLI with node (not the npm .bin shim, which calls sed/libacl).
# CVEs: gzip CVE-2026-41991, libacl1 CVE-2026-54370, tar CVE-2026-18477.
RUN dpkg --purge --force-remove-essential --force-depends gzip libacl1 tar \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /opt/tavi/api ./

USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/main"]
