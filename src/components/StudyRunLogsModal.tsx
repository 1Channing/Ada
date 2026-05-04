import { useEffect, useState } from 'react';
import { X, ScrollText, AlertTriangle, CheckCircle, Info, Clock, Loader2 } from 'lucide-react';
import { loadStudyRunLogs, loadStudyResultLogs } from '../services/studyRunLogs';
import type { StudyRunProgressEvent } from '../store/studyRunsStore';

interface StudyRunLogsModalProps {
  runId: string;
  studyId?: string;
  studyLabel: string;
  onClose: () => void;
}

interface LogsData {
  logs: StudyRunProgressEvent[];
  status: string;
  lastStage?: string;
  errorMessage?: string;
}

// Labels for both worker stages (e.g. START, SCRAPE_TARGET) and legacy local stages
const STAGE_LABELS: Record<string, string> = {
  // Worker stages
  START: 'Démarrage',
  SCRAPE_TARGET: 'Scraping marché cible',
  SCRAPE_SOURCE: 'Scraping marché source',
  FILTER: 'Filtrage',
  STATS: 'Calcul statistiques',
  RESULT: 'Résultat',
  ERROR: 'Erreur',
  // Legacy local stages
  queued: 'En attente',
  scraping_target: 'Scraping marché cible',
  computing_target_stats: 'Calcul stats cible',
  scraping_source: 'Scraping marché source',
  evaluating_price: 'Évaluation prix',
  fetching_details: 'Récupération détails',
  ai_analysis: 'Analyse IA',
  saving_results: 'Sauvegarde résultats',
  done: 'Terminé',
  error: 'Erreur',
  cancelled: 'Annulé',
};

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

function formatTime(ts: number | string): string {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getLevelIcon(level?: string, stage?: string) {
  if (level === 'error' || stage === 'ERROR' || stage === 'error') {
    return <AlertTriangle size={13} className="text-red-400 shrink-0 mt-0.5" />;
  }
  if (level === 'warning') {
    return <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />;
  }
  if (stage === 'RESULT' || stage === 'done') {
    return <CheckCircle size={13} className="text-emerald-400 shrink-0 mt-0.5" />;
  }
  return <Info size={13} className="text-zinc-500 shrink-0 mt-0.5" />;
}

function getLogRowClass(level?: string, stage?: string): string {
  if (level === 'error' || stage === 'ERROR' || stage === 'error') {
    return 'bg-red-950/20 border-l-2 border-red-700';
  }
  if (level === 'warning') return 'bg-amber-950/20 border-l-2 border-amber-700';
  if (stage === 'RESULT' || stage === 'done') return 'bg-emerald-950/20 border-l-2 border-emerald-700';
  return 'border-l-2 border-transparent';
}

function getLogTextClass(level?: string, stage?: string): string {
  if (level === 'error' || stage === 'ERROR' || stage === 'error') return 'text-red-300';
  if (level === 'warning') return 'text-amber-300';
  if (stage === 'RESULT' || stage === 'done') return 'text-emerald-300';
  return 'text-zinc-300';
}

function getStatusBadge(status: string) {
  const classes: Record<string, string> = {
    OPPORTUNITIES: 'bg-emerald-900/40 text-emerald-400 border border-emerald-700/50',
    SUCCESS: 'bg-emerald-900/40 text-emerald-400 border border-emerald-700/50',
    NULL: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
    NO_TARGET_RESULTS: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
    NO_SOURCE_RESULTS: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
    TARGET_BLOCKED: 'bg-red-900/40 text-red-400 border border-red-700/50',
    SOURCE_BLOCKED: 'bg-red-900/40 text-red-400 border border-red-700/50',
    SCRAPER_ERROR: 'bg-red-900/40 text-red-400 border border-red-700/50',
    UNKNOWN_ERROR: 'bg-red-900/40 text-red-400 border border-red-700/50',
    ERROR: 'bg-red-900/40 text-red-400 border border-red-700/50',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${classes[status] ?? 'bg-zinc-800 text-zinc-400 border border-zinc-700'}`}>
      {status}
    </span>
  );
}

export function StudyRunLogsModal({ runId, studyId, studyLabel, onClose }: StudyRunLogsModalProps) {
  const [logsData, setLogsData] = useState<LogsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setLogsData(null);

    async function fetchLogs() {
      let data: LogsData | null = null;

      // 1. Try worker logs (composite key: runId_studyId)
      if (studyId) {
        data = await loadStudyResultLogs(runId, studyId);
      }

      // 2. Fallback: try legacy local logs (plain runId)
      if (!data) {
        data = await loadStudyRunLogs(runId);
      }

      if (cancelled) return;

      if (!data) {
        setNotFound(true);
      } else {
        setLogsData(data);
      }
      setLoading(false);
    }

    fetchLogs();
    return () => { cancelled = true; };
  }, [runId, studyId]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-zinc-900 rounded-lg border border-zinc-700 w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <ScrollText size={18} className="text-zinc-400" />
            <div>
              <h3 className="font-semibold text-zinc-100 text-sm">Logs de recherche</h3>
              <p className="text-xs text-zinc-500 mt-0.5">{studyLabel}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-zinc-800 rounded transition-colors"
            aria-label="Fermer"
          >
            <X size={18} className="text-zinc-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 size={28} className="text-zinc-500 animate-spin" />
              <p className="text-sm text-zinc-500">Chargement des logs...</p>
            </div>
          ) : notFound ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <ScrollText size={32} className="text-zinc-600" />
              <p className="text-sm text-zinc-400 font-medium">Aucun log disponible pour cette étude</p>
              <p className="text-xs text-zinc-600 text-center max-w-xs">
                Les logs ne sont pas encore persistés pour cette recherche, ou ils ont été nettoyés.
              </p>
            </div>
          ) : logsData && (
            <>
              {/* Summary bar */}
              <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-800/30 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-zinc-500">Statut final :</span>
                  {getStatusBadge(logsData.status)}
                </div>
                {logsData.lastStage && (
                  <div className="flex items-center gap-1.5">
                    <Clock size={12} className="text-zinc-500" />
                    <span className="text-xs text-zinc-500">Dernière étape :</span>
                    <span className="text-xs text-zinc-300">{stageLabel(logsData.lastStage)}</span>
                  </div>
                )}
                <div className="ml-auto text-xs text-zinc-600">{logsData.logs.length} entrées</div>
              </div>

              {/* Error message */}
              {logsData.errorMessage && (
                <div className="mx-4 mt-3 p-3 bg-red-950/30 border border-red-800/50 rounded-lg flex items-start gap-2">
                  <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-300">{logsData.errorMessage}</p>
                </div>
              )}

              {/* Log entries */}
              <div className="p-4 space-y-0.5 font-mono text-xs">
                {logsData.logs.length === 0 ? (
                  <p className="text-zinc-600 text-center py-8">Aucune entrée de log.</p>
                ) : (
                  logsData.logs.map((entry, idx) => (
                    <div
                      key={entry.id ?? idx}
                      className={`flex items-start gap-2 px-2 py-1 rounded ${getLogRowClass(entry.level, entry.stage)}`}
                    >
                      {getLevelIcon(entry.level, entry.stage)}
                      <span className="text-zinc-600 shrink-0">{formatTime(entry.timestamp)}</span>
                      <span className="text-zinc-500 shrink-0 hidden sm:inline">
                        [{stageLabel(entry.stage)}]
                      </span>
                      <span className={`flex-1 leading-relaxed ${getLogTextClass(entry.level, entry.stage)}`}>
                        {entry.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
