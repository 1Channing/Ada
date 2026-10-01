/**
 * BOÎTE À APPRENDRE — écriture côté worker (01/10, décision Channing : « tout
 * ce qui peut nécessiter une action de correction va dans la boîte »).
 *
 * Un cas = (kind, key) : revu plusieurs fois → seen_count + 1, jamais de
 * doublon ; un cas « fait » qui se représente est rouvert. Chaque cas dit
 * QUI agit (equipe | dev) et OÙ aller (link = chemin dans ADA).
 * Fail-open : table absente ou erreur → false, l'appelant garde son message.
 *
 * Familles (kind) :
 *   dealer_site_unknown  vitrine de concession non reconnue          dev
 *   dealer_scan_empty    relevé vide sur un site reconnu            dev
 *   service_blocked      Zyte suspendu, crédits API épuisés…        equipe
 *   site_failing         site d'étude en échec plusieurs vagues     dev
 *   sheet_row_unmatched  ligne du tableur ventes non rapprochée     equipe
 *   mail_failed          e-mail de dossier en échec                 equipe
 *   (signalement et mapping_gap sont lus depuis leurs tables, pas écrits ici)
 */
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';

export type LearningActor = 'equipe' | 'dev';

export interface LearningCaseInput {
  kind: string;
  key: string;
  title: string;
  url?: string | null;
  link?: string | null;
  actor?: LearningActor;
  contactId?: string | null;
  submittedBy?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Clôture AUTOMATIQUE d'un cas quand la réalité l'a réglé (le site inconnu
 * est maintenant relevé, le client du tableur a été créé…). Ne touche qu'un
 * cas encore ouvert ; silencieux sinon.
 */
export async function resolveLearningCase(kind: string, key: string, resolution: string): Promise<void> {
  const sb = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    await sb.from('learning_cases').update({ status: 'done', resolution: `auto : ${resolution}`, resolved_at: new Date().toISOString() })
      .eq('kind', kind).eq('key', key).eq('status', 'open');
  } catch { /* fail-open */ }
}

export async function recordLearningCase(c: LearningCaseInput): Promise<boolean> {
  const sb = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const now = new Date().toISOString();
    const { data: existing, error: selErr } = await sb.from('learning_cases').select('id, seen_count, status').eq('kind', c.kind).eq('key', c.key).maybeSingle();
    if (selErr) return false;
    const extra = { ...(c.actor ? { actor: c.actor } : {}), ...(c.link !== undefined ? { link: c.link } : {}) };
    if (existing) {
      const reopen = existing.status === 'done' ? { status: 'open', resolved_at: null, resolution: null } : {};
      let { error } = await sb.from('learning_cases').update({ seen_count: (existing.seen_count ?? 1) + 1, last_seen_at: now, url: c.url ?? null, contact_id: c.contactId ?? null, detail: c.detail ?? null, title: c.title, ...extra, ...reopen }).eq('id', existing.id);
      // Colonnes actor / link absentes (SQL du 02/10 pas collé) : on écrit sans elles.
      if (error && /actor|link/.test(error.message) && /column|schema cache/i.test(error.message)) {
        ({ error } = await sb.from('learning_cases').update({ seen_count: (existing.seen_count ?? 1) + 1, last_seen_at: now, url: c.url ?? null, contact_id: c.contactId ?? null, detail: c.detail ?? null, title: c.title, ...reopen }).eq('id', existing.id));
      }
      return !error;
    }
    const base = { kind: c.kind, key: c.key, url: c.url ?? null, contact_id: c.contactId ?? null, submitted_by: c.submittedBy ?? null, title: c.title, detail: c.detail ?? null, status: 'open', seen_count: 1, last_seen_at: now };
    let { error } = await sb.from('learning_cases').insert({ ...base, ...extra });
    if (error && /actor|link/.test(error.message) && /column|schema cache/i.test(error.message)) {
      ({ error } = await sb.from('learning_cases').insert(base));
    }
    return !error;
  } catch { return false; }
}
