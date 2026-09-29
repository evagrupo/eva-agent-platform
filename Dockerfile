FROM node:22.19.0-bookworm-slim AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /workspace

RUN apt-get update \
  && apt-get install --no-install-recommends --yes g++ make python3 \
  && corepack enable \
  && corepack prepare pnpm@9.15.0 --activate \
  && rm -rf /var/lib/apt/lists/*

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm exec turbo run build \
  --filter=@bb/bundled-plugins \
  --filter=@get-bb/plugin-sdk \
  --filter=@bb/app \
  --filter=@bb/server \
  --filter=@bb/host-daemon \
  --filter=bb-app \
  --concurrency=2 \
  --output-logs=errors-only \
  --summarize=false \
  --no-update-notifier
RUN pnpm deploy --filter=bb-app --prod /opt/eva-runtime

FROM node:22.19.0-bookworm-slim AS runtime

ENV NODE_ENV=production \
  BB_AUTH_REQUIRED=true \
  BB_DATA_DIR=/var/lib/eva \
  BB_SERVER_BIND_HOST=0.0.0.0 \
  BB_SERVER_PORT=38886 \
  BB_HOST_DAEMON_PORT=38887

WORKDIR /opt/eva-runtime
COPY --from=build /opt/eva-runtime ./
COPY --from=build /workspace/eva-agents-seed ./eva-agents-seed

RUN mkdir -p /var/lib/eva

VOLUME ["/var/lib/eva"]
EXPOSE 38886

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:38886/readyz').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

ENTRYPOINT ["node", "/opt/eva-runtime/dist/bb-app.js", "start"]
