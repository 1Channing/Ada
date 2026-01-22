import { Loader } from 'lucide-react';

type StudyStatus = 'idle' | 'queued' | 'running' | 'success' | 'null' | 'error';

interface StudyStatusBadgeProps {
  status: StudyStatus;
}

export function StudyStatusBadge({ status }: StudyStatusBadgeProps) {
  switch (status) {
    case 'queued':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-blue-900/30 text-blue-400 border border-blue-700/50">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          Queued
        </span>
      );
    case 'running':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-blue-900/30 text-blue-300 border border-blue-700/50">
          <Loader size={12} className="animate-spin" />
          Running
        </span>
      );
    case 'success':
      return (
        <span className="px-2 py-1 rounded text-xs font-medium bg-emerald-900/30 text-emerald-400 border border-emerald-700/50">
          Success
        </span>
      );
    case 'null':
      return (
        <span className="px-2 py-1 rounded text-xs font-medium bg-zinc-700 text-zinc-400 border border-zinc-600">
          NULL
        </span>
      );
    case 'error':
      return (
        <span className="px-2 py-1 rounded text-xs font-medium bg-red-900/30 text-red-400 border border-red-700/50">
          Error
        </span>
      );
    default:
      return null;
  }
}
