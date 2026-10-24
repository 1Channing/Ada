/**
 * LES DEMANDES DU SITE mc-export.com DANS LA CLOCHE D'ADA (25/10, Channing :
 * « Je suis ok pour les alertes »). La partie pure : le rappel d'une demande,
 * avec tout ce qu'il faut pour rappeler sans ouvrir Supabase (contact,
 * voiture, page). Le worker : worker/siteLeads.ts ; testé par
 * test/site-leads.test.ts.
 */

/** Une ligne de site_leads (SQL du 23/10, 20261023100000_demandes_site.sql). */
export interface SiteLead {
  id: string;
  created_at: string;
  kind: string;
  lang: string;
  page: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  country: string | null;
  message: string | null;
  details: Record<string, unknown> | null;
  notified_at: string | null;
}

const KIND_LABEL: Record<string, string> = {
  acheteur: 'Acheteur professionnel',
  vendeur: 'Vendeur professionnel',
  particulier: 'Rachat particulier',
  autre: 'Demande professionnelle',
};
const LANG_LABEL: Record<string, string> = { fr: 'français', en: 'anglais', da: 'danois', nl: 'néerlandais', de: 'allemand', it: 'italien', es: 'espagnol' };
/** Les champs de la voiture, mis en forme à part ; les autres détails sont recopiés tels quels. */
const CAR_FIELDS = new Set(['gamme', 'marque', 'modele', 'annee', 'km', 'situation', 'code_postal', 'pays']);

/** La clé du rappel d'une demande (user_tasks.key) : un seul rappel par demande. */
export const leadKey = (id: string): string => `site_lead:${id}`;

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

function kmOf(v: unknown): string {
  const n = Number(text(v).replace(/\D/g, ''));
  return n > 0 ? `${n.toLocaleString('fr-FR')} km` : '';
}

const parisDate = (iso: string): string =>
  new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Le titre et la note du rappel (200 et 1 500 caractères au plus, comme la cloche). */
export function leadReminder(l: SiteLead): { title: string; note: string } {
  const d = l.details ?? {};
  const car = [text(d.marque), text(d.modele)].filter(Boolean).join(' ');
  const carLine = [car, text(d.annee), kmOf(d.km)].filter(Boolean).join(', ');
  const who = text(l.company) || text(l.name) || text(l.email) || text(l.phone) || 'contact sans nom';
  const kind = KIND_LABEL[l.kind] ?? 'Demande';
  const title = `Demande du site : ${l.kind === 'particulier' ? `rappeler ${who}` : `${kind.toLowerCase()}, ${who}`}${carLine ? ` — ${carLine}` : ''}`;
  const gamme = text(d.gamme);
  const extra = Object.entries(d).filter(([k, v]) => !CAR_FIELDS.has(k) && text(v)).map(([k, v]) => `${k} : ${text(v)}`);
  const lines = [
    `${kind} · ${LANG_LABEL[l.lang] ?? l.lang}${l.page ? ` · page ${l.page}` : ''}`,
    `Contact : ${[text(l.name), text(l.company), text(l.phone), text(l.email)].filter(Boolean).join(' · ') || '—'}`,
    carLine ? `Voiture : ${carLine}${gamme && !car.toLowerCase().includes(gamme.toLowerCase()) ? ` (${gamme.toLowerCase()})` : ''}${text(d.situation) ? ` · situation : ${text(d.situation)}` : ''}` : '',
    text(l.country) || text(d.code_postal) ? `Lieu : ${[text(l.country), text(d.code_postal)].filter(Boolean).join(', ')}` : '',
    ...extra,
    text(l.message) ? `Message : ${text(l.message)}` : '',
    `Reçue le ${parisDate(l.created_at)}${l.kind === 'particulier' ? ', offre promise sous 24 h ouvrées' : ''}.`,
  ].filter(Boolean);
  return { title: title.slice(0, 200), note: lines.join('\n').slice(0, 1500) };
}
