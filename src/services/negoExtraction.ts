/**
 * Extractions de photos d'annonce EN ARRIÈRE-PLAN (demande 28/08).
 *
 * L'orchestration vit ICI, pas dans la modale : fermer la fenêtre, changer
 * de page ou revenir ne tue pas le suivi. Les jobs en cours sont persistés
 * en localStorage et REPRIS au montage de la page Ventes — le worker, lui,
 * continue de toute façon ; c'est le sondage côté client qui doit survivre.
 * À l'arrivée, les photos brutes du scrape précédent (photo_NN) sont
 * remplacées, les ajouts manuels / masquées / rognées préservés (même règle
 * que la modale). Les abonnés (ligne de négo, modale) sont notifiés à chaque
 * changement d'état — le spinner de ligne n'est que le reflet de ce store.
 */

import { supabase } from '../lib/supabase';

const LS_KEY = 'nego_photo_extractions_v1';
// Les jobs worker vivent 15 min (purge INGEST_JOBS) — au-delà, l'entrée est morte.
const MAX_AGE_MS = 15 * 60_000;

interface PendingJob {
  jobId: string;
  startedAt: number;
  /** Analyse d'AJOUT (31/08) : compléter la carte au retour du worker —
   *  seulement les champs que l'utilisateur n'a PAS saisis (sa saisie prime,
   *  toujours). Persisté avec le job : survit navigation et rechargement. */
  fillTitle?: boolean;
  fillPrice?: boolean;
}

let pending = new Map<string, PendingJob>();      // negoId → job
const pollingIds = new Set<string>();             // boucles de sondage actives
const errors = new Map<string, string>();         // negoId → dernière erreur
const listeners = new Set<() => void>();

function loadStore(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Record<string, PendingJob>;
    pending = new Map(Object.entries(raw).filter(([, j]) => Date.now() - j.startedAt < MAX_AGE_MS));
  } catch { pending = new Map(); }
}
function saveStore(): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(pending))); } catch { /* stockage indispo */ }
}
function notify(): void { for (const l of [...listeners]) l(); }

export function subscribeNegoExtractions(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
export function isExtracting(negoId: string): boolean { return pending.has(negoId); }
/** Nombre d'analyses en cours — nourrit l'indicateur global persistant. */
export function extractingCount(): number { return pending.size; }
export function extractionError(negoId: string): string | null { return errors.get(negoId) ?? null; }
export function clearExtractionError(negoId: string): void { errors.delete(negoId); }

/** À appeler au montage de la page Ventes : reprend les sondages interrompus. */
export function resumeNegoExtractions(): void {
  loadStore();
  for (const id of pending.keys()) void poll(id);
  if (pending.size > 0) notify();
}

export async function startNegoExtraction(
  negoId: string, url: string,
  fill?: { title?: boolean; price?: boolean },
): Promise<void> {
  if (pending.has(negoId)) return; // déjà en cours
  errors.delete(negoId);
  const start = await supabase.functions.invoke('ingest-url', { body: { url, mode: 'listing_detail' } });
  if (start.error) throw new Error(start.error.message ?? 'edge ingest-url en échec');
  const jobId = (start.data as { jobId?: string } | null)?.jobId;
  if (!jobId) throw new Error('worker sans mode fiche annonce — réponse inattendue');
  pending.set(negoId, { jobId, startedAt: Date.now(), fillTitle: fill?.title, fillPrice: fill?.price });
  saveStore(); notify();
  void poll(negoId);
}

async function mergePhotos(negoId: string, extracted: string[]): Promise<void> {
  const { data } = await supabase.from('negotiations').select('photos').eq('id', negoId).single();
  const current: string[] = Array.isArray((data as { photos?: unknown } | null)?.photos)
    ? ((data as { photos: string[] }).photos) : [];
  const kept = current.filter((p) => !/\/negotiations\/[^/]+\/photo_\d+\./.test(p));
  await supabase.from('negotiations')
    .update({ photos: [...kept, ...extracted], updated_at: new Date().toISOString() })
    .eq('id', negoId);
}

async function poll(negoId: string): Promise<void> {
  if (pollingIds.has(negoId)) return;
  pollingIds.add(negoId);
  let consecutiveFails = 0;
  try {
    for (;;) {
      const job = pending.get(negoId);
      if (!job) return;
      if (Date.now() - job.startedAt > MAX_AGE_MS) throw new Error("Délai dépassé — relance l'extraction");
      await new Promise((r) => setTimeout(r, 2500));
      const p = await supabase.functions.invoke('ingest-url', { body: { jobId: job.jobId } });
      const d = p.data as { jobStatus?: string; message?: string; photos?: string[]; error?: string; card?: { title?: string | null; price?: number | null } } | null;
      if (d?.jobStatus === 'done') {
        // Carte lue par le worker : complète titre/prix laissés vides à
        // l'ajout (la saisie de l'utilisateur prime — fill* le fige).
        const patch: Record<string, unknown> = {};
        if (job.fillTitle && d.card?.title) patch.title = d.card.title;
        if (job.fillPrice && d.card?.price != null) patch.asking_price = d.card.price;
        if (Object.keys(patch).length > 0) {
          await supabase.from('negotiations')
            .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', negoId);
        }
        const photos = d.photos ?? [];
        if (photos.length === 0) {
          // Une analyse d'ajout qui a au moins rempli la carte n'est pas un
          // échec ; hors ajout (relance photos), 0 photo reste une erreur.
          if (Object.keys(patch).length === 0) throw new Error("Aucune photo extraite de l'annonce");
          return;
        }
        await mergePhotos(negoId, photos);
        return;
      }
      if (d?.jobStatus === 'error') throw new Error(d.message || 'extraction en échec');
      if (p.error || d?.error) {
        // Job inconnu = worker redémarré (déploiement) ; erreurs réseau =
        // transitoires. 5 échecs d'affilée = on rend la main proprement.
        consecutiveFails += 1;
        if (consecutiveFails >= 5) throw new Error("Extraction perdue (worker redémarré ?) — relance-la");
      } else {
        consecutiveFails = 0;
      }
    }
  } catch (e) {
    errors.set(negoId, e instanceof Error ? e.message : String(e));
  } finally {
    pending.delete(negoId);
    pollingIds.delete(negoId);
    saveStore();
    notify();
  }
}
