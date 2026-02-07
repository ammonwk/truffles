# Truffles — PostHog to PR Platform

## What This Is

Truffles ingests PostHog session recordings, renders them to video, uses LLMs to detect UI issues, filters out noise, and automatically spawns Claude Code agents to fix the issues and open PRs. It's an internal hackathon tool — read-only for viewers, auth-gated for admin settings.

## Project Structure

This is a **Turborepo monorepo** (MERN stack, TypeScript, Tailwind):

```
apps/
  web/          — React frontend (Vite + React Router + Tailwind)
  api/          — Express backend (REST + WebSocket + agent runner, all in-process)
packages/
  shared/       — Shared TypeScript types, constants, utils
  db/           — Mongoose models, MongoDB connection
docs/           — Planning documents (UI/UX, infra, deliverables)
```

## Agent Execution Rules

- **ALWAYS run subagents in the foreground.** Never use `run_in_background: true` for Task tool calls. All agents must run in the foreground so output is immediately visible and controllable.

## Critical Context for AI Agents

### Auth Model — READ THIS FIRST
- **NO authentication for read-only access.** The entire platform is viewable without login.
- **Only the Settings page (`/settings`) requires authentication** — a simple password check against `ADMIN_PASSWORD` env var.
- **Do NOT add auth middleware to GET endpoints.** Do NOT add login flows. Do NOT add user accounts.
- Mutating endpoints (`POST`, `PUT`, `DELETE` under `/api/settings/*` and `/api/false-alarms/*`) require `Authorization: Bearer <password>` header.

### Target Repo
- The codebase being analyzed and fixed is `plaibook-dev/ai-outbound-agent` (a MERN Turborepo).
- PRs created by agents go to this repo, NOT to the Truffles repo.
- Branch naming: `truffles/fix-<issue-id-short>`
- PR label: `truffles-autofix`

### Claude Code SDK Usage
- **IMPORTANT:** Before writing any code that uses the Claude Code SDK (`@anthropic-ai/claude-code`), you MUST first review the SDK documentation or consult the claude-code-guide subagent to understand the current API surface. The SDK is relatively new and has specific patterns for streaming, configuration, and error handling. Do not guess at the API.
- Agents run in-process on the API server with `--dangerously-skip-permissions`.
- Each agent gets its own git worktree for isolation.

### False Alarm System
- Claude Code agents MUST be given an explicit escape hatch: "If you cannot find code related to this issue, report a false alarm instead of making speculative changes."
- False alarms are automatically added to a suppression list that the screening model checks.
- This is critical for preventing garbage PRs.

## Tech Stack

- **Runtime:** Node 20, TypeScript 5
- **Frontend:** React 18, Vite, React Router, Tailwind CSS, dark mode default
- **Backend:** Express, Mongoose, WebSocket (ws)
- **Database:** MongoDB 7
- **External APIs:** PostHog (cloud), OpenRouter (Kimi K2.5, Gemini 3 Pro, Claude Opus 4.6), AWS S3, GitHub
- **Video Rendering:** rrvideo CLI + ffmpeg → MP4
- **Agent SDK:** @anthropic-ai/claude-code

## Models Used (via OpenRouter)

| Purpose | Model | Why |
|---------|-------|-----|
| Video analysis | `moonshotai/kimi-k2.5` + `google/gemini-3-pro-preview` | Multimodal, compare both |
| Session data analysis | `anthropic/claude-opus-4.6` | Best at structured reasoning |
| Issue screening | `anthropic/claude-opus-4.6` | Needs judgment about user/dev impact |
| Code fixing | Claude Code SDK (direct Anthropic API) | Needs full agentic coding capability |

## Commands

```bash
# Development (from root)
turbo dev                    # Start all apps
turbo build                  # Build all
turbo lint                   # Lint all
turbo typecheck              # TypeScript check all

# Individual apps
cd apps/web && npm run dev   # Frontend on :3000
cd apps/api && npm run dev   # API on :4000
```

## Environment Variables

See `.env.example` files in each app directory. Key ones:
- `MONGODB_URI` — MongoDB connection string
- `POSTHOG_API_KEY` — PostHog project API key
- `OPENROUTER_API_KEY` — OpenRouter API key
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — S3 access
- `S3_BUCKET` — Bucket for video storage
- `GITHUB_TOKEN` — GitHub PAT with repo scope
- `ANTHROPIC_API_KEY` — For Claude Code SDK (agent runner in API process)
- `ADMIN_PASSWORD` — Password for Settings page

## Code Style

- TypeScript strict mode
- ESLint + Prettier (config in root)
- Functional React components with hooks
- Express routes in separate router files
- Mongoose models in `packages/db`
- Shared types in `packages/shared`
- No default exports (named exports only)
- Error handling: try/catch with meaningful error messages, never swallow errors silently

## Security Rules

- NEVER commit `.env` files or API keys
- NEVER add auth to read-only endpoints (this is intentional, not a bug)
- ALL mutating endpoints must check the admin password
- Presigned S3 URLs expire after 1 hour
- Claude Code agents are isolated in individual worktrees
- Agent timeout enforced server-side (kill process after N minutes)
