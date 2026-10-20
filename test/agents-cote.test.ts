/**
 * Mettre de côté une fiche (20/10, Channing : « dans les fiches à compléter, pouvoir stocker ces fiches
 * quelque part, pour qu'elles ne soient pas faites à la reprise de l'agente si la société n'est pas
 * pertinente, et ainsi ne pas cramer des crédits inutilement »). La partie pure : la ligne des notes
 * (date de Paris, motif facultatif), relue ; ce qui distingue une fiche mise de côté par l'équipe d'une
 * fiche écartée par l'IA ; les autres fiches de la même enseigne (les noms de la liste de TEST).
 * Le worker (recherche, préparation, « Refaire la fiche ») : test/agents-recherche.test.ts.
 */
import { asideLine, restoreLine, withNoteLine, isSetAside, lastAside, brandOf, sameBrand } from '../src/lib/agents/setAside';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};

console.log('\n=== ADA ET DANA : METTRE DE CÔTÉ UNE FICHE ===\n');

// --- La ligne des notes ---------------------------------------------------------------------------
const at = new Date('2026-10-20T10:00:00Z');
ok(asideLine(at, '  pas pertinent :\n enseigne de VO grand public ') === 'Mis de côté le 20/10/2026 : pas pertinent : enseigne de VO grand public' && asideLine(at, '') === 'Mis de côté le 20/10/2026',
  'la ligne : la date, et le motif s\'il y en a un (sur une ligne)', asideLine(at, '  pas pertinent :\n enseigne de VO grand public '));
ok(asideLine(new Date('2026-10-20T23:30:00Z'), '') === 'Mis de côté le 21/10/2026' && restoreLine(at) === 'Remis dans la liste le 20/10/2026', 'la date de Paris (23 h 30 UTC = le lendemain à Paris)');
ok(asideLine(at, 'x'.repeat(500)).length === 'Mis de côté le 20/10/2026 : '.length + 300, 'un motif de 300 caractères au plus');
ok(withNoteLine('', 'a') === 'a' && withNoteLine(' Note de Channing ', 'a') === 'Note de Channing\na' && withNoteLine('x'.repeat(5000), 'a').length === 4000 && withNoteLine('x'.repeat(5000), 'a').endsWith('\na'),
  'les notes : une ligne de plus, les plus anciennes tombent au-delà de 4 000 caractères');
const notes = [withNoteLine('Rappeler en janvier', asideLine(new Date('2026-10-18T09:00:00Z'), 'doublon')), restoreLine(new Date('2026-10-19T09:00:00Z')), asideLine(at, 'pas pertinent : enseigne grand public')].join('\n');
ok(JSON.stringify(lastAside(notes)) === JSON.stringify({ day: '20/10/2026', reason: 'pas pertinent : enseigne grand public' }) && JSON.stringify(lastAside('Mis de côté le 20/10/2026')) === JSON.stringify({ day: '20/10/2026', reason: null }) && lastAside('Rappeler en janvier') === null,
  'relue : la dernière mise de côté (le motif peut contenir « : »), sans motif, ou aucune', lastAside(notes));

// --- Mise de côté par l'équipe, ou écartée par l'IA ----------------------------------------------------
ok(isSetAside({ stage: 'ecarte', exclusion_reason: null }) && isSetAside({ stage: 'ecarte', exclusion_reason: ' ' }) && isSetAside({ stage: 'ecarte' })
  && !isSetAside({ stage: 'ecarte', exclusion_reason: 'garage en France : fournisseur possible' }) && !isSetAside({ stage: 'qualifie', exclusion_reason: null }),
  'mise de côté par l\'équipe : écartée sans motif de l\'IA (l\'IA écrit toujours le sien)');

// --- La même enseigne (les noms des grands comptes à compléter de TEST) -------------------------------------
const rows = [
  { id: '1', name: 'FLEXICAR MURCIA.', city: 'MURCIA' }, { id: '2', name: 'FLEXICAR MÁLAGA.', city: 'MALAGA' }, { id: '3', name: 'DOMINGO ALONSO OCASIÓN TENERIFE', city: 'LA LAGUNA' },
  { id: '4', name: 'GRUPO FLEXICAR SEVILLA.', city: 'SEVILLA' }, { id: '5', name: 'Groupe Sellens (filiale en France métropolitaine du groupe Aubéry : JPV, Riviera Car Center, Station 7)', city: 'Toulon' },
  { id: '6', name: 'J BIL Frölunda', city: 'Västra Frölunda' }, { id: '7', name: 'OCASIONPLUS SEVILLA CENTRO II', city: 'Sevilla' }, { id: '8', name: 'OCASIONPLUS LA MAQUINISTA II', city: 'SANT ANDREU' },
  { id: '9', name: 'DOMINGO ALONSO OCASIÓN', city: 'Las Palmas' }, { id: '10', name: 'TOYOTA NANTERRE - AUTOSPHERE', city: 'Nanterre' }, { id: '11', name: 'TOYOTA ASNIERES - AUTOSPHERE', city: 'Asnières' },
];
const twins = (id: string) => sameBrand(rows.find((r) => r.id === id)!, rows).map((r) => r.name).join(' | ');
ok(brandOf('FLEXICAR MURCIA.', 'MURCIA') === 'flexicar' && brandOf('GRUPO FLEXICAR SEVILLA.', 'SEVILLA') === 'flexicar' && brandOf('TOYOTA NANTERRE - AUTOSPHERE', 'Nanterre') === 'autosphere',
  'l\'enseigne : le premier mot distinctif — ni « grupo », ni la ville, ni la marque de voitures');
ok(twins('1') === 'FLEXICAR MÁLAGA. | GRUPO FLEXICAR SEVILLA.' && twins('7') === 'OCASIONPLUS LA MAQUINISTA II' && twins('3') === 'DOMINGO ALONSO OCASIÓN' && twins('10') === 'TOYOTA ASNIERES - AUTOSPHERE',
  'les autres fiches de la même enseigne : Flexicar, OcasionPlus, Domingo Alonso, Autosphere', { flexicar: twins('1'), ocasionplus: twins('7'), domingo: twins('3') });
ok(twins('5') === '' && twins('6') === '' && sameBrand({ id: 'x', name: 'Garage', city: null }, rows).length === 0, 'une enseigne seule, ou un nom sans mot distinctif : aucune autre');

if (fails === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`\n❌ ${fails} TEST(S) FAILED`);
  process.exit(1);
}
