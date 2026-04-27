FROM node:22-slim

RUN npm install -g pnpm@10

WORKDIR /app

# ── Monorepo manifest files ────────────────────────────────────────────────────
# Copy workspace config and ALL package.json files first so pnpm can resolve
# the workspace graph before we copy any source. This layer is cached until
# a dependency actually changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

COPY artifacts/discord-bot/package.json  ./artifacts/discord-bot/
COPY artifacts/api-server/package.json   ./artifacts/api-server/
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/
COPY lib/api-client-react/package.json  ./lib/api-client-react/
COPY lib/api-spec/package.json          ./lib/api-spec/
COPY lib/api-zod/package.json           ./lib/api-zod/
COPY lib/db/package.json                ./lib/db/
COPY scripts/package.json               ./scripts/

# Install only the discord-bot package and its external dependencies.
# Using --no-frozen-lockfile so the build tolerates lockfile/override drift
# between environments without failing.
RUN pnpm install --no-frozen-lockfile --filter @workspace/discord-bot...

# ── Source files ───────────────────────────────────────────────────────────────
COPY artifacts/discord-bot/src ./artifacts/discord-bot/src
COPY artifacts/discord-bot/tsconfig.json ./artifacts/discord-bot/

# ── Data directory ─────────────────────────────────────────────────────────────
# seen-listings.json, seen-buys.json, buy-blocks.json, and mint-blocks.json
# are stored here at runtime. This directory is EPHEMERAL on Railway unless
# you attach a Volume at /app/artifacts/discord-bot/data (Hobby plan+).
RUN mkdir -p artifacts/discord-bot/data

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@workspace/discord-bot", "run", "start"]
