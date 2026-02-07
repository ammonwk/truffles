export type Severity = 'red' | 'yellow';

export type IssueStatus =
  | 'analyzing'
  | 'screening'
  | 'queued'
  | 'fixing'
  | 'pr_open'
  | 'merged'
  | 'false_alarm';

export type AgentPhase =
  | 'verifying'
  | 'planning'
  | 'coding'
  | 'reviewing'
  | 'done'
  | 'false_alarm';

export interface SessionRecord {
  id: string;
  userEmail: string;
  startedAt: string;
  durationSec: number;
  redCount: number;
  yellowCount: number;
  openPrCount: number;
  falseAlarmCount: number;
  thumbnailLabel: string;
}

export interface IssueRecord {
  id: string;
  sessionId: string;
  severity: Severity;
  title: string;
  description: string;
  timestampSec: number;
  status: IssueStatus;
  foundAt: string;
  prNumber?: number;
  prUrl?: string;
  llmReasoning: string;
  screeningReasoning: string;
  falseAlarmReason?: string;
}

export interface AgentRecord {
  id: string;
  issueId: string;
  status: AgentPhase;
  runtimeSec: number;
  progress: number;
  filesModified: string[];
  outputSeed: string[];
}

export interface PullRequestRecord {
  id: number;
  issueId: string;
  title: string;
  branch: string;
  status: 'open' | 'merged';
  additions: number;
  deletions: number;
  filesChanged: number;
  agentReasoning: string;
  diff: string;
}

export interface SuppressionRule {
  id: string;
  pattern: string;
  source: 'agent' | 'manual';
  dateAdded: string;
}

export const sessions: SessionRecord[] = [
  {
    id: 'sess-def456',
    userEmail: 'john@acme.com',
    startedAt: '2026-02-07T16:12:00Z',
    durationSec: 222,
    redCount: 2,
    yellowCount: 1,
    openPrCount: 1,
    falseAlarmCount: 1,
    thumbnailLabel: 'Dashboard > Campaigns > Open modal',
  },
  {
    id: 'sess-0a9b22',
    userEmail: 'jane@acme.com',
    startedAt: '2026-02-07T15:50:00Z',
    durationSec: 195,
    redCount: 1,
    yellowCount: 1,
    openPrCount: 1,
    falseAlarmCount: 0,
    thumbnailLabel: 'Filters panel and results list',
  },
  {
    id: 'sess-4ca115',
    userEmail: 'alex@acme.com',
    startedAt: '2026-02-07T15:18:00Z',
    durationSec: 152,
    redCount: 0,
    yellowCount: 1,
    openPrCount: 1,
    falseAlarmCount: 0,
    thumbnailLabel: 'Settings drawer and CTA interactions',
  },
  {
    id: 'sess-99f410',
    userEmail: 'mira@acme.com',
    startedAt: '2026-02-07T14:41:00Z',
    durationSec: 278,
    redCount: 0,
    yellowCount: 0,
    openPrCount: 0,
    falseAlarmCount: 0,
    thumbnailLabel: 'Checkout flow, no anomalies detected',
  },
  {
    id: 'sess-b4e811',
    userEmail: 'owen@acme.com',
    startedAt: '2026-02-07T13:56:00Z',
    durationSec: 244,
    redCount: 1,
    yellowCount: 0,
    openPrCount: 0,
    falseAlarmCount: 0,
    thumbnailLabel: 'Page title composition while loading',
  },
  {
    id: 'sess-c770ef',
    userEmail: 'sarah@acme.com',
    startedAt: '2026-02-07T12:27:00Z',
    durationSec: 129,
    redCount: 0,
    yellowCount: 0,
    openPrCount: 0,
    falseAlarmCount: 0,
    thumbnailLabel: 'Warm-up session, no issues',
  },
];

