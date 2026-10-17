/**
 * ADA ET DANA RÉDIGENT UN PREMIER CONTACT (17/10, phase 2.3 ; Dana et les
 * grands comptes le 17/10). Pour un prospect qualifié :
 * - garde-fous d'abord : déjà contacté, écarté, sur la liste « ne plus
 *   contacter », déjà en conversation, ou son groupe déjà approché par la
 *   même agente → rien n'est rédigé ; un garage en France n'est jamais un
 *   acheteur d'Ada ;
 * - le matériel factuel : pour Ada (acheteurs), sa fiche, son stock, les
 *   écarts mesurés avec nos offres, nos offres de ses marques ; pour Dana
 *   (fournisseurs), sa fiche et ses lots de véhicules identiques, relus à
 *   l'instant — sans aucun prix (la négociation passe par Channing) ; pour
 *   une entreprise trouvée par recherche web (étape 2), son type de compte,
 *   sa taille et pourquoi elle compte ; les consignes de Channing (Réglages) ;
 * - petit compte (e-mail publié et vérifié) : Opus 5.5 écrit dans sa langue,
 *   avec la traduction et les faits cités ; le brouillon entre dans « À
 *   valider », depuis la boîte de l'agente ;
 * - grand compte (groupe, loueur, leasing, flotte — Channing : « elles
 *   préparent, vous envoyez ») : Opus 5.5 prépare, au nom de Channing, le mail
 *   (s'il y a un e-mail publié et vérifié), la note d'invitation LinkedIn et
 *   la fiche d'appel ; ils entrent dans « Pour vous » : Channing envoie
 *   lui-même (sa boîte, son LinkedIn), puis les marque envoyés.
 * Rien ne part sans le clic d'un administrateur ; l'envoi par la boîte de
 * l'agente respecte les horaires, le plafond du jour et l'étalement.
 */
import { OPUS } from '../../src/lib/agents/aiCost';
import {
  FIRST_MAIL_SYSTEM, FIRST_MAIL_SCHEMA, firstMailPrompt, checkFirstMail, withAgentSignature, LANG_OF_COUNTRY,
  DANA_FIRST_MAIL_SYSTEM, danaFirstMailPrompt, checkDanaMail, keyAccountSystem, KEY_ACCOUNT_SCHEMA, keyAccountPrompt, checkKeyAccount, linkedinSearchUrl,
  type FirstMailOutput, type KeyAccountOutput, type OfferFact, type DraftCheck, type AccountFacts,
} from '../../src/lib/agents/firstMail';
import { segmentOf } from '../../src/lib/agents/research';
import { opportunities, brandKey, type DealerListingLite } from '../../src/lib/agents/opportunity';
import { lotLine, normalizeDanaTargets, groupKey, type LotFact } from '../../src/lib/agents/sourcing';
import { countryVat } from '../../src/lib/offers/vat';
import { suppressionMatch } from '../../src/lib/agents/sendPolicy';
import { callClaude, BudgetReached, AiUnavailable } from './claude';
import { loadOffers, dealerGroupIds, lotsOfDealer, type AiAgent } from './qualify';
import { HOME_COUNTRY } from '../../src/lib/agents/qualification';
import { sb, journal, loadSuppressions } from './store';

interface Person { nom: string; fonction: string | null; email: string | null; linkedin?: string | null }
interface ProspectRow {
  id: string; agent: string; dealer_id: string | null; name: string; country: string | null; city: string | null;
  group_name: string | null; kind: string | null; brands_official: string[] | null; language: string | null; summary: string | null;
  stage: string; score: number | null; network_contact_id: string | null;
  best_contact: { nom: string | null; fonction: string | null; email: string | null; linkedin?: string | null } | null;
  emails: Array<{ email: string; mx: boolean }> | null;
  people?: Person[] | null;
  // SQL agents_comptes (17/10) ; absents avant : un petit compte, sans lots.
  key_account?: boolean | null; lots?: LotFact[] | null;
  // SQL agents_recherche (17/10) : une entreprise trouvée par recherche web.
  account_id?: string | null;
}
export interface DraftOutcome { status: 'redige' | 'ignore' | 'echec'; name: string; detail: string; cost: number; threadId?: string }

const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const nice = (b: string) => b.charAt(0) + b.slice(1).toLowerCase();
/** Les étapes d'un prospect déjà approché (ou qui a dit non). */
const APPROACHED = ['a_contacter', 'contacte', 'repondu', 'interesse', 'client', 'perdu'];

