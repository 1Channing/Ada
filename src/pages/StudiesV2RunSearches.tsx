import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Play, Calendar, CheckSquare, Square, XCircle, Clock } from 'lucide-react';
import { runStudyInBackground, type StudyV2 } from '../services/studyRunner';
import { useStudyRunsStore } from '../store/studyRunsStore';
import type { ScheduledStudyPayload, ScheduledStudyRun } from '../types/scheduling';

interface RunProgress {
  isRunning: boolean;
  currentIndex: number;
  total: number;
  currentStudyId?: string;
  stage?: string;
}

export function StudiesV2RunSearches() {
  const [studies, setStudies] = useState<StudyV2[]>([]);
  const [selectedStudies, setSelectedStudies] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [progress, setProgress] = useState<string>('');
  const [priceDiffThreshold, setPriceDiffThreshold] = useState<number>(5000);
  const [runProgress, setRunProgress] = useState<RunProgress>({
    isRunning: false,
    currentIndex: 0,
    total: 0,
    currentStudyId: undefined,
    stage: undefined,
  });
  const [nextScheduledJob, setNextScheduledJob] = useState<ScheduledStudyRun | null>(null);
  const [reschedulingJob, setReschedulingJob] = useState<ScheduledStudyRun | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [scrapeMode, setScrapeMode] = useState<'fast' | 'full'>('fast');
  const cancelRequestedRef = useRef(false);
  const { addRun, updateRun, addLog } = useStudyRunsStore();

  useEffect(() => {
    loadStudies();
    loadNextScheduledJob();
  }, []);

  async function loadStudies() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('studies_v2')
        .select('*')
        .order('brand', { ascending: true })
        .order('model', { ascending: true });

      if (error) throw error;
      setStudies(data || []);
    } catch (error) {
      console.error('Error loading studies:', error);
      alert('Error loading studies');
    } finally {
      setLoading(false);
    }
  }

  async function loadNextScheduledJob() {
    try {
      const { data, error } = await supabase
        .from('scheduled_study_runs')
        .select('*')
        .eq('status', 'pending')
        .order('scheduled_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      setNextScheduledJob(data);
    } catch (error) {
      console.error('Error loading next scheduled job:', error);
    }
  }

  function toggleStudy(studyId: string) {
    const newSelected = new Set(selectedStudies);
    if (newSelected.has(studyId)) {
      newSelected.delete(studyId);
    } else {
      newSelected.add(studyId);
    }
    setSelectedStudies(newSelected);
  }

  function toggleSelectAll() {
    if (selectedStudies.size === studies.length) {
      setSelectedStudies(new Set());
    } else {
      setSelectedStudies(new Set(studies.map(s => s.id)));
    }
  }

  function handleTrimTargetChange(studyId: string, value: string) {
    setStudies(studies.map(s =>
      s.id === studyId ? { ...s, trim_text_target: value } : s
    ));
  }

  function handleTrimSourceChange(studyId: string, value: string) {
    setStudies(studies.map(s =>
      s.id === studyId ? { ...s, trim_text_source: value } : s
    ));
  }

  async function saveTrimTarget(studyId: string, value: string) {
    const trimmed = value.trim();
    try {
      const { error } = await supabase
        .from('studies_v2')
        .update({ trim_text_target: trimmed })
        .eq('id', studyId);

      if (error) throw error;

      setStudies(studies.map(s =>
        s.id === studyId ? { ...s, trim_text_target: trimmed } : s
      ));
    } catch (error) {
      console.error('Error saving target trim:', error);
      alert('Error saving target trim');
    }
  }

  async function saveTrimSource(studyId: string, value: string) {
    const trimmed = value.trim();
    try {
      const { error } = await supabase
        .from('studies_v2')
        .update({ trim_text_source: trimmed })
        .eq('id', studyId);

      if (error) throw error;

      setStudies(studies.map(s =>
        s.id === studyId ? { ...s, trim_text_source: trimmed } : s
      ));
    } catch (error) {
      console.error('Error saving source trim:', error);
      alert('Error saving source trim');
    }
  }

  async function runInstantSearch() {
    if (selectedStudies.size === 0) {
      alert('Please select at least one study');
      return;
    }

    setRunning(true);
    cancelRequestedRef.current = false;
    setProgress('Creating run...');

    const studiesToRun = studies.filter(s => selectedStudies.has(s.id));

    setRunProgress({
      isRunning: true,
      currentIndex: 0,
      total: studiesToRun.length,
      currentStudyId: undefined,
      stage: 'Creating run...',
    });

    try {
      const { data: runData, error: runError } = await supabase
        .from('study_runs')
        .insert([{
          run_type: 'instant',
          status: 'running',
          total_studies: selectedStudies.size,
          executed_at: new Date().toISOString(),
          price_diff_threshold_eur: priceDiffThreshold,
        }])
        .select()
        .single();

      if (runError) throw runError;

      const runId = runData.id;
      let nullCount = 0;
      let opportunitiesCount = 0;
      let blockedCount = 0;

      for (let i = 0; i < studiesToRun.length; i++) {
        const study = studiesToRun[i];
        const studyLabel = `${study.brand} ${study.model}`;
        const studyCode = `${study.brand}_${study.model}_${study.year}_${study.country_source}_${study.country_target}`;

        setRunProgress({
          isRunning: true,
          currentIndex: i + 1,
          total: studiesToRun.length,
          currentStudyId: study.id,
          stage: 'Queued...',
        });
        setProgress(`Processing study ${i + 1}/${studiesToRun.length}: ${studyLabel}...`);

        const studyRunId = crypto.randomUUID();

        addRun({
          id: studyRunId,
          studyCode,
          studyId: study.id,
          runId,
          stage: 'queued',
          startedAt: Date.now(),
        });

        try {
          console.log(`[BATCH_RUN] ▶️ Starting study ${i + 1}/${studiesToRun.length}: ${studyCode}`);

          const result = await runStudyInBackground(
            studyRunId,
            {
              study,
              runId,
              threshold: priceDiffThreshold,
              scrapeMode,
            },
            (event) => {
              addLog(studyRunId, event);
              updateRun(studyRunId, { stage: event.stage });
              if (event.stage === 'done') {
                updateRun(studyRunId, { finishedAt: Date.now() });
              }
            },
          );

          if (result.status === 'NULL') {
            nullCount++;
            console.log(`[BATCH_RUN] ℹ️ Study ${studyCode} completed with NULL result (count: ${nullCount})`);
          } else if (result.status === 'TARGET_BLOCKED') {
            blockedCount++;
            console.log(`[BATCH_RUN] ⛔ Study ${studyCode} blocked by provider (count: ${blockedCount})`);
          } else {
            opportunitiesCount++;
            console.log(`[BATCH_RUN] 💰 Study ${studyCode} found opportunities (count: ${opportunitiesCount})`);
          }

          console.log(`[BATCH_RUN] ✅ Study ${i + 1}/${studiesToRun.length} completed and persisted: ${studyCode}`);

          updateRun(studyRunId, {
            stage: 'done',
            finishedAt: Date.now(),
          });
        } catch (error) {
          console.error(`[BATCH_RUN] ❌ Error processing study ${study.id}:`, error);
          updateRun(studyRunId, {
            stage: 'error',
            finishedAt: Date.now(),
            errorMessage: (error as Error).message,
          });
        }

        if (cancelRequestedRef.current) {
          console.log('[RUN] Cancellation requested by user, stopping after current study');
          setRunProgress({
            isRunning: false,
            currentIndex: i + 1,
            total: studiesToRun.length,
            currentStudyId: study.id,
            stage: 'Cancelled by user',
          });
          break;
        }
      }

      const finalStatus = cancelRequestedRef.current ? 'cancelled' : 'completed';

      console.log(`[BATCH_RUN] 🏁 Batch ${finalStatus}. Updating run record with final counts...`);

      await supabase
        .from('study_runs')
        .update({
          status: finalStatus,
          null_count: nullCount,
          opportunities_count: opportunitiesCount,
        })
        .eq('id', runId);

      console.log(`[BATCH_RUN] ✅ Run record updated: status=${finalStatus}, null=${nullCount}, opportunities=${opportunitiesCount}`);

      setRunProgress({
        isRunning: false,
        currentIndex: studiesToRun.length,
        total: studiesToRun.length,
        stage: cancelRequestedRef.current ? 'Cancelled by user' : 'Completed',
      });

      if (cancelRequestedRef.current) {
        setProgress('Run cancelled');
        console.log(`[BATCH_RUN] ⚠️ User cancelled batch after ${nullCount + opportunitiesCount + blockedCount} studies`);
        alert(`Run cancelled!\n${nullCount} studies with NULL status\n${opportunitiesCount} studies with opportunities\n${blockedCount} studies blocked by provider\n(${studiesToRun.length - (nullCount + opportunitiesCount + blockedCount)} studies not processed)`);
      } else {
        setProgress('Run completed!');
        console.log(`[BATCH_RUN] 🎉 All ${studiesToRun.length} studies completed successfully`);
        alert(`Run completed!\n${nullCount} studies with NULL status\n${opportunitiesCount} studies with opportunities\n${blockedCount} studies blocked by provider`);
      }

      setSelectedStudies(new Set());
    } catch (error) {
      console.error('Error running search:', error);
      alert(`Error: ${(error as Error).message}`);
      setRunProgress({
        isRunning: false,
        currentIndex: 0,
        total: 0,
        stage: 'Error',
      });
    } finally {
      setRunning(false);
      setProgress('');
    }
  }

  function handleCancelRun() {
    if (runProgress.isRunning) {
      cancelRequestedRef.current = true;
      setRunProgress({
        ...runProgress,
        stage: 'Cancelling after current study...',
      });
    }
  }

  async function scheduleSearch() {
    if (selectedStudies.size === 0) {
      alert('Please select at least one study');
      return;
    }

    if (!scheduledDate || !scheduledTime) {
      alert('Please select date and time');
      return;
    }

    const scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`);

    if (scheduledFor <= new Date()) {
      alert('Scheduled time must be in the future');
      return;
    }

    try {
      const payload: ScheduledStudyPayload = {
        studyIds: Array.from(selectedStudies),
        threshold: priceDiffThreshold,
        type: 'instant',
        scrapeMode,
      };

      const { error } = await supabase
        .from('scheduled_study_runs')
        .insert([{
          scheduled_at: scheduledFor.toISOString(),
          payload,
        }]);

      if (error) throw error;

      const formattedDate = scheduledFor.toLocaleString('en-US', {
        dateStyle: 'short',
        timeStyle: 'short',
      });

      alert(
        `Search scheduled for ${formattedDate}.\n\n` +
        `${selectedStudies.size} studies will run automatically via the backend worker.\n\n` +
        `Results will appear in the Results page once completed.`
      );

      setScheduledDate('');
      setScheduledTime('');
      setSelectedStudies(new Set());
      loadNextScheduledJob();
    } catch (error) {
      console.error('Error scheduling search:', error);
      alert(`Error: ${(error as Error).message}`);
    }
  }

  async function cancelScheduledJob(jobId: string) {
    if (!confirm('Are you sure you want to cancel this scheduled job?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('scheduled_study_runs')
        .update({ status: 'cancelled' })
        .eq('id', jobId)
        .eq('status', 'pending');

      if (error) throw error;

      alert('Scheduled job cancelled successfully');
      loadNextScheduledJob();
    } catch (error) {
      console.error('Error cancelling job:', error);
      alert(`Error cancelling job: ${(error as Error).message}`);
    }
  }

  function startReschedule(job: ScheduledStudyRun) {
    const scheduledDate = new Date(job.scheduled_at);
    const dateStr = scheduledDate.toISOString().split('T')[0];
    const timeStr = scheduledDate.toTimeString().slice(0, 5);

    setReschedulingJob(job);
    setRescheduleDate(dateStr);
    setRescheduleTime(timeStr);
  }

  function cancelReschedule() {
    setReschedulingJob(null);
    setRescheduleDate('');
    setRescheduleTime('');
  }

  async function confirmReschedule() {
    if (!reschedulingJob || !rescheduleDate || !rescheduleTime) {
      return;
    }

    const newScheduledFor = new Date(`${rescheduleDate}T${rescheduleTime}`);

    if (newScheduledFor <= new Date()) {
      alert('Scheduled time must be in the future');
      return;
    }

    try {
      const { error } = await supabase
        .from('scheduled_study_runs')
        .update({ scheduled_at: newScheduledFor.toISOString() })
        .eq('id', reschedulingJob.id)
        .eq('status', 'pending');

      if (error) throw error;

      const formattedDate = newScheduledFor.toLocaleString('en-US', {
        dateStyle: 'short',
        timeStyle: 'short',
      });

      alert(`Job rescheduled to ${formattedDate}`);
      cancelReschedule();
      loadNextScheduledJob();
    } catch (error) {
      console.error('Error rescheduling job:', error);
      alert(`Error rescheduling job: ${(error as Error).message}`);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-zinc-100">Run Searches</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Run instant searches or schedule them for later
        </p>
      </div>

      {progress && (
        <div className="p-4 bg-blue-900/30 border border-blue-700/50 rounded-lg">
          <p className="text-blue-100">{progress}</p>
          {runProgress.isRunning && runProgress.stage && (
            <p className="text-blue-200 text-sm mt-2">
              Stage: {runProgress.stage}
            </p>
          )}
        </div>
      )}

      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            Scrape Mode
          </label>
          <div className="inline-flex rounded-lg border border-zinc-700 bg-zinc-800 p-1">
            <button
              type="button"
              onClick={() => setScrapeMode('fast')}
              className={`px-6 py-2 rounded-md text-sm font-medium transition-colors ${
                scrapeMode === 'fast'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              FAST
            </button>
            <button
              type="button"
              onClick={() => setScrapeMode('full')}
              className={`px-6 py-2 rounded-md text-sm font-medium transition-colors ${
                scrapeMode === 'full'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              FULL
            </button>
          </div>
          <p className="text-xs text-zinc-500 mt-2">
            {scrapeMode === 'fast'
              ? 'FAST: Scrapes only page 1 per query. Minimal Zyte usage, ~1-2 min per study.'
              : 'FULL: Scrapes all pages with full details. Complete data, ~10+ min per study.'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            Minimum price difference (EUR)
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="0"
              max="15000"
              step="500"
              value={priceDiffThreshold}
              onChange={(e) => setPriceDiffThreshold(Number(e.target.value))}
              className="flex-1 h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer"
            />
            <input
              type="number"
              min="0"
              step="500"
              value={priceDiffThreshold}
              onChange={(e) => setPriceDiffThreshold(Number(e.target.value))}
              className="w-32 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 text-center"
            />
            <span className="text-zinc-400">EUR</span>
          </div>
          <p className="text-xs text-zinc-500 mt-2">
            Studies with price difference below this threshold will be marked as NULL
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
          <div className="flex items-center gap-3 mb-4">
            <Play size={24} className="text-emerald-400" />
            <div>
              <h3 className="font-semibold text-zinc-100">Instant Search</h3>
              <p className="text-xs text-zinc-400">Run selected studies immediately</p>
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={runInstantSearch}
              disabled={running || selectedStudies.size === 0}
              className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-700 disabled:text-zinc-400 text-white rounded-lg font-medium transition-colors"
            >
              {runProgress.isRunning
                ? `Running... (${runProgress.currentIndex}/${runProgress.total})`
                : `Run Now (${selectedStudies.size} selected)`}
            </button>

            {runProgress.isRunning && (
              <button
                onClick={handleCancelRun}
                className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <XCircle size={18} />
                Cancel Run
              </button>
            )}

            {runProgress.isRunning && runProgress.stage && (
              <div className="text-xs text-zinc-400 bg-zinc-800 px-3 py-2 rounded border border-zinc-700">
                <div className="font-medium text-zinc-300 mb-1">
                  Processing study {runProgress.currentIndex}/{runProgress.total}
                  {runProgress.currentStudyId && <span className="text-zinc-500"> • {runProgress.currentStudyId}</span>}
                </div>
                <div className="text-emerald-400">{runProgress.stage}</div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
          <div className="flex items-center gap-3 mb-4">
            <Calendar size={24} className="text-blue-400" />
            <div>
              <h3 className="font-semibold text-zinc-100">Schedule Search</h3>
              <p className="text-xs text-zinc-400">Schedule for a specific date and time</p>
            </div>
          </div>

          <div className="space-y-3">
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
            />
            <input
              type="time"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
            />
            <button
              onClick={scheduleSearch}
              disabled={running || selectedStudies.size === 0}
              className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-400 text-white rounded-lg font-medium transition-colors"
            >
              Schedule ({selectedStudies.size} selected)
            </button>

            {nextScheduledJob && !reschedulingJob && (
              <div className="mt-3 pt-3 border-t border-zinc-700">
                <div className="flex items-start gap-2 text-xs">
                  <Clock size={14} className="text-blue-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="text-zinc-400 mb-1">Next scheduled run:</div>
                    <div className="text-zinc-200 font-medium">
                      {new Date(nextScheduledJob.scheduled_at).toLocaleString('en-US', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </div>
                    <div className="text-zinc-500 mt-1">
                      {(nextScheduledJob.payload as ScheduledStudyPayload).studyIds.length} studies
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => startReschedule(nextScheduledJob)}
                        className="flex-1 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-600/50 text-blue-300 rounded text-xs font-medium transition-colors"
                      >
                        Reschedule
                      </button>
                      <button
                        onClick={() => cancelScheduledJob(nextScheduledJob.id)}
                        className="flex-1 px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 border border-red-600/50 text-red-300 rounded text-xs font-medium transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {reschedulingJob && (
              <div className="mt-3 pt-3 border-t border-zinc-700">
                <div className="text-xs text-zinc-400 mb-2">Reschedule job:</div>
                <div className="space-y-2">
                  <input
                    type="date"
                    value={rescheduleDate}
                    onChange={(e) => setRescheduleDate(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100 text-xs"
                  />
                  <input
                    type="time"
                    value={rescheduleTime}
                    onChange={(e) => setRescheduleTime(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100 text-xs"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={confirmReschedule}
                      className="flex-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-medium transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={cancelReschedule}
                      className="flex-1 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-xs font-medium transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 rounded-lg border border-zinc-800">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="font-semibold text-zinc-100">Select Studies</h3>
          <button
            onClick={toggleSelectAll}
            className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-2"
          >
            {selectedStudies.size === studies.length ? <CheckSquare size={16} /> : <Square size={16} />}
            {selectedStudies.size === studies.length ? 'Deselect All' : 'Select All'}
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-zinc-400">Loading studies...</div>
        ) : studies.length === 0 ? (
          <div className="p-8 text-center text-zinc-400">
            No studies available. Please import studies first.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-800/50">
                <tr>
                  <th className="w-12 px-4 py-3"></th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Brand</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Model</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Year</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Target</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Source</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Target Trim</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Source Trim</th>
                </tr>
              </thead>
              <tbody>
                {studies.map((study) => (
                  <tr
                    key={study.id}
                    className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors"
                  >
                    <td className="px-4 py-3 cursor-pointer" onClick={() => toggleStudy(study.id)}>
                      <div className="flex items-center justify-center">
                        {selectedStudies.has(study.id) ? (
                          <CheckSquare size={18} className="text-emerald-400" />
                        ) : (
                          <Square size={18} className="text-zinc-600" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 cursor-pointer" onClick={() => toggleStudy(study.id)}>
                      <div className="font-medium text-zinc-100">{study.brand}</div>
                    </td>
                    <td className="px-4 py-3 cursor-pointer" onClick={() => toggleStudy(study.id)}>
                      <div className="text-zinc-300">{study.model}</div>
                    </td>
                    <td className="px-4 py-3 cursor-pointer" onClick={() => toggleStudy(study.id)}>
                      <div className="text-sm text-zinc-300">{study.year}</div>
                    </td>
                    <td className="px-4 py-3 cursor-pointer" onClick={() => toggleStudy(study.id)}>
                      <div className="text-sm font-medium text-blue-400">{study.country_target}</div>
                    </td>
                    <td className="px-4 py-3 cursor-pointer" onClick={() => toggleStudy(study.id)}>
                      <div className="text-sm font-medium text-emerald-400">{study.country_source}</div>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={study.trim_text_target !== null && study.trim_text_target !== undefined ? study.trim_text_target : (study.trim_text || '')}
                        onChange={(e) => handleTrimTargetChange(study.id, e.target.value)}
                        onBlur={(e) => saveTrimTarget(study.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          }
                        }}
                        placeholder="GR Sport..."
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
                      />
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={study.trim_text_source !== null && study.trim_text_source !== undefined ? study.trim_text_source : (study.trim_text || '')}
                        onChange={(e) => handleTrimSourceChange(study.id, e.target.value)}
                        onBlur={(e) => saveTrimSource(study.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          }
                        }}
                        placeholder="GR, Trail..."
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
