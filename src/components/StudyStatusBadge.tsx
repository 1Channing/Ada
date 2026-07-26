import { Loader } from 'lucide-react';

type StudyStatus = 'idle' | 'queued' | 'running' | 'success' | 'null' | 'error';

interface StudyStatusBadgeProps {
  status: StudyStatus;
}

export function StudyStatusBadge({ status }: StudyStatusBadgeProps) {
  switch (status) {
    case 'queued':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-600 border border-blue-300">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          Queued
        </span>
      );
    case 'running':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-300">
          <Loader size={12} className="animate-spin" />
          Running
        </span>
      );
    case 'success':
      return (
        <span className="px-2 py-1 rounded text-xs font-medium bg-emerald-50 text-emerald-600 border border-emerald-300">
          Success
        </span>
      );
    case 'null':
      return (
        <span className="px-2 py-1 rounded text-xs font-medium bg-slate-300 text-slate-600 border border-slate-300">
          NULL
        </span>
      );
    case 'error':
      return (
        <span className="px-2 py-1 rounded text-xs font-medium bg-red-50 text-red-600 border border-red-300">
          Error
        </span>
      );
    default:
      return null;
  }
}
