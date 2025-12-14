export type ScheduledStudyPayload = {
  studyIds: string[];
  threshold: number;
  type: 'instant';
  scrapeMode?: 'fast' | 'full';
};

export type ScheduledJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ScheduledStudyRun {
  id: string;
  created_at: string;
  scheduled_at: string;
  status: ScheduledJobStatus;
  payload: ScheduledStudyPayload;
  last_run_at?: string;
  last_error?: string;
  run_id?: string;
}
