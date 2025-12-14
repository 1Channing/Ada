import { create } from 'zustand';

export type StudyStage =
  | 'queued'
  | 'scraping_target'
  | 'computing_target_stats'
  | 'scraping_source'
  | 'evaluating_price'
  | 'fetching_details'
  | 'ai_analysis'
  | 'saving_results'
  | 'done'
  | 'error'
  | 'cancelled';

export type StudyRunStatus =
  | 'SUCCESS'
  | 'NO_TARGET_RESULTS'
  | 'NO_SOURCE_RESULTS'
  | 'TARGET_BLOCKED'
  | 'SOURCE_BLOCKED'
  | 'SCRAPER_ERROR'
  | 'UNKNOWN_ERROR';

export interface StudyRunProgressEvent {
  id: string;
  studyCode: string;
  label: string;
  message: string;
  stage: StudyStage;
  timestamp: number;
  level?: 'info' | 'warning' | 'error';
}

export interface StudyRunState {
  id: string;
  studyCode: string;
  studyId: string;
  runId: string;
  stage: StudyStage;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  status?: StudyRunStatus;
  errorMessage?: string;
  hasErrors?: boolean;
  lastStage?: StudyStage;
}

interface StudyRunsStore {
  runs: Record<string, StudyRunState>;
  logs: Record<string, StudyRunProgressEvent[]>;

  addRun: (run: StudyRunState) => void;
  updateRun: (id: string, patch: Partial<StudyRunState>) => void;
  addLog: (id: string, event: StudyRunProgressEvent) => void;
  clearRun: (id: string) => void;
  clearAllCompleted: () => void;
}

export const useStudyRunsStore = create<StudyRunsStore>((set) => ({
  runs: {},
  logs: {},

  addRun: (run) =>
    set((state) => ({
      runs: { ...state.runs, [run.id]: run },
      logs: { ...state.logs, [run.id]: [] },
    })),

  updateRun: (id, patch) =>
    set((state) => ({
      runs: {
        ...state.runs,
        [id]: { ...state.runs[id], ...patch },
      },
    })),

  addLog: (id, event) =>
    set((state) => {
      const currentLogs = state.logs[id] || [];
      const newLogs = [...currentLogs, event];

      const isError =
        event.level === 'error' ||
        event.stage === 'error' ||
        /error|failed|website-ban|ban|blocked/i.test(event.message);

      const currentRun = state.runs[id];

      return {
        logs: {
          ...state.logs,
          [id]: newLogs,
        },
        runs: currentRun
          ? {
              ...state.runs,
              [id]: {
                ...currentRun,
                hasErrors: currentRun.hasErrors || isError,
              },
            }
          : state.runs,
      };
    }),

  clearRun: (id) =>
    set((state) => {
      const { [id]: _, ...restRuns } = state.runs;
      const { [id]: __, ...restLogs } = state.logs;
      return { runs: restRuns, logs: restLogs };
    }),

  clearAllCompleted: () =>
    set((state) => {
      const newRuns: Record<string, StudyRunState> = {};
      const newLogs: Record<string, StudyRunProgressEvent[]> = {};

      Object.entries(state.runs).forEach(([id, run]) => {
        if (run.stage !== 'done' && run.stage !== 'error' && run.stage !== 'cancelled') {
          newRuns[id] = run;
          newLogs[id] = state.logs[id];
        }
      });

      return { runs: newRuns, logs: newLogs };
    }),
}));

export function getStudyRunLogs(studyRunId: string): StudyRunProgressEvent[] {
  return useStudyRunsStore.getState().logs[studyRunId] || [];
}
