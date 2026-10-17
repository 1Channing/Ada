/**
 * ADA RÉDIGE UN PREMIER MAIL (17/10, phase 2.3). Pour un garage qualifié
 * dont l'interlocuteur a un e-mail publié et vérifié :
 * - garde-fous d'abord : pas d'e-mail vérifié, déjà contacté, écarté, sur la
 *   liste « ne plus contacter » ou déjà en conversation → rien n'est rédigé ;
 * - le matériel factuel : sa fiche, son stock (marques, modèles), les écarts
 *   mesurés avec nos offres, nos offres de ses marques, les consignes de
 *   Channing (Réglages) ;
 * - Opus 5.5 écrit dans sa langue, avec la traduction française et la liste
 *   des faits cités ; le contrôle signale ce qu'il faut regarder (longueur,
 *   lien, question, chiffre absent des données) ;
 * - le brouillon entre dans « À valider » (un fil neuf rattaché au
 *   prospect) : rien ne part sans le clic d'un administrateur, puis l'envoi
 *   respecte les horaires, le plafond du jour et l'étalement.
 */
import { OPUS } from '../../src/lib/agents/aiCost';
import {
  FIRST_MAIL_SYSTEM, FIRST_MAIL_SCHEMA, firstMailPrompt, checkFirstMail, withAgentSignature, LANG_OF_COUNTRY,
  type FirstMailOutput, type OfferFact,
} from '../../src/lib/agents/firstMail';
import { opportunities, brandKey, type DealerListingLite } from '../../src/lib/agents/opportunity';
import { countryVat } from '../../src/lib/offers/vat';
import { suppressionMatch } from '../../src/lib/agents/sendPolicy';
import { callClaude, BudgetReached, AiUnavailable } from './claude';
import { loadOffers, dealerGroupIds, type AiAgent } from './qualify';
import { sb, journal, loadSuppressions } from './store';

interface ProspectRow {
  id: string; agent: string; dealer_id: string | null; name: string; country: string | null; city: string | null;
  group_name: string | null; kind: string | null; brands_official: string[] | null; language: string | null; summary: string | null;
  stage: string; score: number | null; network_contact_id: string | null;
  best_contact: { nom: string | null; fonction: string | null; email: string | null } | null;
  emails: Array<{ email: string; mx: boolean }> | null;
}
export interface DraftOutcome { status: 'redige' | 'ignore' | 'echec'; name: string; detail: string; cost: number; threadId?: string }

const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const nice = (b: string) => b.charAt(0) + b.slice(1).toLowerCase();

