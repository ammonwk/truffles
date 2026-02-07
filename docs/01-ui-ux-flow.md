# 01 — UI/UX Flow

## Design Principles

- **Zero-friction read-only by default.** No login walls. Anyone on the network opens the app and immediately sees value.
- **Edit access (Settings) requires auth** — a simple password gate or basic admin login.
- **Information hierarchy:** Sessions → Issues → PRs. Every entity links to the others.
- **Color language:** Red = Issue (bug, broken behavior). Yellow = Warning (UX concern, jank, cosmetic). Green = Fix PR merged. Grey = False alarm / dismissed.

---

## Navigation

Top-level nav bar (sticky):

```
[Truffles]   Sessions | Issues | Agent Lab | Settings(lock)
```

- **Sessions** — default landing page
- **Issues** — issues-first view
- **Agent Lab** — live Claude Code agent observability
- **Settings** — auth-gated, manage config

---

## 1. Sessions View (`/sessions`)

### Grid Layout

Scrollable masonry/grid of **session cards**, most recent first. Each card:

```
┌──────────────────────────────────┐
│  ▶ Thumbnail (first frame)       │
│                                  │
│  User: john@acme.com             │
│  Feb 7, 2026 · 3m 42s            │
│                                  │
│  🔴 2 Issues  🟡 1 Warning       │
│  ✅ 1 PR Open  ⬜ 1 False Alarm  │
└──────────────────────────────────┘
```

- Cards with zero issues still appear but are visually muted (no badge row, greyed border).
- Filter bar at top: severity, date range, status (has open PRs, has unresolved issues, clean).
- Search: by user email, issue description, or session ID.

### Click → Session Detail (`/sessions/:id`)

Two-panel layout:

```
┌─────────────────────────────────────────────────────┬──────────────────────────┐
│                                                     │  Issues (3)              │
│              Video Player                           │                          │
│         (standard HTML5 <video>)                    │  🔴 12:04 Modal overlap  │
│                                                     │     PR #142 (open)  →    │
│                                                     │                          │
│  ◀ ▶ ▮▮  ━━━🔴━━━━🟡━━━━━🔴━━━━━━━━  3:42         │  🟡 01:33 Slow render    │
│           ↑ issue markers on timeline               │     PR #143 (open)  →    │
│                                                     │                          │
│                                                     │  🔴 02:51 UUID in title  │
│                                                     │     ⬜ False Alarm        │
│                                                     │                          │
│                                                     │  ─────────────────────   │
│                                                     │  Raw Session Data  ▼     │
│                                                     │  (collapsible JSON)      │
└─────────────────────────────────────────────────────┴──────────────────────────┘
```

**Video Player behavior:**
- Standard HTML5 video player (we pre-render to MP4, no rrweb-player in the browser).
- Custom overlay: colored dots on the seek bar at each issue's timestamp.
- Clicking a dot or an issue in the sidebar seeks the video to that timestamp.
- Clicking an issue in the sidebar also briefly highlights it.

**Issue cards in sidebar:**
- Severity badge (red/yellow)
- Timestamp (clickable → seeks video)
- One-line description
- Status: `Analyzing...` → `Fix in progress...` → `PR #N (open)` → `Merged` / `False Alarm`
- PR link arrow → opens PR Review or jumps to GitHub

**Raw Session Data:**
- Collapsible accordion at bottom of sidebar
- Shows console errors, network failures, PostHog event metadata
- Searchable

---

## 2. Issues View (`/issues`)

### Table/List Layout

```
┌────────┬─────────────────────────────┬──────────────┬──────────┬────────────┬──────────┐
│ Sev.   │ Description                 │ Session      │ PR       │ Status     │ Found    │
├────────┼─────────────────────────────┼──────────────┼──────────┼────────────┼──────────┤
│ 🔴     │ Modal overlaps nav bar      │ john@ · 3:42 │ #142  →  │ PR Open    │ 2m ago   │
│ 🔴     │ UUID renders in page title  │ john@ · 3:42 │ —        │ False Alarm│ 5m ago   │
│ 🟡     │ 800ms render on filter      │ jane@ · 1:15 │ #144  →  │ Fixing...  │ 12m ago  │
│ 🟡     │ Button hover state missing  │ alex@ · 2:30 │ #145  →  │ PR Open    │ 20m ago  │
└────────┴─────────────────────────────┴──────────────┴──────────┴────────────┴──────────┘
```

- Sorted by severity (red first), then by recency.
- Clicking a row → expands inline or navigates to `/issues/:id`.
- Filters: severity, status (open / fixing / PR open / merged / false alarm), date range.

### Issue Detail (`/issues/:id`)

Same two-panel layout as Session Detail, but pre-seeked to the issue's timestamp and with the relevant issue highlighted.

Additionally shows:
- The LLM's analysis reasoning (why it flagged this)
- The screening model's assessment (if it passed screening)
- If PR exists: inline diff viewer (see PR Review below)

---

## 3. Agent Lab (`/agents`)

Real-time observability into running Claude Code sessions.

### Overview Grid

