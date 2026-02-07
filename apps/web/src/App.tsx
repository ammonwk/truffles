import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bot,
  CalendarClock,
  CheckCircle,
  CircleSlash,
  Clock3,
  ExternalLink,
  Filter,
  GitPullRequest,
  Loader2,
  Lock,
  Moon,
  Pause,
  Play,
  Search,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Sun,
  User,
  Video,
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
} from 'react-router-dom';
import type { PostHogSessionSummary, SessionSummary, SessionDetail } from '@truffles/shared';
import {
  fetchPostHogSessions,
  fetchProcessedSessions,
  fetchSessionDetail,
  processSelectedSessions,
} from './api';
import { useProcessingWebSocket } from './useProcessingWebSocket';
import {
  agentPhaseOrder,
  agentSessions,
  issues,
  pullRequests,
  sessions,
  severityOrder,
  statusLabels,
  suppressionRules,
  type AgentPhase,
  type IssueRecord,
  type IssueStatus,
  type Severity,
  type SuppressionRule,
} from './mockData';

const referenceNow = new Date('2026-02-07T16:30:00Z').getTime();
const adminStubPassword = 'truffles-demo';
const themeStorageKey = 'truffles-theme';
type ThemeMode = 'light' | 'dark';

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
  return severity === 'red'
    ? 'text-severity-red bg-severity-red/15 border-severity-red/35'
    : 'text-severity-yellow bg-severity-yellow/15 border-severity-yellow/35';
}

function statusTone(status: IssueStatus): string {
  if (status === 'merged') return 'text-severity-green bg-severity-green/15 border-severity-green/35';
  if (status === 'false_alarm') return 'text-severity-grey bg-severity-grey/15 border-severity-grey/35';
  if (status === 'pr_open') return 'text-amber-200 bg-amber-500/15 border-amber-400/50';
  if (status === 'fixing') return 'text-indigo-200 bg-indigo-500/20 border-indigo-300/40';
  if (status === 'queued') return 'text-orange-200 bg-orange-500/20 border-orange-300/40';

  return 'text-slate-300 bg-slate-600/20 border-slate-400/30';
}

function phaseLabel(phase: AgentPhase): string {
  if (phase === 'false_alarm') return 'False alarm';
  return `${phase.slice(0, 1).toUpperCase()}${phase.slice(1)}`;
}

function sectionCardClass(extra?: string): string {
  return cn(
    'rounded-xl border border-slate-700/80 bg-slate-900/85',
    extra,
  );
}

