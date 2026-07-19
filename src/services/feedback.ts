/**
 * Feedback interne — les commerciaux signalent depuis ADA même ce qui cloche
 * (ou suggèrent une amélioration). Chaque signalement atterrit dans
 * `ada_feedback` et devient un item de backlog priorisable : quand on se
 * connecte pour développer, la liste dit quoi corriger en premier.
 */

import { supabase } from '../lib/supabase';

export type FeedbackKind = 'suggestion' | 'probleme';

export interface FeedbackItem {
  id: string;
  createdAt: string;
  author: string;
  kind: FeedbackKind;
  message: string;
  page: string;
  screenshot: string | null;
  status: 'open' | 'done';
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  suggestion: 'Suggestion',
  probleme: 'Problème',
};

function mapRow(r: Record<string, unknown>): FeedbackItem {
  return {
    id: String(r.id),
    createdAt: String(r.created_at ?? ''),
    author: String(r.author ?? ''),
    kind: (r.kind === 'suggestion' ? 'suggestion' : 'probleme'),
    message: String(r.message ?? ''),
    page: String(r.page ?? ''),
    screenshot: (r.screenshot as string | null) ?? null,
    status: r.status === 'done' ? 'done' : 'open',
    resolvedAt: (r.resolved_at as string | null) ?? null,
    resolvedBy: (r.resolved_by as string | null) ?? null,
  };
}

export async function loadFeedback(limit = 50): Promise<{ items: FeedbackItem[]; error: string | null }> {
  const { data, error } = await supabase
    .from('ada_feedback')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { items: [], error: error.message };
  return { items: ((data ?? []) as Array<Record<string, unknown>>).map(mapRow), error: null };
}

export async function countOpenFeedback(): Promise<number> {
  const { count } = await supabase
    .from('ada_feedback')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open');
  return count ?? 0;
}

export async function submitFeedback(input: {
  author: string;
  kind: FeedbackKind;
  message: string;
  page: string;
  screenshot: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('ada_feedback').insert({
    author: input.author.trim(),
    kind: input.kind,
    message: input.message.trim(),
    page: input.page,
    screenshot: input.screenshot,
    status: 'open',
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function setFeedbackStatus(
  id: string,
  done: boolean,
  by: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('ada_feedback')
    .update(done
      ? { status: 'done', resolved_at: new Date().toISOString(), resolved_by: by.trim() || null }
      : { status: 'open', resolved_at: null, resolved_by: null })
    .eq('id', id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Downscale + recompress a screenshot before storage (base64 data-URL in the
 * table — no storage bucket to configure). 1400px max edge, JPEG q0.8 ≈
 * 100-300 KB for a typical screen; refuses anything still above ~1.2 MB.
 */
export async function prepareScreenshot(file: File): Promise<{ dataUrl: string | null; error?: string }> {
  if (!file.type.startsWith('image/')) return { dataUrl: null, error: 'Fichier non-image' };
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return { dataUrl: null, error: 'Image illisible' };
  const MAX_EDGE = 1400;
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return { dataUrl: null, error: 'Canvas indisponible' };
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  if (dataUrl.length > 1_200_000) return { dataUrl: null, error: 'Capture trop lourde même compressée' };
  return { dataUrl };
}
