# ---- build stage ----
FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime stage ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=build /app/package.json ./
# Next standalone server (self-contained, includes its own traced deps)
COPY --from=build /app/.next/standalone ./
# Full node_modules on top so native modules (better-sqlite3) are guaranteed present
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Bundled MCP server for agent access (dist/mcp/server.mjs)
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]