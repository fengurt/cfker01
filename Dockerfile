ARG TARGETPLATFORM=linux/amd64
FROM --platform=$TARGETPLATFORM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm ci
COPY . .
RUN npm run build && npm test

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    CI=true \
    WRANGLER_SEND_METRICS=false \
    CLOUDFLARE_CF_FETCH_ENABLED=false \
    PORT=8787 \
    PERSIST_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/wrangler.jsonc /app/tsconfig.json ./
COPY --from=build /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 8787
VOLUME ["/data"]
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
