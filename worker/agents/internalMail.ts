/**
 * LES MAILS INTERNES D'ADA (18/10) : le bilan du jour à l'équipe, le bilan
 * d'une recherche à qui l'a lancée. Depuis la boîte de l'agente (délégation
 * Gmail du domaine) ; si Google la refuse (pas encore créée), de la propre
 * adresse du destinataire. Avec l'en-tête interne : la synchro de la boîte
 * le laisse dans Gmail, hors de la Messagerie et des chiffres.
 */
import { mailCreds, sendPlainMail } from '../mailer';
import { INTERNAL_HEADER } from '../../src/lib/agents/mail';

export type MailCreds = NonNullable<ReturnType<typeof mailCreds>>;

/** Envoie, et dit d'où c'est parti ; lève une erreur si aucune des deux adresses n'est acceptée. */
export async function sendInternal(creds: MailCreds, a: { mailbox: string; display_name: string }, to: string, mail: { subject: string; body: string }, kind: string, agentBox = true): Promise<'agente' | 'soi'> {
  const headers = { [INTERNAL_HEADER]: kind };
  const fromName = `${a.display_name} (ADA)`;
  if (agentBox) {
    try {
      await sendPlainMail(creds, { from: a.mailbox, fromName, to, subject: mail.subject, body: mail.body, headers });
      return 'agente';
    } catch { /* boîte de l'agente refusée : de la propre adresse du destinataire */ }
  }
  await sendPlainMail(creds, { from: to, fromName, to, subject: mail.subject, body: mail.body, headers });
  return 'soi';
}
