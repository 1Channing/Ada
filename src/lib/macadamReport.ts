/**
 * RAPPORT D'INSPECTION MACADAM (www4.macadam.eu, 12/11, Channing : liste Drivalia « lien macadam » sur 52 voitures).
 * Module pur, partagé navigateur / worker. Deux pages publiques pour un même assessmentFileId :
 *   - AppraisalWebview?assessmentFileId=…&language=fr-FR : la fiche (VIN, 1re immat., compteur, carrosserie, boîte,
 *     énergie, portes, places, couleur, options, pneus, dommages chiffrés avec « Coût total hors TVA », photos de
 *     dommages) ; les identifiants des blocs (Vinnumber, Expertise Mileage, Gearbox…) ne changent pas avec la langue,
 *     les libellés « checks_… » si — on lit la page française.
 *   - Report17Pdf_OLD?assessmentFileId=…&language=fr-FR : les photos générales (« General Picture - n »).
 * Les photos pleine taille (2048 × 1536) sont derrière picture/<id>.jpg?originalpicture=true (redirection vers Azure).
 * Les liens « ShowSelectedReport » et « Report17Pdf_OLD » des listes portent le même assessmentFileId.
 * Vérifié sur le Land Rover Discovery Sport SALCA2BT5PH328757 (5 dommages, 4 pneus, 21 photos de dommages) et le
 * Ford Kuga WF0FXXWPMHPJ74563 (17 photos générales).
 */
import type { FycReportFields, FycDamage, FycLine } from './fycReport';
import type { DekraPhoto } from './dekraReport';

export const isMacadamReport = (html: string): boolean => /macadam\.eu/i.test(html) && /dynamicLabel/.test(html) && /assessmentFileId|vehicleTitle/i.test(html);