/**
 * On n'écrit pas deux fois au même groupe (même agente) :
 * - un grand compte attend si un autre grand compte du groupe a déjà été approché ;
 * - un site d'un groupe attend si une fiche du groupe a déjà été approchée, ou si
 *   le groupe est traité en grand compte (c'est le groupe qu'on approche, par Channing).
 */
async function groupConflict(agent: string, p: ProspectRow, key: boolean): Promise<string | null> {
  const g = groupKey(p.group_name);
  if (g.length < 3) return null;
  const q = (cols: string) => sb.from('agent_prospects').select(cols).eq('agent', agent).not('group_name', 'is', null).neq('id', p.id).limit(2000);
  const first = await q('id, name, group_name, stage, key_account');
  const { data } = first.error ? await q('id, name, group_name, stage') : first; // SQL agents_comptes pas encore collé
  const same = ((data ?? []) as Array<{ name: string; group_name: string | null; stage: string; key_account?: boolean }>).filter((r) => groupKey(r.group_name) === g);
  const approached = same.find((r) => APPROACHED.includes(r.stage) && (!key || r.key_account === true));
  if (approached) return `groupe ${p.group_name} déjà approché (${approached.name})`;
  const head = key ? null : same.find((r) => r.key_account === true && r.stage !== 'ecarte');
  return head ? `groupe ${p.group_name} traité en grand compte (${head.name})` : null;
}

