import { ReactNode } from 'react';
import { StudyRunsPanel } from './StudyRunsPanel';

type LayoutProps = {
  children: ReactNode;
};

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="min-h-screen overflow-auto">
        <div className="p-8">
          {children}
        </div>
      </main>

      <StudyRunsPanel />
    </div>
  );
}
