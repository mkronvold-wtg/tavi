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

FROM node:26-trixie-slim@sha256:4ebb5ace66f15a24c14c492e01a8beeed4fddf970a856109f5126e703e5fe503 AS runtime

WORKDIR /app
ENV NODE_ENV=production

# High UID satisfies KSV-0020/0021; keep the existing node username for COPY --chown.
# apt-get upgrade picks up Debian 13 security updates (util-linux CVE-2026-53612/53614).
RUN groupmod -g 10001 node \
  && usermod -u 10001 -g 10001 node \
  && apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# The runtime executes Node directly; remove the unused npm CLI and its vulnerable transitive packages.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# gzip/tar are Essential and libacl1 is a Pre-Depends of coreutils/sed, so
# apt-get remove refuses or would cascade-remove dpkg. Force-purge only these
# unused packages. Runtime is node and does not need gzip/tar/libacl1.
# CVEs: gzip CVE-2026-41991, libacl1 CVE-2026-54370, tar CVE-2026-18477.
RUN dpkg --purge --force-remove-essential --force-depends gzip libacl1 tar \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /opt/tavi/worker ./

USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4100/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/main.js"]