export async function draftFirstMail(prospectId: string, a: AiAgent, taskId: string | null): Promise<DraftOutcome> {
  const { data } = await sb.from('agent_prospects').select('*').eq('id', prospectId).maybeSingle();
  const p = data as ProspectRow | null;
  if (!p) return { status: 'echec', name: prospectId, detail: 'prospect introuvable', cost: 0 };
  const skip = (detail: string): DraftOutcome => ({ status: 'ignore', name: p.name, detail, cost: 0 });
  const role: 'ada' | 'dana' = a.agent === 'dana' ? 'dana' : 'ada';
  const key = p.key_account === true;

  // 1. Garde-fous
  if (p.agent !== a.agent) return skip(p.agent === 'dana' ? 'fiche de Dana' : 'fiche d\'Ada');
  const email = p.best_contact?.email?.toLowerCase() ?? null;
  const verified = !!email && (p.emails ?? []).some((e) => e.email === email && e.mx);
  // Un grand compte sans e-mail publié reste joignable : LinkedIn et la fiche d'appel, préparés pour Channing.
  if (!verified && !key) return skip('pas d\'e-mail publié et vérifié');
  if (!['qualifie', 'a_contacter'].includes(p.stage)) return skip(`étape « ${p.stage} »`);
  if (role === 'ada' && (p.country ?? '').toUpperCase() === HOME_COUNTRY) return skip('garage en France : MC Export y achète, Ada ne lui vend pas');
  // Une adresse de l'entreprise (ou son domaine) sur « ne plus contacter » vaut pour toute l'entreprise, et pour les deux agentes.
  const blocked = suppressionMatch([email ?? '', ...(p.emails ?? []).map((e) => e.email)], await loadSuppressions());
  if (blocked) return skip(`${blocked} est sur « ne plus contacter »`);
  const { data: t1 } = await sb.from('agent_threads').select('id').eq('prospect_id', p.id).limit(1);
  // En conversation avec l'une ou l'autre agente : pas de premier contact à froid.
  const { data: t2 } = email ? await sb.from('agent_threads').select('id').eq('counterpart_email', email).limit(1) : { data: [] };
  if (((t1 ?? []) as unknown[]).length || ((t2 ?? []) as unknown[]).length) return skip('déjà en conversation');
  const conflict = await groupConflict(a.agent, p, key);
  if (conflict) return skip(conflict);

  // 2. Le matériel
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  // Son stock sur tous les sites où ADA le voit (fiches rapprochées) ; la fiche principale d'abord.
  const ids = p.dealer_id ? await dealerGroupIds(p.dealer_id) : [];
  const { data: lRows } = ids.length
    ? await sb.from('market_dealer_listings').select('listing_url, brand, model, title, year, mileage, price_eur').in('dealer_id', ids).gte('last_seen_at', since).limit(1000)
    : { data: [] };
  const listings = (lRows ?? []) as DealerListingLite[];
  const byBrand = new Map<string, number>();
  const models = new Map<string, number>();
  for (const l of listings) {
    if (l.brand) byBrand.set(l.brand, (byBrand.get(l.brand) ?? 0) + 1);
    if (l.brand && l.model) models.set(`${nice(l.brand)} ${l.model}`, (models.get(`${nice(l.brand)} ${l.model}`) ?? 0) + 1);
  }
  const brandsTop = [...byBrand].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([brand, n]) => ({ brand: nice(brand), n }));
  const language = p.language || LANG_OF_COUNTRY[(p.country ?? '').toUpperCase()] || 'en';
  const contact = { name: p.best_contact?.nom ?? null, role: p.best_contact?.fonction ?? null };
  // Une entreprise trouvée par recherche web : son type de compte, sa taille, pourquoi elle compte.
  let account: AccountFacts | null = null;
  if (p.account_id) {
    const { data: acc } = await sb.from('agent_accounts').select('segment, size_hint, why').eq('id', p.account_id).maybeSingle();
    const x = acc as { segment: string; size_hint: string | null; why: string | null } | null;
    if (x) account = { segment: segmentOf(role, x.segment)?.label ?? x.segment, size: x.size_hint, why: x.why };
  }
  let base: string;
  let lots: LotFact[] = [];
  if (role === 'dana') {
    // Les lots relus à l'instant (un lot vendu depuis la qualification ne doit pas être cité).
    lots = ids.length ? await lotsOfDealer(ids[0], listings, normalizeDanaTargets(a.targets)) : [];
    if (lots.length === 0 && !key && !p.account_id) return skip('plus de lot de véhicules identiques en ligne');
    base = danaFirstMailPrompt({
      company: p.name, country: p.country, city: p.city, language, contact, kind: p.kind, group: p.group_name, summary: p.summary,
      stock: { listings: listings.length, byBrand: brandsTop }, lots: lots.slice(0, 4).map((l) => lotLine(l, false)), account, instructions: a.instructions ?? '',
    });
  } else {
    const vat = countryVat((p.country ?? 'FR').toUpperCase());
    const offers = await loadOffers();
    const opps = opportunities(listings, offers, vat).slice(0, 3);
    const gaps = opps.map((o) => `leur ${nice(o.listing.brand ?? '')} ${o.listing.model ?? ''} ${o.listing.year ?? ''}${o.listing.mileage != null ? ` (${o.listing.mileage.toLocaleString('fr-FR')} km)` : ''} affiché ${eur(o.listing.price_eur ?? 0)} TTC ; notre ${o.offer.title}${o.offer.year ? ` ${o.offer.year}` : ''}${o.offer.km != null ? ` (${o.offer.km.toLocaleString('fr-FR')} km)` : ''} ≈ ${eur(o.ourTtc)} TVA de son pays comprise, environ ${o.gapPct} % de moins`);
    const theirBrands = new Set([...byBrand.keys()].map(brandKey));
    // Sans annonces suivies (entreprise trouvée par recherche, flotte) : nos offres du moment.
    const shownOffers = listings.length
      ? [...new Set([...opps.map((o) => o.offer), ...offers.filter((o) => theirBrands.has(brandKey(o.brand)))])].slice(0, 4)
      : offers.slice(0, 4);
    const offerFacts: OfferFact[] = shownOffers.map((o) => ({ title: o.title, year: o.year, km: o.km, priceHt: o.priceHt, withVat: o.priceHt ? Math.round(o.priceHt * (1 + vat)) : null }));
    base = firstMailPrompt({
      company: p.name, country: p.country, city: p.city, language, contact,
      kind: p.kind, group: p.group_name, officialBrands: p.brands_official ?? [], summary: p.summary,
      stock: { listings: listings.length, byBrand: brandsTop, models: [...models].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([m, n]) => `${m} (${n})`) },
      account, gaps, offers: offerFacts, instructions: a.instructions ?? '',
    });
  }
  const people = [
    ...(p.best_contact?.nom ? [{ nom: p.best_contact.nom, fonction: p.best_contact.fonction ?? null, linkedin: p.best_contact.linkedin ?? null }] : []),
    ...(p.people ?? []).filter((x) => x.nom && x.nom !== p.best_contact?.nom).map((x) => ({ nom: x.nom, fonction: x.fonction ?? null, linkedin: x.linkedin ?? null })),
  ];
  const prompt = key ? keyAccountPrompt(base, people) : base;

  // 3. Opus 5.5
  let out: KeyAccountOutput | FirstMailOutput;
  let cost = 0;
  try {
    const budget = Number(a.daily_budget_usd);
    const r = await callClaude<KeyAccountOutput | FirstMailOutput>({
      agent: a.agent, budgetUsd: Number.isFinite(budget) ? budget : 0, purpose: key ? 'grand_compte' : 'premier_mail', model: OPUS,
      system: key ? keyAccountSystem(role) : role === 'dana' ? DANA_FIRST_MAIL_SYSTEM : FIRST_MAIL_SYSTEM, user: prompt,
      schema: (key ? KEY_ACCOUNT_SCHEMA : FIRST_MAIL_SCHEMA) as unknown as Record<string, unknown>,
      maxTokens: key ? 10_000 : 8000, effort: 'medium', prospectId: p.id, taskId, fallbacks: true,
    });
    out = r.data as KeyAccountOutput | FirstMailOutput;
    cost = r.costUsd;
  } catch (e) {
    if (e instanceof BudgetReached || e instanceof AiUnavailable) throw e;
    return { status: 'echec', name: p.name, detail: e instanceof Error ? e.message : String(e), cost: 0 };
  }
  if (!out?.objet?.trim() || !out?.corps?.trim()) return { status: 'echec', name: p.name, detail: 'brouillon vide', cost };
  const check: DraftCheck = key ? checkKeyAccount(out as KeyAccountOutput, prompt, role) : role === 'dana' ? checkDanaMail(out, prompt) : checkFirstMail(out, prompt);
  const subject = out.objet.trim().slice(0, 200);
  const notes = { modele: OPUS, cout_usd: Math.round(cost * 10_000) / 10_000, langue: language, mots: check.words, faits: (out.faits ?? []).slice(0, 12), alertes: check.warnings };

  // 4. Le fil, et le brouillon à valider — ou, pour un grand compte, ce que Channing envoie lui-même
  const { data: th, error: e1 } = await sb.from('agent_threads').insert({
    agent: a.agent, mailbox: a.mailbox, subject, counterpart_email: verified ? email : null, counterpart_name: p.best_contact?.nom ?? null,
    prospect_id: p.id, network_contact_id: p.network_contact_id,
  }).select('id');
  const threadId = ((th ?? []) as Array<{ id: string }>)[0]?.id;
  if (e1 || !threadId) return { status: 'echec', name: p.name, detail: `fil non créé : ${e1?.message ?? '?'}`, cost };
  const rows: Array<Record<string, unknown>> = [];
  const common = { thread_id: threadId, agent: a.agent, mailbox: a.mailbox, direction: 'out', kind: 'premier_contact', author: a.agent };
  if (key) {
    const k = out as KeyAccountOutput;
    const target = people.find((x) => x.linkedin) ?? null;
    const linkedinUrl = target?.linkedin ?? null;
    const card = {
      ...notes, grand_compte: true, fiche_appel: k.fiche_appel ?? null,
      linkedin_url: linkedinUrl, linkedin_nom: target?.nom ?? null,
      linkedin_recherche: linkedinUrl ? null : linkedinSearchUrl(p.group_name || p.name, role, language, p.best_contact?.nom ?? null),
    };
    const translation = language === 'fr' ? null : (k.traduction_fr ?? null);
    // Le mail seulement vers une adresse publiée et vérifiée (Channing : « publiées seulement + LinkedIn »).
    if (verified) rows.push({ ...common, channel: 'mail', status: 'pour_channing', to_emails: [email], subject, body_text: k.corps.trim(), translation_fr: translation, ai_notes: card });
    if ((k.linkedin ?? '').trim()) {
      rows.push({
        ...common, channel: 'linkedin', status: 'pour_channing', to_emails: [], subject: `LinkedIn — ${target?.nom ?? p.best_contact?.nom ?? p.group_name ?? p.name}`.slice(0, 200),
        body_text: k.linkedin.trim(), translation_fr: translation, ai_notes: card,
      });
    }
  } else {
    rows.push({
      ...common, channel: 'mail', status: 'a_valider', to_emails: [email], subject, body_text: withAgentSignature(out.corps, a.signature ?? ''),
      translation_fr: language === 'fr' ? null : (out.traduction_fr ?? null), ai_notes: notes,
    });
  }
  const { data: msg, error: e2 } = rows.length ? await sb.from('agent_messages').insert(rows).select('id') : { data: [], error: { message: 'ni mail ni note LinkedIn' } };
  const messageId = ((msg ?? []) as Array<{ id: string }>)[0]?.id;
  if (e2 || !messageId) {
    await sb.from('agent_threads').delete().eq('id', threadId);
    return { status: 'echec', name: p.name, detail: `brouillon non enregistré : ${e2?.message ?? '?'}`, cost };
  }
  await sb.from('agent_threads').update({ last_message_at: new Date().toISOString(), last_direction: 'out' }).eq('id', threadId);
  if (p.stage === 'qualifie') await sb.from('agent_prospects').update({ stage: 'a_contacter', updated_at: new Date().toISOString() }).eq('id', p.id);
  const points = check.warnings.length ? ` — ${check.warnings.length} point${check.warnings.length > 1 ? 's' : ''} à vérifier` : '';
  await journal({
    agent: a.agent, actor: a.agent, kind: key ? 'grand_compte' : 'premier_mail', threadId, messageId,
    summary: key
      ? `Grand compte ${p.name} (${p.country ?? '?'}) préparé pour vous : ${verified ? `mail à ${email}, ` : ''}note LinkedIn et fiche d'appel${points}`
      : `Premier mail rédigé pour ${p.name} (${p.country ?? '?'}) → ${email}, à valider${points}`,
    details: { prospect_id: p.id, cost_usd: Math.round(cost * 10_000) / 10_000, langue: language, grand_compte: key, lots: lots.length, compte: p.account_id ?? null },
  });
  return { status: 'redige', name: p.name, detail: key ? `grand compte, pour vous${verified ? ` (${email})` : ''}` : email ?? '', cost, threadId };
}

