import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { CheckCircle, XCircle, Clock, Play } from 'lucide-react';
import type { Database } from '../lib/database.types';

type JobRun = Database['public']['Tables']['job_runs']['Row'];

export function JobLogs() {
  const [jobs, setJobs] = useState<JobRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<JobRun | null>(null);
  const [triggeringJob, setTriggeringJob] = useState(false);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 10000);
    return () => clearInterval(interval);
  }, []);

  async function loadJobs() {
    try {
      const { data, error } = await supabase
        .from('job_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setJobs(data || []);
    } catch (error) {
      console.error('Error loading jobs:', error);
    } finally {
      setLoading(false);
    }
  }

  async function triggerManualJob() {
    setTriggeringJob(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/daily-job`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to trigger job: ${response.status}`);
      }

      const result = await response.json();
      console.log('Job triggered:', result);

      setTimeout(loadJobs, 2000);
      alert('Job triggered successfully!');
    } catch (error) {
      console.error('Error triggering job:', error);
      alert(`Error triggering job: ${(error as Error).message}`);
    } finally {
      setTriggeringJob(false);
    }
  }

  function getStatusIcon(status: string) {
    if (status === 'success') {
      return <CheckCircle size={20} className="text-green-400" />;
    }
    if (status === 'error') {
      return <XCircle size={20} className="text-red-400" />;
    }
    return <Clock size={20} className="text-amber-400" />;
  }

  function getDuration(job: JobRun): string {
    if (!job.finished_at) return 'Running...';
    const start = new Date(job.started_at).getTime();
    const end = new Date(job.finished_at).getTime();
    const seconds = Math.round((end - start) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-100">Job Logs</h1>
          <p className="text-zinc-400 mt-1">Monitor scheduled and manual job executions</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={loadJobs}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg font-medium transition-colors"
          >
            Refresh
          </button>
          <button
            onClick={triggerManualJob}
            disabled={triggeringJob}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={18} />
            {triggeringJob ? 'Running...' : 'Run Job Now'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-500/10 rounded-lg">
              <CheckCircle className="text-green-400" size={24} />
            </div>
            <div>
              <div className="text-2xl font-bold text-zinc-100">
                {jobs.filter((j) => j.status === 'success').length}
              </div>
              <div className="text-xs text-zinc-500">Successful</div>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-red-500/10 rounded-lg">
              <XCircle className="text-red-400" size={24} />
            </div>
            <div>
              <div className="text-2xl font-bold text-zinc-100">
                {jobs.filter((j) => j.status === 'error').length}
              </div>
              <div className="text-xs text-zinc-500">Failed</div>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/10 rounded-lg">
              <Clock className="text-amber-400" size={24} />
            </div>
            <div>
              <div className="text-2xl font-bold text-zinc-100">
                {jobs.filter((j) => j.status === 'running').length}
              </div>
              <div className="text-xs text-zinc-500">Running</div>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-zinc-400">Loading jobs...</div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-12 text-zinc-400">No job runs yet</div>
      ) : (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full">
            <thead className="bg-zinc-800 border-b border-zinc-700">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Started</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Duration</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Message</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(job.status)}
                      <span className="text-xs font-medium text-zinc-300 uppercase">{job.status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-300">
                      {job.run_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-sm">
                    {new Date(job.started_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-sm">
                    {getDuration(job)}
                  </td>
                  <td className="px-4 py-3 text-zinc-300 text-sm max-w-md truncate">
                    {job.message || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelectedJob(job)}
                      className="text-xs px-3 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-300 transition-colors"
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedJob && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-8 z-50">
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 max-w-3xl w-full max-h-[80vh] overflow-auto">
            <div className="p-6 border-b border-zinc-800">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-bold text-zinc-100">Job Details</h2>
                  <p className="text-sm text-zinc-400 mt-1">{selectedJob.id}</p>
                </div>
                <button
                  onClick={() => setSelectedJob(null)}
                  className="text-zinc-400 hover:text-zinc-200"
                >
                  <XCircle size={24} />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <div className="text-xs text-zinc-500 mb-1">Status</div>
                <div className="flex items-center gap-2">
                  {getStatusIcon(selectedJob.status)}
                  <span className="font-medium text-zinc-100 uppercase">{selectedJob.status}</span>
                </div>
              </div>

              <div>
                <div className="text-xs text-zinc-500 mb-1">Type</div>
                <div className="text-zinc-100">{selectedJob.run_type}</div>
              </div>

              <div>
                <div className="text-xs text-zinc-500 mb-1">Started At</div>
                <div className="text-zinc-100">{new Date(selectedJob.started_at).toLocaleString()}</div>
              </div>

              {selectedJob.finished_at && (
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Finished At</div>
                  <div className="text-zinc-100">{new Date(selectedJob.finished_at).toLocaleString()}</div>
                </div>
              )}

              <div>
                <div className="text-xs text-zinc-500 mb-1">Duration</div>
                <div className="text-zinc-100">{getDuration(selectedJob)}</div>
              </div>

              {selectedJob.message && (
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Message</div>
                  <div className="text-zinc-100">{selectedJob.message}</div>
                </div>
              )}

              {selectedJob.details && (
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Details</div>
                  <pre className="bg-zinc-800 rounded p-4 text-xs text-zinc-300 overflow-auto">
                    {JSON.stringify(selectedJob.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
