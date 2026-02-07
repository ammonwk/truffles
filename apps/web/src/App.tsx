import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bot,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  CheckCircle,
  CircleSlash,
  Clock3,
  Copy,
  ExternalLink,
  Filter,
  GitPullRequest,
  Home,
  Loader2,
  Lock,
  Moon,
  Pause,
  Play,
  Search,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Sun,
  User,
  Video,
  RefreshCw,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import type { PostHogSessionSummary, SessionSummary, SessionDetail, IssueSummary, IssueDetail as IssueDetailType, IssueStatus, Severity, SuppressionRuleDoc, AgentPhase, AgentSessionDoc } from '@truffles/shared';
import {
  fetchAgentDetail,
  fetchAgentList,
  fetchPostHogSessions,
  triggerPostHogSync,
  fetchProcessedSessions,
  fetchSessionDetail,
  processSelectedSessions,
  fetchIssues,
  fetchIssueDetail,
  validatePassword,
  fetchSettings,
  updateSettings,
  fetchSuppressionRules,
  addSuppressionRule,
  deleteSuppressionRule,
  resetSuppressionRules,
  clearAllData,
  fetchPRDetail,
  reprocessSession,
  cancelProcessing,
  fetchIdentity,
  retryIssue,
  type PRDetail,
} from './api';
import { useAgentWebSocket } from './useAgentWebSocket';
import { GrassBackground } from './GrassBackground';
import { useProcessingWebSocket } from './useProcessingWebSocket';
import { addToast, subscribeToasts, dismissToast, type Toast } from './toastState';
import { parseDiff, Diff, Hunk, type HunkData } from 'react-diff-view';
import 'react-diff-view/style/index.css';
import { AsciiPlayer } from './components/AsciiPlayer';

const agentPhaseOrder: AgentPhase[] = ['queued', 'starting', 'verifying', 'planning', 'coding', 'reviewing', 'done'];

const referenceNow = new Date('2026-02-07T16:30:00Z').getTime();
const themeStorageKey = 'truffles-theme';
type ThemeMode = 'light' | 'dark';

const statusLabels: Record<IssueStatus, string> = {
  detected: 'Detected',
  screening: 'Screening...',
  queued: 'Queued',
  fixing: 'Fix in progress...',
  pr_open: 'PR Open',
  merged: 'Merged',
  false_alarm: 'False Alarm',
};

