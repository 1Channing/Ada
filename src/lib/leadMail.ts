/**
 * MAILS TYPES POUR RÉPONDRE AUX DEMANDES DU SITE (07/11, Channing : « traiter les demandes du site directement
 * sur Ada… avec la possibilité d'envoyer des mails pour les personnes connectées »).
 *
 * Partie pure : un modèle par situation et par langue de la demande (le site parle six langues ; le danois
 * tombe sur l'anglais). Les champs {prenom} {voiture} {prix} {signature} sont remplis par la page.
 */
import type { SiteLead } from './siteLeads';

export type LeadTemplateKey = 'offre' | 'complements' | 'pro';
export const LEAD_TEMPLATE_LABEL: Record<LeadTemplateKey, string> = {
  offre: 'Offre de rachat',
  complements: 'Demande de compléments (photos, carte grise)',
  pro: 'Prise de contact professionnelle',
};

type Tpl = { subject: string; body: string };
type Lang = 'fr' | 'en' | 'it' | 'es' | 'de' | 'nl';

const T: Record<LeadTemplateKey, Partial<Record<Lang, Tpl>>> = {
  offre: {
    fr: { subject: 'MC Export – notre offre pour votre {voiture}', body: 'Bonjour {prenom},\n\nMerci pour votre demande sur mc-export.com concernant votre {voiture}.\n\nAprès étude, nous pouvons vous proposer {prix} € net vendeur, paiement comptant par virement avant enlèvement, enlèvement à votre domicile pris en charge par nos soins.\n\nCette offre est valable 7 jours, sous réserve de la conformité du véhicule avec les éléments transmis. Si elle vous convient, répondez simplement à cet e-mail ou appelez-nous, et nous organisons le rendez-vous.\n\nBien cordialement,\n{signature}' },
    en: { subject: 'MC Export – our offer for your {voiture}', body: 'Hello {prenom},\n\nThank you for your request on mc-export.com about your {voiture}.\n\nAfter review, we can offer you €{prix} net, paid by bank transfer before collection, with collection at your address arranged by us.\n\nThis offer is valid for 7 days, subject to the vehicle matching the details provided. If it suits you, simply reply to this e-mail or call us and we will arrange the appointment.\n\nKind regards,\n{signature}' },
    it: { subject: 'MC Export – la nostra offerta per la sua {voiture}', body: 'Buongiorno {prenom},\n\nGrazie per la sua richiesta su mc-export.com riguardo alla sua {voiture}.\n\nDopo valutazione, possiamo proporle {prix} € netti, con pagamento tramite bonifico prima del ritiro e ritiro a domicilio organizzato da noi.\n\nL\'offerta è valida 7 giorni, a condizione che il veicolo corrisponda ai dati comunicati. Se le conviene, risponda a questa e-mail o ci chiami e fisseremo l\'appuntamento.\n\nCordiali saluti,\n{signature}' },
    es: { subject: 'MC Export – nuestra oferta por su {voiture}', body: 'Hola {prenom},\n\nGracias por su solicitud en mc-export.com sobre su {voiture}.\n\nTras estudiarla, podemos ofrecerle {prix} € netos, con pago por transferencia antes de la recogida y recogida en su domicilio organizada por nosotros.\n\nLa oferta es válida 7 días, siempre que el vehículo corresponda a los datos facilitados. Si le conviene, responda a este correo o llámenos y concertaremos la cita.\n\nUn cordial saludo,\n{signature}' },
    de: { subject: 'MC Export – unser Angebot für Ihren {voiture}', body: 'Guten Tag {prenom},\n\nvielen Dank für Ihre Anfrage auf mc-export.com zu Ihrem {voiture}.\n\nNach Prüfung können wir Ihnen {prix} € netto anbieten, Zahlung per Überweisung vor der Abholung, Abholung bei Ihnen zu Hause durch uns organisiert.\n\nDas Angebot gilt 7 Tage, vorbehaltlich der Übereinstimmung des Fahrzeugs mit den übermittelten Angaben. Wenn es Ihnen zusagt, antworten Sie einfach auf diese E-Mail oder rufen Sie uns an, und wir vereinbaren den Termin.\n\nMit freundlichen Grüßen\n{signature}' },
    nl: { subject: 'MC Export – ons bod voor uw {voiture}', body: 'Beste {prenom},\n\nBedankt voor uw aanvraag op mc-export.com over uw {voiture}.\n\nNa beoordeling kunnen wij u € {prix} netto bieden, betaling per overschrijving vóór het ophalen, ophalen bij u thuis door ons geregeld.\n\nDit bod is 7 dagen geldig, mits het voertuig overeenkomt met de doorgegeven gegevens. Als het u schikt, beantwoord dan deze e-mail of bel ons en we plannen de afspraak.\n\nMet vriendelijke groet,\n{signature}' },
  },
  complements: {
    fr: { subject: 'MC Export – votre {voiture} : quelques précisions', body: 'Bonjour {prenom},\n\nMerci pour votre demande sur mc-export.com concernant votre {voiture}.\n\nPour vous faire une offre ferme, pourriez-vous nous envoyer :\n– quelques photos (extérieur, intérieur, compteur) ;\n– une photo de la carte grise ;\n– le carnet d\'entretien ou les dernières factures, si vous les avez ;\n– tout défaut à signaler (carrosserie, voyants, pneus).\n\nNous revenons vers vous avec une offre dès réception.\n\nBien cordialement,\n{signature}' },
    en: { subject: 'MC Export – your {voiture}: a few details', body: 'Hello {prenom},\n\nThank you for your request on mc-export.com about your {voiture}.\n\nTo make you a firm offer, could you send us:\n– a few photos (exterior, interior, odometer);\n– a photo of the registration document;\n– the service book or latest invoices, if you have them;\n– any defect to report (bodywork, warning lights, tyres).\n\nWe will come back to you with an offer as soon as we receive them.\n\nKind regards,\n{signature}' },
    it: { subject: 'MC Export – la sua {voiture}: alcune precisazioni', body: 'Buongiorno {prenom},\n\nGrazie per la sua richiesta su mc-export.com riguardo alla sua {voiture}.\n\nPer farle un\'offerta definitiva, potrebbe inviarci:\n– alcune foto (esterno, interno, contachilometri);\n– una foto del libretto di circolazione;\n– il libretto dei tagliandi o le ultime fatture, se disponibili;\n– eventuali difetti da segnalare (carrozzeria, spie, pneumatici).\n\nLe risponderemo con un\'offerta appena ricevuti.\n\nCordiali saluti,\n{signature}' },
    es: { subject: 'MC Export – su {voiture}: algunos detalles', body: 'Hola {prenom},\n\nGracias por su solicitud en mc-export.com sobre su {voiture}.\n\nPara hacerle una oferta en firme, ¿podría enviarnos?:\n– algunas fotos (exterior, interior, cuentakilómetros);\n– una foto del permiso de circulación;\n– el libro de mantenimiento o las últimas facturas, si los tiene;\n– cualquier defecto a señalar (carrocería, testigos, neumáticos).\n\nLe responderemos con una oferta en cuanto los recibamos.\n\nUn cordial saludo,\n{signature}' },
    de: { subject: 'MC Export – Ihr {voiture}: einige Angaben', body: 'Guten Tag {prenom},\n\nvielen Dank für Ihre Anfrage auf mc-export.com zu Ihrem {voiture}.\n\nFür ein verbindliches Angebot bräuchten wir:\n– einige Fotos (außen, innen, Tacho);\n– ein Foto des Fahrzeugscheins;\n– das Scheckheft oder die letzten Rechnungen, falls vorhanden;\n– Hinweise auf Mängel (Karosserie, Warnleuchten, Reifen).\n\nWir melden uns nach Erhalt mit einem Angebot.\n\nMit freundlichen Grüßen\n{signature}' },
    nl: { subject: 'MC Export – uw {voiture}: enkele gegevens', body: 'Beste {prenom},\n\nBedankt voor uw aanvraag op mc-export.com over uw {voiture}.\n\nOm u een vast bod te doen, zou u ons het volgende kunnen sturen:\n– enkele foto\'s (buitenkant, binnenkant, kilometerteller);\n– een foto van het kentekenbewijs;\n– het onderhoudsboekje of de laatste facturen, indien beschikbaar;\n– eventuele gebreken (carrosserie, waarschuwingslampjes, banden).\n\nWe komen na ontvangst bij u terug met een bod.\n\nMet vriendelijke groet,\n{signature}' },
  },
  pro: {
    fr: { subject: 'MC Export – suite à votre demande', body: 'Bonjour {prenom},\n\nMerci pour votre message sur mc-export.com.\n\nMC Export achète et vend des véhicules d\'occasion en volume à travers l\'Europe, avec paiement et enlèvement rapides. Pour avancer, le plus simple est un court échange téléphonique : quel créneau vous conviendrait ? Vous pouvez aussi nous envoyer directement votre liste de véhicules ou vos besoins (marques, modèles, volumes, budget).\n\nBien cordialement,\n{signature}' },
    en: { subject: 'MC Export – following your request', body: 'Hello {prenom},\n\nThank you for your message on mc-export.com.\n\nMC Export buys and sells used vehicles in volume across Europe, with fast payment and collection. The easiest next step is a short call: which time slot would suit you? You can also send us your vehicle list or your needs directly (makes, models, volumes, budget).\n\nKind regards,\n{signature}' },
  },
};

