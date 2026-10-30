FROM node:24.19.0-bookworm-slim

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /workspace

RUN npm install --global pnpm@11.25.0 \
  && test "$(node --version)" = "v24.19.0" \
  && test "$(pnpm --version)" = "11.25.0"

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/catalog-client/package.json packages/catalog-client/package.json
COPY packages/staff-client/package.json packages/staff-client/package.json

RUN pnpm install --frozen-lockfile \
  && pnpm exec playwright install --with-deps chromium

COPY . .

CMD ["node", "scripts/r1-010c-e2e-runner.mjs"]
