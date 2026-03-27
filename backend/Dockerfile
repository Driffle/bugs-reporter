# Production image (Railway / VPS). Root directory in Railway: set to `backend` if repo is monorepo.
# Debian slim: Prisma engines need OpenSSL/glibc (Alpine musl often breaks schema-engine).
FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate && npm run build

# Drop dev-only tooling if any are later moved to devDependencies
RUN npm prune --omit=dev

EXPOSE 3000

# Migrations should run in Railway "Release" / pre-deploy, not here — otherwise nothing listens on PORT
# until migrate finishes and Slack/Railway probes can time out.
CMD ["node", "dist/main.js"]