/** L'identifiant du rapport dans un lien Macadam, tel qu'écrit (encodé) ; null si ce n'est pas un lien Macadam. */
export function macadamAssessmentId(url: string): string | null {
  if (!/macadam\.eu/i.test(url)) return null;
  return url.match(/[?&]assessmentFileId=([^&#\s]+)/i)?.[1] ?? null;
}
export const macadamUrls = (id: string) => ({
  webview: `https://www4.macadam.eu/Manager/SinglePage/AppraisalWebview?assessmentFileId=${id}&language=fr-FR`,
  pictures: `https://www4.macadam.eu/Manager/SinglePage/Report17Pdf_OLD?assessmentFileId=${id}&language=fr-FR`,
});

const decode = (s: string) => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\u00a0/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ').trim();
const dash = (s: string | null | undefined) => { const v = (s ?? '').trim(); return v && v !== '-' ? v : null; };
const isoDate = (s: string | null) => { const m = (s ?? '').match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/); return m && Number(m[3]) >= 1980 ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
const num = (s: string | null | undefined) => { const t = (s ?? '').replace(/\s/g, '').replace(',', '.').match(/\d+(?:\.\d+)?/); return t ? Number(t[0]) : null; };
const WHEEL: Record<string, string> = { AVG: 'Avant gauche', AVD: 'Avant droit', ARG: 'Arrière gauche', ARD: 'Arrière droit' };
const BRAND_FIX: Record<string, string> = { 'LAND-ROVER': 'Land Rover', 'ALFA-ROMEO': 'Alfa Romeo', 'ASTON-MARTIN': 'Aston Martin', 'ROLLS-ROYCE': 'Rolls-Royce', 'MERCEDES-BENZ': 'Mercedes-Benz' };

type Entry = { id: string; label: string; value: string | null; section: string };

/** Les blocs libellé → valeur dans l'ordre, avec la section (en-têtes « Options », « Pneu », « Matériel de secours »). */
function entriesOf(html: string): Entry[] {
  const out: Entry[] = [];
  const re = /<th class='x-panel-header[^']*'>([^<]{2,40})<\/th>|<div id='([^']*)'><table[^>]*><tr><td(?:><tr><td)? class='dynamicLabel'[^>]*>([^<]*)<\/td>(?:<td class='dynamicValue[^']*'[^>]*>([\s\S]*?)<\/td>)?/g;
  let section = 'data';
  for (const m of html.matchAll(re)) {
    if (m[1]) { section = decode(m[1]); continue; }
    out.push({ id: m[2], label: decode(m[3]).replace(/:$/, '').trim(), value: dash(decode(m[4] ?? '')), section });
  }
  return out;
}

export interface MacadamParsed { fields: FycReportFields; photos: DekraPhoto[]; rows: Array<{ list: 'devaluation' | 'usage'; idx: number }> }

export function parseMacadamReport(html: string): MacadamParsed {
  const entries = entriesOf(html);
  const byId = (id: string) => entries.find((e) => e.id === id)?.value ?? null;
  const byLabel = (re: RegExp, section?: string) => entries.find((e) => re.test(e.label) && (!section || e.section === section))?.value ?? null;
  const raw: Record<string, string> = {};
  // Titre « LAND-ROVER Discovery Sport: GN649NA ».
  const title = decode(html.match(/id='vehicleTitle'[\s\S]*?class='x-panel-header[^']*'>([^<]*)</)?.[1] ?? '');
  const tm = title.match(/^(\S+)\s+(.*?)(?::\s*([A-Z0-9-]+))?$/);
  const brandRaw = tm?.[1] ?? null;
  const brand = brandRaw ? (BRAND_FIX[brandRaw.toUpperCase()] ?? brandRaw) : null;
  const model = dash(tm?.[2] ?? null);
  if (tm?.[3]) raw.plate = tm[3];
  const kw = num(byId('Power Kw'));
  const fiscal = byId('Fiscalpower'); if (fiscal) raw.fiscal_power = fiscal;
  const transmission = byId('Transmission'); if (transmission) raw.transmission = transmission;
  for (const e of entries) if (e.section === 'data' && e.id.startsWith('checks_') && e.value && !/portes|si[èe]ges|Couleur carrosserie/i.test(e.label)) raw[e.label] = e.value;
  // Options : un libellé seul = présent ; avec valeur = « libellé : valeur ».
  const equipment = entries.filter((e) => e.section === 'Options').map((e) => (e.value ? `${e.label} : ${e.value}` : e.label));
  // Pneus : dimension, type, profondeur par roue ; marque et usure dans le petit tableau.
  const wear = Object.fromEntries([...html.matchAll(/<td class='dynamicLabel' width='50px'>(AVG|AVD|ARG|ARD)<\/td><td class='dynamicValueLeft'>([^<]*)<\/td>/g)].map((m) => [m[1], decode(m[2])]));
  const tyres: string[] = [];
  for (const w of ['AVG', 'AVD', 'ARG', 'ARD']) {
    const size = byLabel(new RegExp(`^Taille de pneu ${w}$`)); const type = byLabel(new RegExp(`^Type de pneu ${w}$`)); const depth = byLabel(new RegExp(`^Profondeur de pneu ${w}$`));
    if (!size && !depth) continue;
    const brandWear = wear[w] ?? '';
    const tyreBrand = brandWear.split(':')[0].trim(); const pct = brandWear.match(/\d+\s*%/)?.[0];
    tyres.push(`${WHEEL[w]} : ${[tyreBrand, size, type, depth ? `${depth} mm` : null, pct ? `(${pct.replace(/\s/g, '')} restant)` : null].filter(Boolean).join(' ')}`);
  }
  // Dommages : « Élément, Dommage, Action | montant » après « Coût total hors TVA | total ».
  const devaluation: FycDamage[] = []; const usage: FycDamage[] = [];
  const rows: MacadamParsed['rows'] = [];
  const lines = [...html.matchAll(/align='left'>([^<]*)<\/div><\/td><td><div[^>]*align='right'>([^<]*)<\/div>/g)].map((m) => ({ text: decode(m[1]), amount: num(decode(m[2])) }));
  let repair_cost: number | null = null;
  for (const l of lines) {
    if (/Co[uû]t total/i.test(l.text)) { repair_cost = l.amount; continue; }
    const parts = l.text.split(/\s*,\s*/).map((p) => p.trim()).filter(Boolean);
    const [element, damage, ...rest] = parts;
    const action = rest.join(', ');
    const acceptable = /^acceptable$/i.test(action) || (l.amount === 0 && /acceptable/i.test(l.text));
    const d: FycDamage = { zone: element ?? l.text, kind: damage ?? '', action, raw: `${element ?? l.text}${damage ? ` : ${damage}` : ''}${action ? ` → ${action}` : ''}${l.amount ? ` (${l.amount.toLocaleString('fr-FR')} € HT)` : ''}` };
    const list = acceptable ? usage : devaluation;
    list.push(d); rows.push({ list: acceptable ? 'usage' : 'devaluation', idx: list.length - 1 });
  }
  // Photos de dommages : <div id='reviewPictures<k>_…'> … ShowPicture("pleine taille") — k = rang du dommage.
  const photos: DekraPhoto[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<div id='reviewPictures(\d+)_\d+'>[\s\S]*?ShowPicture\("([^"]+)"/g)) {
    const k = Number(m[1]); const url = m[2];
    if (seen.has(url)) continue; seen.add(url);
    const r = rows[k];
    const caption = r ? (r.list === 'devaluation' ? devaluation : usage)[r.idx].raw.replace(/\s*\([^()]*€ HT\)$/, '') : `Dommage ${k + 1}`;
    photos.push({ url, caption, list: r?.list ?? null, idx: r?.idx ?? null });
  }
  raw.inspector = 'Macadam';
  const fields: FycReportFields = {
    report_number: null, report_date: null, vin: dash(byId('Vinnumber'))?.replace(/\s+/g, '') ?? null,
    brand, model, version: dash(byId('Versionname')), body: dash(byId('Bodytype')),
    first_registration: isoDate(byId('First Registrationdate')), year: null, km: num(byId('Expertise Mileage')),
    asking_price: null, repair_cost,
    fuel: dash(byId('Fueltype')), gearbox: dash(byId('Gearbox')), power_ch: kw ? Math.round(kw * 1.35962) : null,
    color: byLabel(/^Couleur carrosserie$/, 'data'),
    doors: num(byLabel(/^Nbre portes$/, 'data')), seats: num(byLabel(/^Nbre si[èe]ges$/, 'data')), repainted: null,
    damages: { devaluation, usage }, equipment, tyres, raw_fields: raw,
  };
  fields.year = fields.first_registration ? Number(fields.first_registration.slice(0, 4)) : null;
  return { fields, photos, rows };
}

/** Photos générales de la page Report17Pdf_OLD (pleine taille, dédoublonnées, dans l'ordre). */
export function macadamGeneralPhotos(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/title='General Picture - \d+'[^>]*onclick='[^']*ShowPicture\("([^"]+)"/g)) if (!out.includes(m[1])) out.push(m[1]);
  if (!out.length) for (const m of html.matchAll(/ShowPicture\("([^"]+)"/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// --- Le « Rapport de Remarketing de MACADAM » (PDF du portail, 24/11) -------------------------------------------------

/**
 * LE PDF DU PORTAIL MACADAM (24/11, Channing : « apprends cette inspection dans le FYC », BMW X1 WBA21EF0205X87351).
 * portal.macadam.eu/reports/remarketingV1 imprimé en PDF : « Information véhicule » sur deux colonnes (Marque,
 * Modèle, Version, Kilométrage, Type de carburant… ; Plaque, NIV, Première immatriculation…), « Résumé des dommages »,
 * « Photos commerciales », « Options selon l'inspecteur », « Dommages » (quatre lignes par dommage : pièce, nature,
 * action, zone), « Pneus » (six lignes par roue), « Contrôles » (deux colonnes libellé / valeur). Sans prix
 * (withPrices=False). Lu sur les lignes pdf.js (mêmes lignes dans le navigateur et le worker).
 */

type L = { text: string; frags: Array<{ x: number; s: string }> };
const asLines = (input: FycLine[]): L[] => input.map((l) => (typeof l === 'string' ? { text: l.trim(), frags: [] } : { text: l.text.trim(), frags: (l.frags ?? []).map((f) => ({ x: f.x, s: f.s.trim() })).filter((f) => f.s) })).filter((l) => l.text);
const NOISE = /Rapport de Remarketing de MACADAM|portal\.macadam\.eu/i;

export const isMacadamRemarketing = (input: FycLine[]): boolean => asLines(input).slice(0, 6).some((l) => /Rapport de Remarketing de MACADAM/i.test(l.text));

export function parseMacadamRemarketing(input: FycLine[]): FycReportFields {
  const lines = asLines(input).filter((l) => !NOISE.test(l.text) || /^\d{2}\/\d{2}\/\d{4}/.test(l.text));
  const raw: Record<string, string> = {};
  const section = (name: RegExp, until: RegExp): L[] => {
    const i = lines.findIndex((l) => name.test(l.text));
    if (i < 0) return [];
    const out: L[] = [];
    for (const l of lines.slice(i + 1)) { if (until.test(l.text)) break; if (!NOISE.test(l.text)) out.push(l); }
    return out;
  };
  // Date du rapport : l'en-tête « 24/11/2026 16:34 ».
  const head = lines.find((l) => /^\d{2}\/\d{2}\/\d{4}/.test(l.text));
  const reportDate = isoDate(head?.text ?? null);
  // Information véhicule : deux colonnes, séparées par l'abscisse du premier libellé de droite (« Plaque », « NIV »…).
  const info = section(/^Information véhicule$/i, /^Résumé des dommages$|^Photos commerciales$/i);
  const rightX = Math.min(...info.flatMap((l) => l.frags.filter((f) => /^(Plaque|Couleur|NIV|Puissance|Première immatriculation|Nombre de portes)/i.test(f.s)).map((f) => f.x)), Infinity);
  const pair = (frags: Array<{ x: number; s: string }>) => {
    const f = frags.filter((x) => x.s !== ':');
    if (!f.length) return null;
    return { label: f[0].s.replace(/\s*:$/, ''), value: dash(f.slice(1).map((x) => x.s).join(' ')) };
  };
  for (const l of info) {
    for (const side of [l.frags.filter((f) => f.x < rightX), l.frags.filter((f) => f.x >= rightX)]) {
      const p = pair(side);
      if (p?.value) raw[p.label] = p.value;
    }
  }
  const get = (re: RegExp) => Object.entries(raw).find(([k]) => re.test(k))?.[1] ?? null;
  const brand = get(/^Marque$/i);
  const version = get(/^Version$/i);
  let model = get(/^Modèle$/i);
  // « Modèle : X », « Version : BMW X1 » : la version est plus précise que le modèle tronqué.
  if (version) {
    const v = brand && version.toUpperCase().startsWith(brand.toUpperCase()) ? version.slice(brand.length).trim() : version;
    if (v && (!model || model.length <= 2 || v.toUpperCase().startsWith(model.toUpperCase()))) model = v;
  }
  const firstReg = isoDate(get(/^Première immatriculation$/i));
  // Dommages : pièce, nature, action, zone — « Acceptable » = trace d'usage, le reste dévalue.
  const dmg = section(/^Dommages$/i, /^Pneus$|^Contrôles$/i).map((l) => l.text);
  const devaluation: FycDamage[] = [];
  const usage: FycDamage[] = [];
  const ZONES = /^(Arrière|Avant|Droite|Gauche|Roues|Toit & autres|Intérieur|Mécanique)$/i;
  for (let i = 0; i + 3 < dmg.length + 1; ) {
    const zi = dmg.slice(i + 1, i + 5).findIndex((t) => ZONES.test(t));
    if (zi < 0) break;
    const g = dmg.slice(i, i + 2 + zi);
    const [part, kind, ...rest] = g;
    const zone = rest.pop() ?? '';
    const action = rest.join(' ');
    const d: FycDamage = { zone: part, kind: kind ?? '', action, raw: `${part} — ${kind ?? ''}${action ? ` — ${action}` : ''} (${zone})` };
    (/^Acceptable$/i.test(action) ? usage : devaluation).push(d);
    i += g.length;
  }
  // Pneus : position, saison, jante, dimension, marque, gomme.
  const ty = section(/^Pneus$/i, /^Contrôles$|^Informations sur le contenu/i).map((l) => l.text);
  const tyres: string[] = [];
  for (let i = 0; i < ty.length; i++) {
    if (!/^(Avant|Arrière)\s+(Gauche|Droite?)$/i.test(ty[i])) continue;
    const g = ty.slice(i + 1, i + 6);
    const size = g.find((t) => /^\d{3}\/\d{2}\/\d{2}/.test(t)) ?? '';
    const depth = g.find((t) => /^\d+([.,]\d)?\s*mm$/i.test(t)) ?? '';
    const brandT = g.find((t) => t !== size && t !== depth && !/^(4 Saisons|Été|Hiver|Aluminium|Acier|Tôle)$/i.test(t)) ?? '';
    const season = g.find((t) => /^(4 Saisons|Été|Hiver)$/i.test(t)) ?? '';
    tyres.push([ty[i], brandT, season, size.replace(/^(\d{3})\/(\d{2})\/(\d{2})\/?(\d+)?\/?([A-Z])?$/, (_m, w, h, r, li, sp) => `${w}/${h} R ${r}${li ? ` ${li}` : ''}${sp ? ` ${sp}` : ''}`), depth].filter(Boolean).join(' '));
  }
  // Contrôles : libellé / valeur, deux colonnes ; la ligne qui suit sans libellé prolonge la valeur de gauche.
  const ctrl = section(/^Contrôles$/i, /^Informations sur le contenu/i);
  const cx = Math.min(...ctrl.flatMap((l) => l.frags.length >= 3 ? [l.frags[Math.floor(l.frags.length / 2)].x] : []), Infinity);
  let lastLeft: string | null = null;
  for (const l of ctrl) {
    if (l.frags.length <= 1) { if (lastLeft && /^(Oui|Non)/i.test(l.text)) raw[lastLeft] = l.text; continue; }
    const left = l.frags.filter((f) => f.x < cx), right = l.frags.filter((f) => f.x >= cx);
    for (const side of [left, right]) {
      if (!side.length) continue;
      const label = side[0].s, value = side.slice(1).map((f) => f.s).join(' ');
      if (value) raw[label] = value; else if (side === left) lastLeft = label;
    }
  }
  const options = section(/^Options selon l'inspecteur$/i, /^Dommages$/i).map((l) => l.text).filter((t) => !/^Aucune Information/i.test(t));
  const keys = num(get(/^Nbre clés total$/i));
  if (keys != null) raw['Clés'] = String(keys);
  if (reportDate) raw['Date du rapport'] = reportDate;
  return {
    report_number: null, report_date: reportDate, vin: dash(get(/^NIV$/i))?.toUpperCase() ?? null,
    brand: brand ? (BRAND_FIX[brand.toUpperCase()] ?? brand) : null, model, version, body: null,
    first_registration: firstReg, year: firstReg ? Number(firstReg.slice(0, 4)) : null,
    km: num(get(/^Kilométrage$/i)), asking_price: null, repair_cost: null,
    fuel: get(/^Type de carburant$/i), gearbox: get(/^Boîte de vitesses$/i), power_ch: num(get(/^Puissance$/i)),
    color: get(/^Couleur de la carrosserie$/i), doors: num(get(/^Nombre de portes$/i)), seats: null, repainted: null,
    damages: { devaluation, usage }, equipment: options, tyres, raw_fields: raw,
  };
}

// --- La page du portail Macadam (26/11) ---------------------------------------------------------------------------------

/**
 * LE LIEN DU PORTAIL (26/11, Channing : « apprends cette offre dans le FYC », lien portal.macadam.eu/reports/remarketingV1
 * d'une liste marchand BMW). La même fiche que le PDF du 24/11, mais en HTML, publique avec sa signature : « Information
 * véhicule » (label for="Vehicle_…" + strong), « Options selon l'inspecteur », « Dommages » (pièce, nature, action, zone,
 * puis ses photos), « Pneus » (six cases par roue), « Contrôles », « Photos commerciales » (alt = légende). Les photos
 * sont sur www4.macadam.eu/picture/<id>.jpg, pleine taille avec ?originalpicture=true.
 */
export const isMacadamPortalReport = (html: string): boolean => /Rapport de Remarketing de MACADAM/i.test(html) && /for="Vehicle_VIN"/.test(html);

export function parseMacadamPortalReport(html: string): MacadamParsed {
  const h = html.replace(/\r/g, '');
  // Entités numériques du portail (« Arri&#xE8;re », « &#x27; ») : décodées, en plus des entités nommées de decode().
  const text = (s: string) => decode(s).replace(/&#x([0-9a-f]+);/gi, (_m, x) => String.fromCodePoint(parseInt(x, 16))).replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d))).replace(/\s+/g, ' ').trim();
  const section = (id: string): string => {
    const m = h.match(new RegExp(`<div id="${id}"[^>]*>([\\s\\S]*?)(?=<div class="container-fluid|</body>)`));
    return m?.[1] ?? '';
  };
  // Information véhicule : <label for="Vehicle_X">…</label>:?<strong class="float-right">valeur</strong>
  const info: Record<string, string> = {};
  for (const m of h.matchAll(/<label for="(Vehicle_[A-Za-z]+)">([^<]*)<\/label>:?\s*<strong class="float-right">([^<]*)<\/strong>/g)) {
    const v = dash(text(m[3]));
    if (v) info[m[1]] = v;
  }
  const raw: Record<string, string> = {};
  for (const m of h.matchAll(/<label for="Vehicle_[A-Za-z]+">([^<]*)<\/label>:?\s*<strong class="float-right">([^<]*)<\/strong>/g)) { const v = dash(text(m[2])); if (v) raw[text(m[1])] = v; }
  const brand = info.Vehicle_Make ?? null;
  const version = info.Vehicle_Version ?? null;
  let model = info.Vehicle_Model ?? null;
  if (version) {
    const v = brand && version.toUpperCase().startsWith(brand.toUpperCase()) ? version.slice(brand.length).trim() : version;
    // « Modèle : X », « Version : BMW iX3 » : un modèle tronqué (deux lettres ou moins) prend celui de la version.
    if (v && (!model || model.length <= 2 || v.toUpperCase().startsWith(model.toUpperCase()))) model = v;
  }
  const firstReg = isoDate(info.Vehicle_FirstRegistrationDate ?? null);
  // Options et contrôles : « libellé<span …><strong>valeur</strong></span> ».
  const pairs = (id: string): Array<[string, string]> => [...section(id).matchAll(/>\s*([^<>]+?)\s*<span class="float-right[^"]*"><strong>([^<]*)<\/strong><\/span>/g)].map((m) => [text(m[1]), text(m[2])] as [string, string]).filter(([k]) => k);
  const options = pairs('options').filter(([, v]) => !/^non$/i.test(v)).map(([k, v]) => (/^oui$/i.test(v) ? k : `${k} : ${v}`));
  for (const [k, v] of pairs('checks')) raw[k] = v;
  // Dommages : chaque bloc = pièce, nature, action, zone ; ses photos suivent (class="picture damage-picture").
  const devaluation: FycDamage[] = []; const usage: FycDamage[] = [];
  const photos: DekraPhoto[] = []; const rows: MacadamParsed['rows'] = [];
  const full = (url: string) => (/www4\.macadam\.eu\/picture\//.test(url) && !url.includes('?') ? `${url}?originalpicture=true` : url);
  for (const m of section('damages').matchAll(/<strong>([^<]*)<\/strong><br \/>\s*([^<]*)<br \/>\s*([^<]*)<br \/>\s*([^<]*)<br \/>([\s\S]*?)(?=<div class="row keep-together|$)/g)) {
    const part = text(m[1]), kind = text(m[2]), action = text(m[3]), zone = text(m[4]);
    const d: FycDamage = { zone: part, kind, action, raw: `${part} — ${kind}${action ? ` — ${action}` : ''} (${zone})` };
    const list: 'devaluation' | 'usage' = /^Acceptable$/i.test(action) ? 'usage' : 'devaluation';
    const target = list === 'usage' ? usage : devaluation;
    target.push(d);
    const idx = target.length - 1;
    rows.push({ list, idx });
    for (const p of m[5].matchAll(/<img class="picture damage-picture" src="([^"]+)"[^>]*alt="([^"]*)"/g)) photos.push({ url: full(p[1]), caption: `${part} — ${kind}`, list, idx });
  }
  // Pneus : six cases par roue, la première porte « tire-location ».
  const cells = [...section('tires').matchAll(/<div class="col-12 col-md-2 col-lg-2 border border-white text-center( tire-location)?">([^<]*)<\/div>/g)].map((m) => ({ loc: !!m[1], v: text(m[2]) }));
  const tyres: string[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i].loc) continue;
    const g = cells.slice(i + 1, i + 6).map((c) => c.v);
    const [season, rim, size, make, depth] = g;
    tyres.push([cells[i].v, make, season, (size ?? '').replace(/^(\d{3})\/(\d{2})\/(\d{2})\/?(\d+)?\/?([A-Z])?$/, (_m, w, hh, r, li, sp) => `${w}/${hh} R ${r}${li ? ` ${li}` : ''}${sp ? ` ${sp}` : ''}`), rim, depth].filter(Boolean).join(' '));
  }
  // Photos commerciales : alt = légende (« Kilométrage », « Entretien », « Avant gauche »…), avant celles des dommages.
  const commercial: DekraPhoto[] = [];
  for (const m of section('commercialPictures').matchAll(/<img class="picture" alt="([^"]*)" src="([^"]+)"/g)) commercial.push({ url: full(m[2]), caption: text(m[1]) || `Photo ${commercial.length + 1}`, list: null, idx: null });
  const keys = num(raw['Nbre clés total']); if (keys != null) raw['Clés'] = String(keys);
  const fields: FycReportFields = {
    report_number: null, report_date: null, vin: info.Vehicle_VIN?.toUpperCase() ?? null,
    brand: brand ? (BRAND_FIX[brand.toUpperCase()] ?? brand) : null, model, version, body: null,
    first_registration: firstReg, year: firstReg ? Number(firstReg.slice(0, 4)) : null,
    km: num(info.Vehicle_Mileage), asking_price: null, repair_cost: null,
    fuel: info.Vehicle_FuelType ?? null, gearbox: info.Vehicle_Gearbox ?? null, power_ch: num(info.Vehicle_kW),
    color: info.Vehicle_BodyColor ?? null, doors: num(info.Vehicle_Doors), seats: null, repainted: null,
    damages: { devaluation, usage }, equipment: options, tyres, raw_fields: raw,
  };
  return { fields, photos: [...commercial, ...photos], rows };
}