export const issues: IssueRecord[] = [
  {
    id: 'iss-abc123',
    sessionId: 'sess-def456',
    severity: 'red',
    title: 'Modal overlaps nav bar',
    description:
      'When opening the campaign modal on mobile width, the header still layers above the overlay.',
    timestampSec: 124,
    status: 'pr_open',
    foundAt: '2026-02-07T16:15:00Z',
    prNumber: 142,
    prUrl: 'https://github.com/plaibook-dev/ai-outbound-agent/pull/142',
    llmReasoning:
      'The modal backdrop sits below a fixed nav element and leaves primary navigation clickable while the modal is open.',
    screeningReasoning:
      'User impact is high because core flow can be blocked and interaction context becomes ambiguous.',
  },
  {
    id: 'iss-1f5522',
    sessionId: 'sess-def456',
    severity: 'yellow',
    title: 'Slow render on filter apply',
    description:
      'List repaint takes roughly 800ms after changing filter chips, producing visible jank.',
    timestampSec: 93,
    status: 'fixing',
    foundAt: '2026-02-07T16:16:00Z',
    llmReasoning:
      'Multiple filter state updates are causing expensive re-renders before memoized data is ready.',
    screeningReasoning:
      'Likely noticeable by power users; worth optimization but not blocking.',
  },
  {
    id: 'iss-7c882f',
    sessionId: 'sess-def456',
    severity: 'red',
    title: 'UUID appears in browser title',
    description:
      'Document title briefly shows internal UUID before route metadata resolves.',
    timestampSec: 171,
    status: 'false_alarm',
    foundAt: '2026-02-07T16:17:00Z',
    llmReasoning:
      'A non-human readable identifier appears in top-level title and could reduce trust.',
    screeningReasoning:
      'Suppressed after agent verification; value is not user-visible in production route templates.',
    falseAlarmReason:
      'Reproduced locally and in staging; UUID was generated in dev-only debug mode and never shipped.',
  },
  {
    id: 'iss-4440da',
    sessionId: 'sess-0a9b22',
    severity: 'red',
    title: 'Primary CTA disabled despite valid form',
    description:
      'Submit button remains disabled after selecting a valid account and message.',
    timestampSec: 117,
    status: 'queued',
    foundAt: '2026-02-07T15:53:00Z',
    llmReasoning:
      'Validation state is stale while async account options load; action lock never clears.',
    screeningReasoning:
      'Directly blocks user completion of the task and should be prioritized.',
  },
  {
    id: 'iss-9de214',
    sessionId: 'sess-0a9b22',
    severity: 'yellow',
    title: 'Input label spacing collapse on narrow widths',
    description:
      'Label and helper text overlap at 1024px when side panel opens.',
    timestampSec: 62,
    status: 'merged',
    foundAt: '2026-02-07T15:52:00Z',
    prNumber: 144,
    prUrl: 'https://github.com/plaibook-dev/ai-outbound-agent/pull/144',
    llmReasoning:
      'A hard-coded line-height in the form block collides with helper text after width compression.',
    screeningReasoning:
      'Minor but visible quality issue; low risk with clear CSS-only fix.',
  },
  {
    id: 'iss-6d710f',
    sessionId: 'sess-4ca115',
    severity: 'yellow',
    title: 'Button hover state missing in dark theme',
    description:
      'Secondary button has no hover transition in dark mode, creating weak affordance.',
    timestampSec: 72,
    status: 'pr_open',
    foundAt: '2026-02-07T15:21:00Z',
    prNumber: 145,
    prUrl: 'https://github.com/plaibook-dev/ai-outbound-agent/pull/145',
    llmReasoning:
      'Dark theme token maps hover and resting states to near-identical colors.',
    screeningReasoning:
      'Cosmetic but straightforward improvement with low blast radius.',
  },
  {
    id: 'iss-090a31',
    sessionId: 'sess-b4e811',
    severity: 'red',
    title: 'Title token leak in loading route',
    description:
      'Route title flashes internal job slug before hydrated metadata updates.',
    timestampSec: 101,
    status: 'screening',
    foundAt: '2026-02-07T14:00:00Z',
    llmReasoning:
      'Initial render path concatenates technical slug into document title as fallback.',
    screeningReasoning:
      'Likely user-visible and trust-impacting; pending second pass confirmation.',
  },
];

