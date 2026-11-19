/**
 * LA CAMPAGNE DEPUIS LA CARTE (19/11, Channing : « dans DANA, j'aimerais qu'on puisse contacter les concessions de
 * ces groupes, et qu'on ait juste les e-mails à appuyer "envoyer", pour chaque e-mail bien cibler le contact, la
 * marque… contacter à grande échelle, chaque e-mail adapté, on appuie sur envoyer à la chaîne et on attend les
 * retours ; qu'on choisisse par pays et par marque » — « les envois doivent se faire manuellement, on enchaîne les
 * mails, on relit avec la traduction à côté, et on envoie ; pas d'appel à un call, juste une ouverture à la discussion »).
 *
 * Une tâche « premier_mail » avec params.campagne : pour chaque contact de la Carte (network_contacts) choisi, Dana
 * rédige un premier mail dans la langue du pays, adapté à ses marques et à ses modèles les plus présents (sa vitrine
 * relevée par ADA), avec nos véhicules des mêmes marques (sans prix) ; le mail est enregistré « à valider » dans un
 * fil rattaché au contact (network_contact_id), avec sa traduction française et l'identifiant de la campagne dans
 * ai_notes.campagne. Rien ne part d'ici : l'onglet Campagne de Dana fait valider un mail après l'autre, et la boîte
 * d'envoi (./outbox.ts) les envoie dans ses horaires, au rythme réglé, sous le plafond du jour.
 * Garde-fous : pas d'e-mail → ignoré ; adresse sur « ne plus contacter » → ignoré ; un fil déjà ouvert avec cette
 * adresse ou ce contact → ignoré (pas de doublon à froid).
 */
import { OPUS } from '../../src/lib/agents/aiCost';
import {
  CARTE_CAMPAIGN_SYSTEM, carteCampaignPrompt, checkCampaignMail, withAgentSignature, FIRST_MAIL_SCHEMA, LANG_OF_COUNTRY,
  type CarteCampaignMaterial, type FirstMailOutput,
} from '../../src/lib/agents/firstMail';
import { brandKey } from '../../src/lib/agents/opportunity';
import { addressKind } from '../../src/lib/agents/qualification';
import { suppressionMatch } from '../../src/lib/agents/sendPolicy';
import { callClaude, BudgetReached, AiUnavailable } from './claude';
import { live } from './live';
import { loadOffers, type AiAgent } from './qualify';
import { sb, journal, loadSuppressions } from './store';

interface Task { id: string; agent: string; kind: string; params: Record<string, unknown>; created_by: string | null }
export interface Campaign { id: string; pays: string; marques: string[]; consignes: string }
interface ContactRow {
  id: string; name: string; kind: string | null; country: string | null; city: string | null;
  contact_name: string | null; email: string | null; stock_total: number | null;
}
type Outcome = { status: 'redige' | 'ignore' | 'echec'; name: string; detail: string; cost: number; threadId?: string };

const KIND_FR: Record<string, string> = { concession: 'concession', loueur: 'loueur', leasing: 'société de leasing', trader: 'marchand', convoyeur: 'convoyeur', autre: 'professionnel' };

/** Ses marques et modèles en stock aujourd'hui (vitrine relevée par ADA), du plus présent au moins présent. */
async function stockOf(contactId: string): Promise<{ brands: Array<{ brand: string; n: number }>; models: Array<{ model: string; n: number }> }> {
  const { data } = await sb.from('network_stock_vehicles').select('brand, model').eq('contact_id', contactId).is('gone_at', null).limit(1000);
  const rows = (data ?? []) as Array<{ brand: string | null; model: string | null }>;
  const b = new Map<string, { brand: string; n: number }>();
  const m = new Map<string, { model: string; n: number }>();
  for (const r of rows) {
    const brand = (r.brand ?? '').trim();
    if (!brand) continue;
    const kb = brandKey(brand);
    (b.get(kb) ?? b.set(kb, { brand, n: 0 }).get(kb)!).n++;
    const model = (r.model ?? '').trim();
    if (!model) continue;
    const km = `${kb}|${model.toUpperCase()}`;
    (m.get(km) ?? m.set(km, { model: `${brand} ${model}`, n: 0 }).get(km)!).n++;
  }
  const by = (x: { n: number }, y: { n: number }) => y.n - x.n;
  return { brands: [...b.values()].sort(by).slice(0, 8), models: [...m.values()].sort(by).slice(0, 5) };
}