export async function draftFirstMail(prospectId: string, a: AiAgent, taskId: string | null): Promise<DraftOutcome> {
  const { data } = await sb.from('agent_prospects').select('*').eq('id', prospectId).maybeSingle();
  const p = data as ProspectRow | null;
  if (!p) return { status: 'echec', name: prospectId, detail: 'prospect introuvable', cost: 0 };
  const skip = (detail: string): DraftOutcome => ({ status: 'ignore', name: p.name, detail, cost: 0 });

  // 1. Garde-fous
  const email = p.best_contact?.email?.toLowerCase() ?? null;
  if (!email || !(p.emails ?? []).some((e) => e.email === email && e.mx)) return skip('pas d\'e-mail publié et vérifié');
  if (!['qualifie', 'a_contacter'].includes(p.stage)) return skip(`étape « ${p.stage} »`);
  const blocked = suppressionMatch([email], await loadSuppressions());
  if (blocked) return skip(`${blocked} est sur « ne plus contacter »`);
  const { data: t1 } = await sb.from('agent_threads').select('id').eq('prospect_id', p.id).limit(1);
  const { data: t2 } = await sb.from('agent_threads').select('id').eq('counterpart_email', email).limit(1);
  if (((t1 ?? []) as unknown[]).length || ((t2 ?? []) as unknown[]).length) return skip('déjà en conversation');

  // 2. Le matériel
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  // Son stock sur tous les sites où ADA le voit (fiches rapprochées).
  const { data: lRows } = p.dealer_id
    ? await sb.from('market_dealer_listings').select('listing_url, brand, model, title, year, mileage, price_eur').in('dealer_id', await dealerGroupIds(p.dealer_id)).gte('last_seen_at', since).limit(1000)
    : { data: [] };
  const listings = (lRows ?? []) as DealerListingLite[];
  const byBrand = new Map<string, number>();
  const models = new Map<string, number>();
  for (const l of listings) {
    if (l.brand) byBrand.set(l.brand, (byBrand.get(l.brand) ?? 0) + 1);
    if (l.brand && l.model) models.set(`${nice(l.brand)} ${l.model}`, (models.get(`${nice(l.brand)} ${l.model}`) ?? 0) + 1);
  }
  const vat = countryVat((p.country ?? 'FR').toUpperCase());
  const offers = await loadOffers();
  const opps = opportunities(listings, offers, vat).slice(0, 3);
  const gaps = opps.map((o) => `leur ${nice(o.listing.brand ?? '')} ${o.listing.model ?? ''} ${o.listing.year ?? ''}${o.listing.mileage != null ? ` (${o.listing.mileage.toLocaleString('fr-FR')} km)` : ''} affiché ${eur(o.listing.price_eur ?? 0)} TTC ; notre ${o.offer.title}${o.offer.year ? ` ${o.offer.year}` : ''}${o.offer.km != null ? ` (${o.offer.km.toLocaleString('fr-FR')} km)` : ''} ≈ ${eur(o.ourTtc)} TVA de son pays comprise, environ ${o.gapPct} % de moins`);
  const theirBrands = new Set([...byBrand.keys()].map(brandKey));
  const shownOffers = [...new Set([...opps.map((o) => o.offer), ...offers.filter((o) => theirBrands.has(brandKey(o.brand)))])].slice(0, 4);
  const offerFacts: OfferFact[] = shownOffers.map((o) => ({ title: o.title, year: o.year, km: o.km, priceHt: o.priceHt, withVat: o.priceHt ? Math.round(o.priceHt * (1 + vat)) : null }));
  const language = p.language || LANG_OF_COUNTRY[(p.country ?? '').toUpperCase()] || 'en';
  const prompt = firstMailPrompt({
    company: p.name, country: p.country, city: p.city, language,
    contact: { name: p.best_contact?.nom ?? null, role: p.best_contact?.fonction ?? null },
    kind: p.kind, group: p.group_name, officialBrands: p.brands_official ?? [], summary: p.summary,
    stock: { listings: listings.length, byBrand: [...byBrand].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([brand, n]) => ({ brand: nice(brand), n })), models: [...models].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([m, n]) => `${m} (${n})`) },
    gaps, offers: offerFacts, instructions: a.instructions ?? '',
  });

  // 3. Opus 5.5
  let out: FirstMailOutput;
  let cost = 0;
  try {
    const budget = Number(a.daily_budget_usd);
    const r = await callClaude<FirstMailOutput>({
      agent: a.agent, budgetUsd: Number.isFinite(budget) ? budget : 0, purpose: 'premier_mail', model: OPUS,
      system: FIRST_MAIL_SYSTEM, user: prompt, schema: FIRST_MAIL_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 8000, effort: 'medium', prospectId: p.id, taskId, fallbacks: true,
    });
    out = r.data as FirstMailOutput;
    cost = r.costUsd;
  } catch (e) {
    if (e instanceof BudgetReached || e instanceof AiUnavailable) throw e;
    return { status: 'echec', name: p.name, detail: e instanceof Error ? e.message : String(e), cost: 0 };
  }
  if (!out?.objet?.trim() || !out?.corps?.trim()) return { status: 'echec', name: p.name, detail: 'brouillon vide', cost };
  const check = checkFirstMail(out, prompt);

  // 4. Le fil et le brouillon, à valider
  const subject = out.objet.trim().slice(0, 200);
  const { data: th, error: e1 } = await sb.from('agent_threads').insert({
    agent: a.agent, mailbox: a.mailbox, subject, counterpart_email: email, counterpart_name: p.best_contact?.nom ?? null,
    prospect_id: p.id, network_contact_id: p.network_contact_id,
  }).select('id');
  const threadId = ((th ?? []) as Array<{ id: string }>)[0]?.id;
  if (e1 || !threadId) return { status: 'echec', name: p.name, detail: `fil non créé : ${e1?.message ?? '?'}`, cost };
  const { data: msg, error: e2 } = await sb.from('agent_messages').insert({
    thread_id: threadId, agent: a.agent, mailbox: a.mailbox, channel: 'mail', direction: 'out', status: 'a_valider', kind: 'premier_contact',
    author: a.agent, to_emails: [email], subject, body_text: withAgentSignature(out.corps, a.signature ?? ''),
    translation_fr: language === 'fr' ? null : (out.traduction_fr ?? null),
    ai_notes: { modele: OPUS, cout_usd: Math.round(cost * 10_000) / 10_000, langue: language, mots: check.words, faits: (out.faits ?? []).slice(0, 12), alertes: check.warnings },
  }).select('id');
  const messageId = ((msg ?? []) as Array<{ id: string }>)[0]?.id;
  if (e2 || !messageId) {
    await sb.from('agent_threads').delete().eq('id', threadId);
    return { status: 'echec', name: p.name, detail: `brouillon non enregistré : ${e2?.message ?? '?'}`, cost };
  }
  await sb.from('agent_threads').update({ last_message_at: new Date().toISOString(), last_direction: 'out' }).eq('id', threadId);
  if (p.stage === 'qualifie') await sb.from('agent_prospects').update({ stage: 'a_contacter', updated_at: new Date().toISOString() }).eq('id', p.id);
  await journal({
    agent: a.agent, actor: a.agent, kind: 'premier_mail', threadId, messageId,
    summary: `Premier mail rédigé pour ${p.name} (${p.country ?? '?'}) → ${email}, à valider${check.warnings.length ? ` — ${check.warnings.length} point${check.warnings.length > 1 ? 's' : ''} à vérifier` : ''}`,
    details: { prospect_id: p.id, cost_usd: Math.round(cost * 10_000) / 10_000, langue: language },
  });
  return { status: 'redige', name: p.name, detail: email, cost, threadId };
}

/** Les prochains prospects à qui écrire d'office : qualifiés, au-dessus du seuil, e-mail vérifié, jamais contactés. */
export async function nextDraftCandidates(a: AiAgent, limit: number): Promise<string[]> {
  const { data } = await sb.from('agent_prospects').select('id, score, best_contact, emails')
    .eq('agent', a.agent).eq('stage', 'qualifie').gte('score', a.map_min_score ?? 70).order('score', { ascending: false }).limit(40);
  const rows = (data ?? []) as Array<{ id: string; best_contact: { email: string | null } | null; emails: Array<{ email: string; mx: boolean }> | null }>;
  const suppressed = await loadSuppressions();
  const out: string[] = [];
  for (const r of rows) {
    const email = r.best_contact?.email?.toLowerCase();
    if (!email || !(r.emails ?? []).some((e) => e.email === email && e.mx) || suppressionMatch([email], suppressed)) continue;
    const { data: th } = await sb.from('agent_threads').select('id').eq('prospect_id', r.id).limit(1);
    if (((th ?? []) as unknown[]).length) continue;
    out.push(r.id);
    if (out.length >= limit) break;
  }
  return out;
}
