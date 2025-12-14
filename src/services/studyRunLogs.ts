import { supabase } from '../lib/supabase';
import { StudyRunStatus, StudyStage, StudyRunProgressEvent, getStudyRunLogs } from '../store/studyRunsStore';
import { sanitizeUUIDSafe } from '../lib/uuid-utils';

export async function persistStudyRunLogs(params: {
  studyRunId: string;
  status: StudyRunStatus;
  lastStage?: StudyStage;
  errorMessage?: string;
  logs: StudyRunProgressEvent[];
}) {
  const { studyRunId, status, lastStage, errorMessage, logs } = params;

  const cleanStudyRunId = sanitizeUUIDSafe(studyRunId, studyRunId);

  const MAX_LOGS = 200;
  const trimmedLogs = logs.length > MAX_LOGS ? logs.slice(-MAX_LOGS) : logs;

  const { error } = await supabase.from('study_run_logs').insert({
    study_run_id: cleanStudyRunId,
    status,
    last_stage: lastStage ?? null,
    error_message: errorMessage ?? null,
    logs_json: trimmedLogs,
  });

  if (error) {
    console.error('[STUDY_RUN_LOGS] Failed to persist logs:', error);
    throw error;
  }

  console.log(`[STUDY_RUN_LOGS] Persisted logs for run ${studyRunId} with status ${status}`);
}

export async function persistStudyRunLogsSafe(
  studyRunId: string,
  status: StudyRunStatus,
  lastStage?: StudyStage,
  errorMessage?: string
) {
  try {
    const allLogs = getStudyRunLogs(studyRunId);
    await persistStudyRunLogs({
      studyRunId,
      status,
      lastStage,
      errorMessage,
      logs: allLogs,
    });
  } catch (error) {
    console.error('[STUDY_RUN_LOGS] Error while persisting run logs (non-fatal):', error);
  }
}

export async function loadStudyRunLogs(studyRunId: string): Promise<{
  logs: StudyRunProgressEvent[];
  status: StudyRunStatus;
  lastStage?: StudyStage;
  errorMessage?: string;
} | null> {
  try {
    const cleanStudyRunId = sanitizeUUIDSafe(studyRunId, studyRunId);
    const { data, error } = await supabase
      .from('study_run_logs')
      .select('logs_json, status, last_stage, error_message')
      .eq('study_run_id', cleanStudyRunId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      logs: data.logs_json as StudyRunProgressEvent[],
      status: data.status as StudyRunStatus,
      lastStage: data.last_stage as StudyStage | undefined,
      errorMessage: data.error_message || undefined,
    };
  } catch (error) {
    console.error('[STUDY_RUN_LOGS] Error loading run logs:', error);
    return null;
  }
}
