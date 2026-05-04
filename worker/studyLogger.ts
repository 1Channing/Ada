import type { SupabaseClient } from '@supabase/supabase-js';

export type LogLevel = 'info' | 'warning' | 'error';

export type LogStage =
  | 'START'
  | 'SCRAPE_TARGET'
  | 'SCRAPE_SOURCE'
  | 'FILTER'
  | 'STATS'
  | 'RESULT'
  | 'ERROR';

export interface WorkerLogEntry {
  timestamp: string;
  stage: LogStage | string;
  level: LogLevel;
  message: string;
}

export class StudyLogger {
  private logs: WorkerLogEntry[] = [];
  private studyId: string;
  private runId: string;

  constructor(runId: string, studyId: string) {
    this.runId = runId;
    this.studyId = studyId;
    console.log(`[LOGGER_INIT] run_id=${runId} study_id=${studyId}`);
  }

  log(stage: LogStage | string, level: LogLevel, message: string): void {
    this.logs.push({
      timestamp: new Date().toISOString(),
      stage,
      level,
      message,
    });
  }

  async persist(
    supabase: SupabaseClient,
    status: string,
    lastStage?: string,
    errorMessage?: string
  ): Promise<void> {
    if (this.logs.length === 0) {
      this.logs.push({
        timestamp: new Date().toISOString(),
        stage: 'ERROR',
        level: 'error',
        message: 'No logs captured (unexpected state)',
      });
    }

    const studyRunId = `${this.runId}_${this.studyId}`;

    try {
      const { error } = await supabase.from('study_run_logs').insert({
        study_run_id: studyRunId,
        status,
        last_stage: lastStage ?? null,
        error_message: errorMessage ?? null,
        logs_json: this.logs,
      });

      if (error) {
        console.error(`[LOGGER_ERROR] Failed to persist logs for ${studyRunId}:`, error.message);
        return;
      }

      console.log(
        `[LOGGER_PERSIST] study_run_id=${studyRunId} logs_count=${this.logs.length} status=${status}`
      );
    } catch (err: any) {
      console.error(`[LOGGER_ERROR] Unexpected error persisting logs for ${studyRunId}:`, err?.message ?? err);
    }
  }
}