const severityOrder: Record<Severity, number> = {
  red: 0,
  yellow: 1,
};

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');

  return `${m}:${s}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatRelative(iso: string): string {
  const deltaMs = referenceNow - new Date(iso).getTime();
  const deltaMin = Math.max(1, Math.floor(deltaMs / 1000 / 60));

  if (deltaMin < 60) {
    return `${deltaMin}m ago`;
  }

  const deltaHours = Math.floor(deltaMin / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }

  return `${Math.floor(deltaHours / 24)}d ago`;
}

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function getSystemTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function severityTone(severity: Severity): string {
  return severity === 'red' ? 'severity-badge-red' : 'severity-badge-yellow';
}

function statusTone(status: IssueStatus): string {
  if (status === 'merged') return 'status-badge-merged';
  if (status === 'false_alarm') return 'status-badge-false-alarm';
  if (status === 'pr_open') return 'status-badge-pr-open';
  if (status === 'fixing') return 'status-badge-fixing';
  if (status === 'queued') return 'status-badge-queued';
  if (status === 'screening') return 'status-badge-screening';
  if (status === 'detected') return 'status-badge-screening';

  return 'status-badge-screening';
}

function phaseLabel(phase: AgentPhase): string {
  if (phase === 'false_alarm') return 'False alarm';
  return `${phase.slice(0, 1).toUpperCase()}${phase.slice(1)}`;
}

function terminalColorClass(category: string | undefined): string {
  switch (category) {
    case 'phase_marker': return 'font-bold text-amber-400';
    case 'tool': return 'text-sky-400';
    case 'error': return 'text-red-400';
    case 'false_alarm': return 'text-yellow-300';
    default: return 'text-emerald-300';
  }
}

function sectionCardClass(extra?: string): string {
  return cn('tr-card rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface)]', extra);
}

const QUIPS = [
  'PRs appear. Nobody knows why. Velocity is up 300%',
  'The best way to find bugs is to let someone else find them',
  'Turning user suffering into pull requests since 2026',
  'Reduce churn by hiding the x button',
  'Three LLMs in a trenchcoat',
  'We automated the part where you ignore the bug report',
  'Move fast, break things, let Claude clean up',
  'What if QA but it\'s just vibes and GPUs',
  'Powered by several very confident language models',
  'Have you tried turning it off and on again',
  'Works on my machine',
];

function RotatingQuip() {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<'in' | 'out'>('in');

  useEffect(() => {
    const DISPLAY = 4500;
    const FADE = 400;

    const tick = () => {
      setPhase('out');
      setTimeout(() => {
        setIndex((i) => (i + 1) % QUIPS.length);
        setPhase('in');
      }, FADE);
    };

    const id = setInterval(tick, DISPLAY);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      className="hidden lg:block text-[13px] italic text-[var(--text-tertiary)] text-right leading-tight select-none transition-all duration-[400ms]"
      style={{
        opacity: phase === 'in' ? 1 : 0,
        transform: phase === 'in' ? 'translateY(0)' : 'translateY(-6px)',
      }}
    >
      {QUIPS[index]}
    </span>
  );
}

function AppNav({ theme, onToggleTheme }: { theme: ThemeMode; onToggleTheme: () => void }) {
  const navItems = [
    { to: '/welcome', label: 'Welcome', icon: Home },
    { to: '/sessions', label: 'Sessions', icon: Video },
    { to: '/issues', label: 'Issues', icon: AlertCircle },
    { to: '/agents', label: 'Agent Lab', icon: Bot },
    { to: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <header className="sticky top-0 z-50 h-16 border-b border-[var(--border-subtle)] bg-[var(--surface)]/95 backdrop-blur">
      <div className="mx-auto flex h-full w-full max-w-[1480px] items-center justify-between gap-4 px-6 md:px-8">
        <Link to="/sessions" className="group flex items-center gap-2.5">
          <span className="brand-mark-shell">
            <img
              src={theme === 'dark' ? '/brand/logo-dark-icon.svg' : '/brand/logo-light-icon.svg'}
              alt=""
              className="h-9 w-9 transition group-hover:opacity-90"
            />
          </span>
          <span className="flex items-baseline gap-2 whitespace-nowrap">
            <span className="text-[21px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
              Truffles
            </span>
            <span aria-hidden className="text-[13px] text-[var(--text-tertiary)]">—</span>
            <span className="text-[13px] font-medium tracking-[0.03em] text-[var(--text-secondary)]">
              Posthog to PR
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-4">
          <RotatingQuip />
          <nav className="flex items-center gap-1 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] p-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-[8px] px-3.5 py-2 text-[14px] font-medium tracking-[-0.01em] transition',
                    isActive
                      ? 'bg-[var(--brand-soft)] text-[var(--brand-text)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--hover-soft)] hover:text-[var(--text-primary)]',
                  )
                }
              >
                <span className="flex items-center gap-1.5">
                  <item.icon size={15} />
                  <span>{item.label}</span>
                  {null}
                </span>
              </NavLink>
            ))}
          </nav>
          <button
            type="button"
            className="button-surface h-9 w-9 p-0"
            onClick={onToggleTheme}
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            <span className="flex items-center justify-center">
              {theme === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}

function WelcomePage() {
  const [greeting, setGreeting] = useState<string>('Welcome!');

  useEffect(() => {
    fetchIdentity()
      .then(({ name }) => {
        if (name) setGreeting(`Hey there, ${name}`);
      })
      .catch(() => {});
  }, []);

  return (
    <section className="animate-rise flex flex-col items-center justify-center gap-8 py-20">
      {/* Greeting + intro */}
      <div className="text-center max-w-lg">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--brand-text)]">
          {greeting}
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-[var(--text-secondary)]">
          Most bugs don't get reported. Users hit something broken, get annoyed, and
          leave. The evidence sits in session recordings that nobody has time to watch.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
          Truffles watches for you. It pulls sessions from PostHog, renders them to
          video, and uses LLMs to spot real UI problems - then spawns coding agents
          that open PRs to fix them. No triage meetings. No tickets. Just fixes.
        </p>
      </div>

      <Link
        to="/sessions"
        className="rounded-lg bg-[var(--brand)] px-5 py-2.5 text-sm font-medium text-[#fff] transition hover:opacity-90"
      >
        Enter Dashboard
      </Link>

      {/* ASCII animation container */}
      <div className="relative overflow-hidden">
        <AsciiPlayer src="/ascii/hedgehog.bin" className="block max-w-full h-auto" />

        {/* Scanline overlay for CRT feel */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0,0,0,0.04) 1px, rgba(0,0,0,0.04) 2px)',
          }}
        />

        {/* Vignette overlay */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%)',
          }}
        />
      </div>
    </section>
  );
}

function SessionsPage() {
  const [activeTab, setActiveTab] = useState<'posthog' | 'processed'>('posthog');
  const { processingState } = useProcessingWebSocket();
  const [sortBy, setSortBy] = useState<'date' | 'events' | 'duration'>('date');

  // PostHog tab state
  const [phSessions, setPhSessions] = useState<PostHogSessionSummary[]>([]);
  const [phLoading, setPhLoading] = useState(false);
  const [phError, setPhError] = useState<string | null>(null);
  const [phHasMore, setPhHasMore] = useState(false);
  const [phOffset, setPhOffset] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);

  // Processed tab state
  const [processedSessions, setProcessedSessions] = useState<SessionSummary[]>([]);
  const [processedLoading, setProcessedLoading] = useState(false);
  const [processedError, setProcessedError] = useState<string | null>(null);

  // Auth modal state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authPassword, setAuthPassword] = useState('');
  const [sessionsAuthError, setSessionsAuthError] = useState<string | null>(null);
  const [processNotice, setProcessNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const loadPostHogSessions = useCallback(async (offset = 0) => {
    setPhLoading(true);
    setPhError(null);
    try {
      const result = await fetchPostHogSessions({ limit: 20, offset });
      if (offset === 0) {
        setPhSessions(result.sessions);
      } else {
        setPhSessions((prev) => [...prev, ...result.sessions]);
      }
      setPhHasMore(result.hasMore);
      setPhOffset(offset + result.sessions.length);
    } catch (err) {
      setPhError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setPhLoading(false);
    }
  }, []);

  const loadProcessedSessions = useCallback(async () => {
    setProcessedLoading(true);
    setProcessedError(null);
    try {
      const result = await fetchProcessedSessions();
      setProcessedSessions(result);
    } catch (err) {
      setProcessedError(err instanceof Error ? err.message : 'Failed to load processed sessions');
    } finally {
      setProcessedLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'posthog' && phSessions.length === 0) {
      loadPostHogSessions(0);
    }
    if (activeTab === 'processed') {
      loadProcessedSessions();
    }
  }, [activeTab, loadPostHogSessions, loadProcessedSessions, phSessions.length]);

  // Background sync: fetch new sessions from PostHog, refresh cache if any found
  useEffect(() => {
    if (activeTab !== 'posthog') return;
    let cancelled = false;
    setSyncing(true);
    triggerPostHogSync()
      .then((result) => {
        if (cancelled) return;
        if (result.newSessions > 0) {
          loadPostHogSessions(0);
        }
      })
      .catch(() => {
        // Sync failure is non-critical — cache still serves
      })
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });
    return () => { cancelled = true; };
  }, [activeTab, loadPostHogSessions]);

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleProcess = async () => {
    const storedPassword = sessionStorage.getItem('truffles-admin-password');
    if (!storedPassword) {
      setShowAuthModal(true);
      return;
    }
    await submitProcessing(storedPassword);
  };

  const submitProcessing = async (pw: string) => {
    setShowAuthModal(false);
    setSessionsAuthError(null);
    try {
      const result = await processSelectedSessions(Array.from(selectedIds), pw);
      sessionStorage.setItem('truffles-admin-password', pw);
      const parts: string[] = [];
      if (result.queued.length > 0) parts.push(`${result.queued.length} queued`);
      if (result.skipped.length > 0) parts.push(`${result.skipped.length} skipped`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);
      setProcessNotice(parts.join(', '));
      setSelectedIds(new Set());
      setTimeout(() => setProcessNotice(null), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to process';
      if (msg.includes('401') || msg.includes('403') || msg.includes('password')) {
        sessionStorage.removeItem('truffles-admin-password');
        sessionStorage.removeItem('truffles-admin-auth');
        setSessionsAuthError(msg);
        setShowAuthModal(true);
      } else {
        setProcessNotice(`Error: ${msg}`);
        setTimeout(() => setProcessNotice(null), 4000);
      }
    }
  };

  const sortedPostHogSessions = useMemo(() => {
    const next = [...phSessions];
    next.sort((a, b) => {
      if (sortBy === 'events') return b.eventCount - a.eventCount;
      if (sortBy === 'duration') return b.durationSec - a.durationSec;
      return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
    });
    return next;
  }, [phSessions, sortBy]);

  const sortedProcessedSessions = useMemo(() => {
    const next = [...processedSessions];
    next.sort((a, b) => {
      if (sortBy === 'events') return b.issueCount - a.issueCount;
      if (sortBy === 'duration') return b.durationSec - a.durationSec;
      return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
    });
    return next;
  }, [processedSessions, sortBy]);

  const copySessionId = async (sessionId: string) => {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopiedSessionId(sessionId);
      window.setTimeout(() => {
        setCopiedSessionId((prev) => (prev === sessionId ? null : prev));
      }, 1100);
    } catch {
      setCopiedSessionId(null);
    }
  };

  return (
    <section className="animate-rise space-y-6">
      {processNotice && (
        <div className="rounded-[10px] border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-2 text-sm text-[var(--accent-text)]">
          {processNotice}
        </div>
      )}

      <div className={sectionCardClass('space-y-4 p-5 sm:p-6')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[26px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
              <Video size={20} className="text-[var(--accent)]" />
              Sessions
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Browse PostHog recordings, prioritize high-signal sessions, and queue them for processing.
            </p>
            {syncing && (
              <p className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
                <Loader2 size={12} className="animate-spin" />
                Checking for new sessions...
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {activeTab === 'posthog' && selectedIds.size > 0 && (
              <button type="button" className="button-surface button-accent" onClick={handleProcess}>
                Process {selectedIds.size} Selected
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="segmented-control">
            <button
              type="button"
              className={cn('segmented-control-item', activeTab === 'posthog' && 'segmented-control-item-active')}
              onClick={() => setActiveTab('posthog')}
            >
              PostHog Sessions
            </button>
            <button
              type="button"
              className={cn('segmented-control-item', activeTab === 'processed' && 'segmented-control-item-active')}
              onClick={() => setActiveTab('processed')}
            >
              Processed
            </button>
          </div>

          <div className="flex items-center gap-2 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] p-1">
            <span className="px-2 text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Sort</span>
            {[
              { key: 'date', label: 'Date' },
              { key: 'events', label: 'Events' },
              { key: 'duration', label: 'Duration' },
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                className={cn(
                  'rounded-[6px] px-2.5 py-1 text-xs font-medium transition',
                  sortBy === option.key
                    ? 'bg-[var(--brand-soft)] text-[var(--brand-text)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--hover-soft)]',
                )}
                onClick={() => setSortBy(option.key as 'date' | 'events' | 'duration')}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeTab === 'posthog' && (
        <>
          {phError && (
            <div className="rounded-[10px] border border-[var(--severity-red-border)] bg-[var(--severity-red-bg)] px-4 py-2 text-sm text-[var(--severity-red-text)]">
              {phError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {sortedPostHogSessions.map((s) => {
              const ps = processingState[s.id];
              const isProcessing = ps?.status === 'processing';
              const isComplete = s.alreadyProcessed || ps?.status === 'complete';
              const isError = ps?.status === 'error';
              const isSelected = selectedIds.has(s.id);
              const isInteresting = s.eventCount >= 1000;

              return (
                <div
                  key={s.id}
                  className={cn(
                    sectionCardClass('tr-card-interactive group relative flex min-h-[188px] flex-col p-4'),
                    isSelected && 'border-[var(--accent-border)] ring-1 ring-[var(--accent-border)]',
                    isInteresting && 'session-interesting',
                    isComplete && 'opacity-80',
                  )}
                >
                  <div className="mb-3 flex items-start gap-2.5">
                    <label className="mt-0.5 flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isComplete || isProcessing}
                        onChange={() => toggleSelection(s.id)}
                        className="h-4 w-4 rounded border-[var(--border-soft)] bg-[var(--surface-soft)] text-[var(--accent)]"
                      />
                    </label>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="mono truncate text-[13px] text-[var(--text-primary)]">{s.id}</p>
                        <button
                          type="button"
                          className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] border border-transparent text-[var(--text-tertiary)] opacity-0 transition group-hover:opacity-100 hover:border-[var(--border-soft)] hover:text-[var(--text-primary)] focus-visible:opacity-100 focus-visible:border-[var(--accent-border)] focus-visible:text-[var(--accent-text)]"
                          onClick={() => copySessionId(s.id)}
                          aria-label={`Copy ${s.id}`}
                        >
                          {copiedSessionId === s.id ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                      <p className="truncate text-[11px] text-[var(--text-tertiary)]">
                        {s.userEmail ? (
                          <span className="inline-flex items-center gap-1"><User size={10} />{s.userEmail}</span>
                        ) : (
                          <span className="mono">{s.distinctId}</span>
                        )}
                      </p>
                    </div>
                    {isComplete && (
                      <span className="chip chip-amber flex items-center gap-1 text-[11px]">
                        <CheckCircle size={11} /> Done
                      </span>
                    )}
                    {isError && (
                      <span className="chip chip-red flex items-center gap-1 text-[11px]">
                        <AlertCircle size={11} /> Error
                      </span>
                    )}
                  </div>

                  <div className="mb-3 flex items-center gap-4 text-xs text-[var(--text-secondary)]">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock size={12} />
                      {formatDate(s.startTime)}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock3 size={12} />
                      {formatDuration(s.durationSec)}
                    </span>
                  </div>

                  <div className="mt-auto space-y-2">
                    <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                      <span className={cn('inline-flex items-center gap-1.5', isInteresting && 'event-badge-hot')}>
                        {s.eventCount} events
                      </span>
                      <span>{formatDuration(s.activeSeconds)} active</span>
                    </div>

                    {isProcessing && ps && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1 text-[var(--accent-text)]">
                            <Loader2 size={11} className="animate-spin" />
                            {ps.phase ?? 'Processing'}
                          </span>
                          <span className="text-[var(--text-secondary)]">{ps.percent ?? 0}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--track)]">
                          <div
                            className="progress-live h-full rounded-full bg-[var(--accent)] transition-all"
                            style={{ width: `${ps.percent ?? 0}%` }}
                          />
                        </div>
                        {ps.message && <p className="text-xs text-[var(--text-tertiary)]">{ps.message}</p>}
                      </div>
                    )}

                    {isError && ps?.error && <p className="text-xs text-[var(--severity-red-text)]">{ps.error}</p>}
                  </div>
                </div>
              );
            })}
          </div>

          {phLoading && (
            <div className="flex justify-center py-8">
              <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
            </div>
          )}

          {phHasMore && !phLoading && (
            <div className="flex justify-center">
              <button
                type="button"
                className="button-surface"
                onClick={() => loadPostHogSessions(phOffset)}
              >
                Load More
              </button>
            </div>
          )}
        </>
      )}

      {activeTab === 'processed' && (
        <>
          {processedLoading && (
            <div className="flex justify-center py-8">
              <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
            </div>
          )}

          {!processedLoading && processedError && (
            <ErrorState message={processedError} onRetry={loadProcessedSessions} />
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sortedProcessedSessions.map((s) => (
              <Link
                key={s.id}
                to={`/sessions/${s.posthogSessionId}`}
                className={sectionCardClass('tr-card-interactive group flex min-h-[188px] flex-col p-4')}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="mono truncate text-[13px] text-[var(--text-primary)]">{s.posthogSessionId}</p>
                  <span className={cn('chip text-[11px]', s.status === 'complete' ? 'chip-emerald' : s.status === 'error' ? 'chip-red' : 'chip-grey')}>
                    {s.status}
                  </span>
                </div>

                <p className="mb-3 flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
                  <User size={13} />
                  {s.userEmail || 'Unknown user'}
                </p>

                <div className="mb-3 flex items-center gap-4 text-xs text-[var(--text-secondary)]">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarClock size={12} />
                    {formatDate(s.startTime)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock3 size={12} />
                    {formatDuration(s.durationSec)}
                  </span>
                </div>

                <div className="mt-auto flex items-center justify-between text-xs">
                  <span className="mono text-[var(--text-tertiary)]">Session #{s.id.slice(-6)}</span>
                  {s.issueCount > 0 ? (
                    <span className="chip chip-amber text-[11px]">{s.issueCount} issues</span>
                  ) : (
                    <span className="text-[var(--text-tertiary)]">No issues</span>
                  )}
                </div>
                {s.thumbnailUrl ? (
                  <div className="mt-3 overflow-hidden rounded-[8px] border border-[var(--border-subtle)]">
                    <img src={s.thumbnailUrl} alt="Session thumbnail" className="h-24 w-full object-cover" />
                  </div>
                ) : null}
              </Link>
            ))}
          </div>

          {!processedLoading && processedSessions.length === 0 && (
            <div className={sectionCardClass('p-8 text-center')}>
              <p className="text-sm text-[var(--text-secondary)]">No processed sessions yet. Switch to PostHog Sessions to select and process recordings.</p>
            </div>
          )}
        </>
      )}

      {/* Auth modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className={sectionCardClass('w-full max-w-md p-6')}>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
              <Lock size={16} />
              Admin Authentication
            </h3>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Enter the admin password to process sessions.</p>

            <label className="mt-4 block space-y-1 text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              Password
              <input
                type="password"
                className="input-surface"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitProcessing(authPassword);
                }}
                autoFocus
              />
            </label>

            {sessionsAuthError && <p className="mt-2 text-sm text-[var(--severity-red-text)]">{sessionsAuthError}</p>}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="button-surface button-accent"
                onClick={() => submitProcessing(authPassword)}
              >
                Authenticate & Process
              </button>
              <button
                type="button"
                className="button-surface"
                onClick={() => {
                  setShowAuthModal(false);
                  setSessionsAuthError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SessionTimeline({
  durationSec,
  issuesAtTime,
  currentTime,
  onJump,
}: {
  durationSec: number;
  issuesAtTime: IssueSummary[];
  currentTime: number;
  onJump: (issue: IssueSummary) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-[var(--text-tertiary)]">
        <p>Issue markers</p>
        <p className="mono text-[var(--text-secondary)]">
          {formatClock(currentTime)} / {formatClock(durationSec)}
        </p>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-[var(--track)]">
        <div className="h-full rounded-full bg-[var(--accent)]/80" style={{ width: `${(currentTime / durationSec) * 100}%` }} />
        {issuesAtTime.map((issue) => (
          <button
            key={issue._id}
            type="button"
            aria-label={`Jump to ${issue.title}`}
            className={cn(
              'absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 transition hover:scale-110',
              issue.severity === 'red'
                ? 'border-[var(--severity-red-border)] bg-[var(--severity-red-text)]'
                : 'border-[var(--severity-yellow-border)] bg-[var(--severity-yellow-text)]',
            )}
            style={{ left: `calc(${(issue.timestampSec / durationSec) * 100}% - 7px)` }}
            onClick={() => onJump(issue)}
          />
        ))}
      </div>
    </div>
  );
}

function SessionDetailPage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Fetch session detail from API
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Fetch issues for this session from API
  const [sessionIssues, setSessionIssues] = useState<IssueSummary[]>([]);

  const [reprocessing, setReprocessing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [highlightedIssue, setHighlightedIssue] = useState<string | null>(null);
  const [rawQuery, setRawQuery] = useState('');
  const [showFalseAlarms, setShowFalseAlarms] = useState(false);

  // Speed options: label → playbackRate
  // Video is rendered at 4x speed, so playbackRate 0.25 = 1x original speed
  const speedOptions = [
    { label: '1x', rate: 0.25 },
    { label: '2x', rate: 0.5 },
    { label: '5x', rate: 1.25 },
    { label: '8x', rate: 2.0 },
  ];
  const [activeSpeed, setActiveSpeed] = useState(0); // index into speedOptions

  // Listen to WebSocket for real-time processing updates
  const { processingState } = useProcessingWebSocket();

  const refetchDetail = useCallback(() => {
    if (!params.id) return;
    fetchSessionDetail(params.id)
      .then((detail) => {
        setSessionDetail(detail);
        setDetailLoading(false);
      })
      .catch((err) => {
        setDetailError(err instanceof Error ? err.message : 'Failed to load session');
        setDetailLoading(false);
      });
  }, [params.id]);

  useEffect(() => {
    if (!params.id) return;
    setDetailLoading(true);
    setDetailError(null);
    refetchDetail();
  }, [params.id, refetchDetail]);

  // Re-fetch session detail when WebSocket reports completion or error
  const posthogId = sessionDetail?.posthogSessionId;
  const wsState = posthogId ? processingState[posthogId] : undefined;
  useEffect(() => {
    if (wsState?.status === 'complete' || wsState?.status === 'error') {
      refetchDetail();
    }
  }, [wsState?.status, refetchDetail]);

  useEffect(() => {
    if (!sessionDetail) return;
    fetchIssues({ sessionId: sessionDetail.id, limit: 50 })
      .then((result) => setSessionIssues(result.issues.sort((a, b) => a.timestampSec - b.timestampSec)))
      .catch(() => {});
  }, [sessionDetail]);

  useEffect(() => {
    setCurrentTime(0);
    setIsPlaying(false);
  }, [params.id]);

  // Sync video timeupdate with timeline
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
    };

    const handleLoadedMetadata = () => {
      setVideoDuration(video.duration);
      video.playbackRate = speedOptions[activeSpeed].rate;
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    // Apply initial playback rate and duration
    video.playbackRate = speedOptions[activeSpeed].rate;
    if (video.readyState >= 1) {
      setVideoDuration(video.duration);
    }

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [sessionDetail?.videoUrl]);

  // Seek to ?t= query param timestamp on load
  useEffect(() => {
    const video = videoRef.current;
    const tParam = searchParams.get('t');
    if (!video || !tParam) return;
    const seekSec = Number(tParam);
    if (isNaN(seekSec) || seekSec <= 0) return;

    const handleSeekable = () => {
      video.currentTime = seekSec;
      setCurrentTime(seekSec);
    };

    if (video.readyState >= 1) {
      handleSeekable();
    } else {
      video.addEventListener('loadedmetadata', handleSeekable, { once: true });
      return () => video.removeEventListener('loadedmetadata', handleSeekable);
    }
  }, [sessionDetail?.videoUrl, searchParams]);

  // Apply playback rate when speed changes
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speedOptions[activeSpeed].rate;
    }
  }, [activeSpeed]);

  const durationSec = videoDuration || sessionDetail?.durationSec || 1;

  if (detailLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  if (!sessionDetail && detailError) {
    return <MissingState title="Session not found" backPath="/sessions" backLabel="Back to Sessions" />;
  }

  if (!sessionDetail) {
    return <MissingState title="Session not found" backPath="/sessions" backLabel="Back to Sessions" />;
  }

  const jumpToIssue = (issue: IssueSummary) => {
    if (videoRef.current) {
      videoRef.current.currentTime = issue.timestampSec;
    }
    setCurrentTime(issue.timestampSec);
    setHighlightedIssue(issue._id);
    window.setTimeout(() => setHighlightedIssue(null), 1200);
  };

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (video) {
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
    }
    setIsPlaying((prev) => !prev);
  };

  const handleSeek = (delta: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + delta);
    }
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekTo = fraction * durationSec;
    if (videoRef.current) {
      videoRef.current.currentTime = seekTo;
    }
  };

  const isRendering = sessionDetail.status === 'rendering' || sessionDetail.status === 'pending';

  const handleReprocess = async () => {
    const pw = sessionStorage.getItem('truffles-admin-password') || prompt('Admin password:');
    if (!pw) return;
    sessionStorage.setItem('truffles-admin-password', pw);
    setReprocessing(true);
    try {
      await reprocessSession(sessionDetail.posthogSessionId);
      setSessionDetail({ ...sessionDetail, status: 'rendering', errorMessage: null });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Reprocess failed');
    } finally {
      setReprocessing(false);
    }
  };

  const handleCancel = async () => {
    const pw = sessionStorage.getItem('truffles-admin-password') || prompt('Admin password:');
    if (!pw) return;
    sessionStorage.setItem('truffles-admin-password', pw);
    setCancelling(true);
    try {
      await cancelProcessing(sessionDetail.posthogSessionId);
      setSessionDetail({ ...sessionDetail, status: 'error', errorMessage: 'Cancelled by user' });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  };

  const userEmail = sessionDetail.userEmail;
  const startTime = sessionDetail.startTime;
  const sessionId = sessionDetail.posthogSessionId;

  const rawPayload = JSON.stringify(
    {
      sessionId,
      consoleErrors: sessionDetail.consoleErrors,
      networkFailures: sessionDetail.networkFailures,
      metadata: sessionDetail.metadata,
    },
    null,
    2,
  );

  const rawLines = rawPayload
    .split('\n')
    .filter((line) => line.toLowerCase().includes(rawQuery.trim().toLowerCase()) || !rawQuery.trim());

  return (
    <div className="animate-rise flex h-[calc(100dvh-8.25rem)] flex-col gap-3">
      <Link to="/sessions" className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-[var(--text-tertiary)] transition hover:text-[var(--text-primary)]">
        <ChevronLeft size={14} />
        Sessions
      </Link>
      <section className="grid min-h-0 flex-1 grid-rows-[1fr] gap-5 xl:grid-cols-[1fr_380px]">
      <div className={cn(sectionCardClass('p-6'), 'min-h-0 overflow-y-auto')}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-tertiary)]">Session Detail</p>
            <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">{userEmail || sessionId}</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              {startTime ? formatDate(startTime) : ''} • {sessionId}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isRendering ? (
              <button
                type="button"
                className="button-surface"
                onClick={handleCancel}
                disabled={cancelling}
              >
                <span className="flex items-center gap-1.5">
                  {cancelling ? <Loader2 size={13} className="animate-spin" /> : <CircleSlash size={13} />}
                  {cancelling ? 'Cancelling...' : 'Cancel Processing'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                className="button-surface"
                onClick={handleReprocess}
                disabled={reprocessing}
              >
                <span className="flex items-center gap-1.5">
                  <RefreshCw size={13} className={reprocessing ? 'animate-spin' : ''} />
                  {reprocessing ? 'Reprocessing...' : 'Reprocess'}
                </span>
              </button>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[#050b12]">
          <div className="relative aspect-video">
            {sessionDetail?.videoUrl ? (
              <video
                ref={videoRef}
                src={sessionDetail.videoUrl}
                className="h-full w-full object-contain"
                onClick={handlePlayPause}
              />
            ) : isRendering ? (
              <div className="flex h-full items-center justify-center">
                <div className="w-64 text-center">
                  <Loader2 size={32} className="mx-auto animate-spin text-[var(--accent)]" />
                  <p className="mt-2 text-sm text-[var(--text-tertiary)]">
                    {wsState?.message ?? 'Video is being rendered...'}
                  </p>
                  {wsState?.percent != null && (
                    <div className="mt-3">
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border-subtle)]">
                        <div
                          className="h-full rounded-full bg-[var(--accent)] transition-all"
                          style={{ width: `${wsState.percent}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-[var(--text-tertiary)]">{wsState.percent}%</p>
                    </div>
                  )}
                </div>
              </div>
            ) : sessionDetail?.status === 'error' ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <AlertCircle size={32} className="mx-auto text-[var(--severity-red-text)]" />
                  <p className="mt-2 text-sm text-[var(--severity-red-text)]">{sessionDetail.errorMessage ?? 'Rendering failed'}</p>
                  <button
                    type="button"
                    className="button-surface mt-4"
                    onClick={handleReprocess}
                    disabled={reprocessing}
                  >
                    <span className="flex items-center gap-1.5">
                      <RefreshCw size={13} className={reprocessing ? 'animate-spin' : ''} />
                      {reprocessing ? 'Reprocessing...' : 'Retry'}
                    </span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <Video size={32} className="mx-auto text-[var(--text-tertiary)]" />
                  <p className="mt-2 text-sm text-[var(--text-tertiary)]">No video available</p>
                </div>
              </div>
            )}
          </div>

          {/* Control bar */}
          <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2">
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--text-primary)] transition hover:bg-[var(--surface-soft)]"
              onClick={handlePlayPause}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
            </button>

            {/* Scrubber + issue markers */}
            <div
              className="group relative flex-1 cursor-pointer py-1.5"
              onClick={handleTimelineClick}
            >
              <div className="relative h-1.5 rounded-full bg-[var(--track)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-150"
                  style={{ width: `${durationSec > 0 ? Math.min(100, (currentTime / durationSec) * 100) : 0}%` }}
                />
                {/* Scrubber thumb */}
                <div
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] opacity-0 shadow transition group-hover:opacity-100"
                  style={{ left: `${durationSec > 0 ? Math.min(100, (currentTime / durationSec) * 100) : 0}%` }}
                />
              </div>
              {/* Issue markers */}
              {sessionIssues.map((issue) => (
                <button
                  key={issue._id}
                  type="button"
                  aria-label={`Jump to ${issue.title}`}
                  className={cn(
                    'absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border transition hover:scale-125',
                    issue.severity === 'red'
                      ? 'border-[var(--severity-red-border)] bg-[var(--severity-red-text)]'
                      : 'border-[var(--severity-yellow-border)] bg-[var(--severity-yellow-text)]',
                  )}
                  style={{ left: `calc(${durationSec > 0 ? (issue.timestampSec / durationSec) * 100 : 0}% - 5px)` }}
                  onClick={(e) => { e.stopPropagation(); jumpToIssue(issue); }}
                />
              ))}
            </div>

            <span className="mono shrink-0 text-xs tabular-nums text-[var(--text-secondary)]">
              {formatClock(currentTime)} / {formatClock(durationSec)}
            </span>

            {/* Speed selector */}
            <div className="segmented-control shrink-0">
              {speedOptions.map((opt, idx) => (
                <button
                  key={opt.label}
                  type="button"
                  className={cn(
                    'segmented-control-item',
                    idx === activeSpeed ? 'segmented-control-item-active' : '',
                  )}
                  onClick={() => setActiveSpeed(idx)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <aside className={cn(sectionCardClass('p-5'), 'flex min-h-0 flex-col overflow-hidden')}>
        <h3 className="flex-none flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
          <AlertCircle size={17} className="text-[var(--accent)]" />
          Issues ({sessionIssues.length})
        </h3>
        <div className="mt-4 flex-1 space-y-2.5 overflow-y-auto pr-1">
          {sessionIssues
            .filter((issue) => showFalseAlarms || issue.status !== 'false_alarm')
            .map((issue) => (
            <button
              key={issue._id}
              type="button"
              onClick={() => jumpToIssue(issue)}
              className={cn(
                'w-full rounded-[8px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] p-3 text-left transition hover:border-[var(--accent-border)]',
                highlightedIssue === issue._id && 'ring-1 ring-[var(--accent-border)]',
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className={cn('severity-badge', severityTone(issue.severity))}>
                  {issue.severity}
                </span>
                <span className="mono text-xs text-[var(--text-secondary)]">{formatClock(issue.timestampSec)}</span>
              </div>

              <p className="text-sm font-semibold text-[var(--text-primary)]">{issue.title}</p>
              <p className="mt-1 line-clamp-4 text-xs text-[var(--text-secondary)]">{issue.description}</p>

              <div className="mt-2 flex items-center justify-between gap-2">
                <span className={cn('status-badge', statusTone(issue.status))}>
                  {statusLabels[issue.status]}
                </span>
                {issue.prNumber ? (
                  <Link
                    to={`/prs/${issue.prNumber}`}
                    className="pr-chip inline-flex items-center gap-1"
                    onClick={(event) => event.stopPropagation()}
                  >
                    PR #{issue.prNumber} <ExternalLink size={11} />
                  </Link>
                ) : null}
              </div>
            </button>
          ))}
          {!showFalseAlarms && sessionIssues.some((i) => i.status === 'false_alarm') && (
            <button
              type="button"
              className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-[8px] py-2 text-xs text-[var(--text-tertiary)] transition hover:bg-[var(--surface-soft)] hover:text-[var(--text-secondary)]"
              onClick={() => setShowFalseAlarms(true)}
            >
              <ChevronDown size={13} />
              Show False Alarms ({sessionIssues.filter((i) => i.status === 'false_alarm').length})
            </button>
          )}
          {showFalseAlarms && sessionIssues.some((i) => i.status === 'false_alarm') && (
            <button
              type="button"
              className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-[8px] py-2 text-xs text-[var(--text-tertiary)] transition hover:bg-[var(--surface-soft)] hover:text-[var(--text-secondary)]"
              onClick={() => setShowFalseAlarms(false)}
            >
              Hide False Alarms
            </button>
          )}
        </div>

        <details className="mt-5 flex-none rounded-[8px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] p-3">
          <summary className="cursor-pointer text-sm font-medium text-[var(--text-primary)]">
            <span className="inline-flex items-center gap-1.5">
              <Search size={13} />
              Raw Session Data
            </span>
          </summary>
          <div className="mt-3 space-y-2">
            <input
              className="input-surface"
              placeholder="Search raw JSON"
              value={rawQuery}
              onChange={(event) => setRawQuery(event.target.value)}
            />
            <pre className="mono max-h-56 overflow-auto rounded-[8px] border border-[var(--border-subtle)] bg-[#050b12] p-3 text-[11px] text-emerald-300">
              {rawLines.join('\n')}
            </pre>
          </div>
        </details>
      </aside>
    </section>
    </div>
  );
}

function IssuesPage() {
  const navigate = useNavigate();
  const [severityFilter, setSeverityFilter] = useState<'all' | Severity>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | IssueStatus>('all');
  const [search, setSearch] = useState('');
  const [issuesList, setIssuesList] = useState<IssueSummary[]>([]);
  const [totalIssues, setTotalIssues] = useState(0);
  const [loading, setLoading] = useState(true);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const statusOptions: Array<{ value: 'all' | IssueStatus; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'detected', label: 'Detected' },
    { value: 'screening', label: 'Screening' },
    { value: 'queued', label: 'Queued' },
    { value: 'fixing', label: 'Fix In Progress' },
    { value: 'pr_open', label: 'PR Open' },
    { value: 'merged', label: 'Merged' },
    { value: 'false_alarm', label: 'False Alarm' },
  ];

  const loadIssues = useCallback(() => {
    setLoading(true);
    setIssuesError(null);
    fetchIssues({ severity: severityFilter, status: statusFilter, limit: 200 })
      .then((result) => {
        setIssuesList(result.issues);
        setTotalIssues(result.total);
        setLoading(false);
      })
      .catch((err) => {
        setIssuesError(err instanceof Error ? err.message : 'Failed to load issues');
        setLoading(false);
      });
  }, [severityFilter, statusFilter]);

  useEffect(() => {
    loadIssues();
  }, [loadIssues]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return issuesList.sort((a, b) => {
        const severityDelta = severityOrder[a.severity] - severityOrder[b.severity];
        if (severityDelta !== 0) return severityDelta;
        return new Date(b.foundAt).getTime() - new Date(a.foundAt).getTime();
      });
    }
    return issuesList
      .filter((issue) =>
        issue.title.toLowerCase().includes(query) ||
        issue.description.toLowerCase().includes(query) ||
        issue._id.toLowerCase().includes(query)
      )
      .sort((a, b) => {
        const severityDelta = severityOrder[a.severity] - severityOrder[b.severity];
        if (severityDelta !== 0) return severityDelta;
        return new Date(b.foundAt).getTime() - new Date(a.foundAt).getTime();
      });
  }, [search, issuesList]);

  return (
    <section className="animate-rise space-y-5">
      <div className={sectionCardClass('space-y-5 p-5 sm:p-6')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[26px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
              <AlertCircle size={20} className="text-[var(--accent)]" />
              Issues
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Sorted by severity then recency, with direct links to sessions and PRs.
            </p>
          </div>
          <span className="chip chip-grey text-[11px]">{filtered.length} of {totalIssues} entries</span>
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] p-3">
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              <Filter size={13} />
              Severity
            </p>
            <div className="segmented-control">
              {[
                { value: 'all', label: 'All' },
                { value: 'red', label: 'Red' },
                { value: 'yellow', label: 'Yellow' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    'segmented-control-item',
                    severityFilter === option.value && 'segmented-control-item-active',
                  )}
                  onClick={() => setSeverityFilter(option.value as 'all' | Severity)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-w-[240px] flex-1 space-y-1">
            <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              <SlidersHorizontal size={13} />
              Status
            </p>
            <div className="flex flex-wrap gap-1">
              {statusOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn('filter-chip', statusFilter === option.value && 'filter-chip-active')}
                  onClick={() => setStatusFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <label className="min-w-[220px] flex-1 space-y-1 text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            <span className="inline-flex items-center gap-1.5">
              <Search size={12} />
              Search
            </span>
            <input
              className="input-surface"
              placeholder="Description, session, issue id"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-8">
          <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
        </div>
      )}

      {!loading && issuesError && (
        <ErrorState message={issuesError} onRetry={loadIssues} />
      )}

      {!loading && !issuesError && (
        <div className="space-y-3">
          {filtered.map((issue) => {
            const statusLabel = statusLabels[issue.status];
            const showSpinner = issue.status === 'screening' || issue.status === 'detected';
            const showPulse = issue.status === 'fixing';
            const canRetry = ['detected', 'queued', 'false_alarm'].includes(issue.status);

            return (
              <button
                key={issue._id}
                type="button"
                className="issue-row w-full text-left"
                onClick={() => navigate(`/issues/${issue._id}`)}
              >
                <div className="grid items-start gap-3 sm:grid-cols-[auto_1fr_auto] sm:gap-4">
                  <div>
                    <span className={cn('severity-badge', severityTone(issue.severity))}>
                      {issue.severity === 'red' ? 'RED' : 'YELLOW'}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <p className={cn('truncate text-[15px] font-semibold text-[var(--text-primary)]', issue.status === 'false_alarm' && 'line-through')}>
                      {issue.title}
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">{issue.description}</p>
                  </div>

                  <div className="flex flex-wrap items-center justify-start gap-2 sm:flex-col sm:items-end sm:justify-start">
                    <div className="text-right">
                      <p className="mono text-[11px] text-[var(--text-secondary)]">{issue.sessionId}</p>
                      <p className="mono text-[11px] text-[var(--text-tertiary)]">{formatClock(issue.timestampSec)}</p>
                    </div>

                    {issue.prNumber ? (
                      <Link
                        to={`/prs/${issue.prNumber}`}
                        className="pr-chip inline-flex items-center gap-1"
                        onClick={(event) => event.stopPropagation()}
                      >
                        PR #{issue.prNumber}
                        <ExternalLink size={11} />
                      </Link>
                    ) : null}

                    <span className={cn('status-badge', statusTone(issue.status), issue.status === 'false_alarm' && 'line-through')}>
                      {showSpinner ? <Loader2 size={12} className="animate-spin" /> : null}
                      {showPulse ? <span className="status-live-dot" /> : null}
                      {statusLabel}
                    </span>

                    {canRetry ? (
                      <button
                        type="button"
                        className="button-surface inline-flex items-center gap-1 px-2 py-1 text-[11px]"
                        title="Retry agent"
                        onClick={(event) => {
                          event.stopPropagation();
                          retryIssue(issue._id)
                            .then(() => {
                              addToast('Agent started', 'success');
                              loadIssues();
                            })
                            .catch((err) => {
                              addToast(err instanceof Error ? err.message : 'Retry failed', 'error');
                            });
                        }}
                      >
                        <RefreshCw size={12} />
                        Retry
                      </button>
                    ) : null}

                    <span className="text-[11px] text-[var(--text-tertiary)]">{formatRelative(issue.foundAt)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className={sectionCardClass('p-12 text-center')}>
          <p className="text-sm text-[var(--text-secondary)]">No issues match your current filters.</p>
        </div>
      )}
    </section>
  );
}

function IssueDetailPage() {
  const params = useParams();
  const [issue, setIssue] = useState<IssueDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [relatedIssues, setRelatedIssues] = useState<IssueSummary[]>([]);

  const loadIssue = useCallback(() => {
    if (!params.id) return;
    setLoading(true);
    setDetailError(null);
    fetchIssueDetail(params.id)
      .then((detail) => {
        setIssue(detail);
        setCurrentTime(detail.timestampSec ?? 0);
        setLoading(false);
      })
      .catch((err) => {
        setDetailError(err instanceof Error ? err.message : 'Failed to load issue');
        setLoading(false);
      });
  }, [params.id]);

  useEffect(() => {
    loadIssue();
  }, [loadIssue]);

  useEffect(() => {
    if (!issue) return;
    fetchIssues({ sessionId: issue.sessionId, limit: 50 })
      .then((result) => setRelatedIssues(result.issues))
      .catch(() => {});
  }, [issue?.sessionId]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  if (detailError) {
    return (
      <section className="animate-rise">
        <ErrorState message={detailError} onRetry={loadIssue} />
      </section>
    );
  }

  if (!issue) {
    return <MissingState title="Issue not found" backPath="/issues" backLabel="Back to Issues" />;
  }

  return (
    <div className="animate-rise space-y-3">
      <Link to="/issues" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-tertiary)] transition hover:text-[var(--text-primary)]">
        <ChevronLeft size={14} />
        Issues
      </Link>
      <section className="grid gap-5 xl:grid-cols-[1fr_390px]">
      <div className={sectionCardClass('p-6')}>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-tertiary)]">Issue Detail</p>
            <h2 className="flex items-center gap-2 text-[24px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
              <AlertCircle size={18} className="text-[var(--accent)]" />
              {issue.title}
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">{issue.sessionEmail ?? issue.sessionId} • {formatDate(issue.foundAt)}</p>
          </div>
          <span className={cn('severity-badge', severityTone(issue.severity))}>{issue.severity}</span>
        </div>

        <div className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] p-4">
          <p className="text-sm text-[var(--text-secondary)]">{issue.description}</p>
          <div className="mt-3">
            <SessionTimeline
              durationSec={240}
              issuesAtTime={relatedIssues}
              currentTime={currentTime}
              onJump={(targetIssue) => setCurrentTime(targetIssue.timestampSec)}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className="button-surface" onClick={() => setCurrentTime(Math.max(0, currentTime - 5))}>
              -5s
            </button>
            <button type="button" className="button-surface" onClick={() => setCurrentTime(issue.timestampSec)}>
              Jump to issue
            </button>
            <button
              type="button"
              className="button-surface"
              onClick={() => setCurrentTime(Math.min(240, currentTime + 5))}
            >
              +5s
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className={sectionCardClass('p-4')}>
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">LLM Analysis Reasoning</h3>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{issue.llmReasoning}</p>
          </div>

          <div className={sectionCardClass('p-4')}>
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Screening Assessment</h3>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{issue.screeningReasoning}</p>
          </div>
        </div>

        {issue.prNumber ? (
          <div className={cn('mt-5', sectionCardClass('p-4'))}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Pull Request</h3>
              {issue.prUrl ? (
                <a href={issue.prUrl} target="_blank" rel="noreferrer" className="pr-chip inline-flex items-center gap-1">
                  PR #{issue.prNumber} on GitHub <ExternalLink size={11} />
                </a>
              ) : (
                <Link to={`/prs/${issue.prNumber}`} className="pr-chip inline-flex items-center gap-1">
                  PR #{issue.prNumber} <ExternalLink size={11} />
                </Link>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <aside className={sectionCardClass('p-5')}>
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Issue Snapshot</h3>
        <div className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
          <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Session</p>
            <Link to={`/sessions/${issue.sessionId}`} className="mono pr-chip inline-flex items-center gap-1">
              <Video size={12} />
              {issue.sessionId}
            </Link>
          </div>

          <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Status</p>
            <div className="mt-1 flex items-center gap-2">
              <span className={cn('status-badge inline-flex', statusTone(issue.status))}>
                {statusLabels[issue.status]}
              </span>
              {['detected', 'queued', 'false_alarm'].includes(issue.status) ? (
                <button
                  type="button"
                  className="button-surface inline-flex items-center gap-1 px-2 py-1 text-[11px]"
                  onClick={() => {
                    retryIssue(issue._id)
                      .then(() => {
                        addToast('Agent started', 'success');
                        loadIssue();
                      })
                      .catch((err) => {
                        addToast(err instanceof Error ? err.message : 'Retry failed', 'error');
                      });
                  }}
                >
                  <RefreshCw size={12} />
                  Retry
                </button>
              ) : null}
            </div>
          </div>

          {issue.prNumber ? (
            <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">PR</p>
              <Link to={`/prs/${issue.prNumber}`} className="pr-chip inline-flex items-center gap-1">
                <GitPullRequest size={12} /> #{issue.prNumber}
              </Link>
            </div>
          ) : null}

          {issue.falseAlarmReason ? (
            <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">False Alarm Reason</p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{issue.falseAlarmReason}</p>
            </div>
          ) : null}
        </div>
      </aside>
    </section>
    </div>
  );
}

function AgentsPage() {
  const [agents, setAgents] = useState<AgentSessionDoc[]>([]);
  const [stats, setStats] = useState({ maxConcurrent: 5, activeCount: 0, queuedCount: 0 });
  const [loading, setLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const { agentState } = useAgentWebSocket();
  const [runtimeTick, setRuntimeTick] = useState(0);

  const loadAgents = useCallback(() => {
    setLoading(true);
    setAgentsError(null);
    fetchAgentList()
      .then((result) => {
        setAgents(result.active);
        setStats(result.stats);
        setLoading(false);
      })
      .catch((err) => {
        setAgentsError(err instanceof Error ? err.message : 'Failed to load agents');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  // Re-fetch when WebSocket indicates changes
  useEffect(() => {
    const agentIds = Object.keys(agentState);
    if (agentIds.length === 0) return;
    fetchAgentList()
      .then((result) => {
        setAgents(result.active);
        setStats(result.stats);
      })
      .catch(() => {});
  }, [agentState]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRuntimeTick((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const phaseSteps: AgentPhase[] = ['planning', 'coding', 'reviewing', 'done'];
  const getStepIndex = (status: AgentPhase) => {
    if (status === 'false_alarm') return 3;
    if (status === 'failed') return 3;
    if (status === 'done') return 3;
    if (status === 'queued' || status === 'starting' || status === 'verifying') return 0;
    return Math.max(0, phaseSteps.indexOf(status));
  };

  const getProgressFromPhase = (status: AgentPhase): number => {
    const idx = agentPhaseOrder.indexOf(status);
    if (idx < 0) return 0;
    return Math.round((idx / (agentPhaseOrder.length - 1)) * 100);
  };

  const computeRuntimeSec = (startedAt: string): number => {
    const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
    return Math.max(0, elapsed);
  };

  const throughput = (agents.length * 0.6).toFixed(1);

  if (loading) {
    return (
      <section className="animate-rise">
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
        </div>
      </section>
    );
  }

  if (agentsError) {
    return (
      <section className="animate-rise">
        <ErrorState message={agentsError} onRetry={loadAgents} />
      </section>
    );
  }

  return (
    <section className="animate-rise space-y-5">
      <div className={sectionCardClass('space-y-5 p-5 sm:p-6')}>
        <div>
          <h2 className="flex items-center gap-2 text-[26px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
            <Bot size={20} className="text-[var(--accent)]" />
            Agent Lab
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">Live status for active coding agents and queue throughput.</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Metric title="Active Agents" value={`${stats.activeCount} / ${stats.maxConcurrent}`} icon={Bot} variant="hero" />
          <Metric title="Queue" value={`${stats.queuedCount} pending`} icon={Clock3} variant="hero" />
          <Metric title="Throughput" value={`${throughput} issues/min`} icon={Activity} variant="hero" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => {
            const liveState = agentState[agent._id];
            const currentStatus = liveState?.phase ?? agent.status;
            const stepIndex = getStepIndex(currentStatus);
            const runtimeSec = agent.completedAt
              ? Math.floor((new Date(agent.completedAt).getTime() - new Date(agent.startedAt).getTime()) / 1000)
              : computeRuntimeSec(agent.startedAt) + runtimeTick;
            const runtime = formatDuration(Math.max(0, runtimeSec));
            const progress = getProgressFromPhase(currentStatus);
            const isDone = currentStatus === 'done' || currentStatus === 'failed' || currentStatus === 'false_alarm';

            return (
              <Link key={agent._id} to={`/agents/${agent._id}`} className={sectionCardClass('tr-card-interactive space-y-3 p-4')}>
                <p className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Agent #{agent._id.slice(-6)}</p>
                <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">Issue: {agent.issueId.slice(-8)}</h3>

                <div className="flex flex-wrap gap-1.5">
                  {phaseSteps.map((phase, index) => (
                    <span
                      key={phase}
                      className={cn(
                        'rounded-[6px] border px-2 py-0.5 text-[10px] uppercase tracking-[0.1em]',
                        index < stepIndex && 'border-[var(--severity-green-border)] bg-[var(--severity-green-bg)] text-[var(--severity-green-text)]',
                        index === stepIndex && 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]',
                        index > stepIndex && 'border-[var(--border-soft)] bg-[var(--surface-soft)] text-[var(--text-tertiary)]',
                      )}
                    >
                      {phaseLabel(phase)}
                    </span>
                  ))}
                </div>

                <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                  <span className="inline-flex items-center gap-1">
                    {!isDone && <span className="status-live-dot" />}
                    Runtime
                  </span>
                  <span className="mono text-[12px]">{runtime}</span>
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-[var(--track)]">
                  <div
                    className={cn('h-full rounded-full', isDone ? 'bg-[var(--accent)]' : 'progress-live bg-[var(--accent)]')}
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <p className="inline-flex items-center gap-1 text-xs uppercase tracking-[0.12em] text-[var(--accent-text)]">
                  <Sparkles size={11} />
                  {isDone ? 'View results' : 'View live output'}
                </p>
              </Link>
            );
          })}
        </div>

        {agents.length === 0 && (
          <div className={sectionCardClass('p-8 text-center')}>
            <p className="text-sm text-[var(--text-secondary)]">No active agents. Issues will be dispatched automatically after screening.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function AgentDetailPage() {
  const params = useParams();
  const [agent, setAgent] = useState<AgentSessionDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const { agentState } = useAgentWebSocket();
  const terminalRef = useRef<HTMLPreElement>(null);

  const loadAgent = useCallback(() => {
    if (!params.id) return;
    setLoading(true);
    setDetailError(null);
    fetchAgentDetail(params.id)
      .then((detail) => {
        setAgent(detail);
        setLoading(false);
      })
      .catch((err) => {
        setDetailError(err instanceof Error ? err.message : 'Failed to load agent');
        setLoading(false);
      });
  }, [params.id]);

  // Fetch initial state
  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  // Re-fetch when WebSocket signals completion
  useEffect(() => {
    if (!params.id) return;
    const liveState = agentState[params.id];
    if (liveState && (liveState.status === 'done' || liveState.status === 'failed' || liveState.status === 'false_alarm')) {
      fetchAgentDetail(params.id)
        .then((detail) => setAgent(detail))
        .catch(() => {});
    }
  }, [params.id, agentState]);

  // Auto-scroll terminal output
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  });

  const getProgressFromPhase = (status: AgentPhase): number => {
    const idx = agentPhaseOrder.indexOf(status);
    if (idx < 0) return 0;
    return Math.round((idx / (agentPhaseOrder.length - 1)) * 100);
  };

  if (loading) {
    return (
      <section className="animate-rise">
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
        </div>
      </section>
    );
  }

  if (detailError) {
    return (
      <section className="animate-rise">
        <ErrorState message={detailError} onRetry={loadAgent} />
      </section>
    );
  }

  if (!agent) {
    return <MissingState title="Agent not found" backPath="/agents" backLabel="Back to Agent Lab" />;
  }

  // Get live state from WebSocket
  const liveState = params.id ? agentState[params.id] : undefined;
  const currentStatus = liveState?.phase ?? agent.status;
  const phaseIndex = agentPhaseOrder.indexOf(currentStatus === 'false_alarm' ? 'reviewing' : currentStatus);

  // Compute runtime
  const runtimeSec = agent.completedAt
    ? Math.floor((new Date(agent.completedAt).getTime() - new Date(agent.startedAt).getTime()) / 1000)
    : Math.floor((Date.now() - new Date(agent.startedAt).getTime()) / 1000);

  const progress = getProgressFromPhase(currentStatus);
  const isDone = currentStatus === 'done' || currentStatus === 'failed' || currentStatus === 'false_alarm';

  // Use live output lines from WebSocket, fall back to stored outputLog
  const outputLines = liveState?.outputLines && liveState.outputLines.length > 0
    ? liveState.outputLines
    : agent.outputLog.map((entry) => ({ content: entry.content, category: entry.category ?? 'assistant' as const }));
  const streamingText = liveState?.streamingText ?? '';

  return (
    <div className="animate-rise space-y-3">
      <Link to="/agents" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-tertiary)] transition hover:text-[var(--text-primary)]">
        <ChevronLeft size={14} />
        Agent Lab
      </Link>
      <section className="space-y-5">
      <div className={sectionCardClass('p-6')}>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[24px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
              <Bot size={18} className="text-[var(--accent)]" />
              Agent #{agent._id.slice(-6)}
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Status: {phaseLabel(currentStatus)} • Runtime: {formatDuration(Math.max(0, runtimeSec))}
              {agent.costUsd != null && ` • Cost: $${agent.costUsd.toFixed(2)}`}
            </p>
            <p className="text-xs text-[var(--text-tertiary)]">
              Issue:{' '}
              <Link to={`/issues/${agent.issueId}`} className="pr-chip inline-flex items-center gap-1">
                <AlertCircle size={11} />
                {agent.issueId}
              </Link>{' '}
              • Branch:{' '}
              <span className="mono text-[var(--text-secondary)]">{agent.branchName}</span>
            </p>
          </div>
          <span className="chip chip-amber text-[11px]">{progress}% complete</span>
        </div>

        {/* Error banner */}
        {(agent.error || liveState?.error) && (
          <div className="mb-5 rounded-[8px] border border-[var(--severity-red-border)] bg-[var(--severity-red-bg)] p-3 text-sm text-[var(--severity-red-text)]">
            <span className="font-semibold">Error:</span> {liveState?.error ?? agent.error}
          </div>
        )}

        {/* False alarm banner */}
        {(agent.falseAlarmReason || liveState?.falseAlarmReason) && (
          <div className="mb-5 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] p-3 text-sm text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--text-primary)]">False Alarm:</span> {liveState?.falseAlarmReason ?? agent.falseAlarmReason}
          </div>
        )}

        {/* PR link */}
        {(agent.prUrl || liveState?.prUrl) && (
          <div className="mb-5 rounded-[8px] border border-[var(--severity-green-border)] bg-[var(--severity-green-bg)] p-3">
            <a
              href={liveState?.prUrl ?? agent.prUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--severity-green-text)]"
            >
              <GitPullRequest size={14} />
              PR #{agent.prNumber ?? 'Link'}
              <ExternalLink size={12} />
            </a>
          </div>
        )}

        <div className={sectionCardClass('mb-5 p-4')}>
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Phase Timeline</h3>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {agentPhaseOrder.map((phase, index) => {
              const complete = index < phaseIndex;
              const current = index === phaseIndex;

              return (
                <div
                  key={phase}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs uppercase tracking-[0.14em]',
                    complete && 'border-[var(--severity-green-border)] bg-[var(--severity-green-bg)] text-[var(--severity-green-text)]',
                    current && 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]',
                    !complete && !current && 'border-[var(--border-soft)] bg-[var(--surface-soft)] text-[var(--text-tertiary)]',
                  )}
                >
                  {phaseLabel(phase)}
                </div>
              );
            })}
          </div>
        </div>

        <div className={sectionCardClass('p-4')}>
          <h3 className="mono text-xs uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            {isDone ? 'Output Log' : 'Live Output'}
          </h3>
          <pre
            ref={terminalRef}
            className="mono mt-3 h-64 overflow-auto rounded-[8px] border border-[var(--border-subtle)] bg-[#050b12] p-3 text-[12px]"
          >
            {outputLines.map((line, i) => (
              <span key={i} className={terminalColorClass(line.category)}>{line.content}{'\n'}</span>
            ))}
            {streamingText && <span className="text-emerald-300">{streamingText}</span>}
            {!isDone && <span className="animate-pulse text-[var(--text-primary)]">▋</span>}
          </pre>
        </div>

        <div className={cn('mt-5', sectionCardClass('p-4'))}>
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Files Modified</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {agent.filesModified.length > 0 ? (
              agent.filesModified.map((file) => (
                <span key={file} className="chip chip-grey mono text-[11px]">
                  {file}
                </span>
              ))
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">No file edits yet.</p>
            )}
          </div>
        </div>
      </div>
    </section>
    </div>
  );
}

function PRReviewPage() {
  const params = useParams();
  const prNumber = Number(params.id);
  const [pr, setPr] = useState<PRDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Video snippet state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [sessionIssues, setSessionIssues] = useState<IssueSummary[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!prNumber || isNaN(prNumber)) {
      setError('Invalid PR number');
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchPRDetail(prNumber)
      .then((data) => {
        setPr(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load PR');
        setLoading(false);
      });
  }, [prNumber]);

  // Fetch session detail for video snippet
  useEffect(() => {
    if (!pr?.sessionId) return;
    setVideoLoading(true);
    fetchSessionDetail(pr.sessionId)
      .then((detail) => {
        setSessionDetail(detail);
        setVideoLoading(false);
      })
      .catch(() => setVideoLoading(false));
  }, [pr?.sessionId]);

  // Fetch session issues for timeline markers
  useEffect(() => {
    if (!pr?.sessionId) return;
    fetchIssues({ sessionId: pr.sessionId, limit: 50 })
      .then((result) => setSessionIssues(result.issues.sort((a, b) => a.timestampSec - b.timestampSec)))
      .catch(() => {});
  }, [pr?.sessionId]);

  // Sync video timeupdate/play/pause events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    // Play at 1x original speed (video is rendered at 4x)
    video.playbackRate = 0.25;

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [sessionDetail?.videoUrl]);

  // Auto-seek to issue timestamp on video load
  useEffect(() => {
    const video = videoRef.current;
    if (!video || pr?.issueTimestampSec == null) return;
    const seekSec = pr.issueTimestampSec;

    const handleSeekable = () => {
      video.currentTime = seekSec;
      video.playbackRate = 0.25;
      setCurrentTime(seekSec);
    };

    if (video.readyState >= 1) {
      handleSeekable();
    } else {
      video.addEventListener('loadedmetadata', handleSeekable, { once: true });
      return () => video.removeEventListener('loadedmetadata', handleSeekable);
    }
  }, [sessionDetail?.videoUrl, pr?.issueTimestampSec]);

  const snippetDuration = sessionDetail?.durationSec ?? 0;

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  };

  const handleSnippetSeek = (delta: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + delta);
  };

  const jumpToSnippetIssue = (issue: IssueSummary) => {
    if (videoRef.current) {
      videoRef.current.currentTime = issue.timestampSec;
    }
    setCurrentTime(issue.timestampSec);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  if (error || !pr) {
    return <MissingState title={error || 'PR not found'} backPath="/issues" backLabel="Back to Issues" />;
  }

  const statusLabel = pr.status === 'open' ? 'Open' : pr.status === 'merged' ? 'Merged' : 'Closed';

  return (
    <div className="animate-rise space-y-3">
      <Link to="/issues" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-tertiary)] transition hover:text-[var(--text-primary)]">
        <ChevronLeft size={14} />
        Issues
      </Link>
      <section>
      <div className={sectionCardClass('p-6')}>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-tertiary)]">PR Review</p>
            <h2 className="flex items-center gap-2 text-[24px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
              <GitPullRequest size={18} className="text-[var(--accent)]" />
              <span>
                PR #{pr.id}: {pr.title}
              </span>
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Branch: <span className="mono">{pr.branch}</span>
            </p>
          </div>
          <a
            className="button-surface button-accent"
            href={pr.htmlUrl}
            target="_blank"
            rel="noreferrer"
          >
            <span className="inline-flex items-center gap-1.5">
              View on GitHub
              <ExternalLink size={13} />
            </span>
          </a>
        </div>

        <div className="mb-5 grid gap-3 sm:grid-cols-4">
          <Metric title="Status" value={statusLabel} />
          <Metric title="Lines" value={`+${pr.additions} / -${pr.deletions}`} />
          <Metric title="Files" value={`${pr.filesChanged}`} />
          <Metric title="Linked Issue" value={pr.issueId ? (pr.issueTitle || pr.issueId) : '-'} />
        </div>

        <div className={cn('mb-5', sectionCardClass('p-4'))}>
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Issue Context</h3>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">{pr.issueDescription || 'No linked issue description.'}</p>
          <div className="mt-2 flex gap-2">
            {pr.issueId ? (
              <Link to={`/issues/${pr.issueId}`} className="button-surface">
                <span className="inline-flex items-center gap-1.5">
                  <AlertCircle size={13} />
                  Open issue detail
                </span>
              </Link>
            ) : null}
            {pr.sessionId ? (
              <Link to={`/sessions/${pr.sessionId}${pr.issueTimestampSec != null ? `?t=${pr.issueTimestampSec}` : ''}`} className="button-surface">
                <span className="inline-flex items-center gap-1.5">
                  <Video size={13} />
                  Watch moment
                </span>
              </Link>
            ) : null}
          </div>
        </div>

        {pr.sessionId ? (
          <div className={cn('mb-5', sectionCardClass('overflow-hidden'))}>
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-soft)] px-4 py-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                <Video size={13} />
                Session Moment
              </h3>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => handleSnippetSeek(-5)} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)] hover:text-[var(--text-primary)]">
                  -5s
                </button>
                <button type="button" onClick={handlePlayPause} className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)] hover:text-[var(--text-primary)]">
                  {isPlaying ? <Pause size={11} /> : <Play size={11} />}
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button type="button" onClick={() => handleSnippetSeek(5)} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)] hover:text-[var(--text-primary)]">
                  +5s
                </button>
              </div>
            </div>

            <div className="relative bg-[#050b12]">
              {videoLoading ? (
                <div className="flex aspect-video max-h-[280px] items-center justify-center">
                  <Loader2 size={20} className="animate-spin text-[var(--accent)]" />
                </div>
              ) : sessionDetail?.videoUrl ? (
                <>
                  <video
                    ref={videoRef}
                    src={sessionDetail.videoUrl}
                    preload="metadata"
                    className="aspect-video max-h-[280px] w-full object-contain"
                  />
                  <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-[var(--surface)]/90 px-2 py-0.5 text-xs font-medium tabular-nums text-[var(--text-secondary)] backdrop-blur-sm">
                    {formatClock(currentTime)}
                  </div>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#050b12]/80 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 px-4 pb-3">
                    <SessionTimeline
                      durationSec={snippetDuration}
                      issuesAtTime={sessionIssues}
                      currentTime={currentTime}
                      onJump={jumpToSnippetIssue}
                    />
                  </div>
                </>
              ) : (
                <div className="flex aspect-video max-h-[280px] items-center justify-center">
                  <Video size={28} className="text-[var(--text-tertiary)]" />
                </div>
              )}
            </div>
          </div>
        ) : null}

        <DiffViewer diff={pr.diff} />

        {pr.agentReasoning ? (
          <div className="mt-5 rounded-[10px] border border-[var(--accent-border)] bg-[var(--accent-soft)] p-4">
            <p className="text-sm text-[var(--accent-text)]">Agent reasoning: &quot;{pr.agentReasoning}&quot;</p>
            <p className="mt-2 text-xs uppercase tracking-[0.12em] text-[var(--accent-text)]">
              Approve and merge on GitHub.
            </p>
          </div>
        ) : null}
      </div>
    </section>
    </div>
  );
}

