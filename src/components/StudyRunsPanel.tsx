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
    if (stage === 'done') return <CheckCircle size={16} className="text-green-600" />;
    if (stage === 'error' || stage === 'cancelled') return <XCircle size={16} className="text-red-600" />;
    return <Loader size={16} className="text-blue-600 animate-spin" />;
  };

  const getStageColor = (stage: string) => {
    if (stage === 'done') return 'text-green-600';
    if (stage === 'error' || stage === 'cancelled') return 'text-red-600';
    return 'text-blue-600';
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
      SUCCESS: { label: 'Success', className: 'bg-green-100 text-green-600 border-green-500/30' },
      NO_TARGET_RESULTS: { label: 'No Results', className: 'bg-slate-200 text-slate-600 border-slate-300' },
      NO_SOURCE_RESULTS: { label: 'No Results', className: 'bg-slate-200 text-slate-600 border-slate-300' },
      TARGET_BLOCKED: { label: 'Blocked', className: 'bg-orange-100 text-orange-600 border-orange-500/30' },
      SOURCE_BLOCKED: { label: 'Blocked', className: 'bg-orange-100 text-orange-600 border-orange-500/30' },
      SCRAPER_ERROR: { label: 'Error', className: 'bg-red-100 text-red-600 border-red-500/30' },
      UNKNOWN_ERROR: { label: 'Error', className: 'bg-red-100 text-red-600 border-red-500/30' },
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
      <div className="bg-white border border-slate-300 rounded-lg shadow-2xl overflow-hidden">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between bg-slate-200 hover:bg-slate-200 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Activity size={20} className="text-blue-600" />
            <div className="text-left">
              <div className="text-sm font-semibold text-slate-900">
                Study Runs
              </div>
              <div className="text-xs text-slate-600">
                {activeRuns.length > 0 ? (
                  <span className="text-blue-600">
                    {activeRuns.length} running
                    {activeRuns.length === 1 && completedRuns.length > 0 && ` (${completedRuns.length + 1} of ${allRuns.length})`}
                  </span>
                ) : (
                  <span className="text-green-600">All completed</span>
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
              <div className="p-4 text-center text-slate-600 text-sm">
                No study runs
              </div>
            ) : (
              <>
                <div className="divide-y divide-slate-200">
                  {allRuns.map((run) => {
                    const runLogs = logs[run.id] || [];
                    const lastLog = runLogs[runLogs.length - 1];
                    const isSelected = selectedRunId === run.id;

                    return (
                      <div key={run.id} className="bg-white">
                        <div
                          onClick={() => setSelectedRunId(isSelected ? null : run.id)}
                          className="px-4 py-3 hover:bg-slate-100 cursor-pointer transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-2 flex-1 min-w-0">
                              {getStageIcon(run.stage)}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <div className="text-sm font-medium text-slate-900 truncate">
                                    {run.studyCode}
                                  </div>
                                  {run.hasErrors && (
                                    <AlertTriangle size={14} className="text-red-600 flex-shrink-0" title="Contains errors" />
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <div className={`text-xs ${getStageColor(run.stage)}`}>
                                    {lastLog?.label || run.stage}
                                  </div>
                                  {run.status && getStatusBadge(run.status)}
                                </div>
                                {run.errorMessage && (
                                  <div className="text-xs text-red-600/80 mt-1 truncate" title={run.errorMessage}>
                                    {run.errorMessage}
                                  </div>
                                )}
                                <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
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
                              className="text-slate-500 hover:text-slate-700 transition-colors"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </div>

                        {isSelected && runLogs.length > 0 && (
                          <div className="px-4 pb-3 bg-white/50">
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
                                    ? 'text-red-600'
                                    : log.level === 'warning'
                                    ? 'text-orange-600'
                                    : 'text-slate-600';
                                return (
                                  <div key={idx} className="text-xs font-mono">
                                    <span className="text-slate-400">{time}</span>
                                    <span className="text-slate-500 mx-2">│</span>
                                    <span className={getStageColor(log.stage)}>
                                      {log.label}
                                    </span>
                                    <span className="text-slate-500 mx-2">·</span>
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
                  <div className="px-4 py-3 bg-slate-100 border-t border-slate-200">
                    <button
                      onClick={clearAllCompleted}
                      className="w-full px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 hover:bg-slate-300/50 rounded transition-colors"
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
