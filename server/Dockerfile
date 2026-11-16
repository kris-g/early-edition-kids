# Early Edition Kids server plus the built parent dashboard (web/) and iPad reader (reader/). Build from the REPO ROOT:
#   docker build -f server/Dockerfile .
#   docker buildx build --platform linux/amd64,linux/arm64 -f server/Dockerfile -t <registry>/early-edition-kids:<tag> .
#
# The server runs TypeScript directly with tsx (no compile step). SQLite is Node's built-in
# node:sqlite, so there are no native modules and the image is the same on amd64 and arm64.

# ---- web app: static files, so build once on the build machine's own arch ----
FROM --platform=$BUILDPLATFORM node:22-slim AS web
WORKDIR /repo/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
# The web app imports the dashboard API types from the server by relative path.
COPY server/src/dashboard/types.ts /repo/server/src/dashboard/types.ts
RUN npm run build

# ---- iPad reader: static files too (fonts come from npm, the icons are committed PNGs) ----
FROM --platform=$BUILDPLATFORM node:22-slim AS reader
WORKDIR /repo/reader
COPY reader/package.json reader/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY reader/ ./
RUN npm run build

# ---- server production dependencies ----
FROM node:22-slim AS deps
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---- runtime ----
FROM node:22-slim
LABEL org.opencontainers.image.title="Early Edition Kids" \
      org.opencontainers.image.description="A daily kids' news brief for a Kindle running KOReader, with a parent dashboard" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    EARLY_EDITION_KIDS_DATA_DIR=/data \
    EARLY_EDITION_KIDS_CONFIG=/config/config.yaml \
    EARLY_EDITION_KIDS_WEB_DIR=/app/web \
    EARLY_EDITION_KIDS_READER_DIR=/app/reader \
    HOST=0.0.0.0 \
    PORT=8080 \
    DASHBOARD_PORT=8081

# UID/GID 10001 matches runAsUser in the Deployment.
RUN groupadd --system --gid 10001 early-edition-kids \
 && useradd --system --uid 10001 --gid 10001 --home-dir /app --shell /usr/sbin/nologin early-edition-kids

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json server/tsconfig.json ./
COPY server/src ./src
# Admin scripts (run with kubectl exec), e.g. scripts/rewrite-issues.ts and scripts/import-comparison.ts.
COPY server/scripts ./scripts
COPY server/prompts ./prompts
COPY server/templates ./templates
COPY --from=web /repo/web/dist ./web
COPY --from=reader /repo/reader/dist ./reader

# A default config so the image runs on its own; the ConfigMap is mounted over /config.
COPY server/config.example.yaml /config/config.yaml
RUN mkdir -p /data && chown -R 10001:10001 /data

USER 10001:10001
VOLUME ["/data"]
# 8080: Kindle API and the iPad reader at /read/ (LAN LoadBalancer). 8081: dashboard (ClusterIP, behind Authelia).
EXPOSE 8080 8081

HEALTHCHECK --interval=60s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "--import", "tsx", "src/server.ts"]