export const leadLang = (l: SiteLead): Lang => (['fr', 'en', 'it', 'es', 'de', 'nl'].includes(l.lang) ? (l.lang as Lang) : 'en');

/** Le modèle adapté à une demande ; les professionnels n'ont que « pro », les particuliers « offre » et « complements ». */
export function leadTemplates(l: SiteLead): LeadTemplateKey[] {
  return l.kind === 'particulier' ? ['offre', 'complements'] : ['pro'];
}

export function leadTemplate(key: LeadTemplateKey, l: SiteLead): Tpl {
  const lang = leadLang(l);
  return T[key][lang] ?? T[key].en ?? T[key].fr ?? { subject: '', body: '' };
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** La voiture d'une demande en une ligne (« Tesla Model 3 2021, 31 000 km »), vide pour un professionnel. */
export function leadCar(l: SiteLead): string {
  const d = l.details ?? {};
  const car = [text(d.marque), text(d.modele)].filter(Boolean).join(' ');
  const km = Number(text(d.km).replace(/\D/g, ''));
  return [car, text(d.annee), km > 0 ? `${km.toLocaleString('fr-FR')} km` : ''].filter(Boolean).join(', ');
}

/** Remplit un modèle pour une demande. `prix` vide → le champ reste visible (« …… ») pour ne pas partir sans montant. */
export function renderLeadMail(tpl: string, l: SiteLead, p: { prix: string; signature: string }): string {
  const first = text(l.name).split(/\s+/)[0] || '';
  return tpl
    .replace(/\{prenom\}/gi, first).replace(/\{voiture\}/gi, leadCar(l) || 'véhicule')
    .replace(/\{prix\}/gi, p.prix.trim() || '……').replace(/\{signature\}/gi, p.signature)
    .replace(/^(Bonjour|Hello|Buongiorno|Hola|Guten Tag|Beste) ,/m, '$1,');
}

/** Le même modèle en français, pour lire à côté ce qu'on envoie dans une autre langue (07/11, Channing). */
export function leadTemplateFr(key: LeadTemplateKey): Tpl {
  return T[key].fr ?? { subject: '', body: '' };
}
