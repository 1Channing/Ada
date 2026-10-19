/**
 * « LE BON CONTACT EST… » (19/10, Channing après le test DMD : « elle n'a pas
 * tort sur ce qu'elle donne, mais ce n'est pas le contact parfait » ; « c'est
 * un commercial d'une concession qui nous a donné le contact »). Sur une
 * fiche, l'équipe donne le bon interlocuteur — et, si elle veut, comment
 * elle l'a eu. Une tâche « qualification » avec params.bon_contact (sans SQL
 * à coller) :
 * - la personne entre sur la fiche (« donné par Channing »), devient le
 *   contact retenu ; ce que l'agente avait trouvé reste, rien n'est effacé ;
 * - son adresse, si elle est donnée, est vérifiée (le domaine reçoit-il du
 *   courrier ?) ;
 * - l'agente en tire une leçon générale (sans nom ni adresse), PROPOSÉE à
 *   Channing (« Ce que … sait ») ;
 * - pas de premier mail d'office : l'équipe connaît déjà cette personne
 *   (« Rédiger le premier mail » reste possible à la main).
 */
import { EMAIL_OK } from '../../src/lib/agents/qualification';
import { segmentOf } from '../../src/lib/agents/research';
import { LEVEL_LABEL, type ContactLevel } from '../../src/lib/agents/deepResearch';
import { hasMx, type AiAgent } from './qualify';
import { proposeLesson } from './lessons';
import { forgetTeam } from './team';
import { sb, journal } from './store';

interface Task { id: string; agent: string; kind: string; params: Record<string, unknown>; created_by: string | null }
interface Given { prospect_id: string; nom: string; fonction?: string | null; email?: string | null; telephone?: string | null; comment?: string | null; niveau?: ContactLevel | null }
interface Row {
  id: string; agent: string; name: string; country: string | null; kind: string | null; account_id: string | null;
  people: Array<Record<string, unknown>> | null; emails: Array<{ email: string; nature?: string; mx?: boolean }> | null;
  best_contact: { nom?: string | null; fonction?: string | null; email?: string | null; pourquoi?: string | null; niveau?: string | null } | null;
}

const clean = (x: unknown, n: number) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export async function applyRightContact(t: Task, a: AiAgent): Promise<{ result: Record<string, unknown>; summary: string }> {
  const g = (t.params.bon_contact ?? {}) as Given;
  const nom = clean(g.nom, 120);
  if (!g.prospect_id || nom.length < 2) throw new Error('il faut la fiche et le nom du bon contact');
  const { data } = await sb.from('agent_prospects').select('id, agent, name, country, kind, account_id, people, emails, best_contact').eq('id', g.prospect_id).maybeSingle();
  const p = data as Row | null;
  if (!p) throw new Error('fiche introuvable');
  if (p.agent !== a.agent) throw new Error(`fiche ${p.agent === 'dana' ? 'de Dana' : 'd\'Ada'}`);
  const fonction = clean(g.fonction, 160) || 'le bon contact';
  const email = clean(g.email, 200).toLowerCase() || null;
  if (email && !EMAIL_OK.test(email)) throw new Error(`adresse illisible : ${email}`);
  const telephone = clean(g.telephone, 40) || null;
  const comment = clean(g.comment, 400) || null;
  const niveau: ContactLevel = g.niveau === 'decider' ? 'decider' : 'demarrer';
  const day = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
  const source = `donné par Channing le ${day}${comment ? ` — ${comment}` : ''}`;
  const lower = nom.toLowerCase();

  // La fiche : la personne donnée, son adresse vérifiée, le contact retenu ; ce que l'agente avait trouvé reste.
  const people = [
    ...(p.people ?? []).filter((x) => String(x.nom ?? '').toLowerCase() !== lower && (!email || String(x.email ?? '').toLowerCase() !== email)),
    { nom, fonction, email, telephone, source, via: 'channing', niveau, connu: true },
  ];
  const mx = email ? await hasMx(email.split('@')[1] ?? '') : false;
  const emails = email ? [...(p.emails ?? []).filter((e) => e.email !== email), { email, nature: 'nominatif', source, mx, via: 'channing' }] : (p.emails ?? []);
  const before = p.best_contact;
  const best = { nom, fonction, email, telephone, niveau, pourquoi: `Le bon contact, donné par Channing${comment ? ` (${comment})` : ''}.` };
  const { error } = await sb.from('agent_prospects').update({ people: people.slice(0, 20), emails: emails.slice(0, 30), best_contact: best, updated_at: new Date().toISOString() }).eq('id', p.id);
  if (error) throw new Error(`fiche non enregistrée : ${error.message}`);
  forgetTeam();
  await journal({
    agent: a.agent, actor: 'humain', actorId: t.created_by, kind: 'bon_contact',
    summary: `${p.name} : le bon contact est ${nom} (${fonction}, ${LEVEL_LABEL[niveau]})${email ? ` — ${email}${mx ? '' : ', domaine sans courrier'}` : ''}${before?.nom && before.nom.toLowerCase() !== lower ? ` ; ${a.display_name} avait retenu ${before.nom}` : ''}`,
    details: { prospect_id: p.id, avant: before?.nom ?? null },
  });

  // La leçon : ce que l'agente avait retenu face au bon contact — jamais de nom ni d'adresse.
  let segKey: string | null = null;
  let segLabel: string | null = null;
  if (p.account_id) {
    const { data: acc } = await sb.from('agent_accounts').select('segment').eq('id', p.account_id).maybeSingle();
    const s = (acc as { segment: string } | null)?.segment ?? null;
    if (s) { segKey = s; segLabel = segmentOf(a.agent === 'dana' ? 'dana' : 'ada', s)?.label ?? s; }
  }
  const had = before?.nom || before?.fonction
    ? `${before?.fonction ?? 'une personne'}${before?.niveau ? ` (${LEVEL_LABEL[before.niveau as ContactLevel] ?? before.niveau})` : ''}, ${before?.email ? (/^(contact|info|accueil|bonjour|hello)@/.test(before.email) ? 'joignable seulement par une adresse générale' : 'avec une adresse directe') : 'sans adresse'} — ${before?.pourquoi ?? ''}`
    : 'personne de nommé';
  const lesson = await proposeLesson(a, {
    source: 'bon_contact', agent: a.agent === 'dana' ? 'dana' : 'ada', company: p.name, country: p.country, segment: segKey ?? p.kind, segmentLabel: segLabel ?? p.kind,
    had, right: `${fonction} (${LEVEL_LABEL[niveau]})`, how: comment,
  }, { prospect_id: p.id }, t.id);
  return {
    result: { bon_contact: true, prospect_id: p.id, lecon: lesson },
    summary: `${p.name} : le bon contact est enregistré (${nom})${lesson ? ', une leçon est proposée' : ''}`,
  };
}
