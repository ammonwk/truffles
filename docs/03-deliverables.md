# 03 — Deliverables

Broken into workstreams that can be developed in parallel by multiple agents/developers. Each section lists what to build, key files, and the definition of done.

---

## Workstream 0: Project Scaffolding

**What:** Turborepo monorepo with all packages, shared config, and dev tooling.

**Deliverables:**
- [ ] Turborepo root with `turbo.json`
- [ ] `apps/web` — React frontend (Vite + React Router + Tailwind + TypeScript)
- [ ] `apps/api` — Express backend (TypeScript) with agent runner in-process
- [ ] `packages/shared` — Shared types, constants, utility functions
- [ ] `packages/db` — MongoDB models (Mongoose schemas), connection helper
- [ ] `.env.example` for all apps
- [ ] `CLAUDE.md` at root
- [ ] ESLint + Prettier config (shared)
- [ ] `tsconfig` base config (shared)

**Done when:** `turbo dev` starts both apps, TypeScript compiles, lint passes.

---

## Workstream 1: PostHog Ingestion & Video Rendering

**What:** Poll PostHog for new session recordings, download rrweb data, render to MP4 video using headless Puppeteer, upload to S3.

**Deliverables:**
- [ ] PostHog API client (`apps/api/src/services/posthog.ts`)
  - Authenticate with API key
  - List recent recordings (paginated)
  - Download rrweb events for a recording
  - Download session metadata (user, events, console, network)
  - Deduplicate: skip already-ingested sessions
- [ ] Video renderer (`apps/api/src/services/videoRenderer.ts`)
  - Spin up headless Puppeteer
  - Load rrweb-player in a page
  - Feed rrweb events, play at 1x speed, capture via `page.screencast()` or MediaRecorder
  - Output MP4 file
  - Generate thumbnail (first meaningful frame)
- [ ] S3 uploader (`apps/api/src/services/s3.ts`)
  - Upload MP4, thumbnail, raw events JSON
  - Generate presigned URLs for playback
- [ ] Poller worker (`apps/api/src/workers/posthogPoller.ts`)
  - Runs on interval (configurable, default 60s)
  - Orchestrates: poll → download → render → upload → save to MongoDB
  - Handles errors gracefully (retry logic, dead-letter tracking)
- [ ] Session MongoDB model and CRUD endpoints

**Done when:** New PostHog sessions automatically appear as cards in the Sessions view with playable video.

---

## Workstream 2: LLM Analysis Pipeline

**What:** Send rendered video + session data to LLMs for issue detection, then screen results with a second model pass.

**Deliverables:**
- [ ] OpenRouter client (`apps/api/src/services/openrouter.ts`)
  - Send video frames/file to multimodal models (Kimi K2.5, Gemini 3 Pro)
  - Send structured session data to Claude Opus 4.6
  - Handle rate limits, retries, timeouts
- [ ] Analysis prompts (`apps/api/src/prompts/`)
  - `videoAnalysis.ts` — Prompt for video-based issue detection
    - Provide clear rubric: what counts as red (bug, broken functionality) vs yellow (UX concern, jank, cosmetic)
    - Ask for timestamps, descriptions, severity
    - Explicitly allow "no issues found" as a valid response
  - `sessionDataAnalysis.ts` — Prompt for session-data-based issue detection
    - Analyze console errors, network failures, rendered content issues (UUIDs, broken strings)
    - Same rubric and output format
  - `screeningPrompt.ts` — Prompt for the screening/filter pass
    - Input: list of detected issues with context
    - Ask: "If you were a user, would you care?" and "If you were the dev, would you investigate?"
    - Access to false alarms list for known non-issues
    - Output: filtered list with reasoning for each keep/drop decision
  - `mergeResults.ts` — Logic to deduplicate/merge issues found by video vs session data models
- [ ] Analysis worker (`apps/api/src/workers/analysisWorker.ts`)
  - Triggered after video rendering completes
  - Runs video analysis (both models in parallel) + session data analysis in parallel
  - Merges results
  - Runs screening pass
  - Saves issues to MongoDB
  - Queues surviving issues for fix orchestration
- [ ] Issue MongoDB model and CRUD endpoints
- [ ] A/B comparison logic for Kimi vs Gemini (store which model found what, for later evaluation)

