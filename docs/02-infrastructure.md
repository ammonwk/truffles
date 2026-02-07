# 02 — Infrastructure, Permissions & API Keys

## Architecture Overview

```
                                    ┌─────────────────────┐
                                    │     PostHog Cloud    │
                                    │   (Session Source)   │
                                    └──────────┬──────────┘
                                               │ API polling
                                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     SINGLE EC2 INSTANCE                              │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │  React App   │  │  Express API │  │  Background Workers       │  │
│  │  (Vite/CRA)  │←→│  (REST + WS) │  │                           │  │
│  │  Port 3000   │  │  Port 4000   │  │  • PostHog Poller         │  │
│  └──────────────┘  └──────┬───────┘  │  • Video Renderer         │  │
│                           │          │    (Puppeteer + rrweb)     │  │
│                           │          │  • Analysis Pipeline       │  │
│                           │          │    (OpenRouter calls)      │  │
│                           │          └───────────────────────────┘  │
│                           │                                          │
│                           ▼                                          │
│                    ┌──────────────┐                                  │
│                    │   MongoDB    │                                  │
│                    │  (local or   │                                  │
│                    │   Atlas)     │                                  │
│                    └──────────────┘                                  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Agent Runner (in-process)                                     │  │
│  │                                                                 │  │
│  │  AgentManager — queue, concurrency, lifecycle                  │  │
│  │  WorktreeManager — git worktree create/cleanup                 │  │
│  │  Claude Agent SDK — query() calls, sandboxed via bubblewrap    │  │
│  │                                                                 │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐                          │  │
│  │  │ Agent 1 │ │ Agent 2 │ │ Agent 3 │  ...                      │  │
│  │  │ (SDK)   │ │ (SDK)   │ │ (SDK)   │                          │  │
│  │  │ worktree│ │ worktree│ │ worktree│                          │  │
│  │  └─────────┘ └─────────┘ └─────────┘                          │  │
│  │                                                                 │  │
│  │  Each agent:                                                    │  │
│  │  1. git worktree add (from local clone)                        │  │
│  │  2. Claude Agent SDK query() call                              │  │
│  │  3. Sandboxed via bubblewrap (SDK sandbox option)              │  │
│  │  4. Streams output → WebSocket → frontend                     │  │
│  │  5. Opens PR via gh CLI inside sandbox                        │  │
│  │  6. Worktree cleaned up on completion                         │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
          │                    │                         │
          │ S3 (videos)        │ OpenRouter API          │ GitHub API
          ▼                    ▼                         ▼
┌──────────────┐    ┌──────────────────┐    ┌──────────────────────┐
│  AWS S3      │    │  OpenRouter      │    │  GitHub              │
│  (MP4s,      │    │  • Kimi K2.5     │    │  plaibook-dev/       │
│   thumbnails)│    │  • Gemini 3 Pro  │    │  ai-outbound-agent   │
└──────────────┘    │  • Claude Opus   │    └──────────────────────┘
                    └──────────────────┘
```

---

## EC2 Sizing

### Single EC2 Instance (Platform + Agent Runner)
- **Instance type:** `m6i.2xlarge` (8 vCPU, 32 GB RAM)
- Puppeteer for video rendering is memory-hungry; each render ≈ 500MB
- Each Claude Code agent: ~1–2 GB RAM (Node process + git operations)
- Support 5 concurrent agents + 2–3 concurrent video renders
- Needs fast disk for git worktrees: use `gp3` EBS volume, 100GB+
- Must have `gh` CLI, `node`, `git`, `bubblewrap`, and the target repo cloned
- MongoDB can run locally for hackathon (or use Atlas free tier)

---

## Required API Keys & Secrets

All stored in `.env` on the instance. Never committed.

### EC2 `.env`

```bash
# MongoDB
MONGODB_URI=mongodb://localhost:27017/truffles
# or Atlas: mongodb+srv://...

# PostHog
POSTHOG_API_KEY=phx_...              # Project API key (read-only sufficient)
POSTHOG_PROJECT_ID=12345
POSTHOG_HOST=https://us.posthog.com  # or eu.posthog.com

# OpenRouter (for analysis models)
OPENROUTER_API_KEY=sk-or-...

# AWS (for S3 video storage)
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
S3_BUCKET=truffles-recordings

# GitHub (for PR links, status checks, agent push access)
GITHUB_TOKEN=ghp_...                 # PAT with repo scope
GITHUB_REPO=plaibook-dev/ai-outbound-agent

# Admin auth for Settings page
ADMIN_PASSWORD=<something-strong>

# Anthropic (for Claude Agent SDK)
ANTHROPIC_API_KEY=sk-ant-...

# Agent Runner config
MAX_CONCURRENT_AGENTS=5
AGENT_TIMEOUT_MINUTES=15
REPO_CLONE_PATH=/home/ubuntu/ai-outbound-agent
WORKTREE_BASE_PATH=/home/ubuntu/worktrees

# App
PORT=4000
NODE_ENV=production
```

---

## Security Considerations

### Network
- Single EC2, public-facing (port 80/443 via NGINX).
- No inter-service network calls — agent runner is in-process.

### API Key Safety
- All keys in `.env`, never in code or MongoDB.
- Settings page shows masked values (last 4 chars only).
- Settings page edits write to `.env` and restart relevant service (or update in-memory config for non-sensitive values like concurrency limits).

