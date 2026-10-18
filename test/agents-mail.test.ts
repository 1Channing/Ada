/**
 * Ada et Dana (16/10) : la logique pure des mails — lecture d'une réponse,
 * tri automatique (absence, rebond, stop), message MIME envoyé à Gmail,
 * horaires d'envoi à l'heure de Paris et liste « ne plus contacter ».
 */
import {
  parseAddressList, replySubject, buildMime, replyReferences, htmlToText, stripQuoted,
  headersOf, isAutoReply, isBounce, bouncedRecipients, isStopRequest, base64UrlToUtf8, utf8ToBase64Url, encodeHeaderWord, isInternalMail, htmlBody, pngSize,
} from '../src/lib/agents/mail';
import { readFileSync } from 'node:fs';
import { mailboxFacts, folderThreads, folderOf, type MailboxFacts } from '../src/lib/agents/mailbox';
import {
  parisClock, inSendWindow, nextWindowStart, parisDayStart, randomGapMs, suppressionMatch, countsAgainstCap,
} from '../src/lib/agents/sendPolicy';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};
const eq = (got: unknown, want: unknown, what: string) => ok(JSON.stringify(got) === JSON.stringify(want), what, got);

console.log('\n=== ADA ET DANA : LES MAILS ===\n');

// Adresses
eq(parseAddressList('Jean Dupont <Jean.Dupont@Garage.FR>, "Dupont, Marie" <m@y.nl>; z@w.de, pas-une-adresse, z@w.de'),
  [{ name: 'Jean Dupont', email: 'jean.dupont@garage.fr' }, { name: 'Dupont, Marie', email: 'm@y.nl' }, { name: '', email: 'z@w.de' }],
  'adresses : noms, guillemets, minuscules, doublon et déchet retirés');
eq(parseAddressList(''), [], 'adresses : vide');

// Objet de réponse
eq(replySubject('Vos 4 C-HR hybrides'), 'Re: Vos 4 C-HR hybrides', 'objet : Re: ajouté');
eq(replySubject('AW: Angebot'), 'AW: Angebot', 'objet : préfixe allemand gardé');
eq(replySubject('re: déjà'), 're: déjà', 'objet : pas de double Re:');