export const agentSessions: AgentRecord[] = [
  {
    id: 'a1b2c3',
    issueId: 'iss-abc123',
    status: 'reviewing',
    runtimeSec: 252,
    progress: 80,
    filesModified: ['src/components/Modal.tsx', 'src/components/NavBar.tsx'],
    outputSeed: [
      '$ Checking src/components/Modal.tsx...',
      'Found z-index mismatch between overlay and fixed nav.',
      'Planning fix in shared layering tokens.',
      'Applying changes and running lint/typecheck.',
      'Reviewing patch for side effects on mobile nav.',
    ],
  },
  {
    id: 'd4e5f6',
    issueId: 'iss-1f5522',
    status: 'coding',
    runtimeSec: 93,
    progress: 33,
    filesModified: ['src/pages/CampaignList.tsx'],
    outputSeed: [
      '$ Profiling list render path...',
      'Found repeated list transform in render body.',
      'Introducing memoized selector and batched state update.',
      'Running focused tests around filter toggles.',
    ],
  },
  {
    id: 'g7h8i9',
    issueId: 'iss-4440da',
    status: 'planning',
    runtimeSec: 22,
    progress: 15,
    filesModified: [],
    outputSeed: [
      '$ Reproducing disabled button issue...',
      'Looking at form validity + async option loading coordination.',
      'Drafting fix approach before code edit.',
    ],
  },
];

export const pullRequests: PullRequestRecord[] = [
  {
    id: 142,
    issueId: 'iss-abc123',
    title: 'Fix modal z-index overlap with navigation bar',
    branch: 'truffles/fix-modal-overlap-a1b2c3',
    status: 'open',
    additions: 12,
    deletions: 3,
    filesChanged: 2,
    agentReasoning:
      'The modal used z-40 while nav uses z-50. Raising overlay to z-[60] guarantees correct stacking.',
    diff: `src/components/Modal.tsx
140  | return (
141  |   <div
142- |     className="fixed inset-0 z-40"
142+ |     className="fixed inset-0 z-[60]"
143  |     onClick={onClose}

src/components/NavBar.tsx
22   | // Nav z-index documented in LAYERING.md
23-  | const NAV_Z = 50;
23+  | const NAV_Z = 50; // Modal overlay sits above nav`,
  },
  {
    id: 144,
    issueId: 'iss-9de214',
    title: 'Adjust label spacing in compressed layout',
    branch: 'truffles/fix-form-spacing-b97f31',
    status: 'merged',
    additions: 9,
    deletions: 4,
    filesChanged: 1,
    agentReasoning:
      'Updated line-height and spacing token in compressed form rows to prevent label/helper overlap.',
    diff: `src/components/forms/FieldRow.tsx
18- | const tightLineHeight = 'leading-4';
18+ | const tightLineHeight = 'leading-[1.25rem]';
24- | className="gap-1"
24+ | className="gap-2"`,
  },
  {
    id: 145,
    issueId: 'iss-6d710f',
    title: 'Restore hover affordance for secondary button (dark theme)',
    branch: 'truffles/fix-dark-hover-state-22ff10',
    status: 'open',
    additions: 6,
    deletions: 2,
    filesChanged: 1,
    agentReasoning:
      'Dark theme hover token matched resting state; increased contrast and eased transition timing.',
    diff: `src/components/Button.tsx
55- | dark:hover:bg-slate-700
55+ | dark:hover:bg-slate-600
56+ | dark:hover:border-slate-400`,
  },
];

export const suppressionRules: SuppressionRule[] = [
  {
    id: 'sup-11',
    pattern: 'UUID in title during local debug boot',
    source: 'agent',
    dateAdded: '2026-02-07T16:24:00Z',
  },
  {
    id: 'sup-12',
    pattern: 'Transient chart jitter under 120ms',
    source: 'manual',
    dateAdded: '2026-02-06T18:09:00Z',
  },
];

export const severityOrder: Record<Severity, number> = {
  red: 0,
  yellow: 1,
};

export const statusLabels: Record<IssueStatus, string> = {
  analyzing: 'Analyzing...',
  screening: 'Screening...',
  queued: 'Queued',
  fixing: 'Fix in progress...',
  pr_open: 'PR Open',
  merged: 'Merged',
  false_alarm: 'False Alarm',
};

export const agentPhaseOrder: AgentPhase[] = ['verifying', 'planning', 'coding', 'reviewing', 'done'];
