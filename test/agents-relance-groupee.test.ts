/**
 * Relance groupée de la Carte (27/11) : le destinataire décisionnaire d'une fiche, et le mail réécrit ou traduit par
 * l'agente — signé par la personne connectée, champs conservés, contrôles.
 */
import { recipientOptions, defaultRecipient, recipientFirstName } from '../src/lib/network/recipients';
import { groupMailSystem, groupMailPrompt, checkGroupMail } from '../src/lib/agents/groupMail';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};

console.log('\n=== RELANCE GROUPÉE : DÉCISIONNAIRE ET DANA ===\n');

// --- Le destinataire d'une fiche ---------------------------------------------------------------------
const toonder = {
  contact_name: 'Arjan den Toonder — achats et ventes « Inkoop/Verkoop »', email: 'info@autotoonder.nl',
  people: [
    { name: 'Arjan den Toonder', role: 'achats et ventes « Inkoop/Verkoop » certifié', email: 'arjan@autotoonder.nl', phone: '' },
    { name: 'Jan den Toonder', role: 'achats et ventes « Inkoop/Verkoop »', email: '', phone: '' },
  ],
};
const r1 = defaultRecipient(toonder);
ok(r1?.email === 'arjan@autotoonder.nl' && r1.role === 'acheteur', 'Auto Toonder : l\'acheteur nommé (arjan@) passe avant l\'adresse générale info@', r1);
ok(recipientFirstName(r1) === 'Arjan', 'et {prenom} = Arjan', recipientFirstName(r1));
ok(recipientOptions(toonder).length === 2 && recipientOptions(toonder)[1].generic, 'deux adresses possibles, l\'adresse générale en second et marquée générale', recipientOptions(toonder));

const seller = { contact_name: 'Attila Radics — vendeur VO « predajca »', email: 'predajvw@dscar.sk', people: [{ name: 'Attila Radics', role: 'vendeur VO', email: '', phone: '+421' }] };
const r2 = defaultRecipient(seller);
ok(r2?.email === 'predajvw@dscar.sk' && r2.main, 'DS-CAR : une seule adresse (celle de la fiche, portée par un vendeur) : on l\'écrit quand même', r2);

const wallis = {
  contact_name: 'Szilágyi Antal — responsable VO « üzletág vezető »', email: 'szilagyia@wallismotor.hu',
  people: [
    { name: 'Szilágyi Antal', role: 'responsable VO', email: 'szilagyia@wallismotor.hu', phone: '' },
    { name: 'Fekete László', role: 'vendeur VO', email: 'feketel@wallismotor.hu', phone: '' },
    { name: 'Takács Zoltán', role: 'direction « Ügyvezető igazgató »', email: 'takacs@wallismotor.hu', phone: '' },
  ],
};
const o3 = recipientOptions(wallis);
ok(o3[0].email === 'szilagyia@wallismotor.hu' && o3[o3.length - 1].role === 'vendeur' && o3.length === 3, 'AutoWallis : responsable VO d\'abord, le vendeur en dernier, l\'adresse de la fiche (la même) dédoublonnée', o3.map((o) => o.label));
ok(defaultRecipient({ contact_name: null, email: 'info@x.nl', people: [{ name: 'Piet', role: 'verkoper', email: 'piet@x.nl', phone: '' }] })?.email === 'info@x.nl', 'un vendeur n\'est jamais choisi d\'office quand l\'adresse générale existe');
ok(defaultRecipient({ contact_name: null, email: '', people: [{ name: 'Piet', role: 'verkoper', email: 'piet@x.nl', phone: '' }] })?.email === 'piet@x.nl', 'mais il l\'est s\'il est la seule adresse');
ok(defaultRecipient({ contact_name: null, email: 'pas une adresse', people: [] }) === null, 'une adresse invalide : aucun destinataire');

// --- Le mail réécrit par Dana -------------------------------------------------------------------------
const sys = groupMailSystem('Dana', 'Doctrine : électriques et plug-in recherchés.', 'Channing');
ok(/SIGNÉ PAR Channing/.test(sys) && /\{signature\}/.test(sys) && /Doctrine : électriques/.test(sys), 'le système : signé par Channing, champ {signature} gardé, doctrine présente');
const prompt = groupMailPrompt({ signatory: 'Channing', lang: 'da', themeLabel: 'Vente', kindLabel: 'Concession', recipientsCount: 26, example: { societe: 'Bayern AutoGroup', prenom: 'Heine', pays: 'Danemark' }, subject: 'MC Export – vores brugte biler', body: 'Hej {prenom},\n\nTekst.\n\nMed venlig hilsen,\n{signature}', note: 'Plus court, insiste sur les électriques.', mode: 'reecrire' });
ok(/en danois/.test(prompt) && /26 destinataires/.test(prompt) && /<demande_de_channing>/.test(prompt) && /Bayern AutoGroup/.test(prompt), 'le prompt : langue, nombre de destinataires, note balisée, exemple de destinataire');
const tr = groupMailPrompt({ signatory: 'Antoine', lang: 'nl', themeLabel: 'Achat', kindLabel: 'Concession', recipientsCount: 5, example: null, subject: 'S', body: 'B {signature}', note: '', mode: 'traduire' });
ok(/Traduis en français/.test(tr) && !/<demande_de_/.test(tr), 'mode traduire : sans note, demande de traduction seule');

const before = 'MC Export – vores brugte biler\nHej {prenom},\n\nTekst om {societe}.\n\nMed venlig hilsen,\n{signature}';
const c1 = checkGroupMail({ objet: 'Objet', corps: 'Hej {prenom},\n\nKortere tekst om {societe}.\n\nMed venlig hilsen', traduction_fr: 'Bonjour…' }, before, 'plus court', 'Dana');
ok(/\{signature\}$/.test(c1.body) && c1.warnings.some((w) => /\{signature\} manquait/.test(w)), '{signature} oublié par le modèle : remis en fin de mail, signalé', c1);
const c2 = checkGroupMail({ objet: 'Objet', corps: 'Hej {prenom},\n\nVi tilbyder biler til 15 000 € — skriv til Dana.\n\n{signature}', traduction_fr: null }, before, 'plus court', 'Dana');
ok(c2.warnings.some((w) => /prix/.test(w)) && c2.warnings.some((w) => /15 ?000/.test(w)) && c2.warnings.some((w) => /prénom de l'agente/.test(w)) && c2.warnings.some((w) => /\{societe\}/.test(w)), 'alertes : prix, chiffre inventé, prénom de Dana, champ {societe} disparu', c2.warnings);
const c3 = checkGroupMail({ objet: 'O', corps: 'Hej {prenom},\n\nTekst om {societe}. Se https://mc-export.com/bonnes-affaires\n\n{signature}', traduction_fr: null }, before, '', 'Dana');
ok(c3.warnings.length === 0, 'un mail propre avec le lien de la boutique : aucune alerte', c3.warnings);

if (fails === 0) { console.log('\n✅ relance groupée : tout passe\n'); process.exit(0); }
console.error(`\n❌ ${fails} test(s) en échec\n`); process.exit(1);