```
┌───────────────────────────────────────────────────────────────────────┐
│  Active Agents: 3 / 5 max          Queue: 2 pending                  │
├──────────────────────┬──────────────────────┬────────────────────────┤
│  Agent #a1b2c3       │  Agent #d4e5f6       │  Agent #g7h8i9         │
│  Issue: Modal overlap│  Issue: Slow render  │  Issue: Hover state    │
│  Phase: Reviewing    │  Phase: Coding fix   │  Phase: Planning       │
│  Runtime: 4m 12s     │  Runtime: 1m 33s     │  Runtime: 0m 22s       │
│  ██████████░░ 80%    │  ████░░░░░░░░ 33%    │  ██░░░░░░░░░░ 15%     │
│  [View Live Output]  │  [View Live Output]  │  [View Live Output]    │
└──────────────────────┴──────────────────────┴────────────────────────┘
│                                                                       │
│  Completed Today: 12    False Alarms: 3    PRs Opened: 9              │
└───────────────────────────────────────────────────────────────────────┘
```

### Click → Agent Detail (`/agents/:id`)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Agent #a1b2c3 — Modal overlap issue                                 │
│  Status: Reviewing · Runtime: 4m 12s                                 │
│  Issue: /issues/abc123 →    Session: /sessions/def456 →              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─ Phase Timeline ──────────────────────────────────────────────┐   │
│  │ ✅ Verifying  →  ✅ Planning  →  ✅ Coding  →  🔄 Reviewing  │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─ Live Output (streaming) ─────────────────────────────────────┐   │
│  │ $ Checking src/components/Modal.tsx...                         │   │
│  │ Found the issue at line 142: z-index conflict with NavBar     │   │
│  │ Planning fix: update z-index layering system...               │   │
│  │ Writing fix to src/components/Modal.tsx...                    │   │
│  │ Running lint... ✓                                             │   │
│  │ Running typecheck... ✓                                        │   │
│  │ Reviewing changes...                                          │   │
│  │ █                                                             │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Files Modified: Modal.tsx, NavBar.tsx                                │
│  [View Diff Preview]                                                 │
└──────────────────────────────────────────────────────────────────────┘
```

- Streaming output via WebSocket/SSE from the Claude Code SDK.
- Phase timeline updates as the agent progresses.
- If agent reports false alarm, this view shows the reasoning and marks it clearly.

---

## 4. PR Review (`/prs/:id` or inline in Issue Detail)

```
┌──────────────────────────────────────────────────────────────────────┐
│  PR #142: Fix modal z-index overlap with navigation bar              │
│  Branch: truffles/fix-modal-overlap-a1b2c3                           │
│  Status: Open · +12 / -3 lines · 2 files changed                    │
│  [View on GitHub →]                                                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Issue Context:                                                      │
│  🔴 Modal overlaps nav bar when opened on mobile viewport            │
│  Session: john@acme.com · Feb 7 · 12:04 into recording              │
│  [Watch moment →]                                                    │
│                                                                      │
│  ┌─ Diff ────────────────────────────────────────────────────────┐   │
│  │  src/components/Modal.tsx                                      │   │
│  │                                                                │   │
│  │  140  │   return (                                             │   │
│  │  141  │     <div                                               │   │
│  │  142- │       className="fixed inset-0 z-40"                   │   │
│  │  142+ │       className="fixed inset-0 z-[60]"                │   │
│  │  143  │       onClick={onClose}                                │   │
│  │                                                                │   │
│  │  src/components/NavBar.tsx                                     │   │
│  │                                                                │   │
│  │  22   │ // Nav z-index documented in LAYERING.md               │   │
│  │  23-  │ const NAV_Z = 50;                                      │   │
│  │  23+  │ const NAV_Z = 50; // Modal overlay is z-[60]           │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Agent's reasoning:                                                  │
│  "The modal used z-40 which renders below the NavBar's z-50.        │
│   Updated to z-[60] to ensure modal overlays all content."           │
│                                                                      │
│  ⚠️ To approve this PR, review and merge on GitHub.                  │
│  [Open PR on GitHub →]                                               │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 5. Settings (`/settings`) — Auth Required

Simple password gate (env var `ADMIN_PASSWORD`). No user accounts needed.

### Sections:

**PostHog Connection**
- API key (masked), project ID, polling interval

**OpenRouter**
- API key (masked), model selections for video/text/screening

**GitHub**
- Target repo, base branch, PR label prefix

**Claude Code Agents**
- Max concurrent agents (slider, 1–10)
- Agent timeout (minutes)
- Anthropic API key (masked)

**False Alarms / Suppression Rules**
- Table of learned suppressions with:
  - Pattern/description
  - Source (auto-learned from agent / manually added)
  - Date added
  - [Remove] button
- [Add Manual Rule] button

**Danger Zone**
- Clear all data
- Reset false alarms

---

## Responsive Notes

- Desktop-first (internal tool), but should be usable on a laptop screen (1366px+).
- Video player should resize fluidly.
- Tables should horizontally scroll on smaller viewports rather than collapse.

---

## Color & Typography

- Dark mode default (dev tool aesthetic).
- Monospace for code/diffs/agent output.
- Sans-serif (Inter or system) for everything else.
- Severity colors: Red `#EF4444`, Yellow `#F59E0B`, Green `#22C55E`, Grey `#6B7280`.