**Done when:** After a session is rendered, issues automatically appear in the Issues view with severity, timestamps, and LLM reasoning.

---

## Workstream 3: Fix Orchestrator & Claude Code Agent Runner

**What:** For each verified issue, create a git worktree, spawn a Claude Code SDK agent to verify + fix + PR, and stream output back. All agent execution runs in-process on the API server — no separate sidecar service.

**Deliverables:**

### Agent Runner (in-process, `apps/api/src/services/`)
- [ ] Agent manager (`agentManager.ts`)
  - Queue incoming fix requests
  - Respect concurrency limit (from settings, default 5)
  - Track active agents, handle timeouts
  - Broadcast agent lifecycle events via WebSocket
- [ ] Worktree manager (`worktreeManager.ts`)
  - `git worktree add` from the local repo clone
  - Create branch: `truffles/fix-<issue-id-short>`
  - Cleanup on completion or timeout
- [ ] Claude Code SDK integration (`claudeAgent.ts`)
  - Use `@anthropic-ai/claude-code` SDK (NOT the CLI directly)
  - Configure with `--dangerously-skip-permissions`
  - Pass detailed prompt with:
    - Issue description, severity, timestamp
    - Session context (console errors, network data)
    - Target codebase info (it's a MERN Turborepo)
    - Explicit instruction: "If you cannot find code related to this issue, report a false alarm. Do NOT make speculative changes."
    - Steps: verify → plan → fix → lint → typecheck → self-review → open PR
  - Stream output events directly to WebSocket clients
  - Parse agent phases from output (verifying / planning / coding / reviewing)
- [ ] PR creation helper
  - Agent uses `gh pr create` within its session
  - PR title format: `[Truffles] Fix: <issue title>`
  - PR body includes: issue description, session link, analysis reasoning
  - PR labeled with `truffles-autofix`
- [ ] False alarm handler
  - If agent reports false alarm, add to `falseAlarms` collection automatically
  - Update issue status to `false_alarm`

### Orchestration (in-process, `apps/api/src/services/`)
- [ ] Analysis manager auto-queues agents after screening passes
- [ ] Agent session MongoDB model and CRUD endpoints
- [ ] WebSocket endpoint (`/ws/agents`) streams agent output directly to frontend

**Done when:** Issues automatically get fixed, PRs appear on GitHub with the `truffles-autofix` label, false alarms are learned, and agent progress is visible in the Agent Lab.

---

## Workstream 4: Frontend — Core Views

**What:** React frontend with Sessions, Issues, and PR Review views.

**Deliverables:**

### Layout & Navigation
- [ ] App shell with top nav bar: Truffles logo, Sessions, Issues, Agent Lab, Settings
- [ ] Dark theme (Tailwind dark mode, default on)
- [ ] Responsive layout (desktop-first, 1366px+ min)

### Sessions View (`/sessions`)
- [ ] Session card grid (responsive masonry or CSS grid)
  - Thumbnail, user email, date, duration
  - Severity badges (red/yellow counts)
  - PR status indicators
  - Muted styling for zero-issue sessions
- [ ] Filter bar: severity, date range, status
- [ ] Search: by user email, issue description, session ID
- [ ] Pagination or infinite scroll

### Session Detail (`/sessions/:id`)
- [ ] Video player (HTML5 `<video>` with S3 presigned URL)
- [ ] Custom seek bar overlay with colored issue markers
- [ ] Clicking marker → seeks video
- [ ] Issue sidebar with severity badges, timestamps, descriptions
- [ ] Clicking issue → seeks video + highlights issue
- [ ] Issue status and PR link
- [ ] Collapsible raw session data (JSON viewer)

### Issues View (`/issues`)
- [ ] Sortable table: severity, description, session link, PR link, status, date
- [ ] Default sort: severity desc, then date desc
- [ ] Filters: severity, status, date range
- [ ] Click row → navigate to Issue Detail

### Issue Detail (`/issues/:id`)
- [ ] Same two-panel layout as Session Detail, pre-seeked
- [ ] LLM analysis reasoning display
- [ ] Screening assessment display
- [ ] Inline diff viewer (if PR exists) using `react-diff-viewer-continued`

### PR Review (inline in Issue Detail + `/prs/:id`)
- [ ] Diff viewer with syntax highlighting
- [ ] Issue context sidebar
- [ ] Agent reasoning display
- [ ] "View on GitHub" prominent CTA link
- [ ] Clear notice: "Approve on GitHub to merge"

**Done when:** All four views render correctly with real data, video playback works, issue markers are interactive, and diffs display properly.

---

## Workstream 5: Frontend — Agent Lab & Settings

**What:** Real-time agent observability and auth-gated settings page.

**Deliverables:**

### Agent Lab (`/agents`)
- [ ] Overview grid of active agent cards
  - Issue title, phase, runtime, progress indicator
  - "View Live Output" button
- [ ] Queue status (pending count, active/max)
- [ ] Completed today / false alarms / PRs opened stats
- [ ] WebSocket connection for real-time updates

### Agent Detail (`/agents/:id`)
- [ ] Phase timeline (verify → plan → code → review → done)
- [ ] Streaming terminal output (monospace, auto-scroll, ANSI color support)
- [ ] Files modified list
- [ ] Links to issue and session
- [ ] Diff preview (if changes exist)

### Settings (`/settings`)
- [ ] Password prompt modal on entry (check against `ADMIN_PASSWORD`)
- [ ] Store auth in sessionStorage
- [ ] PostHog connection settings (display only for hackathon — real config in .env)
- [ ] OpenRouter model selection
- [ ] GitHub repo display
- [ ] Claude Code agent concurrency slider
- [ ] Agent timeout setting
- [ ] False alarm management table
  - View all suppressions (pattern, source, date)
  - Remove suppression
  - Add manual suppression rule
- [ ] Danger zone: clear data, reset false alarms

**Done when:** Agent Lab shows real-time streaming output from running agents, settings are editable and persist, false alarms are manageable.

---

## Workstream 6: Integration & Polish

**What:** End-to-end pipeline verification, error handling, and UX polish.

**Deliverables:**
- [ ] End-to-end test: PostHog session → video render → analysis → screening → agent fix → PR
- [ ] Error states for every view (loading spinners, empty states, error messages)
- [ ] Toast notifications for key events (new issues found, PR opened, agent completed)
- [ ] WebSocket reconnection logic
- [ ] Graceful error handling if agent runner encounters failures
- [ ] Rate limit handling for all external APIs
- [ ] Cleanup cron: remove old worktrees, expire old presigned URLs
- [ ] Health check endpoints (`/health` on both services)
- [ ] pm2 ecosystem config
- [ ] NGINX config for primary
- [ ] Deployment scripts (or at minimum, clear setup instructions in README)

**Done when:** The full pipeline runs hands-free, errors are surfaced clearly, and the platform is stable enough for a demo.

---

## Dependency Graph

```
WS0 (Scaffold) ──┬──→ WS1 (Ingestion) ──→ WS2 (Analysis) ──→ WS3 (Fix/Agent)
                  │                                               │
                  ├──→ WS4 (Frontend Core) ◄──────────────────────┤
                  │                                               │
                  └──→ WS5 (Agent Lab + Settings) ◄──────────────┘
                                                                  │
                                                    WS6 (Integration) ◄──┘
```

- **WS0** must complete first (all others depend on it).
- **WS1** and **WS4** can start in parallel after WS0.
- **WS2** depends on WS1 (needs video + session data).
- **WS3** depends on WS2 (needs issues to fix).
- **WS4** and **WS5** can develop with mock data, then integrate.
- **WS6** runs after all others are functional.

---

## File Counts (Rough Estimate)

| Workstream | New Files | Complexity |
|-----------|-----------|------------|
| WS0 Scaffold | ~20 | Config-heavy |
| WS1 Ingestion | ~8 | Medium (Puppeteer is finicky) |
| WS2 Analysis | ~10 | Medium (prompt engineering) |
| WS3 Fix/Agent | ~12 | High (SDK integration, worktrees) |
| WS4 Frontend Core | ~20 | Medium (standard React) |
| WS5 Agent Lab | ~10 | Medium (WebSocket streaming) |
| WS6 Integration | ~5 | Polish |
| **Total** | **~85** | |
