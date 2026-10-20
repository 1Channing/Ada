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
 *   préparent, vous envoyez ») : Opus 5.5 prépare le mail (s'il y a un e-mail
 *   publié et vérifié ; écrit sans nommer l'expéditeur), la note d'invitation
 *   LinkedIn et la fiche d'appel ; ils entrent dans « Pour vous » : « Envoyer »
 *   fait partir le mail de la boîte de l'agente, signé par elle (18/10), ou
 *   Channing l'envoie de sa boîte et le marque envoyé ; la note LinkedIn et
 *   l'appel restent à lui.
 * L'adresse du mail est dite à Opus (18/10) : celle de la personne, d'un
 * service, ou une adresse générale — on demande alors de transmettre.
 * 19/10 (Channing, après le test DMD) :
 * - sans adresse directe (rien, ou seulement contact@) : pas de
 *   présentation dans le vide, un MAIL D'AIGUILLAGE à quelqu'un de joignable
 *   (un commercial d'un site, sinon le service, sinon l'adresse générale)
 *   pour obtenir le contact direct ; il arrive marqué dans « À valider » ;
 * - une entreprise que l'équipe connaît déjà (carte, Workflow, copies…)
 *   n'a pas de premier mail d'office — à la main, si Channing le demande ;
 * - l'adresse probable (format prouvé) seulement sur le clic d'un
 *   administrateur ;
 * - droit au but : un mail qui récite les chiffres du prospect est signalé ;
 *   le texte d'origine est gardé (ai_notes.texte_initial) pour apprendre des
 *   corrections.
 * Rien ne part sans le clic d'un administrateur ; l'envoi par la boîte de
 * l'agente respecte les horaires, le plafond du jour et l'étalement.
 */
import { OPUS } from '../../src/lib/agents/aiCost';
import {
  FIRST_MAIL_SYSTEM, FIRST_MAIL_SCHEMA, firstMailPrompt, checkFirstMail, withAgentSignature, LANG_OF_COUNTRY,
  DANA_FIRST_MAIL_SYSTEM, danaFirstMailPrompt, checkDanaMail, keyAccountSystem, KEY_ACCOUNT_SCHEMA, keyAccountPrompt, checkKeyAccount, linkedinSearchUrl,
  type FirstMailOutput, type KeyAccountOutput, type OfferFact, type DraftCheck, type AccountFacts,
  routingSystem, routingPrompt, ROUTING_SCHEMA, checkRouting, pickRouter, routingWanted, theirFigures, type RoutingOutput, type RouterPick,
  planPeople, notesOf, type NoteTarget,
} from '../../src/lib/agents/firstMail';
import { samePerson } from '../../src/lib/agents/people';
import { teamKnownOf, TEAM_SOURCE_LABEL, type TeamSource } from '../../src/lib/agents/teamMemory';
import { lessonsBlock } from './lessons';
import { segmentOf } from '../../src/lib/agents/research';
import { opportunities, brandKey, type DealerListingLite } from '../../src/lib/agents/opportunity';
import { lotLine, normalizeDanaTargets, groupKey, type LotFact } from '../../src/lib/agents/sourcing';
import { countryVat } from '../../src/lib/offers/vat';
import { suppressionMatch } from '../../src/lib/agents/sendPolicy';
import { callClaude, BudgetReached, AiUnavailable } from './claude';
import { live } from './live';
import { loadOffers, dealerGroupIds, lotsOfDealer, type AiAgent } from './qualify';
import { HOME_COUNTRY, addressKind, type AddressKind } from '../../src/lib/agents/qualification';
import { sb, journal, loadSuppressions } from './store';
import { dropPrepared } from './prepared';
import { isSetAside } from '../../src/lib/agents/setAside';

interface Person { nom: string; fonction: string; email: string | null; linkedin?: string | null; niveau?: string | null; perimetre?: string | null; connu?: boolean; via?: string | null; email_probable?: string | null; motif?: string | null }
interface ProspectRow {
  id: string; agent: string; dealer_id: string | null; name: string; country: string | null; city: string | null;
  group_name: string | null; kind: string | null; brands_official: string[] | null; language: string | null; summary: string | null;
  stage: string; score: number | null; network_contact_id: string | null;
  best_contact: { nom: string | null; fonction: string | null; email: string | null; linkedin?: string | null } | null;
  emails: Array<{ email: string; mx: boolean; nature?: string }> | null;
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

export interface DraftOptions {
  /** Demandé par une personne (un clic) : une entreprise que l'équipe connaît déjà peut quand même recevoir un mail. */
  manual?: boolean;
  /** Après un aiguillage réussi (19/10) : le fil de l'aiguillage n'empêche pas le premier mail à la personne donnée. */
  afterRouting?: boolean;
  /** L'adresse probable choisie par un administrateur (19/10) : le mail lui est écrit, marqué comme tel. */
  probable?: { email: string; motif: string } | null;
  /** 20/10 : les fils de la préparation d'avant (rien d'envoyé, rien de corrigé), remplacés une fois la nouvelle enregistrée. */
  replacing?: string[];
}

export async function draftFirstMail(prospectId: string, a: AiAgent, taskId: string | null, opts: DraftOptions = {}): Promise<DraftOutcome> {
  const { data } = await sb.from('agent_prospects').select('*').eq('id', prospectId).maybeSingle();
  const p = data as ProspectRow | null;
  if (!p) return { status: 'echec', name: prospectId, detail: 'prospect introuvable', cost: 0 };
  const skip = (detail: string): DraftOutcome => ({ status: 'ignore', name: p.name, detail, cost: 0 });
  const role: 'ada' | 'dana' = a.agent === 'dana' ? 'dana' : 'ada';
  const key = p.key_account === true;

  // 1. Garde-fous
  if (p.agent !== a.agent) return skip(p.agent === 'dana' ? 'fiche de Dana' : 'fiche d\'Ada');
  const probable = opts.probable?.email ? { email: opts.probable.email.trim().toLowerCase(), motif: opts.probable.motif } : null;
  const email = probable?.email ?? p.best_contact?.email?.toLowerCase() ?? null;
  const verified = !!probable || (!!email && (p.emails ?? []).some((e) => e.email === email && e.mx));
  // 19/10 : sans adresse directe (rien, ou une adresse générale), un aiguillage plutôt qu'une présentation dans le vide.
  const kind = verified && email ? (probable ? 'personne' : addressKind(email, (p.emails ?? []).find((e) => e.email === email)?.nature, p.best_contact?.nom)) : null;
  const bestDirect = verified && kind !== 'generique';
  // 20/10 (Channing, sur Agilauto : « qu'elle prépare tout le plan, qu'on n'ait plus qu'à valider ») : un grand compte —
  // les personnes du plan (qui traite, qui décide, le contact retenu). Le contact retenu sans adresse directe : une
  // personne du plan qui en a une reçoit le mail ; sinon l'aiguillage, ET le mail à l'adresse probable (format prouvé)
  // d'une personne du plan — marqué, que seul un administrateur envoie. D'abord une personne de l'entreprise même : le
  // format prouvé est souvent celui de la filiale (chez Agilauto, l'adresse du directeur commercial), un pari pour un directeur du groupe.
  const plan = key ? planPeople((p.people ?? []) as Person[], p.best_contact, (p.emails ?? []).map((e) => ({ email: e.email, nature: e.nature ?? null, mx: e.mx })), addressKind) : [];
  const planDirect = !bestDirect ? plan.find((x) => x.email) ?? null : null;
  const router: RouterPick | null = !bestDirect && !planDirect ? pickRouter((p.people ?? []) as Person[], (p.emails ?? []).map((e) => ({ email: e.email, nature: e.nature ?? 'autre', mx: e.mx })), p.best_contact, addressKind) : null;
  const planProbable = !bestDirect && !planDirect ? plan.find((x) => x.probable && !x.groupe) ?? plan.find((x) => x.probable) ?? null : null;
  const mailTo: { nom: string | null; fonction: string | null; email: string; address: AddressKind; probable: { email: string; motif: string } | null } | null = planDirect?.email
    ? { nom: planDirect.nom, fonction: planDirect.fonction, email: planDirect.email, address: 'personne', probable: null }
    : bestDirect && email && kind
      ? { nom: p.best_contact?.nom ?? null, fonction: p.best_contact?.fonction ?? null, email, address: kind, probable }
      : planProbable?.probable
        ? { nom: planProbable.nom, fonction: planProbable.fonction, email: planProbable.probable.email, address: 'personne', probable: planProbable.probable }
        : null;
  // Un grand compte sans e-mail publié reste joignable : LinkedIn et la fiche d'appel, préparés pour Channing.
  if (!router && !mailTo && !key) return skip('pas d\'adresse directe, ni personne à qui demander le bon contact');
  if (!['qualifie', 'a_contacter'].includes(p.stage)) return skip(isSetAside(p) ? 'fiche mise de côté par l\'équipe' : `étape « ${p.stage} »`);
  if (role === 'ada' && (p.country ?? '').toUpperCase() === HOME_COUNTRY) return skip('garage en France : MC Export y achète, Ada ne lui vend pas');
  // 19/10 : une entreprise que l'équipe connaît déjà n'a pas de mail à froid d'office.
  const known = teamKnownOf(p.people);
  if (known.length && !opts.manual && !opts.afterRouting) {
    return skip(`déjà connue de l'équipe : ${known.slice(0, 2).map((x) => `${x.nom}${x.via ? ` (${TEAM_SOURCE_LABEL[x.via as TeamSource] ?? x.via})` : ''}`).join(', ')} — pas de premier mail d'office`);
  }
  // Une adresse de l'entreprise (ou son domaine) sur « ne plus contacter » vaut pour toute l'entreprise, et pour les deux agentes.
  const target = router?.email ?? mailTo?.email ?? email;
  const blocked = suppressionMatch([target ?? '', email ?? '', mailTo?.email ?? '', ...(p.emails ?? []).map((e) => e.email)], await loadSuppressions());
  if (blocked) return skip(`${blocked} est sur « ne plus contacter »`);
  // En conversation avec l'une ou l'autre agente : pas de premier contact à froid (sauf la personne donnée par un aiguillage) ;
  // la préparation qu'on refait ne compte pas.
  const replaced = new Set(opts.replacing ?? []);
  const others = (rows: unknown) => ((rows ?? []) as Array<{ id: string }>).filter((x) => !replaced.has(x.id)).length;
  const { data: t1 } = await sb.from('agent_threads').select('id').eq('prospect_id', p.id).limit(10);
  const targets = [...new Set([router?.email, mailTo?.email].filter((x): x is string => !!x))];
  const { data: t2 } = targets.length ? await sb.from('agent_threads').select('id').in('counterpart_email', targets).limit(10) : { data: [] };
  if ((!opts.afterRouting && others(t1)) || others(t2)) return skip('déjà en conversation');
  const conflict = opts.afterRouting ? null : await groupConflict(a.agent, p, key);
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
  // L'adresse du mail et ce qu'elle est : celle de la personne, d'un service, ou une adresse générale (on demande alors de transmettre).
  const contact = {
    name: mailTo?.nom ?? p.best_contact?.nom ?? null, role: mailTo ? mailTo.fonction : p.best_contact?.fonction ?? null,
    email: mailTo?.email ?? null, address: mailTo?.address ?? null,
  };
  // Une entreprise trouvée par recherche web : son type de compte, sa taille, pourquoi elle compte.
  let account: AccountFacts | null = null;
  let segKey: string | null = null;
  if (p.account_id) {
    const { data: acc } = await sb.from('agent_accounts').select('segment, size_hint, why').eq('id', p.account_id).maybeSingle();
    const x = acc as { segment: string; size_hint: string | null; why: string | null } | null;
    if (x) { account = { segment: segmentOf(role, x.segment)?.label ?? x.segment, size: x.size_hint, why: x.why }; segKey = x.segment; }
  }
  // 19/10 : les leçons de Channing pour écrire.
  const lessons = await lessonsBlock(a.agent, 'mail', { segment: segKey, kind: p.kind, country: p.country });
  const withLessons = (prompt: string) => (lessons.length ? `${prompt}\n\n${lessons.join('\n')}` : prompt);
  let base: string;
  let lots: LotFact[] = [];
  let ours: string[] = [];
  if (role === 'dana') {
    // Les lots relus à l'instant (un lot vendu depuis la qualification ne doit pas être cité).
    lots = ids.length ? await lotsOfDealer(ids[0], listings, normalizeDanaTargets(a.targets)) : [];
    if (lots.length === 0 && !key && !p.account_id) return skip('plus de lot de véhicules identiques en ligne');
    const lotLines = lots.slice(0, 4).map((l) => lotLine(l, false));
    ours = lotLines;
    base = danaFirstMailPrompt({
      company: p.name, country: p.country, city: p.city, language, contact, kind: p.kind, group: p.group_name, summary: p.summary,
      stock: { listings: listings.length, byBrand: brandsTop }, lots: lotLines, account, instructions: a.instructions ?? '',
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
    ours = [...gaps, ...offerFacts.map((o) => `${o.title} ${o.year ?? ''} ${o.km ?? ''} ${o.priceHt ?? ''} ${o.withVat ?? ''}`)];
    base = firstMailPrompt({
      company: p.name, country: p.country, city: p.city, language, contact,
      kind: p.kind, group: p.group_name, officialBrands: p.brands_official ?? [], summary: p.summary,
      stock: { listings: listings.length, byBrand: brandsTop, models: [...models].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([m, n]) => `${m} (${n})`) },
      account, gaps, offers: offerFacts, instructions: a.instructions ?? '',
    });
  }
  // 19/10 : les chiffres de l'entreprise elle-même (taille, volumes…) — un mail qui les récite est signalé.
  const figures = theirFigures([p.summary, account?.size, account?.why], ours);
  const people = [
    ...(p.best_contact?.nom ? [{ nom: p.best_contact.nom, fonction: p.best_contact.fonction ?? null, linkedin: p.best_contact.linkedin ?? null }] : []),
    ...(p.people ?? []).filter((x) => x.nom && x.nom !== p.best_contact?.nom && !x.connu).map((x) => ({ nom: x.nom, fonction: x.fonction ?? null, linkedin: x.linkedin ?? null })),
  ];
  // Les notes LinkedIn du plan : une par personne dont le profil a été vu (3 au plus) ; sinon une, pour la première du plan.
  const withProfile = plan.filter((x) => x.linkedin);
  const noteTargets: NoteTarget[] = (withProfile.length ? withProfile.slice(0, 3) : plan.slice(0, 1)).map((x) => ({ nom: x.nom, fonction: x.fonction, role: x.role }));
  const prompt = withLessons(key ? keyAccountPrompt(base, people, noteTargets) : base);
  const budget = Number(a.daily_budget_usd);

  // 3a. L'aiguillage (19/10) : pas d'adresse directe — un mail court pour obtenir le bon contact.
  let routing: { row: Record<string, unknown>; subject: string; cost: number; warnings: number } | null = null;
  if (router) {
    live(taskId, `${p.name} : pas d'adresse directe — mail d'aiguillage à ${router.name ?? router.email} pour obtenir le bon contact (IA)`);
    const wanted = routingWanted(role, segKey ?? p.kind);
    const targetName = p.best_contact?.nom ?? null;
    const rp = withLessons(routingPrompt({
      role, company: p.name, country: p.country, language, router, target: { name: targetName, role: p.best_contact?.fonction ?? null }, wanted, instructions: a.instructions ?? '',
    }));
    let ro: RoutingOutput | null = null;
    let rcost = 0;
    try {
      const r = await callClaude<RoutingOutput>({
        agent: a.agent, budgetUsd: Number.isFinite(budget) ? budget : 0, purpose: 'aiguillage', model: OPUS,
        system: routingSystem(role), user: rp, schema: ROUTING_SCHEMA as unknown as Record<string, unknown>,
        maxTokens: 3000, effort: 'low', prospectId: p.id, taskId, fallbacks: true,
      });
      ro = r.data;
      rcost = r.costUsd;
    } catch (e) {
      if (e instanceof BudgetReached || e instanceof AiUnavailable) throw e;
      return { status: 'echec', name: p.name, detail: e instanceof Error ? e.message : String(e), cost: 0 };
    }
    if (!ro?.objet?.trim() || !ro?.corps?.trim()) return { status: 'echec', name: p.name, detail: 'aiguillage vide', cost: rcost };
    const rc = checkRouting(ro, role);
    const rsubject = ro.objet.trim().slice(0, 200);
    routing = {
      subject: rsubject, cost: rcost, warnings: rc.warnings.length,
      row: {
        channel: 'mail', status: 'a_valider', to_emails: [router.email], subject: rsubject, body_text: withAgentSignature(ro.corps, a.signature ?? ''),
        translation_fr: language === 'fr' ? null : (ro.traduction_fr ?? null),
        ai_notes: {
          modele: OPUS, cout_usd: Math.round(rcost * 10_000) / 10_000, langue: language, mots: rc.words, faits: [], alertes: rc.warnings, texte_initial: ro.corps.trim(),
          aiguillage: {
            cible: targetName ? `${targetName}${p.best_contact?.fonction ? ` — ${p.best_contact.fonction}` : ''}` : null, cherche: wanted,
            routeur: router.name, routeur_fonction: router.role, adresse: router.address,
          },
        },
      },
    };
  }

  // 3b. Opus 5.5 : le premier mail (adresse directe), ou la préparation d'un grand compte (note LinkedIn, fiche d'appel ; le mail seulement vers une adresse directe).
  let out: KeyAccountOutput | FirstMailOutput | null = null;
  let cost = routing?.cost ?? 0;
  let check: DraftCheck = { words: 0, warnings: [] };
  if (!routing || key) {
    live(taskId, key ? `${p.name} : grand compte — le plan préparé pour vous : ${mailTo ? 'mail, ' : ''}notes LinkedIn et fiche d'appel (IA)` : `${p.name} : rédaction du premier mail (IA)`);
    try {
      const r = await callClaude<KeyAccountOutput | FirstMailOutput>({
        agent: a.agent, budgetUsd: Number.isFinite(budget) ? budget : 0, purpose: key ? 'grand_compte' : 'premier_mail', model: OPUS,
        system: key ? keyAccountSystem(role) : role === 'dana' ? DANA_FIRST_MAIL_SYSTEM : FIRST_MAIL_SYSTEM, user: prompt,
        schema: (key ? KEY_ACCOUNT_SCHEMA : FIRST_MAIL_SCHEMA) as unknown as Record<string, unknown>,
        maxTokens: key ? 10_000 : 8000, effort: 'medium', prospectId: p.id, taskId, fallbacks: true,
      });
      out = r.data as KeyAccountOutput | FirstMailOutput;
      cost += r.costUsd;
    } catch (e) {
      if (e instanceof BudgetReached || e instanceof AiUnavailable) throw e;
      if (!routing) return { status: 'echec', name: p.name, detail: e instanceof Error ? e.message : String(e), cost: 0 };
      out = null;
    }
    if (!routing && (!out?.objet?.trim() || !out?.corps?.trim())) return { status: 'echec', name: p.name, detail: 'brouillon vide', cost };
    if (out?.objet?.trim() && out?.corps?.trim()) {
      live(taskId, `${p.name} : contrôle du mail (chaque fait vient d'ADA, aucun prix inventé, droit au but)`);
      check = key ? checkKeyAccount(out as KeyAccountOutput, prompt, role, figures) : role === 'dana' ? checkDanaMail(out, prompt, figures) : checkFirstMail(out, prompt, figures);
    }
  }
  const subject = (routing?.subject ?? out?.objet ?? p.name).trim().slice(0, 200);
  const notes = {
    modele: OPUS, cout_usd: Math.round((cost - (routing?.cost ?? 0)) * 10_000) / 10_000, langue: language, mots: check.words, faits: (out?.faits ?? []).slice(0, 12), alertes: check.warnings,
    texte_initial: out?.corps?.trim() ?? null,
    // 19/10 : l'adresse probable, choisie par un administrateur.
    ...(probable ? { adresse_probable: probable.email, motif_adresse: probable.motif, alertes: [`Adresse probable, non publiée (${probable.motif}) : un rebond abîme la réputation de mc-export.com.`, ...check.warnings] } : {}),
  };

  // 4. Le fil, et le brouillon à valider — ou, pour un grand compte, ce que Channing envoie lui-même
  const own = { agent: a.agent, mailbox: a.mailbox, direction: 'out', kind: 'premier_contact', author: a.agent };
  const routingRows: Array<Record<string, unknown>> = routing ? [{ ...own, ...routing.row }] : [];
  const planRows: Array<Record<string, unknown>> = [];
  const mailSubject = (out?.objet?.trim() || subject).slice(0, 200);
  let liNotes: Array<{ nom: string | null; note: string; url: string | null }> = [];
  if (key && out) {
    const k = out as KeyAccountOutput;
    // Chaque note à sa personne du plan : par son nom, sinon par son rang (les notes sont demandées dans l'ordre) ;
    // sans personne nommée, la note ne nomme personne (et la recherche LinkedIn se fait par le poste).
    liNotes = notesOf(k, noteTargets[0]?.nom ?? p.best_contact?.nom ?? null).slice(0, Math.max(1, noteTargets.length)).map((n, i) => {
      const who = plan.find((x) => samePerson(x.nom, n.nom)) ?? plan.find((x) => x.nom === noteTargets[i]?.nom) ?? null;
      const nom = who?.nom ?? (noteTargets.length ? n.nom : null);
      return { nom, note: n.note, url: who?.linkedin ?? (samePerson(nom, p.best_contact?.nom) ? p.best_contact?.linkedin ?? null : null) };
    });
    const card = { ...notes, grand_compte: true, fiche_appel: k.fiche_appel ?? null };
    const translation = language === 'fr' ? null : (k.traduction_fr ?? null);
    // Le mail : à une adresse directe publiée (Channing : « publiées seulement + LinkedIn »), ou — 20/10, le plan préparé —
    // à l'adresse probable de la personne du plan, marquée : un administrateur seul l'envoie (comme « Écrire à cette adresse »).
    if (mailTo && k.corps?.trim()) {
      const guessed = mailTo.probable && !probable
        ? { adresse_probable: mailTo.probable.email, motif_adresse: mailTo.probable.motif, alertes: [`Adresse probable, non publiée (${mailTo.probable.motif}) : seul un administrateur l'envoie ; un rebond abîme la réputation de mc-export.com.`, ...check.warnings] }
        : {};
      planRows.push({ ...own, channel: 'mail', status: 'pour_channing', to_emails: [mailTo.email], subject: mailSubject, body_text: k.corps.trim(), translation_fr: translation, ai_notes: { ...card, personne: mailTo.nom, ...guessed } });
    }
    // Une note par personne du plan, avec son profil (ou la recherche LinkedIn de son nom).
    for (const n of liNotes) {
      planRows.push({
        ...own, channel: 'linkedin', status: 'pour_channing', to_emails: [], subject: `LinkedIn — ${n.nom ?? p.group_name ?? p.name}`.slice(0, 200),
        body_text: n.note, translation_fr: translation,
        // Son texte d'origine : la note (pas le mail) — une note corrigée apprend une leçon, une note envoyée telle quelle non.
        ai_notes: { ...card, texte_initial: n.note, personne: n.nom, linkedin_url: n.url, linkedin_nom: n.nom, linkedin_recherche: n.url ? null : linkedinSearchUrl(p.group_name || p.name, role, language, n.nom) },
      });
    }
  } else if (!routing && out && mailTo) {
    planRows.push({
      ...own, channel: 'mail', status: 'a_valider', to_emails: [mailTo.email], subject: mailSubject, body_text: withAgentSignature(out.corps, a.signature ?? ''),
      translation_fr: language === 'fr' ? null : (out.traduction_fr ?? null), ai_notes: notes,
    });
  }
  // 20/10 : l'aiguillage et le mail à une autre personne sont deux conversations, deux fils : dans le fil de l'aiguillage,
  // le mail à celle qui traite partirait en réponse au mail à l'aiguilleur (et sa réponse arriverait dans ce fil-là).
  const mailRow = planRows.find((r) => r.channel === 'mail') ?? null;
  const groups = routing && mailRow
    ? [
      { subject, email: router?.email ?? null, name: router?.name ?? null, rows: routingRows },
      { subject: mailSubject, email: mailTo?.email ?? null, name: mailTo?.nom ?? null, rows: planRows },
    ]
    : [{
      subject, email: routing ? router?.email ?? null : mailTo?.email ?? null, name: routing ? router?.name ?? null : mailTo?.nom ?? p.best_contact?.nom ?? null,
      rows: [...routingRows, ...planRows],
    }];
  if (!groups.some((g) => g.rows.length)) return { status: 'echec', name: p.name, detail: 'brouillon non enregistré : ni mail ni note LinkedIn', cost };
  const made: string[] = [];
  let messageId: string | undefined;
  for (const g of groups) {
    const { data: th, error: e1 } = await sb.from('agent_threads').insert({
      agent: a.agent, mailbox: a.mailbox, subject: g.subject, counterpart_email: g.email, counterpart_name: g.name, prospect_id: p.id, network_contact_id: p.network_contact_id,
    }).select('id');
    const id = ((th ?? []) as Array<{ id: string }>)[0]?.id;
    const { data: msg, error: e2 } = id ? await sb.from('agent_messages').insert(g.rows.map((r) => ({ ...r, thread_id: id }))).select('id') : { data: [], error: e1 };
    const first = ((msg ?? []) as Array<{ id: string }>)[0]?.id;
    if (id) made.push(id);
    if (e1 || e2 || !id || !first) {
      for (const x of made) { await sb.from('agent_messages').delete().eq('thread_id', x); await sb.from('agent_threads').delete().eq('id', x); }
      return { status: 'echec', name: p.name, detail: `${id ? 'brouillon non enregistré' : 'fil non créé'} : ${(e2 ?? e1)?.message ?? '?'}`, cost };
    }
    messageId ??= first;
    await sb.from('agent_threads').update({ last_message_at: new Date().toISOString(), last_direction: 'out' }).eq('id', id);
  }
  const threadId = made[0];
  // 20/10 : la préparation d'avant laisse la place, maintenant que la nouvelle est enregistrée (./prepared.ts).
  if (replaced.size) await dropPrepared([...replaced].filter((id) => !made.includes(id)));
  if (p.stage === 'qualifie') await sb.from('agent_prospects').update({ stage: 'a_contacter', updated_at: new Date().toISOString() }).eq('id', p.id);
  const warnings = check.warnings.length + (routing?.warnings ?? 0);
  const points = warnings ? ` — ${warnings} point${warnings > 1 ? 's' : ''} à vérifier` : '';
  const who = router ? (router.name ? `${router.name}${router.role ? ` (${router.role})` : ''}` : router.email) : '';
  const lookingFor = p.best_contact?.nom ?? `la personne qui ${routingWanted(role, segKey ?? p.kind)}`;
  const named = liNotes.map((n) => n.nom).filter(Boolean).join(', ');
  const prepared = [
    routing ? `aiguillage à ${who}` : null,
    mailTo && planRows.some((r) => r.channel === 'mail' && r.status === 'pour_channing') ? `mail à ${mailTo.nom ? `${mailTo.nom} (${mailTo.email}${mailTo.probable && !probable ? ', adresse probable' : ''})` : mailTo.email}` : null,
    liNotes.length ? `${liNotes.length > 1 ? `${liNotes.length} notes LinkedIn` : 'note LinkedIn'}${named ? ` (${named})` : ''}` : null,
    'fiche d\'appel',
  ].filter(Boolean).join(', ');
  await journal({
    agent: a.agent, actor: a.agent, kind: routing ? 'aiguillage' : key ? 'grand_compte' : 'premier_mail', threadId, messageId,
    summary: key
      ? `Grand compte ${p.name} (${p.country ?? '?'}) préparé pour vous : ${prepared}${points}`
      : routing
        ? `Aiguillage préparé pour ${p.name} (${p.country ?? '?'}) : à ${who}, pour obtenir le contact de ${lookingFor} — à valider${points}`
        : `Premier mail rédigé pour ${p.name} (${p.country ?? '?'}) → ${mailTo?.email ?? email}${probable ? ' (adresse probable)' : ''}, à valider${points}`,
    details: { prospect_id: p.id, cost_usd: Math.round(cost * 10_000) / 10_000, langue: language, grand_compte: key, lots: lots.length, compte: p.account_id ?? null, aiguillage: !!routing },
  });
  return {
    status: 'redige', name: p.name, cost, threadId,
    detail: routing ? `aiguillage à ${router?.email}${key ? ' ; grand compte pour vous' : ''}` : key ? `grand compte, pour vous${mailTo ? ` (${mailTo.email})` : ''}` : mailTo?.email ?? email ?? '',
  };
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
    // 19/10 : sans adresse directe, un aiguillage s'il y a quelqu'un à qui demander ; une entreprise connue de l'équipe attend.
    const direct = verified && addressKind(email as string, (r.emails ?? []).find((e) => e.email === email)?.nature, r.best_contact?.nom) !== 'generique';
    const routable = !direct && !!pickRouter((r.people ?? []) as Person[], (r.emails ?? []).map((e) => ({ email: e.email, nature: e.nature ?? 'autre', mx: e.mx })), r.best_contact, addressKind);
    if (!direct && !routable && !key) continue;
    if (teamKnownOf(r.people).length) continue;
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
