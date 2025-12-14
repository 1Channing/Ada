import { useState } from 'react';
import { useStudyRunsStore, type StudyRunStatus } from '../store/studyRunsStore';
import { Activity, ChevronDown, ChevronUp, X, CheckCircle, XCircle, Clock, Loader, AlertTriangle } from 'lucide-react';

export function StudyRunsPanel() {
  const { runs, logs, clearRun, clearAllCompleted } = useStudyRunsStore();
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const allRuns = Object.values(runs);
  const activeRuns = allRuns.filter(
    (r) => r.stage !== 'done' && r.stage !== 'error' && r.stage !== 'cancelled',
  );
  const completedRuns = allRuns.filter((r) => r.stage === 'done');
  const erroredRuns = allRuns.filter((r) => r.stage === 'error' || r.stage === 'cancelled');

  if (allRuns.length === 0) return null;

  const getStageIcon = (stage: string) => {
    if (stage === 'done') return <CheckCircle size={16} className="text-green-400" />;
    if (stage === 'error' || stage === 'cancelled') return <XCircle size={16} className="text-red-400" />;
    return <Loader size={16} className="text-blue-400 animate-spin" />;
  };

  const getStageColor = (stage: string) => {
    if (stage === 'done') return 'text-green-400';
    if (stage === 'error' || stage === 'cancelled') return 'text-red-400';
    return 'text-blue-400';
  };

  const formatDuration = (startedAt: number, finishedAt?: number) => {
    const end = finishedAt || Date.now();
    const duration = Math.floor((end - startedAt) / 1000);
    if (duration < 60) return `${duration}s`;
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes}m ${seconds}s`;
  };

  const getStatusBadge = (status?: StudyRunStatus) => {
    if (!status) return null;

    const badges: Record<StudyRunStatus, { label: string; className: string }> = {
      SUCCESS: { label: 'Success', className: 'bg-green-500/20 text-green-400 border-green-500/30' },
      NO_TARGET_RESULTS: { label: 'No Results', className: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' },
      NO_SOURCE_RESULTS: { label: 'No Results', className: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' },
      TARGET_BLOCKED: { label: 'Blocked', className: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
      SOURCE_BLOCKED: { label: 'Blocked', className: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
      SCRAPER_ERROR: { label: 'Error', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
      UNKNOWN_ERROR: { label: 'Error', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
    };

    const badge = badges[status];
    return (
      <span className={`px-1.5 py-0.5 text-xs rounded border ${badge.className}`}>
        {badge.label}
      </span>
    );
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 max-w-[calc(100vw-2rem)]">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between bg-zinc-800 hover:bg-zinc-750 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Activity size={20} className="text-blue-400" />
            <div className="text-left">
              <div className="text-sm font-semibold text-zinc-100">
                Study Runs
              </div>
              <div className="text-xs text-zinc-400">
                {activeRuns.length > 0 ? (
                  <span className="text-blue-400">{activeRuns.length} running</span>
                ) : (
                  <span className="text-green-400">All completed</span>
                )}
                {completedRuns.length > 0 && ` • ${completedRuns.length} done`}
                {erroredRuns.length > 0 && ` • ${erroredRuns.length} failed`}
              </div>
            </div>
          </div>
          {isExpanded ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
        </button>

        {isExpanded && (
          <div className="max-h-96 overflow-y-auto">
            {allRuns.length === 0 ? (
              <div className="p-4 text-center text-zinc-400 text-sm">
                No study runs
              </div>
            ) : (
              <>
                <div className="divide-y divide-zinc-800">
                  {allRuns.map((run) => {
                    const runLogs = logs[run.id] || [];
                    const lastLog = runLogs[runLogs.length - 1];
                    const isSelected = selectedRunId === run.id;

                    return (
                      <div key={run.id} className="bg-zinc-900">
                        <div
                          onClick={() => setSelectedRunId(isSelected ? null : run.id)}
                          className="px-4 py-3 hover:bg-zinc-800/50 cursor-pointer transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-2 flex-1 min-w-0">
                              {getStageIcon(run.stage)}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <div className="text-sm font-medium text-zinc-100 truncate">
                                    {run.studyCode}
                                  </div>
                                  {run.hasErrors && (
                                    <AlertTriangle size={14} className="text-red-400 flex-shrink-0" title="Contains errors" />
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <div className={`text-xs ${getStageColor(run.stage)}`}>
                                    {lastLog?.label || run.stage}
                                  </div>
                                  {run.status && getStatusBadge(run.status)}
                                </div>
                                {run.errorMessage && (
                                  <div className="text-xs text-red-400/80 mt-1 truncate" title={run.errorMessage}>
                                    {run.errorMessage}
                                  </div>
                                )}
                                <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-2">
                                  <Clock size={12} />
                                  {formatDuration(run.startedAt, run.finishedAt)}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                clearRun(run.id);
                                if (selectedRunId === run.id) {
                                  setSelectedRunId(null);
                                }
                              }}
                              className="text-zinc-500 hover:text-zinc-300 transition-colors"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </div>

                        {isSelected && runLogs.length > 0 && (
                          <div className="px-4 pb-3 bg-zinc-950/50">
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                              {runLogs.map((log, idx) => {
                                const time = new Date(log.timestamp).toLocaleTimeString('en-US', {
                                  hour12: false,
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                });
                                const messageColor =
                                  log.level === 'error'
                                    ? 'text-red-400'
                                    : log.level === 'warning'
                                    ? 'text-orange-400'
                                    : 'text-zinc-400';
                                return (
                                  <div key={idx} className="text-xs font-mono">
                                    <span className="text-zinc-600">{time}</span>
                                    <span className="text-zinc-500 mx-2">│</span>
                                    <span className={getStageColor(log.stage)}>
                                      {log.label}
                                    </span>
                                    <span className="text-zinc-500 mx-2">·</span>
                                    <span className={messageColor}>{log.message}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {(completedRuns.length > 0 || erroredRuns.length > 0) && (
                  <div className="px-4 py-3 bg-zinc-800/50 border-t border-zinc-800">
                    <button
                      onClick={clearAllCompleted}
                      className="w-full px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 rounded transition-colors"
                    >
                      Clear completed
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
