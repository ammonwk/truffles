# Truffles

**PostHog session recordings in, GitHub PRs out.**

Truffles watches your users via PostHog, renders session replays to video, runs them through LLMs to detect UI bugs, filters out noise with a second screening pass, then spawns autonomous Claude Code agents that verify the issue, write a fix, and open a PR — all without human intervention.

You review the diff. You click merge. That's it.

---

## How It Works

```
PostHog sessions
      |
      v
  [Render to MP4]  ──>  S3
      |
      v
  [LLM Analysis]       Video: Kimi K2.5 + Gemini 3 Pro (via OpenRouter)
  + Session data:       Console errors, network failures, DOM events
      |                 Model: Claude Opus 4.6
      v
  [Screening Pass]      "Would a user care? Would a dev investigate?"
      |                 Checks against learned false-alarm patterns
      v
  [Claude Code Agent]   Verifies issue exists in codebase
      |                 Plans and implements a fix
      |                 Runs lint + typecheck + self-review
      |                 Opens a PR (or reports a false alarm)
      v
  GitHub PR             Labeled `truffles-autofix`, requires human approval
```

Issues are classified as **Red** (bugs, broken functionality) or **Yellow** (UX concerns, jank, cosmetic problems). The system learns over time — when an agent can't find the code behind a flagged issue, it reports a false alarm, which gets added to the suppression list so the same pattern isn't flagged again.

## Views

| View | Path | Description |
|------|------|-------------|
| **Sessions** | `/sessions` | Browse PostHog recordings, select and process them. Watch rendered videos with issue markers on the timeline. |
| **Issues** | `/issues` | All detected issues sorted by severity. Filter by status, search by description. Click through to session context and PR diffs. |
| **Agent Lab** | `/agents` | Real-time observability into running Claude Code agents. Streaming terminal output, phase timelines, queue stats. |
| **PR Review** | `/prs/:id` | Inline diff viewer with issue context and agent reasoning. Link out to GitHub to approve. |
| **Settings** | `/settings` | Auth-gated. Configure agent concurrency, model selection, polling intervals, and manage the false alarm suppression list. |

## Project Structure

Turborepo monorepo — MERN stack, TypeScript, Tailwind.

```
apps/
  web/             React frontend (Vite + React Router + Tailwind)
  api/             Express backend (REST + WebSocket + agent runner, all in-process)
packages/
  shared/          Shared types, constants, utilities
  db/              Mongoose models, MongoDB connection
docs/              Planning docs (UI/UX flow, infrastructure, deliverables)
infra/             Server setup, pm2 config
```

## Quick Start

### Prerequisites

- Node 20+
- MongoDB 7+ (local or Atlas)
- PostHog cloud account with session recordings enabled
- OpenRouter API key
- AWS credentials (for S3 video storage)
- GitHub PAT with `repo` scope

### Development

```bash
# Install dependencies
npm install

# Copy environment files and fill in your keys
cp apps/api/.env.example apps/api/.env

# Start all services (frontend :3000, API :4000)
npm run dev
```

The frontend proxies `/api/*` to the Express backend in development.

### Environment Variables

Create `apps/api/.env` with:

```bash
MONGODB_URI=mongodb://localhost:27017/truffles
POSTHOG_API_KEY=phx_...
POSTHOG_PROJECT_ID=12345
POSTHOG_HOST=https://us.posthog.com
OPENROUTER_API_KEY=sk-or-...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
S3_BUCKET=truffles-recordings
GITHUB_TOKEN=ghp_...
GITHUB_REPO=plaibook-dev/ai-outbound-agent
ADMIN_PASSWORD=your-password
ANTHROPIC_API_KEY=sk-ant-...
REPO_CLONE_PATH=/opt/target-repo
WORKTREE_BASE_PATH=/opt/worktrees
```

## Deployment

Deployed to an EC2 instance behind nginx with Let's Encrypt SSL.

```bash
# First time: set up the server (installs Node, MongoDB, nginx, pm2, gh, certbot)
./deploy.sh --setup

# Every subsequent deploy: builds locally, rsyncs, restarts
./deploy.sh
```

That's it. One command. It builds the monorepo locally, rsyncs the built artifacts to the server, installs production dependencies, restarts pm2, and reloads nginx.

### Infrastructure

| Resource | Details |
|----------|---------|
| **EC2 (primary)** | m6i.2xlarge, Ubuntu 24.04, 50GB gp3 |
| **S3** | `truffles-recordings` — rendered MP4s, thumbnails, raw rrweb data |
| **DNS** | Cloudflare A record (DNS-only, not proxied) |
| **SSL** | Let's Encrypt via certbot, auto-renews |
| **MongoDB** | Local on the primary instance |

### Teardown

When the hackathon is over:

```bash
./teardown.sh
```

Prompts you to type `nuke-it`, then destroys the EC2 instance, Elastic IP, S3 bucket, security group, and DNS records. Reads the Cloudflare API token from `.env`.

## Architecture

The platform runs on a single EC2 instance:

- **Primary** — runs the frontend, API, MongoDB, background workers (PostHog polling, video rendering, LLM analysis pipeline), and Claude Code agents (all in-process).

Agents use `--dangerously-skip-permissions` and are sandboxed per-worktree with enforced timeouts. Each agent is explicitly instructed to report a false alarm rather than make speculative code changes.

## Auth Model

- **No login required** for viewing sessions, issues, agents, or PR diffs.
- **Password required** for the Settings page and any mutating operations (processing sessions, managing suppression rules).
- PRs require approval on GitHub — the platform never merges automatically.

## Models

| Purpose | Model | Provider |
|---------|-------|----------|
| Video analysis | Kimi K2.5 + Gemini 3 Pro Preview | OpenRouter |
| Session data analysis | Claude Opus 4.6 | OpenRouter |
| Issue screening | Claude Opus 4.6 | OpenRouter |
| Code fixing | Claude Code SDK | Anthropic (direct) |

## Commands

```bash
npm run dev          # Start all apps in development
npm run build        # Build all packages
npm run lint         # Lint everything
npm run typecheck    # TypeScript check everything
./deploy.sh          # Deploy to production
./teardown.sh        # Destroy all AWS resources
```

## License

Internal hackathon project. Not licensed for external use.
