/**
 * FYC — rapport Macadam exporté en PDF IMAGE (27/11, BMW iX3 WBY41DU060SA31436) : aucune couche texte, lignes OCR
 * (tesseract, mot à mot, bruit des photos). Le lecteur reconnaît la mise en page sans l'en-tête du portail et lit la
 * fiche, les dommages, les pneus et les contrôles. La fixture est la sortie réelle de l'OCR de l'app (pdfText.ocrLines).
 */
import { readFileSync } from 'node:fs';
import { isMacadamRemarketing, parseMacadamRemarketing } from '../src/lib/macadamReport';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};
console.log('\n=== FYC : MACADAM EN PDF IMAGE (OCR) ===\n');
const lines = JSON.parse(readFileSync(new URL('./fixtures/macadam-ix3-ocr-lines.json', import.meta.url), 'utf8'));
ok(isMacadamRemarketing(lines), 'la mise en page Macadam est reconnue sans l\'en-tête « Rapport de Remarketing »');
const f = parseMacadamRemarketing(lines);
ok(f.vin === 'WBY41DU060SA31436' && f.brand === 'BMW' && f.model === 'iX3' && f.version === 'BMW iX3', 'VIN, marque, modèle (la version complète le modèle tronqué « x »)', [f.vin, f.brand, f.model, f.version]);
ok(f.km === 61014 && f.first_registration === '2023-10-25' && f.year === 2023 && f.fuel === 'Electrique', 'kilométrage, 1re immatriculation, énergie', [f.km, f.first_registration, f.fuel]);
ok(f.report_date === null, 'la date lue sur la photo du certificat batterie n\'est pas prise pour la date du rapport', f.report_date);
ok(f.damages.devaluation.map((d) => d.raw).join(' | ') === 'Garniture intérieur — Manque — E - Remplacer (Intérieur) | Pare-chocs AR — Griffe(s) — Peindre (Arrière)', 'deux dommages qui dévaluent, malgré le bruit des photos', f.damages.devaluation.map((d) => d.raw));
ok(f.damages.usage.map((d) => d.raw).join(' | ') === "Carrosserie — Mesure de la peinture — Acceptable (Toit & autres) | Moulure d'aile — Griffe(s) — Acceptable (Droite)", 'deux traces d\'usage, dont celle dont la photo est sur la même ligne que le libellé (« AVD » noyé dans la photo, perdu)', f.damages.usage.map((d) => d.raw));
ok(f.tyres.length === 4 && f.tyres[2] === 'Arrière Gauche Bridgestone Été 245/50 R 19 105 W 4,7 mm', 'quatre pneus, accents de l\'OCR corrigés', f.tyres);
ok(f.equipment.join(' | ') === 'Toit ouvrant électrique : Oui | Toit panoramique : Oui', 'options lues en paires libellé : Oui/Non', f.equipment);
ok(f.raw_fields['Nbre clés total'] === '2' && f.raw_fields['Clés'] === '2' && f.raw_fields['Cric'] === 'P/A' && /réinitialisé/.test(f.raw_fields["Réinitialisation des paramètres d'usine"] ?? ''), 'contrôles lus par libellés connus (deux colonnes mot à mot)', f.raw_fields);
// Le PDF du portail (24/11) garde son en-tête : toujours reconnu.
ok(isMacadamRemarketing(['24/11/2026 16:34 Rapport de Remarketing de MACADAM', 'Information véhicule']), 'le PDF du portail avec en-tête reste reconnu');
ok(!isMacadamRemarketing(['DEKRA Fahrzeugbewertung', 'Fahrgestellnummer: X', 'Kilometerstand']), 'un autre rapport n\'est pas pris pour du Macadam');
if (fails === 0) { console.log('\n✅ FYC Macadam OCR : tout passe\n'); process.exit(0); }
console.error(`\n❌ ${fails} test(s) en échec\n`); process.exit(1);