/** Nos véhicules en vente des mêmes marques, groupés par modèle — sans prix. */
async function oursFor(brands: string[]): Promise<string[]> {
  if (brands.length === 0) return [];
  const order = [...new Set(brands.map(brandKey))];
  const keys = new Set(order);
  const offers = (await loadOffers()).filter((o) => keys.has(brandKey(o.brand)));
  const by = new Map<string, { label: string; n: number; years: number[] }>();
  for (const o of offers) {
    const k = `${brandKey(o.brand)}|${o.model.toUpperCase()}`;
    const g = by.get(k) ?? by.set(k, { label: `${o.brand} ${o.model}`.trim(), n: 0, years: [] }).get(k)!;
    g.n++;
    if (o.year) g.years.push(o.year);
  }
  const rank = (label: string) => { const i = order.findIndex((k) => brandKey(label).startsWith(k)); return i < 0 ? order.length : i; };
  return [...by.values()].sort((x, y) => rank(x.label) - rank(y.label) || y.n - x.n).slice(0, 6).map((g) => {
    const ys = [...new Set(g.years)].sort();
    return `${g.label} ×${g.n}${ys.length ? ` (${ys.length > 1 ? `${ys[0]}–${ys[ys.length - 1]}` : ys[0]})` : ''}`;
  });
}

export async function draftContactMail(contactId: string, a: AiAgent, taskId: string, camp: Campaign): Promise<Outcome> {
  const { data } = await sb.from('network_contacts').select('id, name, kind, country, city, contact_name, email, stock_total').eq('id', contactId).maybeSingle();
  const c = data as ContactRow | null;
  if (!c) return { status: 'echec', name: contactId, detail: 'contact introuvable', cost: 0 };
  const skip = (detail: string): Outcome => ({ status: 'ignore', name: c.name, detail, cost: 0 });
  const email = (c.email ?? '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return skip('pas d\'adresse e-mail sur la fiche');
  const blocked = suppressionMatch([email], await loadSuppressions());
  if (blocked) return skip(`${blocked} est sur « ne plus contacter »`);
  // Un fil déjà ouvert avec cette adresse (par l'une ou l'autre agente) ou avec ce contact : pas de second mail à froid.
  const { data: th } = await sb.from('agent_threads').select('id').or(`counterpart_email.eq.${email},network_contact_id.eq.${c.id}`).limit(1);
  if ((th ?? []).length) return skip('un fil existe déjà avec cette adresse ou ce contact');

  const language = LANG_OF_COUNTRY[(c.country ?? '').toUpperCase()] ?? 'en';
  live(taskId, `${c.name} : lecture de sa vitrine`);
  const stock = await stockOf(c.id);
  // Les marques visées par la campagne qu'il a en stock : le mail en parle d'abord, et nos véhicules sont ceux-là d'abord.
  const wanted = new Set(camp.marques.map(brandKey));
  const focus = wanted.size ? stock.brands.filter((b) => wanted.has(brandKey(b.brand))) : [];
  const models = focus.length
    ? [...new Set([...stock.models.filter((x) => focus.some((f) => brandKey(x.model).startsWith(brandKey(f.brand)))), ...stock.models])].slice(0, 5)
    : stock.models;
  const ours = await oursFor([...focus, ...stock.brands].map((b) => b.brand));
  // « Kovács Gábor — direction « … » » (fiches de Dana) : le nom, puis la fonction.
  const [name, ...roleParts] = (c.contact_name ?? '').split(/\s+[—–-]\s+/);
  const person = name.trim() || null;
  const kind = email ? addressKind(email, null, person) : null;
  const material: CarteCampaignMaterial = {
    company: c.name, country: c.country, city: c.city, language,
    contact: { name: person, role: roleParts.join(' — ').trim() || null, email, address: kind },
    kind: c.kind ? KIND_FR[c.kind] ?? c.kind : null,
    focus, brands: stock.brands, models, ours,
    instructions: camp.consignes,
  };
  const prompt = carteCampaignPrompt(material);
  const budget = Number(a.daily_budget_usd);
  live(taskId, `${c.name} : rédaction du mail (IA, ${language})`);
  let out: FirstMailOutput | null = null;
  let cost = 0;
  try {
    const r = await callClaude<FirstMailOutput>({
      agent: a.agent, budgetUsd: Number.isFinite(budget) ? budget : 0, purpose: 'campagne_carte', model: OPUS,
      system: CARTE_CAMPAIGN_SYSTEM, user: prompt, schema: FIRST_MAIL_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 6000, effort: 'medium', taskId, fallbacks: true,
    });
    out = r.data;
    cost = r.costUsd;
  } catch (e) {
    if (e instanceof BudgetReached || e instanceof AiUnavailable) throw e;
    return { status: 'echec', name: c.name, detail: e instanceof Error ? e.message : String(e), cost: 0 };
  }
  if (!out?.corps?.trim() || !out.objet?.trim()) return { status: 'echec', name: c.name, detail: 'réponse de l\'IA sans mail', cost };
  const check = checkCampaignMail(out, prompt);
  const notes = {
    modele: OPUS, cout_usd: Math.round(cost * 10_000) / 10_000, langue: language, mots: check.words, faits: (out.faits ?? []).slice(0, 12), alertes: check.warnings,
    texte_initial: out.corps.trim(),
    campagne: { id: camp.id, pays: camp.pays, marques: camp.marques, marques_contact: stock.brands.slice(0, 4).map((b) => b.brand) },
  };
  const subject = out.objet.trim().slice(0, 200);
  const { data: t, error: e1 } = await sb.from('agent_threads').insert({
    agent: a.agent, mailbox: a.mailbox, subject, counterpart_email: email, counterpart_name: c.contact_name, network_contact_id: c.id,
  }).select('id');
  const threadId = ((t ?? []) as Array<{ id: string }>)[0]?.id;
  if (!threadId) return { status: 'echec', name: c.name, detail: `fil non créé : ${e1?.message ?? '?'}`, cost };
  const { data: msg, error: e2 } = await sb.from('agent_messages').insert({
    thread_id: threadId, agent: a.agent, mailbox: a.mailbox, channel: 'mail', direction: 'out', kind: 'premier_contact', author: a.agent,
    status: 'a_valider', to_emails: [email], cc_emails: [], subject, body_text: withAgentSignature(out.corps, a.signature ?? ''),
    translation_fr: language === 'fr' ? null : (out.traduction_fr ?? null), ai_notes: notes,
  }).select('id');
  const messageId = ((msg ?? []) as Array<{ id: string }>)[0]?.id;
  if (!messageId) {
    await sb.from('agent_threads').delete().eq('id', threadId);
    return { status: 'echec', name: c.name, detail: `brouillon non enregistré : ${e2?.message ?? '?'}`, cost };
  }
  await sb.from('agent_threads').update({ last_message_at: new Date().toISOString(), last_direction: 'out' }).eq('id', threadId);
  const points = check.warnings.length ? ` — ${check.warnings.length} point${check.warnings.length > 1 ? 's' : ''} à vérifier` : '';
  await journal({
    agent: a.agent, actor: a.agent, kind: 'campagne_carte', threadId, messageId,
    summary: `Campagne ${camp.pays}${camp.marques.length ? ` ${camp.marques.join('/')}` : ''} : mail rédigé pour ${c.name} (${c.country ?? '?'}) → ${email}, à valider${points}`,
    details: { contact_id: c.id, campagne: camp.id, cost_usd: notes.cout_usd, langue: language, marques: stock.brands.map((b) => b.brand) },
  });
  return { status: 'redige', name: c.name, detail: email, cost, threadId };
}