### Read-Only Platform
- No auth for read operations (GET endpoints, WebSocket subscriptions).
- All mutating endpoints (`POST /settings/*`, `DELETE /false-alarms/:id`, etc.) require `Authorization: Bearer <ADMIN_PASSWORD>` header.
- Frontend: Settings page prompts for password, stores in sessionStorage (not localStorage — cleared on tab close).

### Claude Code Agent Isolation
- Agents are sandboxed via bubblewrap using the SDK's built-in `sandbox` option.
- Each agent subprocess is filesystem-isolated to its worktree + the repo's `.git` directory.
- Each agent runs in its own worktree (isolated branch).
- Agents cannot access the platform codebase, env vars, or other worktrees.
- Agent timeout kills the process and cleans up the worktree.
- Worktree branches are named: `truffles/fix-<issue-id-short>` for easy identification.
- Sandbox fallback: if bubblewrap is unavailable, agents still run scoped to `cwd` without OS-level enforcement.

### GitHub
- PAT needs `repo` scope (read/write to the target repo).
- PRs are created with a consistent label (e.g., `truffles-autofix`) for filtering.
- PRs require human approval on GitHub — the platform never merges.

---

## S3 Structure

```
s3://truffles-recordings/
  sessions/
    <session-id>/
      recording.mp4        # Rendered video
      thumbnail.jpg         # First frame, for session cards
      rrweb-events.json     # Raw rrweb data (backup/debug)
      metadata.json         # PostHog metadata snapshot
```

- Videos are served via S3 presigned URLs (no CloudFront needed for hackathon).
- Presigned URLs expire after 1 hour, regenerated on page load.

---

## MongoDB Collections

```
sessions {
  _id: ObjectId,
  posthogSessionId: string,
  userId: string,
  userEmail: string,
  startTime: Date,
  duration: number,              // seconds
  videoUrl: string,              // S3 key
  thumbnailUrl: string,          // S3 key
  rrwebEventsUrl: string,        // S3 key
  metadata: object,              // PostHog properties
  consoleErrors: array,
  networkFailures: array,
  status: "pending" | "rendering" | "analyzing" | "complete",
  issueCount: { red: number, yellow: number },
  createdAt: Date,
  updatedAt: Date
}

issues {
  _id: ObjectId,
  sessionId: ObjectId,           // ref → sessions
  severity: "red" | "yellow",
  title: string,
  description: string,
  timestamp: number,             // seconds into the recording
  analysisSource: "video" | "session_data" | "both",
  modelUsed: string,             // which model flagged it
  llmReasoning: string,          // raw model output
  screeningPassed: boolean,
  screeningReasoning: string,
  status: "detected" | "screening" | "queued" | "fixing" | "pr_open" | "merged" | "false_alarm",
  agentSessionId: ObjectId,      // ref → agentSessions (nullable)
  prNumber: number,              // GitHub PR number (nullable)
  prUrl: string,
  prBranch: string,
  falseAlarmReason: string,      // if agent reported false alarm
  createdAt: Date,
  updatedAt: Date
}

agentSessions {
  _id: ObjectId,
  issueId: ObjectId,             // ref → issues
  status: "queued" | "starting" | "verifying" | "planning" | "coding" | "reviewing" | "done" | "failed" | "false_alarm",
  worktreePath: string,
  branchName: string,
  startedAt: Date,
  completedAt: Date,
  outputLog: [{ timestamp: Date, phase: string, content: string }],
  filesModified: [string],
  error: string,                 // if failed
  prNumber: number,
  prUrl: string,
  falseAlarmReason: string,
  costUsd: number,
}

falseAlarms {
  _id: ObjectId,
  pattern: string,               // description/pattern to match against
  source: "agent" | "manual",    // how it was added
  issueId: ObjectId,             // originating issue (if from agent)
  reason: string,
  createdAt: Date
}

settings {
  _id: "global",                 // singleton document
  maxConcurrentAgents: number,
  agentTimeoutMinutes: number,
  pollingIntervalSeconds: number,
  videoModelPrimary: string,
  videoModelSecondary: string,
  textModel: string,
  screeningModel: string
}
```

---

## Inter-Service Communication

Agent runner is in-process — communicates via function calls and callbacks. No inter-service HTTP or WebSocket relay needed.

### Agent API Endpoints (on Express API, port 4000)

```
POST   /api/agents/start      { issueId, issueTitle, issueDescription, severity, sessionContext? }
GET    /api/agents             → list active agents, queue, stats
GET    /api/agents/:id         → agent session details + output log
POST   /api/agents/:id/stop   → kill agent (admin auth required)
WS     /ws/agents              → real-time streaming output from all agents
```

Mutating endpoints require `Authorization: Bearer <ADMIN_PASSWORD>`.
Read-only endpoints (GET, WS) require no auth.

---

## Deployment (Hackathon-Simple)

- Single instance: Ubuntu 22.04 AMI
- Install: Node 20, MongoDB 7, Puppeteer deps, gh CLI, git, bubblewrap
- Clone platform repo, `npm install`, run with `pm2`
- Clone target repo (`plaibook-dev/ai-outbound-agent`) for agent worktrees
- No Docker, no Kubernetes — keep it simple
- NGINX reverse proxy for serving frontend + API on port 80