/**
 * Les prochains prospects à qui écrire d'office : qualifiés, au-dessus du
 * seuil, jamais contactés ; un petit compte avec un e-mail vérifié (`small`),
 * un grand compte même sans e-mail (`big` : préparé pour Channing).
 */
export async function nextDraftCandidates(a: AiAgent, limit: number, allow: { small: boolean; big: boolean } = { small: true, big: true }): Promise<string[]> {
  const { data } = await sb.from('agent_prospects').select('*')
    .eq('agent', a.agent).eq('stage', 'qualifie').gte('score', a.map_min_score ?? 70).order('score', { ascending: false }).limit(40);
  const rows = ((data ?? []) as ProspectRow[])
    // Ada vend à l'export : un garage français (qualifié avant le 17/10) n'est pas un acheteur.
    .filter((r) => a.agent !== 'ada' || (r.country ?? '').toUpperCase() !== HOME_COUNTRY);
  const suppressed = await loadSuppressions();
  // Les groupes traités en grand compte : leurs sites n'ont pas de mail à part (vide tant que le SQL agents_comptes n'est pas collé).
  const { data: kg } = await sb.from('agent_prospects').select('group_name').eq('agent', a.agent).eq('key_account', true).neq('stage', 'ecarte').limit(1000);
  const keyGroups = new Set(((kg ?? []) as Array<{ group_name: string | null }>).map((r) => groupKey(r.group_name)).filter((g) => g.length >= 3));
  const out: string[] = [];
  const groups = new Set<string>();
  for (const r of rows) {
    const key = r.key_account === true;
    if (key ? !allow.big : !allow.small) continue;
    const email = r.best_contact?.email?.toLowerCase();
    const verified = !!email && (r.emails ?? []).some((e) => e.email === email && e.mx);
    if (!verified && !key) continue;
    if (suppressionMatch([email ?? '', ...(r.emails ?? []).map((e) => e.email)], suppressed)) continue;
    // Deux fiches du même groupe dans la même série : une seule ; un site d'un groupe traité en grand compte : aucune.
    const g = groupKey(r.group_name);
    if (g.length >= 3 && (groups.has(g) || (!key && keyGroups.has(g)))) continue;
    const { data: th } = await sb.from('agent_threads').select('id').eq('prospect_id', r.id).limit(1);
    if (((th ?? []) as unknown[]).length) continue;
    if (g.length >= 3) groups.add(g);
    out.push(r.id);
    if (out.length >= limit) break;
  }
  return out;
}
