# Production image: one process serves the web app, the API and realtime on PORT.
#   docker build -t figma-clone .
#   docker run -p 8080:8080 -e PUBLIC_URL=http://localhost:8080 -v figma-data:/data figma-clone
# See docs/deploy.md (and docker-compose.prod.yml for running it with Postgres).

FROM node:22-slim AS build
WORKDIR /src
RUN corepack enable
# Dependencies first, so they're cached while the code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/document/package.json packages/document/
COPY packages/geometry/package.json packages/geometry/
COPY packages/layout/package.json packages/layout/
COPY packages/renderer/package.json packages/renderer/
RUN pnpm install --frozen-lockfile
COPY . .
# Settings baked into the web app at build time (optional).
ARG VITE_SENTRY_DSN=
ARG VITE_RELEASE=
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN VITE_RELEASE=$VITE_RELEASE
RUN pnpm build
# The server with only its production dependencies.
RUN pnpm --filter @figma/server deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIST=/app/web \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /out /app/server
COPY --from=build /src/apps/web/dist /app/web
# The embedded database (used when DATABASE_URL isn't set) keeps its files in /data.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "server/dist/index.mjs"]
