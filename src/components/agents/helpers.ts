/**
 * Onglet Agents (16/10) — fonctions pures partagées : dates, raison pour
 * laquelle un message validé attend encore, contrôle d'un brouillon.
 */
import type { AgentMessage, AgentSettings, AgentCounts, Draft, ProspectStage } from '../../services/agents';
import { inSendWindow, nextWindowStart, countsAgainstCap } from '../../lib/agents/sendPolicy';
import { parseAddressList } from '../../lib/agents/mail';

/** Date et heure de Paris (les horaires d'envoi sont réglés à l'heure de Paris). */
export const fmtDateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'à l\'instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return fmtDateTime(iso);
}

/** Pourquoi un message validé n'est pas encore parti (estimation côté écran ; le worker fait foi). */
export function pendingReason(m: AgentMessage, s: AgentSettings | undefined, c: AgentCounts | undefined): string {
  if (m.status === 'envoi') return 'Envoi en cours.';
  if (!s) return 'En file.';
  if (!s.gmail_connected_email) return `En attente : la boîte ${s.mailbox} n'est pas encore connectée (Réglages).`;
  const now = new Date();
  if (!inSendWindow(now, s)) {
    const next = nextWindowStart(now, s);
    return next ? `Hors horaires d'envoi : part ${fmtDateTime(next.toISOString())}.` : 'Aucun jour d\'envoi coché (Réglages).';
  }
  if (countsAgainstCap(m.kind)) {
    if (c && c.premiersContactsAujourdhui >= s.daily_first_contact_cap) return `Plafond du jour atteint (${s.daily_first_contact_cap} premiers contacts) : part au prochain jour d'envoi.`;
    if (s.next_send_after && Date.parse(s.next_send_after) > now.getTime()) return `Écart entre deux envois : part vers ${fmtDateTime(s.next_send_after)}.`;
  }
  return 'Part dans la minute.';
}

/** Contrôle avant d'enregistrer : au moins un destinataire valide, un objet, un texte. */
export function draftProblem(d: Draft): string | null {
  const to = d.to.map((x) => x.trim()).filter(Boolean);
  if (to.length === 0) return 'Ajoutez un destinataire.';
  const bad = to.filter((x) => parseAddressList(x).length === 0);
  if (bad.length) return `Adresse invalide : ${bad.join(', ')}`;
  if (!d.subject.trim()) return 'Ajoutez un objet.';
  if (!d.body.trim()) return 'Le message est vide.';
  return null;
}

export const cleanDraft = (d: Draft): Draft => ({ ...d, to: d.to.map((x) => parseAddressList(x)[0]?.email ?? x.trim()).filter(Boolean) });

// --- Qualification d'Ada (17/10) ---
export const KIND_LABEL: Record<string, string> = {
  concession_marque: 'Concession de marque', agent_marque: 'Agent de marque', groupe: 'Groupe de distribution',
  independant_multimarque: 'Indépendant multimarque', utilitaires: 'Spécialiste utilitaires', negociant_vo: 'Négociant VO',
  exportateur_concurrent: 'Exportateur (concurrent)', loueur_ou_leasing: 'Loueur / leasing', autre: 'Autre',
};
export const STAGE_LABEL: Record<ProspectStage, string> = {
  qualifie: 'Qualifié', a_contacter: 'À contacter', contacte: 'Contacté', repondu: 'A répondu', interesse: 'Intéressé', client: 'Client', perdu: 'Perdu', ecarte: 'Écarté',
};
export const LANG_LABEL: Record<string, string> = { fr: 'français', nl: 'néerlandais', de: 'allemand', en: 'anglais', es: 'espagnol', it: 'italien', da: 'danois' };

export const scoreTone = (s: number | null | undefined) =>
  s == null ? 'bg-slate-100 text-slate-500 border-slate-200'
    : s >= 70 ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : s >= 40 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-100 text-slate-600 border-slate-200';
