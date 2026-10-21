FROM node:24.19.0-bookworm-slim AS build
WORKDIR /repo
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,id=stdu-pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN pnpm --filter @stdu/api build
RUN pnpm --filter @stdu/api deploy --prod --legacy /runtime

FROM node:24.19.0-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
WORKDIR /app
RUN mkdir -p /data/files && chown node:node /data/files
COPY --from=build --chown=node:node /runtime /app
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