// MIME
const mime = buildMime({
  fromEmail: 'dana@mc-export.com', fromName: 'Dana — MC Export', to: ['garage@exemple.fr'], subject: 'Vos 4 C-HR hybrides',
  body: 'Bonjour,\nJe vous fais une proposition ?\nDana', inReplyTo: '<abc@mail.gmail.com>', references: '<x@y> <abc@mail.gmail.com>',
});
ok(mime.includes('From: =?UTF-8?B?') && mime.includes('<dana@mc-export.com>'), 'MIME : expéditeur au nom encodé (tiret long)');
ok(mime.includes('In-Reply-To: <abc@mail.gmail.com>') && mime.includes('References: <x@y> <abc@mail.gmail.com>'), 'MIME : réponse dans le même fil');
ok(mime.includes('Content-Type: text/plain; charset="UTF-8"') && !/<img|<html/i.test(mime), 'MIME : texte simple, sans image ni HTML');
const bodyB64 = mime.split('\r\n\r\n')[1].replace(/\r\n/g, '');
eq(base64UrlToUtf8(bodyB64.replace(/\+/g, '-').replace(/\//g, '_')), 'Bonjour,\r\nJe vous fais une proposition ?\r\nDana', 'MIME : corps UTF-8 relu à l\'identique');
let threw = false;
try { buildMime({ fromEmail: 'dana@mc-export.com', to: ['pas une adresse'], subject: 'x', body: 'y' }); } catch { threw = true; }
ok(threw, 'MIME : destinataire invalide refusé');
// La signature avec logo (18/10) : le texte simple, puis le HTML qui montre l'image jointe au mail.
const logo = readFileSync('public/signatures/dana.png');
const size = pngSize(logo);
ok(size?.width === 600 && size.height > 300 && pngSize(new Uint8Array([1, 2, 3])) === null, 'logo de Dana : un PNG de 600 px de large (affiché à 300)', size);
const sigImg = { base64: logo.toString('base64'), name: 'signature-dana.png', alt: 'Dana — MC Export · mc-export.com', width: size?.width ?? 0, height: size?.height ?? 0 };
const withLogo = buildMime({ fromEmail: 'dana@mc-export.com', fromName: 'Dana — MC Export', to: ['x@garage.fr'], subject: 'Vos lots', body: 'Bonjour,\n\nUn <test> & deux.\n\nDana\nMC Export', signatureImage: sigImg, signatureText: 'Dana\nMC Export' });
const cid = withLogo.match(/Content-ID: <([^>]+)>/)?.[1] ?? '';
const parts = withLogo.split(/\r\n--ada_(?:alt|rel)_[a-z0-9]+/);
const html = Buffer.from((parts.find((x) => x.includes('text/html')) ?? '').split('\r\n\r\n')[1]?.replace(/\r\n/g, '') ?? '', 'base64').toString();
const plainPart = Buffer.from((parts.find((x) => x.includes('text/plain')) ?? '').split('\r\n\r\n')[1]?.replace(/\r\n/g, '') ?? '', 'base64').toString();
ok(/^Content-Type: multipart\/alternative; boundary="ada_alt_/m.test(withLogo) && /Content-Type: multipart\/related/.test(withLogo) && /Content-Disposition: inline; filename="signature-dana.png"/.test(withLogo)
  && !!cid && html.includes(`src="cid:${cid}"`) && !/https?:\/\//.test(html), 'MIME avec logo : texte simple + HTML et l\'image jointe (cid), aucun lien externe');
ok(plainPart.endsWith('Dana\r\nMC Export') && html.includes('Un &lt;test&gt; &amp; deux.') && !html.includes('MC Export</p>') && html.includes('width="300"'),
  'MIME avec logo : la version texte garde la signature texte ; en HTML, le logo la remplace, le texte est échappé', { plainPart, html: html.slice(0, 400) });
ok(htmlBody('Bonjour,\nligne 2\n\nFin', null, sigImg, 'c').includes('<p style="margin:0 0 12px">Bonjour,<br>ligne 2</p><p style="margin:0 0 12px">Fin</p>'), 'HTML : paragraphes et retours à la ligne gardés');

// Les dossiers de la Messagerie (18/10) : Réception, Brouillons (comme « À valider »), Envoyés, Archives.
const T0 = '2026-10-18T08:00:00Z';
const mm = (o: Partial<{ direction: string; status: string; channel: string; classification: string | null }>) => ({ direction: 'out', status: 'envoye', channel: 'mail', classification: null, received_at: null, sent_at: T0, created_at: T0, ...o });
const th = (id: string, ms: ReturnType<typeof mm>[], archived = false): MailboxFacts & { id: string } => ({ id, archived, last_message_at: T0, created_at: T0, ...mailboxFacts(ms) });
const box = [
  th('repondu', [mm({}), mm({ direction: 'in', status: 'recu', received_at: '2026-10-18T09:00:00Z' }), mm({ status: 'a_valider', sent_at: null })]),
  th('pour-vous', [mm({ status: 'pour_channing', sent_at: null }), mm({ status: 'pour_channing', channel: 'linkedin', sent_at: null })]),
  th('rebond', [mm({}), mm({ direction: 'in', status: 'recu', classification: 'rebond' })]),
  th('bilan-range', [mm({})], true),
  th('ecarte', [mm({ status: 'refuse', sent_at: null })]),
];
const ids = (f: 'reception' | 'brouillons' | 'envoyes' | 'archives') => folderThreads(box, f).map((x) => x.id).join();
ok(ids('reception') === 'repondu' && ids('brouillons') === 'repondu,pour-vous' && ids('envoyes') === 'repondu,rebond' && ids('archives') === 'bilan-range,ecarte',
  'dossiers : un mail reçu (pas un rebond) en Réception ; ce qui attend en Brouillons ; un fil archivé ou tout écarté seulement en Archives', { r: ids('reception'), b: ids('brouillons'), e: ids('envoyes'), a: ids('archives') });
ok(box[1].linkedinOnly === false && th('li', [mm({ status: 'pour_channing', channel: 'linkedin', sent_at: null })]).linkedinOnly && folderOf(box[0]) === 'brouillons' && folderOf(box[3]) === 'archives' && folderOf(box[2]) === 'envoyes',
  'un fil ouvert depuis ailleurs : là où il attend d\'abord ; une note LinkedIn seule est marquée comme telle');
ok(encodeHeaderWord('Proposition pour vos véhicules électriques en stock depuis longtemps').split(' ').every((w) => w.length <= 75), 'MIME : objet long découpé en mots de 75 caractères au plus');
eq(base64UrlToUtf8(utf8ToBase64Url('Ærø — Køb')), 'Ærø — Køb', 'base64url : aller-retour UTF-8');
eq(replyReferences('<a@x> <b@x>', '<c@x>'), '<a@x> <b@x> <c@x>', 'References : chaîne du fil complétée');
eq(replyReferences(null, null), null, 'References : rien quand le fil est vide');

// Lecture d'une réponse
eq(htmlToText('<p>Bonjour&nbsp;Dana,</p><div>Oui, envoyez&#33;<br>Merci</div><style>p{}</style>'), 'Bonjour Dana,\nOui, envoyez!\nMerci', 'HTML → texte');
eq(stripQuoted('Oui, envoyez-moi la liste.\n\nLe jeu. 16 oct. 2026 à 10:02, Dana <dana@mc-export.com> a écrit :\n> Bonjour'), 'Oui, envoyez-moi la liste.', 'historique cité coupé (français)');
eq(stripQuoted('Ja graag.\n\nOp do 16 okt. 2026 om 10:02 schreef Ada <ada@mc-export.com>:\n> Hallo'), 'Ja graag.', 'historique cité coupé (néerlandais)');
eq(stripQuoted('Interessiert.\n\nAm 16.10.2026 um 10:02 schrieb Dana <dana@mc-export.com>:\n> Hallo'), 'Interessiert.', 'historique cité coupé (allemand)');
eq(stripQuoted('Yes please.\n\nOn Thu, Oct 16, 2026 at 10:02 AM Ada <ada@mc-export.com>\nwrote:\n> Hello'), 'Yes please.', 'historique cité coupé (anglais, attribution sur deux lignes)');
eq(stripQuoted('Ok pour moi.\n\nDe : Dana <dana@mc-export.com>\nEnvoyé : jeudi 16 octobre 2026 10:02\nObjet : C-HR'), 'Ok pour moi.', 'historique cité coupé (Outlook)');
eq(stripQuoted('Merci.\n> ancien\n> texte'), 'Merci.', 'lignes « > » finales coupées');
eq(stripQuoted('> tout est cité'), '> tout est cité', 'rien de nouveau : le texte reste entier');
eq(stripQuoted('lisible ?\n\n-- \nChanning Cloirec\nMC Export'), 'lisible ?', 'signature coupée au séparateur « -- »');
eq(stripQuoted('Ok pour moi\n\nEnvoyé de mon iPhone'), 'Ok pour moi', 'mention « Envoyé de mon iPhone » coupée');
eq(stripQuoted('Prijs?\n\nVerzonden vanaf mijn iPhone\n\nOp do 16 okt. 2026 om 10:02 schreef Ada <ada@mc-export.com>:\n> Hallo'), 'Prijs?', 'signature mobile puis historique (néerlandais)');
eq(stripQuoted('-- \nsignature seule'), '-- \nsignature seule', 'rien avant la signature : le texte reste entier');

// Tri automatique
const h = headersOf([{ name: 'Auto-Submitted', value: 'auto-replied' }, { name: 'Subject', value: 'x' }]);
ok(isAutoReply(h, 'Bonjour'), 'absence : en-tête Auto-Submitted');
ok(isAutoReply({}, 'Réponse automatique : absent jusqu\'au 20/10'), 'absence : objet français');
ok(isAutoReply({}, 'Afwezig tot maandag'), 'absence : objet néerlandais');
ok(!isAutoReply({ 'auto-submitted': 'no' }, 'Re: Vos 4 C-HR'), 'pas d\'absence pour une vraie réponse');
ok(isInternalMail(headersOf([{ name: 'X-ADA-Interne', value: 'bilan' }])) && !isInternalMail(h), 'bilan du jour (en-tête interne) : pas une conversation, la synchro le laisse dans Gmail');
ok(isBounce('mailer-daemon@googlemail.com', 'Delivery Status Notification (Failure)', {}), 'rebond : avis Gmail');
ok(isBounce('postmaster@outlook.com', 'Non remis : Vos 4 C-HR', {}), 'rebond : avis Outlook');
ok(!isBounce('jean@garage.fr', 'Re: Vos 4 C-HR', {}), 'pas de rebond pour une réponse');
eq(bouncedRecipients({ 'x-failed-recipients': 'Morte@Garage.fr' }, '', ['dana@mc-export.com']), ['morte@garage.fr'], 'rebond : destinataire refusé (en-tête)');
eq(bouncedRecipients({}, "Your message wasn't delivered to morte@garage.fr because the address couldn't be found. dana@mc-export.com", ['dana@mc-export.com']), ['morte@garage.fr'], 'rebond : destinataire refusé (texte), notre boîte exclue');
ok(isStopRequest('STOP'), 'stop : « STOP »');
ok(isStopRequest('Merci de ne plus me contacter.'), 'stop : « ne plus me contacter »');
ok(isStopRequest('Graag afmelden voor deze mails'), 'stop : néerlandais');
ok(isStopRequest('Bitte keine E-Mails mehr.'), 'stop : allemand');
ok(isStopRequest('Please unsubscribe me'), 'stop : anglais');
ok(!isStopRequest('Oui, envoyez-moi les prix, je ne stoppe pas les achats.'), 'pas de stop dans une réponse intéressée');

// Horaires d'envoi (heure de Paris)
const w = { send_days: [1, 2, 3, 4, 5], send_from: '08:30', send_to: '18:00' };
eq(parisClock(new Date('2026-10-16T08:00:00Z')).minutes, 10 * 60, 'Paris : 08:00 UTC = 10:00 en été');
eq(parisClock(new Date('2026-12-16T08:00:00Z')).minutes, 9 * 60, 'Paris : 08:00 UTC = 09:00 en hiver');
ok(inSendWindow(new Date('2026-10-16T08:00:00Z'), w), 'créneau : vendredi 10 h, ouvert');
ok(!inSendWindow(new Date('2026-10-16T16:30:00Z'), w), 'créneau : vendredi 18 h 30, fermé');
ok(!inSendWindow(new Date('2026-10-17T09:00:00Z'), w), 'créneau : samedi, fermé');
eq(nextWindowStart(new Date('2026-10-16T17:00:00Z'), w)?.toISOString(), '2026-10-19T06:30:00.000Z', 'créneau : vendredi soir → lundi 8 h 30 (Paris)');
eq(nextWindowStart(new Date('2026-10-23T17:00:00Z'), w)?.toISOString(), '2026-10-26T07:30:00.000Z', 'créneau : passage à l\'heure d\'hiver respecté');
eq(nextWindowStart(new Date('2026-10-16T08:00:00Z'), { ...w, send_days: [] }), null, 'créneau : aucun jour coché → null');
const allDay = { send_days: [1, 2, 3, 4, 5, 6, 7], send_from: '00:00', send_to: '00:00' };
ok(inSendWindow(new Date('2026-10-17T21:30:00Z'), allDay) && inSendWindow(new Date('2026-10-17T22:10:00Z'), allDay) && inSendWindow(new Date('2026-10-18T03:00:00Z'), allDay),
  'créneau : « 00:00 à 00:00 » = toute la journée (samedi 23 h 30, dimanche 0 h 10 et 5 h)');
ok(inSendWindow(new Date('2026-10-16T21:30:00Z'), { ...w, send_to: '00:00' }) && !inSendWindow(new Date('2026-10-16T06:00:00Z'), { ...w, send_to: '00:00' }),
  'créneau : « 08:30 à 00:00 » = jusqu\'à minuit (vendredi 23 h 30 ouvert, 8 h fermé)');
eq(nextWindowStart(new Date('2026-10-17T09:00:00Z'), { ...allDay, send_days: [1, 2, 3, 4, 5] })?.toISOString(), '2026-10-18T22:00:00.000Z', 'créneau : toute la journée en semaine → samedi, reprise lundi 0 h (Paris)');
eq(parisDayStart(new Date('2026-10-16T08:00:00Z')).toISOString(), '2026-10-15T22:00:00.000Z', 'plafond : le jour commence à minuit, heure de Paris');
const gap = randomGapMs(150, 420, () => 0.5);
eq(gap, 285000, 'écart : au milieu de 150 et 420 s');
eq(randomGapMs(420, 150, () => 0), 150000, 'écart : bornes inversées remises dans l\'ordre');
eq(suppressionMatch(['jean@garage.fr'], ['@garage.fr']), '@garage.fr', 'ne plus contacter : tout un domaine');
eq(suppressionMatch(['Jean@Garage.fr'], ['jean@garage.fr']), 'jean@garage.fr', 'ne plus contacter : une adresse, sans souci de majuscules');
eq(suppressionMatch(['jean@garage.fr'], ['@autre.fr']), null, 'ne plus contacter : pas de blocage à tort');
ok(countsAgainstCap('premier_contact') && countsAgainstCap('relance') && !countsAgainstCap('reponse'), 'plafond : premiers contacts et relances seulement');

if (fails === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`\n❌ ${fails} TEST(S) FAILED`);
  process.exit(1);
}