function AppNav({ theme, onToggleTheme }: { theme: ThemeMode; onToggleTheme: () => void }) {
  const navItems = [
    { to: '/sessions', label: 'Sessions', icon: Video },
    { to: '/issues', label: 'Issues', icon: AlertCircle },
    { to: '/agents', label: 'Agent Lab', icon: Bot },
    { to: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-slate-700/80 bg-slate-900/95">
      <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link to="/sessions" className="flex items-center gap-3">
          <img
            src={theme === 'dark' ? '/brand/logo-dark-icon.svg' : '/brand/logo-light-icon.svg'}
            alt=""
            className="h-9 w-9 rounded-lg sm:hidden"
          />
          <img
            src={theme === 'dark' ? '/brand/logo-dark.svg' : '/brand/logo-light.svg'}
            alt="Truffles - PostHog to PR"
            className="hidden h-9 w-auto sm:block"
          />
        </Link>

        <div className="flex items-center gap-2">
          <nav className="flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-900 p-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-2 text-sm transition',
                    isActive
                      ? 'bg-amber-500/20 text-amber-100'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white',
                  )
                }
              >
                <span className="flex items-center gap-1.5">
                  <item.icon size={14} />
                  <span>{item.label}</span>
                  {item.to === '/settings' ? <Lock size={12} /> : null}
                </span>
              </NavLink>
            ))}
          </nav>
          <button type="button" className="button-surface min-w-[86px]" onClick={onToggleTheme}>
            <span className="flex items-center justify-center gap-1.5">
              {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
              {theme === 'dark' ? 'Dark' : 'Light'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}

function SessionsPage() {
  const [activeTab, setActiveTab] = useState<'posthog' | 'processed'>('posthog');
  const { processingState } = useProcessingWebSocket();

  // PostHog tab state
  const [phSessions, setPhSessions] = useState<PostHogSessionSummary[]>([]);
  const [phLoading, setPhLoading] = useState(false);
  const [phError, setPhError] = useState<string | null>(null);
  const [phHasMore, setPhHasMore] = useState(false);
  const [phOffset, setPhOffset] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Processed tab state
  const [processedSessions, setProcessedSessions] = useState<SessionSummary[]>([]);
  const [processedLoading, setProcessedLoading] = useState(false);

  // Auth modal state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authPassword, setAuthPassword] = useState('');
  const [sessionsAuthError, setSessionsAuthError] = useState<string | null>(null);
  const [processNotice, setProcessNotice] = useState<string | null>(null);

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
    try {
      const result = await fetchProcessedSessions();
      setProcessedSessions(result);
    } catch {
      // silently fail for processed tab
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
        setSessionsAuthError(msg);
        setShowAuthModal(true);
      } else {
        setProcessNotice(`Error: ${msg}`);
        setTimeout(() => setProcessNotice(null), 4000);
      }
    }
  };

  return (
    <section className="animate-rise space-y-5">
      {processNotice && (
        <div className="rounded-xl border border-amber-400/45 bg-amber-500/15 px-4 py-2 text-sm text-amber-100">
          {processNotice}
        </div>
      )}

      <div className={sectionCardClass('p-4 sm:p-5')}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
              <Video size={18} className="text-amber-300" />
              Sessions
            </h2>
            <p className="text-sm text-slate-400">Browse PostHog recordings or view processed videos.</p>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === 'posthog' && selectedIds.size > 0 && (
              <button type="button" className="button-surface button-accent" onClick={handleProcess}>
                Process {selectedIds.size} Selected
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-1 rounded-lg border border-slate-700/80 bg-slate-900 p-1">
          <button
            type="button"
            className={cn(
              'rounded-lg px-4 py-2 text-sm transition',
              activeTab === 'posthog' ? 'bg-amber-500/20 text-amber-100' : 'text-slate-300 hover:bg-white/5',
            )}
            onClick={() => setActiveTab('posthog')}
          >
            PostHog Sessions
          </button>
          <button
            type="button"
            className={cn(
              'rounded-lg px-4 py-2 text-sm transition',
              activeTab === 'processed' ? 'bg-amber-500/20 text-amber-100' : 'text-slate-300 hover:bg-white/5',
            )}
            onClick={() => setActiveTab('processed')}
          >
            Processed
          </button>
        </div>
      </div>

      {activeTab === 'posthog' && (
        <>
          {phError && (
            <div className="rounded-xl border border-red-200/20 bg-red-500/10 px-4 py-2 text-sm text-red-200">
              {phError}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {phSessions.map((s) => {
              const ps = processingState[s.id];
              const isProcessing = ps?.status === 'processing';
              const isComplete = s.alreadyProcessed || ps?.status === 'complete';
              const isError = ps?.status === 'error';
              const isSelected = selectedIds.has(s.id);

              return (
                <div
                  key={s.id}
                  className={cn(
                    sectionCardClass('group flex flex-col overflow-hidden transition duration-200'),
                    isSelected && 'border-amber-400/60 ring-1 ring-amber-400/40',
                    isComplete && 'opacity-70',
                  )}
                >
                  <div className="flex items-start gap-3 border-b border-slate-700/70 bg-slate-900 p-4">
                    <label className="flex-shrink-0 pt-0.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isComplete || isProcessing}
                        onChange={() => toggleSelection(s.id)}
                        className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-amber-400"
                      />
                    </label>
                    <div className="min-w-0 flex-1">
                      <p className="mono truncate text-sm text-white">{s.distinctId || s.id}</p>
                      <p className="flex items-center gap-1.5 text-xs text-slate-400">
                        <Clock3 size={12} />
                        {formatDate(s.startTime)} • {formatDuration(s.durationSec)}
                      </p>
                    </div>
                    {isComplete && (
                      <span className="chip chip-amber flex items-center gap-1">
                        <CheckCircle size={11} /> Done
                      </span>
                    )}
                    {isError && (
                      <span className="chip chip-red flex items-center gap-1">
                        <AlertCircle size={11} /> Error
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>{s.eventCount} events</span>
                      <span>{formatDuration(s.activeSeconds)} active</span>
                    </div>

                    {isProcessing && ps && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1 text-amber-300">
                            <Loader2 size={11} className="animate-spin" />
                            {ps.phase ?? 'Processing'}
                          </span>
                          <span className="text-slate-400">{ps.percent ?? 0}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-amber-400 transition-all"
                            style={{ width: `${ps.percent ?? 0}%` }}
                          />
                        </div>
                        {ps.message && (
                          <p className="text-xs text-slate-500">{ps.message}</p>
                        )}
                      </div>
                    )}

                    {isError && ps?.error && (
                      <p className="text-xs text-red-300">{ps.error}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {phLoading && (
            <div className="flex justify-center py-8">
              <Loader2 size={24} className="animate-spin text-amber-300" />
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
              <Loader2 size={24} className="animate-spin text-amber-300" />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {processedSessions.map((s) => (
              <Link
                key={s.id}
                to={`/sessions/${s.posthogSessionId}`}
                className={sectionCardClass(
                  'group flex flex-col overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:border-amber-400/45',
                )}
              >
                <div className="relative border-b border-slate-700/70 bg-slate-900 p-4">
                  {s.thumbnailUrl ? (
                    <img
                      src={s.thumbnailUrl}
                      alt="Session thumbnail"
                      className="h-32 w-full rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-32 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-800/60">
                      <Video size={24} className="text-slate-500" />
                    </div>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div>
                    <p className="flex items-center gap-1.5 text-sm text-slate-300">
                      <User size={13} />
                      {s.userEmail || 'Unknown user'}
                    </p>
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-slate-400">
                    <Clock3 size={12} />
                    {formatDate(s.startTime)} • {formatDuration(s.durationSec)}
                  </p>
                  <div className="mt-auto flex items-center gap-2 text-xs">
                    <span className={cn(
                      'rounded-md border px-2 py-1 uppercase',
                      s.status === 'complete'
                        ? 'border-severity-green/50 bg-severity-green/15 text-severity-green'
                        : s.status === 'error'
                          ? 'border-severity-red/50 bg-severity-red/15 text-severity-red'
                          : 'border-slate-400/30 bg-slate-600/20 text-slate-300',
                    )}>
                      {s.status}
                    </span>
                    {s.issueCount > 0 && (
                      <span className="chip chip-amber">{s.issueCount} issues</span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {!processedLoading && processedSessions.length === 0 && (
            <div className={sectionCardClass('p-8 text-center')}>
              <p className="text-sm text-slate-400">No processed sessions yet. Switch to PostHog Sessions to select and process recordings.</p>
            </div>
          )}
        </>
      )}

      {/* Auth modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className={sectionCardClass('w-full max-w-md p-6')}>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
              <Lock size={16} />
              Admin Authentication
            </h3>
            <p className="mt-1 text-sm text-slate-400">Enter the admin password to process sessions.</p>

            <label className="mt-4 block space-y-1 text-xs uppercase tracking-[0.14em] text-slate-400">
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

            {sessionsAuthError && <p className="mt-2 text-sm text-severity-red">{sessionsAuthError}</p>}

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
  issuesAtTime: IssueRecord[];
  currentTime: number;
  onJump: (issue: IssueRecord) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <p>Issue markers</p>
        <p className="mono text-slate-300">
          {formatClock(currentTime)} / {formatClock(durationSec)}
        </p>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-amber-400/80" style={{ width: `${(currentTime / durationSec) * 100}%` }} />
        {issuesAtTime.map((issue) => (
          <button
            key={issue.id}
            type="button"
            aria-label={`Jump to ${issue.title}`}
            className={cn(
              'absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 transition hover:scale-110',
              issue.severity === 'red'
                ? 'border-red-100 bg-severity-red'
                : 'border-yellow-100 bg-severity-yellow',
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
  const videoRef = useRef<HTMLVideoElement>(null);

  // Fetch session detail from API
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Also look up mock session for issues overlay (mock data still used for issues)
  const mockSession = sessions.find((entry) => entry.id === params.id);

  const sessionIssues = useMemo(
    () => issues.filter((issue) => issue.sessionId === mockSession?.id).sort((a, b) => a.timestampSec - b.timestampSec),
    [mockSession?.id],
  );

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [highlightedIssue, setHighlightedIssue] = useState<string | null>(null);
  const [rawQuery, setRawQuery] = useState('');

  // Speed options: label → playbackRate
  // rrvideo renders at 2x, so playbackRate 0.5 = 1x original speed
  const speedOptions = [
    { label: '1x', rate: 0.5 },
    { label: '2x', rate: 1.0 },
    { label: '5x', rate: 2.5 },
    { label: '8x', rate: 4.0 },
  ];
  const [activeSpeed, setActiveSpeed] = useState(0); // index into speedOptions

  useEffect(() => {
    if (!params.id) return;
    setDetailLoading(true);
    setDetailError(null);
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
    setCurrentTime(0);
    setIsPlaying(false);
  }, [params.id]);

  // Sync video timeupdate with timeline
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const handleTimeUpdate = () => {
      // Map video time to session time: sessionTime = videoTime * 2
      const sessionTime = video.currentTime * 2;
      setCurrentTime(sessionTime);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [sessionDetail?.videoUrl]);

  // Apply playback rate when speed changes
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speedOptions[activeSpeed].rate;
    }
  }, [activeSpeed]);

  const durationSec = sessionDetail?.durationSec ?? mockSession?.durationSec ?? 240;
  const displaySession = sessionDetail ?? mockSession;

  if (detailLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={24} className="animate-spin text-amber-300" />
      </div>
    );
  }

  if (!displaySession && detailError) {
    return <MissingState title="Session not found" backPath="/sessions" backLabel="Back to Sessions" />;
  }

  if (!displaySession) {
    return <MissingState title="Session not found" backPath="/sessions" backLabel="Back to Sessions" />;
  }

  const jumpToIssue = (issue: IssueRecord) => {
    // Map session time to video time: videoTime = sessionTime / 2
    if (videoRef.current) {
      videoRef.current.currentTime = issue.timestampSec / 2;
    }
    setCurrentTime(issue.timestampSec);
    setHighlightedIssue(issue.id);
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
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + delta / 2);
    }
    setCurrentTime((prev) => Math.max(0, Math.min(durationSec, prev + delta)));
  };

  const userEmail = 'userEmail' in displaySession
    ? (displaySession as SessionDetail).userEmail
    : (displaySession as typeof mockSession)?.userEmail ?? '';
  const startTime = 'startTime' in displaySession
    ? (displaySession as SessionDetail).startTime
    : (displaySession as typeof mockSession)?.startedAt ?? '';
  const sessionId = 'posthogSessionId' in displaySession
    ? (displaySession as SessionDetail).posthogSessionId
    : (displaySession as typeof mockSession)?.id ?? '';

  const rawPayload = JSON.stringify(
    {
      sessionId,
      consoleErrors: sessionDetail?.consoleErrors ?? ['TypeError: Cannot read property map of undefined'],
      networkFailures: sessionDetail?.networkFailures ?? ['POST /api/campaigns 500', 'GET /api/segments timeout'],
      metadata: sessionDetail?.metadata ?? {
        userEmail,
        browser: 'Chrome 122',
        viewport: '1366x768',
      },
    },
    null,
    2,
  );

  const rawLines = rawPayload
    .split('\n')
    .filter((line) => line.toLowerCase().includes(rawQuery.trim().toLowerCase()) || !rawQuery.trim());

  return (
    <section className="animate-rise grid gap-4 xl:grid-cols-[1fr_370px]">
      <div className={sectionCardClass('p-5')}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Session Detail</p>
            <h2 className="text-xl font-semibold text-white">{userEmail || sessionId}</h2>
            <p className="text-sm text-slate-400">
              {startTime ? formatDate(startTime) : ''} • {sessionId}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" className="button-surface" onClick={() => handleSeek(-5)}>
              <span className="flex items-center gap-1.5">
                <Clock3 size={13} />
                -5s
              </span>
            </button>
            <button type="button" className="button-surface button-accent" onClick={handlePlayPause}>
              <span className="flex items-center gap-1.5">
                {isPlaying ? <Pause size={13} /> : <Play size={13} />}
                {isPlaying ? 'Pause' : 'Play'}
              </span>
            </button>
            <button type="button" className="button-surface" onClick={() => handleSeek(5)}>
              <span className="flex items-center gap-1.5">
                <Clock3 size={13} />
                +5s
              </span>
            </button>

            {/* Speed selector */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-900 p-0.5">
              {speedOptions.map((opt, idx) => (
                <button
                  key={opt.label}
                  type="button"
                  className={cn(
                    'rounded-md px-2 py-1 text-xs transition',
                    idx === activeSpeed
                      ? 'bg-amber-500/20 text-amber-100'
                      : 'text-slate-400 hover:text-white',
                  )}
                  onClick={() => setActiveSpeed(idx)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-slate-700/80 bg-slate-900 p-5">
          <div className="relative h-[360px] overflow-hidden rounded-lg border border-slate-700/70 bg-slate-950">
            {sessionDetail?.videoUrl ? (
              <video
                ref={videoRef}
                src={sessionDetail.videoUrl}
                className="h-full w-full object-contain"
              />
            ) : sessionDetail?.status === 'rendering' ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <Loader2 size={32} className="mx-auto animate-spin text-amber-300" />
                  <p className="mt-2 text-sm text-slate-400">Video is being rendered...</p>
                </div>
              </div>
            ) : sessionDetail?.status === 'error' ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <AlertCircle size={32} className="mx-auto text-red-400" />
                  <p className="mt-2 text-sm text-red-300">{sessionDetail.errorMessage ?? 'Rendering failed'}</p>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <Video size={32} className="mx-auto text-slate-500" />
                  <p className="mt-2 text-sm text-slate-400">No video available</p>
                </div>
              </div>
            )}
            <div className="absolute bottom-6 left-6 right-6 rounded-xl border border-white/10 bg-slate-900/85 p-3">
              <SessionTimeline
                durationSec={durationSec}
                issuesAtTime={sessionIssues}
                currentTime={currentTime}
                onJump={jumpToIssue}
              />
            </div>
          </div>
        </div>
      </div>

      <aside className={sectionCardClass('p-4')}>
        <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
          <AlertCircle size={17} className="text-amber-300" />
          Issues ({sessionIssues.length})
        </h3>
        <div className="mt-3 space-y-2">
          {sessionIssues.map((issue) => (
            <button
              key={issue.id}
              type="button"
              onClick={() => jumpToIssue(issue)}
              className={cn(
                'w-full rounded-xl border border-white/10 bg-slate-900/70 p-3 text-left transition hover:border-amber-400/35',
                highlightedIssue === issue.id && 'ring-1 ring-amber-400/55',
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className={cn('rounded-md border px-2 py-1 text-[11px] uppercase tracking-[0.12em]', severityTone(issue.severity))}>
                  {issue.severity}
                </span>
                <span className="mono text-xs text-slate-300">{formatClock(issue.timestampSec)}</span>
              </div>

              <p className="text-sm font-medium text-white">{issue.title}</p>
              <p className="mt-1 text-xs text-slate-400">{issue.description}</p>

              <div className="mt-2 flex items-center justify-between gap-2">
                <span className={cn('rounded-md border px-2 py-1 text-[11px] uppercase tracking-[0.12em]', statusTone(issue.status))}>
                  {statusLabels[issue.status]}
                </span>
                {issue.prNumber ? (
                  <Link
                    to={`/prs/${issue.prNumber}`}
                    className="inline-flex items-center gap-1 text-xs text-amber-300 underline-offset-2 hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    PR #{issue.prNumber} <ExternalLink size={11} />
                  </Link>
                ) : null}
              </div>
            </button>
          ))}
        </div>

        <details className="mt-4 rounded-xl border border-white/10 bg-slate-900/70 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-100">
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
            <pre className="mono max-h-56 overflow-auto rounded-lg border border-white/10 bg-slate-950/70 p-3 text-[11px] text-slate-300">
              {rawLines.join('\n')}
            </pre>
          </div>
        </details>
      </aside>
    </section>
  );
}

function IssuesPage() {
  const navigate = useNavigate();
  const [severityFilter, setSeverityFilter] = useState<'all' | Severity>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | IssueStatus>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return issues
      .filter((issue) => {
        if (severityFilter !== 'all' && issue.severity !== severityFilter) return false;
        if (statusFilter !== 'all' && issue.status !== statusFilter) return false;
        if (!query) return true;

        const session = sessions.find((entry) => entry.id === issue.sessionId);

        return (
          issue.title.toLowerCase().includes(query) ||
          issue.description.toLowerCase().includes(query) ||
          issue.id.toLowerCase().includes(query) ||
          (session?.userEmail.toLowerCase().includes(query) ?? false)
        );
      })
      .sort((a, b) => {
        const severityDelta = severityOrder[a.severity] - severityOrder[b.severity];
        if (severityDelta !== 0) return severityDelta;
        return new Date(b.foundAt).getTime() - new Date(a.foundAt).getTime();
      });
  }, [search, severityFilter, statusFilter]);

  return (
    <section className="animate-rise space-y-4">
      <div className={sectionCardClass('p-4 sm:p-5')}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold text-white">
              <AlertCircle size={18} className="text-amber-300" />
              Issues
            </h2>
            <p className="text-sm text-slate-400">Sorted by severity then recency, with direct links to sessions and PRs.</p>
          </div>
          <span className="chip chip-grey">{filtered.length} entries</span>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-slate-400">
            <span className="flex items-center gap-1.5">
              <Filter size={13} />
              Severity
            </span>
            <select
              className="input-surface"
              value={severityFilter}
              onChange={(event) => setSeverityFilter(event.target.value as 'all' | Severity)}
            >
              <option value="all">All</option>
              <option value="red">Red</option>
              <option value="yellow">Yellow</option>
            </select>
          </label>

          <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-slate-400">
            <span className="flex items-center gap-1.5">
              <SlidersHorizontal size={13} />
              Status
            </span>
            <select
              className="input-surface"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | IssueStatus)}
            >
              <option value="all">All</option>
              <option value="analyzing">Analyzing...</option>
              <option value="screening">Screening...</option>
              <option value="queued">Queued</option>
              <option value="fixing">Fixing...</option>
              <option value="pr_open">PR Open</option>
              <option value="merged">Merged</option>
              <option value="false_alarm">False alarm</option>
            </select>
          </label>

          <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-slate-400">
            <span className="flex items-center gap-1.5">
              <Search size={13} />
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

      <div className={sectionCardClass('overflow-hidden')}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="border-b border-white/10 bg-white/5 text-xs uppercase tracking-[0.14em] text-slate-400">
              <tr>
                <th className="px-4 py-3">Sev.</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Session</th>
                <th className="px-4 py-3">PR</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Found</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((issue) => {
                const session = sessions.find((entry) => entry.id === issue.sessionId);

                return (
                  <tr
                    key={issue.id}
                    className="cursor-pointer border-b border-white/5 hover:bg-white/5"
                    onClick={() => navigate(`/issues/${issue.id}`)}
                  >
                    <td className="px-4 py-3">
                      <span className={cn('rounded-md border px-2 py-1 text-xs uppercase', severityTone(issue.severity))}>
                        {issue.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-100">{issue.title}</p>
                      <p className="text-xs text-slate-400">{issue.description}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      <p className="mono text-xs">{session?.userEmail ?? 'Unknown'}</p>
                      <p className="mono text-xs text-slate-500">{formatClock(issue.timestampSec)}</p>
                    </td>
                    <td className="px-4 py-3">
                      {issue.prNumber ? (
                        <Link
                          to={`/prs/${issue.prNumber}`}
                          className="inline-flex items-center gap-1 text-amber-300 underline-offset-2 hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          #{issue.prNumber} <ExternalLink size={11} />
                        </Link>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('rounded-md border px-2 py-1 text-xs uppercase', statusTone(issue.status))}>
                        {statusLabels[issue.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{formatRelative(issue.foundAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function IssueDetailPage() {
  const params = useParams();
  const issue = issues.find((entry) => entry.id === params.id);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    setCurrentTime(issue?.timestampSec ?? 0);
  }, [issue?.id, issue?.timestampSec]);

  if (!issue) {
    return <MissingState title="Issue not found" backPath="/issues" backLabel="Back to Issues" />;
  }

  const session = sessions.find((entry) => entry.id === issue.sessionId);
  const relatedIssues = issues.filter((entry) => entry.sessionId === issue.sessionId);
  const relatedPr = pullRequests.find((entry) => entry.issueId === issue.id);

  return (
    <section className="animate-rise grid gap-4 xl:grid-cols-[1fr_390px]">
      <div className={sectionCardClass('p-5')}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Issue Detail</p>
            <h2 className="flex items-center gap-2 text-xl font-semibold text-white">
              <AlertCircle size={18} className="text-amber-300" />
              {issue.title}
            </h2>
            <p className="text-sm text-slate-400">{session?.userEmail} • {formatDate(issue.foundAt)}</p>
          </div>
          <span className={cn('rounded-md border px-2 py-1 text-xs uppercase', severityTone(issue.severity))}>{issue.severity}</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
          <p className="text-sm text-slate-300">{issue.description}</p>
          <div className="mt-3">
            <SessionTimeline
              durationSec={session?.durationSec ?? 240}
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
              onClick={() => setCurrentTime(Math.min(session?.durationSec ?? 240, currentTime + 5))}
            >
              +5s
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-300">LLM Analysis Reasoning</h3>
            <p className="mt-2 text-sm text-slate-300">{issue.llmReasoning}</p>
          </div>

          <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-300">Screening Assessment</h3>
            <p className="mt-2 text-sm text-slate-300">{issue.screeningReasoning}</p>
          </div>
        </div>

        {relatedPr ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/70 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-300">Inline Diff Preview</h3>
              <Link to={`/prs/${relatedPr.id}`} className="inline-flex items-center gap-1 text-xs text-amber-300 underline-offset-2 hover:underline">
                Open PR Review <ExternalLink size={11} />
              </Link>
            </div>
            <pre className="mono overflow-auto rounded-lg border border-white/10 bg-slate-950/70 p-3 text-[11px] text-slate-300">
              {relatedPr.diff}
            </pre>
          </div>
        ) : null}
      </div>

      <aside className={sectionCardClass('p-4')}>
        <h3 className="text-lg font-semibold text-white">Issue Snapshot</h3>
        <div className="mt-3 space-y-2 text-sm text-slate-300">
          <div className="rounded-lg border border-white/10 bg-slate-900/70 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Session</p>
            <Link to={`/sessions/${issue.sessionId}`} className="mono inline-flex items-center gap-1 text-amber-300 hover:underline">
              <Video size={12} />
              {issue.sessionId}
            </Link>
          </div>

          <div className="rounded-lg border border-white/10 bg-slate-900/70 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Status</p>
            <span className={cn('mt-1 inline-block rounded-md border px-2 py-1 text-xs uppercase', statusTone(issue.status))}>
              {statusLabels[issue.status]}
            </span>
          </div>

          {issue.prNumber ? (
            <div className="rounded-lg border border-white/10 bg-slate-900/70 p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">PR</p>
              <Link to={`/prs/${issue.prNumber}`} className="inline-flex items-center gap-1 text-amber-300 hover:underline">
                <GitPullRequest size={12} /> #{issue.prNumber}
              </Link>
            </div>
          ) : null}

          {issue.falseAlarmReason ? (
            <div className="rounded-lg border border-white/10 bg-slate-900/70 p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">False Alarm Reason</p>
              <p className="mt-1 text-sm text-slate-300">{issue.falseAlarmReason}</p>
            </div>
          ) : null}
        </div>
      </aside>
    </section>
  );
}

function AgentsPage() {
  const active = agentSessions;
  const maxAgents = 5;
  const pendingQueue = 2;

  const completedToday = issues.filter((issue) => issue.status === 'merged').length + 10;
  const falseAlarmsToday = issues.filter((issue) => issue.status === 'false_alarm').length + 2;
  const prsOpenedToday = issues.filter((issue) => issue.status === 'pr_open' || issue.status === 'merged').length + 6;

  return (
    <section className="animate-rise space-y-4">
      <div className={sectionCardClass('p-5')}>
        <div className="mb-4">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-white">
            <Bot size={18} className="text-amber-300" />
            Agent Lab
          </h2>
          <p className="text-sm text-slate-400">Live status for active coding agents and queue throughput.</p>
        </div>
        <div className="mb-4 grid gap-3 lg:grid-cols-3">
          <Metric title="Active Agents" value={`${active.length} / ${maxAgents} max`} icon={Bot} />
          <Metric title="Queue" value={`${pendingQueue} pending`} icon={Clock3} />
          <Metric title="Current Throughput" value="1.8 issues / min" icon={Activity} />
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          {active.map((agent) => {
            const issue = issues.find((entry) => entry.id === agent.issueId);

            return (
              <Link key={agent.id} to={`/agents/${agent.id}`} className="rounded-xl border border-white/10 bg-slate-900/70 p-4 hover:border-amber-400/35">
                <p className="mono text-xs uppercase tracking-[0.16em] text-slate-400">Agent #{agent.id}</p>
                <h3 className="mt-2 text-sm font-semibold text-white">{issue?.title ?? 'Unknown issue'}</h3>
                <p className="mt-1 text-xs text-slate-400">Phase: {phaseLabel(agent.status)}</p>
                <p className="text-xs text-slate-400">Runtime: {formatDuration(agent.runtimeSec)}</p>

                <div className="mt-3 h-2 rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-amber-400"
                    style={{ width: `${agent.progress}%` }}
                  />
                </div>
                <p className="mt-2 inline-flex items-center gap-1 text-xs uppercase tracking-[0.14em] text-amber-300">
                  <Activity size={11} />
                  View live output
                </p>
              </Link>
            );
          })}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Metric title="Completed Today" value={`${completedToday}`} icon={Wrench} />
          <Metric title="False Alarms" value={`${falseAlarmsToday}`} icon={CircleSlash} />
          <Metric title="PRs Opened" value={`${prsOpenedToday}`} icon={GitPullRequest} />
        </div>
      </div>
    </section>
  );
}

function AgentDetailPage() {
  const params = useParams();
  const agent = agentSessions.find((entry) => entry.id === params.id);
  const [displayLines, setDisplayLines] = useState<string[]>([]);
  const [lineIndex, setLineIndex] = useState(0);

  useEffect(() => {
    if (!agent) return;
    const seed = agent.outputSeed;
    setDisplayLines(seed.length > 0 ? [seed[0]] : []);
    setLineIndex(seed.length > 0 ? 1 : 0);
  }, [agent?.id]);

  useEffect(() => {
    if (!agent) return undefined;
    if (lineIndex >= agent.outputSeed.length) return undefined;

    const timer = window.setTimeout(() => {
      setDisplayLines((prev) => [...prev, agent.outputSeed[lineIndex]]);
      setLineIndex((prev) => prev + 1);
    }, 900);

    return () => window.clearTimeout(timer);
  }, [agent, lineIndex]);

  if (!agent) {
    return <MissingState title="Agent not found" backPath="/agents" backLabel="Back to Agent Lab" />;
  }

  const issue = issues.find((entry) => entry.id === agent.issueId);
  const session = sessions.find((entry) => entry.id === issue?.sessionId);
  const phaseIndex = agentPhaseOrder.indexOf(agent.status === 'false_alarm' ? 'reviewing' : agent.status);

  return (
    <section className="animate-rise space-y-4">
      <div className={sectionCardClass('p-5')}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold text-white">
              <Bot size={18} className="text-amber-300" />
              Agent #{agent.id}
            </h2>
            <p className="text-sm text-slate-400">
              Status: {phaseLabel(agent.status)} • Runtime: {formatDuration(agent.runtimeSec)}
            </p>
            <p className="text-xs text-slate-500">
              Issue:{' '}
              <Link to={`/issues/${issue?.id ?? ''}`} className="inline-flex items-center gap-1 text-amber-300 hover:underline">
                <AlertCircle size={11} />
                {issue?.id}
              </Link>{' '}
              • Session:{' '}
              <Link to={`/sessions/${session?.id ?? ''}`} className="inline-flex items-center gap-1 text-amber-300 hover:underline">
                <Video size={11} />
                {session?.id}
              </Link>
            </p>
          </div>
          <span className="chip chip-amber">{agent.progress}% complete</span>
        </div>

        <div className="mb-4 rounded-xl border border-white/10 bg-slate-900/70 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-300">Phase Timeline</h3>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {agentPhaseOrder.map((phase, index) => {
              const complete = index < phaseIndex;
              const current = index === phaseIndex;

              return (
                <div
                  key={phase}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs uppercase tracking-[0.14em]',
                    complete && 'border-severity-green/50 bg-severity-green/20 text-severity-green',
                    current && 'border-amber-400/50 bg-amber-500/20 text-amber-200',
                    !complete && !current && 'border-white/15 bg-white/5 text-slate-400',
                  )}
                >
                  {phaseLabel(phase)}
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-950/85 p-4">
          <h3 className="mono text-xs uppercase tracking-[0.16em] text-slate-400">Live Output (stub stream)</h3>
          <pre className="mono mt-3 h-64 overflow-auto rounded-lg border border-white/10 bg-[#02060f] p-3 text-[12px] text-emerald-300">
            {displayLines.join('\n')}
            <span className="animate-pulse text-white">▋</span>
          </pre>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/70 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-300">Files Modified</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {agent.filesModified.length > 0 ? (
              agent.filesModified.map((file) => (
                <span key={file} className="chip chip-grey mono">
                  {file}
                </span>
              ))
            ) : (
              <p className="text-sm text-slate-400">No file edits yet.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function PRReviewPage() {
  const params = useParams();
  const prNumber = Number(params.id);
  const pr = pullRequests.find((entry) => entry.id === prNumber);

  if (!pr) {
    return <MissingState title="PR not found" backPath="/issues" backLabel="Back to Issues" />;
  }

  const issue = issues.find((entry) => entry.id === pr.issueId);
  const session = sessions.find((entry) => entry.id === issue?.sessionId);

  return (
    <section className="animate-rise">
      <div className={sectionCardClass('p-5')}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">PR Review</p>
            <h2 className="flex items-center gap-2 text-xl font-semibold text-white">
              <GitPullRequest size={18} className="text-amber-300" />
              <span>
                PR #{pr.id}: {pr.title}
              </span>
            </h2>
            <p className="text-sm text-slate-400">
              Branch: <span className="mono">{pr.branch}</span>
            </p>
          </div>
          <a
            className="button-surface button-accent"
            href={`https://github.com/plaibook-dev/ai-outbound-agent/pull/${pr.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <span className="inline-flex items-center gap-1.5">
              View on GitHub
              <ExternalLink size={13} />
            </span>
          </a>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Metric title="Status" value={pr.status === 'open' ? 'Open' : 'Merged'} />
          <Metric title="Lines" value={`+${pr.additions} / -${pr.deletions}`} />
          <Metric title="Files" value={`${pr.filesChanged}`} />
          <Metric title="Linked Issue" value={issue?.id ?? '-'} />
        </div>

        <div className="mb-4 rounded-xl border border-white/10 bg-slate-900/70 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-300">Issue Context</h3>
          <p className="mt-2 text-sm text-slate-300">{issue?.description}</p>
          <p className="mt-1 text-xs text-slate-500">
            Session: {session?.userEmail} • {issue ? formatClock(issue.timestampSec) : '-'}
          </p>
          <div className="mt-2 flex gap-2">
            {issue ? (
              <Link to={`/issues/${issue.id}`} className="button-surface">
                <span className="inline-flex items-center gap-1.5">
                  <AlertCircle size={13} />
                  Open issue detail
                </span>
              </Link>
            ) : null}
            {session ? (
              <Link to={`/sessions/${session.id}`} className="button-surface">
                <span className="inline-flex items-center gap-1.5">
                  <Video size={13} />
                  Watch moment
                </span>
              </Link>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-300">Diff</h3>
          <pre className="mono mt-2 overflow-auto rounded-lg border border-white/10 bg-slate-950/70 p-3 text-[11px] text-slate-300">
            {pr.diff}
          </pre>
        </div>

        <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
          <p className="text-sm text-amber-100">Agent reasoning: "{pr.agentReasoning}"</p>
          <p className="mt-2 text-xs uppercase tracking-[0.12em] text-amber-200">
            Approve and merge on GitHub.
          </p>
        </div>
      </div>
    </section>
  );
}

function SettingsPage() {
  const [authorized, setAuthorized] = useState<boolean>(() => sessionStorage.getItem('truffles-admin-auth') === 'ok');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const [maxAgents, setMaxAgents] = useState(5);
  const [timeoutMinutes, setTimeoutMinutes] = useState(15);
  const [pollingInterval, setPollingInterval] = useState(60);
  const [rules, setRules] = useState<SuppressionRule[]>(suppressionRules);
  const [manualRule, setManualRule] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2500);
  };

  const handleUnlock = () => {
    if (password === adminStubPassword) {
      setAuthorized(true);
      setAuthError(null);
      sessionStorage.setItem('truffles-admin-auth', 'ok');
      sessionStorage.setItem('truffles-admin-password', password);
      showNotice('Settings unlocked (stub auth).');
    } else {
      setAuthError('Invalid password for this demo build. Try: truffles-demo');
    }
  };

  if (!authorized) {
    return (
      <section className="animate-rise mx-auto max-w-xl">
        <div className={sectionCardClass('p-6')}>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-white">
            <Lock size={18} className="text-amber-300" />
            Settings Access
          </h2>
          <p className="mt-1 text-sm text-slate-400">Settings is auth-gated. This build uses a local stubbed password check.</p>

          <label className="mt-4 block space-y-1 text-xs uppercase tracking-[0.14em] text-slate-400">
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

          {authError ? <p className="mt-2 text-sm text-severity-red">{authError}</p> : null}

          <button type="button" className="button-surface button-accent mt-4" onClick={handleUnlock}>
            <span className="inline-flex items-center gap-1.5">
              <Lock size={13} />
              Unlock Settings
            </span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="animate-rise space-y-4">
      {notice ? (
        <div className="rounded-xl border border-amber-400/45 bg-amber-500/15 px-4 py-2 text-sm text-amber-100">{notice}</div>
      ) : null}

      <div className={sectionCardClass('p-5')}>
        <h2 className="flex items-center gap-2 text-xl font-semibold text-white">
          <Settings size={18} className="text-amber-300" />
          Settings
        </h2>
        <p className="text-sm text-slate-400">All controls are stubbed for UI prototyping and are not connected to backend APIs yet.</p>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <SettingsBlock title="PostHog Connection" icon={Activity}>
            <SettingRow label="Project ID" value="12345" />
            <SettingRow label="API Key" value="••••••••••••x9d2" />
            <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-slate-400">
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
            <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-slate-400">
              Video model (primary)
              <select className="input-surface" defaultValue="moonshotai/kimi-k2.5">
                <option>moonshotai/kimi-k2.5</option>
                <option>google/gemini-3-pro-preview</option>
              </select>
            </label>
            <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-slate-400">
              Screening model
              <select className="input-surface" defaultValue="anthropic/claude-opus-4.6">
                <option>anthropic/claude-opus-4.6</option>
                <option>google/gemini-3-pro-preview</option>
              </select>
            </label>
          </SettingsBlock>

          <SettingsBlock title="GitHub" icon={GitPullRequest}>
            <SettingRow label="Target repo" value="plaibook-dev/ai-outbound-agent" />
            <SettingRow label="Base branch" value="main" />
            <SettingRow label="PR label" value="truffles-autofix" />
          </SettingsBlock>

          <SettingsBlock title="Claude Code Agents" icon={Wrench}>
            <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-slate-400">
              Max concurrent agents: {maxAgents}
              <input
                type="range"
                min={1}
                max={10}
                value={maxAgents}
                className="w-full"
                onChange={(event) => setMaxAgents(Number(event.target.value))}
              />
            </label>

            <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-slate-400">
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

        <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-300">False Alarms / Suppression Rules</h3>
            <button
              type="button"
              className="button-surface"
              onClick={() => {
                if (!manualRule.trim()) return;
                setRules((prev) => [
                  {
                    id: `sup-${Date.now()}`,
                    pattern: manualRule.trim(),
                    source: 'manual',
                    dateAdded: new Date(referenceNow).toISOString(),
                  },
                  ...prev,
                ]);
                setManualRule('');
                showNotice('Manual suppression added (stub).');
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

          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b border-white/10 text-xs uppercase tracking-[0.14em] text-slate-500">
                <tr>
                  <th className="px-2 py-2">Pattern</th>
                  <th className="px-2 py-2">Source</th>
                  <th className="px-2 py-2">Date Added</th>
                  <th className="px-2 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} className="border-b border-white/5">
                    <td className="px-2 py-2 text-slate-300">{rule.pattern}</td>
                    <td className="px-2 py-2">
                      <span className="chip chip-grey">{rule.source}</span>
                    </td>
                    <td className="px-2 py-2 text-slate-400">{formatDate(rule.dateAdded)}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        className="text-xs text-severity-red hover:underline"
                        onClick={() => {
                          setRules((prev) => prev.filter((entry) => entry.id !== rule.id));
                          showNotice('Suppression removed (stub).');
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

        <div className="mt-4 rounded-xl border border-red-200/20 bg-red-500/10 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-red-200">Danger Zone</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="button-surface" onClick={() => showNotice('Clear all data queued (stub).')}>
              <span className="inline-flex items-center gap-1.5">
                <ShieldAlert size={13} />
                Clear all data
              </span>
            </button>
            <button type="button" className="button-surface" onClick={() => showNotice('False alarms reset queued (stub).')}>
              <span className="inline-flex items-center gap-1.5">
                <CircleSlash size={13} />
                Reset false alarms
              </span>
            </button>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button type="button" className="button-surface button-accent" onClick={() => showNotice('Settings saved (stub).')}>
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

function Metric({ title, value, icon: Icon }: { title: string; value: string; icon?: LucideIcon }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/65 p-3">
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-[0.14em] text-slate-500">
        {Icon ? <Icon size={12} /> : null}
        {title}
      </p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function SettingsBlock({ title, children, icon: Icon }: { title: string; children: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-[0.14em] text-slate-300">
        {Icon ? <Icon size={14} className="text-amber-300" /> : null}
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="mono text-slate-200">{value}</span>
    </div>
  );
}

function MissingState({ title, backPath, backLabel }: { title: string; backPath: string; backLabel: string }) {
  return (
    <section className="animate-rise mx-auto max-w-lg">
      <div className={sectionCardClass('p-6 text-center')}>
        <h2 className="text-xl font-semibold text-white">{title}</h2>
        <Link to={backPath} className="button-surface button-accent mt-4 inline-flex">
          {backLabel}
        </Link>
      </div>
    </section>
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
      <div className="pointer-events-none fixed inset-0 -z-10 bg-slate-950" />

      <AppNav theme={theme} onToggleTheme={handleToggleTheme} />

      <main className="mx-auto w-full max-w-[1440px] px-4 pb-10 pt-6 sm:px-6 lg:px-8">
        <Routes>
          <Route path="/" element={<Navigate to="/sessions" replace />} />
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
    </div>
  );
}
