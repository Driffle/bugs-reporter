# Bugs Reporter

Slack bot that watches a channel for bug reports (emoji :bug: or keywords) and creates tickets in your self-hosted Plane (e.g. [plan.driffle.org](https://plan.driffle.org/driffle/)).

## Local setup (test before you push)

### 1a. Full stack in Docker (Deployer-style, thin local file)

**`docker-compose.prod.yml`** is the canonical stack (app + embedded Postgres + Redis). **`docker-compose.yml`** only `include`s prod and adds **host `ports`** on DBs for local tools.

From the **repo root**:

```bash
cp .env.example .env
# Edit .env (Slack, Plane, secrets). Defaults match embedded postgres/redis hostnames.
docker compose up --build
```

Validate the prod file anytime:

```bash
docker compose -f docker-compose.prod.yml config
```

- API: **http://localhost:3000/health**
- Postgres: `localhost:5432` (user `bugs`, password `bugs`, db `bugs_reporter`)
- Redis: `localhost:6379`

### 1b. Only Postgres + Redis (run Nest on the host)

```bash
docker compose up -d postgres redis
```

Use **`backend/.env`** (from `backend/.env.example`) with `DATABASE_URL=postgresql://bugs:bugs@localhost:5432/bugs_reporter` and `REDIS_HOST=localhost`.

### 2. Environment files

- **Docker Compose** (repo root): `cp .env.example .env` — used by `env_file` / substitution for the `bugs-reporter` service.
- **Nest on the host** (`npm run start:dev` from `backend/`): `cp .env.example .env` inside `backend/` — see **`backend/.env.example`** (localhost DB/Redis).

For **Slack** and **Plane** you can leave placeholders to only test that the app starts; add real values when you want to test the full flow.

```bash
# Install deps and run migrations
npm install
npx prisma generate
npx prisma migrate deploy   # or: npm run prisma:migrate

# Optional: seed (no required data)
npm run prisma:seed
```

### 3. Run the backend locally

```bash
npm run start:dev
```

You should see the app listening on `http://localhost:3000`. The Slack Events URL you’ll configure later is:

`http://localhost:3000/slack/events`

For Slack to reach this on your machine you need a public URL (e.g. ngrok):

```bash
ngrok http 3000
# Use the https URL + /slack/events as Request URL in Slack
```

### 4. When you’re ready to test with Slack and Plane

1. **Slack**
   - Create an app at [api.slack.com/apps](https://api.slack.com/apps).
   - Bot token (e.g. `xoxb-...`) → `SLACK_BOT_TOKEN`.
   - Signing Secret (Basic Information) → `SLACK_SIGNING_SECRET`.
   - Subscribe to **message.channels** (Event Subscriptions), Request URL = your public URL + `/slack/events`.
   - Invite the bot to the channel you want to monitor and set that channel ID as `CHANNEL_ID`.

2. **Plane (self-hosted)**
   - `PLANE_BASE_URL=https://plan.driffle.org` (your instance).
   - `PLANE_WORKSPACE_SLUG=driffle` (from your URL path).
   - Create an API key in Plane and set `PLANE_API_KEY`.
   - Set `PLANE_PROJECT_ID` to the project where bugs should be created.

3. Restart the backend and post a message in the Slack channel with :bug: or words like “bug”, “issue”, “error”, “broken” to trigger a ticket.

## Environment variables (reference)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `REDIS_HOST`, `REDIS_PORT` | Yes | Redis for BullMQ |
| `SLACK_BOT_TOKEN` | For Slack | Bot token (xoxb-...) |
| `SLACK_SIGNING_SECRET` | For Slack | Signing secret for request verification |
| `CHANNEL_ID` | For Slack | Slack channel ID to monitor (e.g. #production-issues) |
| `PLANE_BASE_URL` | For Plane | Your Plane base URL (e.g. https://plan.driffle.org) |
| `PLANE_API_KEY` | For Plane | Plane API key |
| `PLANE_WORKSPACE_SLUG` | For Plane | Workspace slug (e.g. driffle) |
| `PLANE_PROJECT_ID` | For Plane | Project ID where issues are created |
| `OPENAI_API_KEY` | Optional | For AI-generated titles and severity |

## Driffle Deployer (production)

Follow the team **Deployer Docker Compose** guide (PDF). This repo matches it:

- **`docker-compose.prod.yml`** — default Deployer compose; **first service with `ports` is `bugs-reporter`** (HTTP on container **3000**). Postgres/Redis use **`expose` only** so Deployer’s primary publish targets the API, not the databases.
- **`docker-compose.yml`** — `include: [docker-compose.prod.yml]` + local **`ports`** overrides for Postgres/Redis.
- **`.env.example`** (repo root) — full env contract; do not commit **`.env`** or **`.deployer.env`**.

Use **[deployer.driffle.net](https://deployer.driffle.net/)** with a repo under the **Driffle GitHub org**.

1. Push **`Dockerfile`**, **`docker-compose.prod.yml`**, **`docker-compose.yml`**, **`.env.example`**, and source.
2. **Do not commit** generated **`docker-compose.deployer*.yml`** or **`.deployer.env`** if they appear locally.
3. Register the app; enable **Postgres** + **Redis** as needed; set env vars (same names as `.env.example`). Managed hostnames are typically **`postgres`** and **`redis`**.
4. Deploy: **Pull latest**, **Force recreate**, **tunnel subdomain** → Slack URL **`https://<subdomain>.driffle.net/slack/events`**.
5. Optional **`envServiceNames`**: if set, order so **`bugs-reporter`** is first so injection targets the web service.

Migrations run in the container **`command`** (`prisma migrate deploy` then `node dist/main.js`).

## Deploy elsewhere

- Use the same `DATABASE_URL` and Redis in production.
- Point Slack Event Subscriptions to your public URL + `/slack/events`.
- Keep `PLANE_BASE_URL` and other Plane vars as needed for your self-hosted Plane.

### Railway (502 / `connection dial timeout` from Slack)

If the edge logs show **`upstreamErrors: connection dial timeout`** and your container logs only show **`npm run build`** (Prisma generate + `nest build`) and then stop, **nothing is listening on `PORT`**. The **Start Command** must run the server, not the build.

- In Railway: **Service → Settings → Deploy → Start Command**  
  - Set to: `node dist/main.js` (or `npm start`, which runs the same).  
  - **Pre-deploy command**: `npx prisma migrate deploy` (migrations must not block the web process from binding `PORT`, or Slack/Railway will see dial timeouts).  
  - **Do not** set Start Command to `npm run build` (that compiles and exits).

- After a correct deploy, logs should show something like **`Bugs Reporter backend listening on port`** (port comes from Railway’s `PORT`).

- Smoke test: open `https://<your-app>.up.railway.app/health` — you should get `{"ok":true}`.

- Add the **Redis** plugin (or `REDIS_URL` / `REDIS_HOST`) if you use BullMQ; without Redis the app may fail or hang during boot depending on config.

The repo includes **`railway.toml`** / **`backend/railway.toml`** with **`preDeployCommand`** (migrations), **`startCommand`** (`node dist/main.js`), and **`healthcheckPath`** `/health`.

### Railway (Prisma + OpenSSL on Alpine)

If you see **OpenSSL** warnings or **`Could not parse schema engine response`** / **`Error load...`**, the image was likely **Alpine-based** and Prisma’s native engine could not load. The project **Dockerfiles use `node:20-bookworm-slim`** with **`openssl`** installed so `prisma migrate deploy` and the app run correctly. Redeploy after pulling the latest Dockerfile.

### Railway (fix: `Cannot find module '/app/dist/main'`)

That error means the **build step never produced `dist/`** before `node` ran. Do one of the following:

1. **Dockerfile (recommended)**  
   - Use the `Dockerfile` at the **repo root** or `backend/Dockerfile` if the service root is `backend`.  
   - In Railway: **Settings → Build → Builder = Dockerfile**, and set **Dockerfile path** if needed (`Dockerfile` or `backend/Dockerfile`).  
   - The image runs `npm ci` → `npm run build` → starts with `prisma migrate deploy` + `node dist/main.js`.

2. **Nixpacks (no Docker)**  
   - Set **Root Directory** to `backend` so `package.json` and `npm run build` are found.  
   - `backend/nixpacks.toml` runs `npm ci` and `npm run build` before `npm start`.  
   - Ensure **Build Command** is `npm run build` (or leave empty so Nixpacks uses the config).

3. **Scripts**  
   - `npm start` runs migrations then `node dist/main.js`. You must run **`npm run build`** in the build phase (Dockerfile and `nixpacks.toml` do this).

Set `REDIS_HOST` / `REDIS_PORT` (and password if any) for BullMQ when deploying.

## Scripts (backend)

- `npm run start:dev` — run with watch (local)
- `npm run build` / `npm run start:prod` — production
- `npm run prisma:migrate` — run migrations
- `npm run prisma:studio` — open Prisma Studio on the DB