/** Une tâche de campagne : jusqu'à 5 contacts, un mail chacun ; s'arrête au plafond de dépense ou à une panne de l'IA. */
export async function runCarteCampaign(t: Task, a: AiAgent): Promise<{ result: Record<string, unknown>; summary: string }> {
  const raw = (t.params.campagne ?? {}) as Partial<Campaign>;
  const camp: Campaign = {
    id: String(raw.id ?? t.id), pays: String(raw.pays ?? '').toUpperCase(), marques: Array.isArray(raw.marques) ? raw.marques.map(String) : [],
    consignes: String(raw.consignes ?? ''),
  };
  const ids = (Array.isArray(t.params.contact_ids) ? t.params.contact_ids : []).map(String).slice(0, 5);
  if (ids.length === 0) throw new Error('aucun contact');
  const r = { campagne: camp.id, contacts: ids.length, rediges: 0, ignores: 0, echecs: 0, cout_usd: 0, arret: null as string | null, details: [] as string[] };
  for (const [i, id] of ids.entries()) {
    live(t.id, `Mail ${i + 1} sur ${ids.length}`, { done: i, total: ids.length });
    try {
      const o = await draftContactMail(id, a, t.id, camp);
      r.cout_usd += o.cost;
      if (o.status === 'redige') r.rediges++;
      else { if (o.status === 'ignore') r.ignores++; else r.echecs++; r.details.push(`${o.name} : ${o.detail}`); }
    } catch (e) {
      if (e instanceof BudgetReached || e instanceof AiUnavailable) { r.arret = e.message; break; }
      r.echecs++;
      r.details.push(e instanceof Error ? e.message : String(e));
    }
  }
  r.cout_usd = Math.round(r.cout_usd * 10_000) / 10_000;
  if (r.rediges === 0 && r.arret) throw new Error(r.arret);
  const summary = `Campagne ${camp.pays}${camp.marques.length ? ` ${camp.marques.join('/')}` : ''} : ${r.rediges} mail${r.rediges > 1 ? 's' : ''} rédigé${r.rediges > 1 ? 's' : ''} à valider${r.ignores ? `, ${r.ignores} ignoré${r.ignores > 1 ? 's' : ''}` : ''}${r.echecs ? `, ${r.echecs} en échec` : ''}${r.arret ? ` — arrêt : ${r.arret}` : ''}`;
  return { result: r, summary };
}