function SettingsPage() {
  const [authorized, setAuthorized] = useState<boolean>(() => sessionStorage.getItem('truffles-admin-auth') === 'ok');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [maxAgents, setMaxAgents] = useState(5);
  const [timeoutMinutes, setTimeoutMinutes] = useState(15);
  const [pollingInterval, setPollingInterval] = useState(60);
  const [videoModelPrimary, setVideoModelPrimary] = useState('moonshotai/kimi-k2.5');
  const [videoModelSecondary, setVideoModelSecondary] = useState('google/gemini-3-pro-preview');
  const [screeningModel, setScreeningModel] = useState('anthropic/claude-opus-4.6');
  const [rules, setRules] = useState<SuppressionRuleDoc[]>([]);
  const [manualRule, setManualRule] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2500);
  };

  const handleUnlock = async () => {
    try {
      const valid = await validatePassword(password);
      if (valid) {
        setAuthorized(true);
        setAuthError(null);
        sessionStorage.setItem('truffles-admin-auth', 'ok');
        sessionStorage.setItem('truffles-admin-password', password);
      } else {
        setAuthError('Invalid admin password');
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Validation failed');
    }
  };

  const loadSettings = useCallback(() => {
    if (!authorized) return;
    setSettingsLoading(true);
    setSettingsError(null);
    Promise.all([fetchSettings(), fetchSuppressionRules()])
      .then(([settingsData, rulesData]) => {
        setMaxAgents(settingsData.maxConcurrentAgents);
        setTimeoutMinutes(settingsData.agentTimeoutMinutes);
        setPollingInterval(settingsData.pollingIntervalSec);
        setVideoModelPrimary(settingsData.videoModelPrimary);
        setVideoModelSecondary(settingsData.videoModelSecondary);
        setScreeningModel(settingsData.screeningModel);
        setRules(rulesData.rules);
        setSettingsLoading(false);
      })
      .catch((err) => {
        setSettingsError(err instanceof Error ? err.message : 'Failed to load settings');
        setSettingsLoading(false);
      });
  }, [authorized]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    try {
      await updateSettings({
        maxConcurrentAgents: maxAgents,
        agentTimeoutMinutes: timeoutMinutes,
        pollingIntervalSec: pollingInterval,
        videoModelPrimary,
        videoModelSecondary,
        screeningModel,
      });
      showNotice('Settings saved successfully.');
    } catch (err) {
      showNotice(`Error: ${err instanceof Error ? err.message : 'Failed to save'}`);
    }
  };

  if (!authorized) {
    return (
      <section className="animate-rise mx-auto max-w-2xl">
        <div className={sectionCardClass('space-y-4 p-7')}>
          <h2 className="flex items-center gap-2 text-[26px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
            <Lock size={18} className="text-[var(--accent)]" />
            Settings Access
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">
            Enter the admin password to access settings.
          </p>

          <label className="block space-y-1 text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            Admin Password
            <input
              type="password"
              className="input-surface"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleUnlock();
                }
              }}
            />
          </label>

          {authError ? <p className="text-sm text-[var(--severity-red-text)]">{authError}</p> : null}

          <button type="button" className="button-surface button-accent" onClick={handleUnlock}>
            <span className="inline-flex items-center gap-1.5">
              <Lock size={13} />
              Unlock Settings
            </span>
          </button>
        </div>
      </section>
    );
  }

  if (settingsLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  if (settingsError) {
    return <ErrorState message={settingsError} onRetry={loadSettings} />;
  }

  return (
    <section className="animate-rise space-y-5">
      {notice ? (
        <div className="rounded-[10px] border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-2 text-sm text-[var(--accent-text)]">{notice}</div>
      ) : null}

      <div className={sectionCardClass('space-y-5 p-6')}>
        <div>
          <h2 className="flex items-center gap-2 text-[26px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
            <Settings size={18} className="text-[var(--accent)]" />
            Settings
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">
            Configure agents, models, and suppression rules.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Metric title="Max Agents" value={`${maxAgents}`} icon={Bot} />
          <Metric title="Timeout" value={`${timeoutMinutes}m`} icon={Clock3} />
          <Metric title="Polling" value={`${pollingInterval}s`} icon={Activity} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <SettingsBlock title="PostHog Connection" icon={Activity}>
            <SettingRow label="Project ID" value="12345" />
            <SettingRow label="API Key" value="••••••••••••x9d2" />
            <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              Polling interval (sec)
              <input
                type="number"
                min={15}
                className="input-surface"
                value={pollingInterval}
                onChange={(event) => setPollingInterval(Number(event.target.value))}
              />
            </label>
          </SettingsBlock>

          <SettingsBlock title="OpenRouter" icon={Bot}>
            <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              Video model (primary)
              <select className="input-surface" value={videoModelPrimary} onChange={(event) => setVideoModelPrimary(event.target.value)}>
                <option value="moonshotai/kimi-k2.5">moonshotai/kimi-k2.5</option>
                <option value="google/gemini-3-pro-preview">google/gemini-3-pro-preview</option>
                <option value="anthropic/claude-opus-4.6">anthropic/claude-opus-4.6</option>
              </select>
            </label>
            <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              Video model (secondary)
              <select className="input-surface" value={videoModelSecondary} onChange={(event) => setVideoModelSecondary(event.target.value)}>
                <option value="google/gemini-3-pro-preview">google/gemini-3-pro-preview</option>
                <option value="moonshotai/kimi-k2.5">moonshotai/kimi-k2.5</option>
                <option value="anthropic/claude-opus-4.6">anthropic/claude-opus-4.6</option>
              </select>
            </label>
            <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              Screening model
              <select className="input-surface" value={screeningModel} onChange={(event) => setScreeningModel(event.target.value)}>
                <option value="anthropic/claude-opus-4.6">anthropic/claude-opus-4.6</option>
                <option value="google/gemini-3-pro-preview">google/gemini-3-pro-preview</option>
                <option value="moonshotai/kimi-k2.5">moonshotai/kimi-k2.5</option>
              </select>
            </label>
          </SettingsBlock>

          <SettingsBlock title="GitHub" icon={GitPullRequest}>
            <SettingRow label="Target repo" value="plaibook-dev/ai-outbound-agent" />
            <SettingRow label="Base branch" value="main" />
            <SettingRow label="PR label" value="truffles-autofix" />
          </SettingsBlock>

          <SettingsBlock title="Claude Code Agents" icon={Wrench}>
            <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              Max concurrent agents: {maxAgents}
              <input
                type="range"
                min={1}
                max={10}
                value={maxAgents}
                className="mt-1 w-full accent-[var(--accent)]"
                onChange={(event) => setMaxAgents(Number(event.target.value))}
              />
            </label>

            <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              Timeout (minutes)
              <input
                type="number"
                min={5}
                max={60}
                className="input-surface"
                value={timeoutMinutes}
                onChange={(event) => setTimeoutMinutes(Number(event.target.value))}
              />
            </label>
          </SettingsBlock>
        </div>

        <div className={sectionCardClass('p-4')}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">False Alarms / Suppression Rules</h3>
            <button
              type="button"
              className="button-surface"
              onClick={async () => {
                if (!manualRule.trim()) return;
                try {
                  const newRule = await addSuppressionRule(manualRule.trim());
                  setRules((prev) => [newRule, ...prev]);
                  setManualRule('');
                  showNotice('Suppression rule added.');
                } catch (err) {
                  showNotice(`Error: ${err instanceof Error ? err.message : 'Failed to add rule'}`);
                }
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <ShieldAlert size={13} />
                Add Manual Rule
              </span>
            </button>
          </div>

          <div className="mb-3 grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              className="input-surface"
              placeholder="Describe a suppressible pattern"
              value={manualRule}
              onChange={(event) => setManualRule(event.target.value)}
            />
            <button
              type="button"
              className="button-surface"
              onClick={() => {
                setManualRule('Ignore debug skeleton shimmer under 100ms');
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <Search size={13} />
                Insert sample
              </span>
            </button>
          </div>

          <div className="overflow-x-auto rounded-[8px] border border-[var(--border-subtle)]">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b border-[var(--border-subtle)] bg-[var(--surface-soft)] text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                <tr>
                  <th className="px-3 py-2">Pattern</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Date Added</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule._id} className="border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--hover-soft)] last:border-b-0">
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{rule.pattern}</td>
                    <td className="px-3 py-2">
                      <span className="chip chip-grey text-[11px]">{rule.source}</span>
                    </td>
                    <td className="px-3 py-2 text-[var(--text-tertiary)]">{formatDate(rule.createdAt)}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-xs text-[var(--severity-red-text)] hover:underline"
                        onClick={async () => {
                          try {
                            await deleteSuppressionRule(rule._id);
                            setRules((prev) => prev.filter((entry) => entry._id !== rule._id));
                            showNotice('Suppression rule removed.');
                          } catch (err) {
                            showNotice(`Error: ${err instanceof Error ? err.message : 'Failed to remove rule'}`);
                          }
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-[10px] border border-[var(--severity-red-border)] bg-[var(--severity-red-bg)] p-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--severity-red-text)]">Danger Zone</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="button-surface"
              onClick={async () => {
                if (!window.confirm('This will permanently delete all sessions, issues, agents, and suppression rules. Are you sure?')) return;
                try {
                  await clearAllData();
                  setRules([]);
                  showNotice('All data cleared.');
                } catch (err) {
                  showNotice(`Error: ${err instanceof Error ? err.message : 'Failed to clear data'}`);
                }
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <ShieldAlert size={13} />
                Clear all data
              </span>
            </button>
            <button
              type="button"
              className="button-surface"
              onClick={async () => {
                try {
                  await resetSuppressionRules();
                  setRules([]);
                  showNotice('All suppression rules reset.');
                } catch (err) {
                  showNotice(`Error: ${err instanceof Error ? err.message : 'Failed to reset'}`);
                }
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <CircleSlash size={13} />
                Reset false alarms
              </span>
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <button type="button" className="button-surface button-accent" onClick={handleSave}>
            <span className="inline-flex items-center gap-1.5">
              <Wrench size={13} />
              Save Settings
            </span>
          </button>
          <button
            type="button"
            className="button-surface"
            onClick={() => {
              sessionStorage.removeItem('truffles-admin-auth');
              sessionStorage.removeItem('truffles-admin-password');
              setAuthorized(false);
              showNotice('Session lock restored.');
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <Lock size={13} />
              Lock Settings
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}

function DiffViewer({ diff }: { diff: string }) {
  const files = useMemo(() => {
    if (!diff) return [];
    try {
      return parseDiff(diff, { nearbySequences: 'zip' });
    } catch {
      return [];
    }
  }, [diff]);

  if (files.length === 0) {
    return (
      <div className={sectionCardClass('p-4')}>
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Diff</h3>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">No diff available.</p>
      </div>
    );
  }

  return (
    <div className="diff-dark-theme space-y-3">
      {files.map(({ oldRevision, newRevision, type, hunks, oldPath, newPath }) => (
        <div key={`${oldRevision}-${newRevision}`} className={sectionCardClass('overflow-hidden')}>
          <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-soft)] px-4 py-2">
            <p className="mono text-xs text-[var(--text-secondary)]">
              {newPath || oldPath || 'unknown file'}
            </p>
          </div>
          <div className="overflow-x-auto text-[12px]">
            <Diff viewType="unified" diffType={type} hunks={hunks}>
              {(hunks: HunkData[]) =>
                hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)
              }
            </Diff>
          </div>
        </div>
      ))}
    </div>
  );
}

function Metric({
  title,
  value,
  icon: Icon,
  variant = 'default',
}: {
  title: string;
  value: string;
  icon?: LucideIcon;
  variant?: 'default' | 'hero' | 'positive' | 'neutral';
}) {
  const toneClass =
    variant === 'hero'
      ? 'metric-card-hero'
      : variant === 'positive'
        ? 'metric-card-positive'
        : variant === 'neutral'
          ? 'metric-card-neutral'
          : 'metric-card-default';

  return (
    <div className={cn('metric-card', toneClass)}>
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        {Icon ? <Icon size={12} /> : null}
        {title}
      </p>
      <p className="mt-1 text-[24px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function SettingsBlock({ title, children, icon: Icon }: { title: string; children: ReactNode; icon?: LucideIcon }) {
  return (
    <div className={sectionCardClass('p-4')}>
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        {Icon ? <Icon size={14} className="text-[var(--accent)]" /> : null}
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-3 py-2 text-sm">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className="mono text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

function MissingState({ title, backPath, backLabel }: { title: string; backPath: string; backLabel: string }) {
  return (
    <section className="animate-rise mx-auto max-w-lg">
      <div className={sectionCardClass('p-8 text-center')}>
        <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">{title}</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">The requested route is unavailable in this demo.</p>
        <Link to={backPath} className="button-surface button-accent mt-4 inline-flex">
          {backLabel}
        </Link>
      </div>
    </section>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <AlertTriangle size={28} className="text-[var(--severity-red-text)]" />
      <p className="text-sm text-[var(--text-secondary)]">{message}</p>
      {onRetry ? (
        <button type="button" className="button-surface inline-flex items-center gap-1.5" onClick={onRetry}>
          <RefreshCw size={13} />
          Retry
        </button>
      ) : null}
    </div>
  );
}

function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    return subscribeToasts(setToasts);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className={cn('toast-item', `toast-item-${t.variant}`, t.exiting && 'toast-item-exiting')}
          onClick={() => dismissToast(t.id)}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}

export function App() {
  const [hasManualTheme, setHasManualTheme] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem(themeStorageKey);
    return stored === 'light' || stored === 'dark';
  });

  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'dark';
    const stored = localStorage.getItem(themeStorageKey);
    if (stored === 'light' || stored === 'dark') return stored;
    return getSystemTheme();
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (hasManualTheme || typeof window === 'undefined') return undefined;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const syncTheme = () => setTheme(mediaQuery.matches ? 'dark' : 'light');

    syncTheme();
    mediaQuery.addEventListener('change', syncTheme);
    return () => mediaQuery.removeEventListener('change', syncTheme);
  }, [hasManualTheme]);

  const handleToggleTheme = () => {
    const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    setHasManualTheme(true);
    localStorage.setItem(themeStorageKey, nextTheme);
  };

  return (
    <div className="min-h-screen">
      <div className="tr-background pointer-events-none fixed inset-0 -z-10" />
      <GrassBackground />

      <AppNav theme={theme} onToggleTheme={handleToggleTheme} />

      <main className="mx-auto w-full max-w-[1480px] px-6 pb-12 pt-7 md:px-8">
        <Routes>
          <Route path="/" element={<Navigate to="/welcome" replace />} />
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/sessions/:id" element={<SessionDetailPage />} />
          <Route path="/issues" element={<IssuesPage />} />
          <Route path="/issues/:id" element={<IssueDetailPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:id" element={<AgentDetailPage />} />
          <Route path="/prs/:id" element={<PRReviewPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<MissingState title="Page not found" backPath="/sessions" backLabel="Back to Sessions" />} />
        </Routes>
      </main>
      <ToastContainer />
    </div>
  );
}
