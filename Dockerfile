# ---- build stage ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Toolchain so native modules (better-sqlite3) can compile when no prebuilt
# binary is available for this Node/arch combination.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Static files keep the host checkout's modes through COPY (a 0700 directory on a developer machine
# would be unreadable to the runtime `node` user), so normalise them here without touching the source tree.
RUN chmod -R u=rwX,go=rX public
RUN npm run build

# ---- production dependencies ----
# Install runtime deps only, so build tooling (e.g. the esbuild Go binary) never
# reaches the shipped image. Native modules still compile here.
FROM node:24-bookworm-slim AS prod-deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime stage ----
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Release identity: the app reports it and the updater verifies it after pulling.
ARG CHIBAKO_VERSION=0.0.0
ARG CHIBAKO_COMMIT=unknown
ENV CHIBAKO_VERSION=$CHIBAKO_VERSION
LABEL org.opencontainers.image.source="https://github.com/jccd-dev/chibako" \
      org.opencontainers.image.version=$CHIBAKO_VERSION \
      org.opencontainers.image.revision=$CHIBAKO_COMMIT

# gosu lets the entrypoint fix bind-mount ownership as root, then drop to `node`.
RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/* \
    /usr/local/lib/node_modules/npm \
    /usr/local/bin/npm \
    /usr/local/bin/npx

COPY --from=build /app/package.json ./
# Next standalone server (self-contained, includes its own traced deps)
COPY --from=build /app/.next/standalone ./
# Production-only node_modules so native modules (better-sqlite3) are guaranteed present
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Bundled MCP server for agent access (dist/mcp/server.mjs)
COPY --from=build /app/dist ./dist

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
  && mkdir -p /app/data /app/.next/cache \
  && chown -R node:node /app/data /app/.next/cache

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# entrypoint runs as root: chowns DATA_DIR, drops to `node`, execs the CMD.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]
