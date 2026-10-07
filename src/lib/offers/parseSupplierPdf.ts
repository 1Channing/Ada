/**
 * OFFRES FOURNISSEUR — lecture d'un PDF « Auszug aus unserem aktuellen
 * Gebrauchtwagenangebot » (listes allemandes reçues par Achille le 07/10 :
 * VW_Hybrid_1.pdf, 39 voitures sur 29 pages ; Audi_MUE_07.10.pdf, 73 voitures
 * sur 42 pages).
 *
 * Forme PROUVÉE (pdf.js, lignes regroupées par hauteur — src/lib/pdfText.ts) :
 *   « Modell / Beschreibung                                    Preis in € »
 *   « Arteon SB 1.4 eHybrid DSG R-Line …  MwSt.-Ausweis möglich!  27.300 € »
 *   « Nr. MAN/89140/ Angebotstyp: [---], EZ 15.12.2022, km 52.520, kW(PS)
 *     160(218), ccm 1395, Mangangrau, 5- »
 *   « türig, Hybrid-Plugin Automatik/Frontantrieb, *** HIGHLIGHTS: … »
 *   … puis la description jusqu'au titre suivant.
 *
 * Le titre porte le modèle et la version, la mention de TVA et le prix ; la
 * ligne « Nr. » porte l'identifiant (filiale/numéro), la 1re immatriculation,
 * les km, la puissance, la cylindrée, la couleur, les portes ; la ligne
 * suivante l'énergie, la boîte et la transmission. Les prix sont TTC (TVA
 * allemande 19 %) : « MwSt.-Ausweis möglich » = TVA récupérable (export HT =
 * prix / 1,19) ; « Differenzbesteuert » / « § 25a » = TVA sur la marge.
 * La MARQUE n'est pas écrite : elle vient des modèles connus (référentiel
 * ADA), sinon du nom du fichier (« VW_Hybrid_1.pdf », « Audi_MUE… »).
 * Rien n'est inventé : ce qui n'est pas lu reste vide et se voit.
 */
import type { TextLine } from '../bankStatements';
import { brandOfModelWord, canonBrand, guessModel, parseFreeLine, splitBrand, type OfferVehicle } from './parseSupplierFile';

export interface ParsedSupplierPdf {
  vehicles: OfferVehicle[];
  warnings: string[];
  /** Marque déduite pour le fichier (modèles connus ou nom du fichier) — '' si rien. */
  brand: string;
  /** Date d'édition lue dans l'en-tête (« Erstellt am: 07.10.2026 »), ISO. */
  issued_on: string | null;
}

const GERMAN_VAT = 0.19;

/** Reconnaît le gabarit : en-tête « Angebotstyp » + lignes « Nr. ». */
export function isDealerExtractPdf(lines: Array<{ text: string }>): boolean {
  let nr = 0, typ = 0;
  for (const l of lines) {
    if (/^Nr\. [A-Z0-9-]+\/\d+\//.test(l.text)) nr++;
    if (/Angebotstyp/.test(l.text)) typ++;
  }
  return nr >= 1 && typ >= 1;
}

const deDate = (s: string | undefined): string | null => {
  const m = s?.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const deInt = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** Marque depuis le NOM DU FICHIER (« VW_Hybrid_1.pdf » → VOLKSWAGEN, « Audi_MUE » → AUDI). */
export function brandFromFilename(name: string, knownBrands: string[]): string {
  const tokens = name.replace(/\.[^.]+$/, '').split(/[^A-Za-z]+/).filter(Boolean);
  for (const t of tokens) {
    const c = canonBrand(t);
    if (knownBrands.includes(c)) return c;
  }
  // Abréviations courantes même sans référentiel.
  for (const t of tokens) { const c = canonBrand(t); if (['VOLKSWAGEN', 'AUDI', 'BMW', 'MERCEDES', 'SKODA', 'SEAT', 'CUPRA', 'PORSCHE', 'OPEL', 'FORD', 'TOYOTA', 'RENAULT', 'PEUGEOT', 'CITROEN', 'HYUNDAI', 'KIA'].includes(c)) return c; }
  return '';
}

const FUEL_DE: Array<[RegExp, string]> = [
  [/hybrid-?plugin|plug-?in|phev/i, 'HYBRIDE RECHARGEABLE'],
  [/hybrid|mild/i, 'HYBRIDE'],
  [/elektro|electric|strom/i, 'ELECTRIQUE'],
  [/diesel/i, 'DIESEL'],
  [/benzin|super|otto/i, 'ESSENCE'],
  [/autogas|lpg|gpl/i, 'GPL'],
  [/erdgas|cng/i, 'CNG'],
];
const fuelDe = (s: string): string | null => { for (const [re, f] of FUEL_DE) if (re.test(s)) return f; return null; };
const gearboxDe = (s: string): string | null =>
  /automatik|automatic|dsg|s-?tronic|tiptronic|multitronic|doppelkupplung/i.test(s) ? 'AUTOMATIQUE'
    : /schalt|manuell|handschalt/i.test(s) ? 'MANUELLE' : null;

export function parseDealerExtractPdf(
  lines: TextLine[],
  opts: { filename: string; knownModelsByBrand?: Record<string, string[]> },
): ParsedSupplierPdf {
  const known = opts.knownModelsByBrand ?? {};
  const knownBrands = Object.keys(known).map((b) => b.toUpperCase());
  const warnings: string[] = [];
  const vehicles: OfferVehicle[] = [];
  const texts = lines.map((l) => l.text.replace(/\s+/g, ' ').trim());
  const isPageNoise = (t: string) => /^Auszug aus unserem|^Erstellt am:|^Modell \/ Beschreibung|^Seite \d+|^\d+ \/ \d+$/.test(t) || t === '';
  const issued = deDate(texts.find((t) => /^Erstellt am:/.test(t)));
  const fileBrand = brandFromFilename(opts.filename, knownBrands);

  // Index des lignes « Nr. » : chaque bloc va du titre (ligne précédente non
  // bruit) jusqu'à la ligne qui précède le titre suivant.
  const nrIdx: number[] = [];
  texts.forEach((t, i) => { if (/^Nr\. [A-Z0-9-]+\/\d+\//.test(t)) nrIdx.push(i); });
  if (nrIdx.length === 0) return { vehicles, warnings: ['Aucune ligne « Nr. … » reconnue : ce PDF n\'est pas un extrait de stock de ce gabarit.'], brand: fileBrand, issued_on: issued };

  const titleIndexOf = (nr: number): number => {
    for (let i = nr - 1; i >= 0 && i >= nr - 3; i--) if (!isPageNoise(texts[i])) return i;
    return -1;
  };

  nrIdx.forEach((nr, k) => {
    // TITRE SUR UNE OU PLUSIEURS LIGNES (3e PDF « Electro » 07/10 : « Elroq RS
    // MAXX AHK WÄRMEPUMPE 21" WINTER CANTON 360 » déborde, le prix restait
    // sur la première ligne et n'était « pas lu »). Les lignes de titre sont
    // celles qui commencent plus à GAUCHE que la ligne « Nr. » (x 23 contre
    // 30, prouvé sur VW et Audi) ; on remonte tant que c'est le cas. Dans ces
    // lignes, le fragment « … € » est le prix, celui qui parle de TVA la
    // mention, le reste (à gauche) le titre — par fragments, pas par position
    // fixe. Sans abscisses (texte brut), repli sur la lecture de la ligne.
    const firstX = (i: number) => lines[i]?.frags?.[0]?.x ?? null;
    const nrX = firstX(nr);
    const titleIdx: number[] = [];
    for (let i = nr - 1; i >= 0 && i >= nr - 6; i--) {
      if (isPageNoise(texts[i])) continue;
      if (/^Nr\. /.test(texts[i])) break;
      const x = firstX(i);
      if (nrX != null && x != null && x >= nrX - 2) break;   // ligne de corps (même marge que « Nr. »)
      titleIdx.unshift(i);
      if (nrX == null) break;                                  // texte brut : une seule ligne
    }
    const ti = titleIdx[0] ?? titleIndexOf(nr);
    const nextTitle = k + 1 < nrIdx.length ? titleIndexOf(nrIdx[k + 1]) : texts.length;
    const PRICE_RE = /(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/;
    const VAT_RE = /MwSt\.?-?\s?Ausweis möglich!?|Differenzbesteuert|§ ?25a|MwSt\.? nicht ausweisbar/i;
    let title = '', vatText = '', priceTtc: number | null = null;
    const frags = titleIdx.flatMap((i) => (lines[i]?.frags ?? []).map((g) => g.s.replace(/\s+/g, ' ').trim()).filter(Boolean));
    if (frags.length > 0 && nrX != null) {
      const rest: string[] = [];
      for (const s of frags) {
        const pm = s.match(PRICE_RE);
        // Prix absent : le PDF écrit littéralement « null » (VW 07/10, Passat
        // MUE-V/90271) ou « Preis auf Anfrage » — sans prix, jamais 0.
        if (/^(null|Preis auf Anfrage|auf Anfrage)$/i.test(s)) continue;
        if (pm && s.replace(PRICE_RE, '').trim() === '') { priceTtc = deInt(pm[1]); continue; }
        if (VAT_RE.test(s) && s.replace(VAT_RE, '').trim() === '') { vatText = s.trim(); continue; }
        rest.push(s);
      }
      title = rest.join(' ').replace(/\s+/g, ' ').trim();
    } else {
      const titleLine = (ti >= 0 ? texts[ti] : '').replace(/\s+(null|Preis auf Anfrage|auf Anfrage)\s*$/i, '');
      const tm = titleLine.match(/^(.*?)\s*(MwSt\.?-?\s?Ausweis möglich!?|Differenzbesteuert[^\d€]*|§ ?25a[^\d€]*|MwSt\.? nicht ausweisbar[^\d€]*)?\s*(?:(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€)?\s*$/);
      title = (tm?.[1] ?? titleLine).trim();
      vatText = (tm?.[2] ?? '').trim();
      priceTtc = deInt(tm?.[3]);
    }
    const vatRecoverable: boolean | null = /ausweis möglich/i.test(vatText) ? true : /differenz|25a|nicht ausweisbar/i.test(vatText) ? false : null;
    // Bloc : lignes « Nr. » → avant le titre suivant, bruit de page retiré,
    // coupures « 5- » + « türig » recollées.
    let body = '';
    for (let i = nr; i < nextTitle; i++) {
      const t = texts[i];
      if (isPageNoise(t)) continue;
      body = body.endsWith('-') && /^[a-zäöü]/.test(t) ? body + t : body ? `${body} ${t}` : t;
    }
    const head = body.match(/^Nr\. ([A-Z0-9-]+\/\d+)\/\s*Angebotstyp:\s*\[([^\]]*)\],\s*(.*?)(?:,\s*\*\*\*|$)/);
    const id = head?.[1] ?? `pdf-${k + 1}`;
    const offerType = (head?.[2] ?? '').trim();
    const specs = head?.[3] ?? body;
    const ez = deDate(specs.match(/EZ (\d{2}\.\d{2}\.\d{4})/)?.[1]);
    const km = deInt(specs.match(/\bkm ([\d.]+)/)?.[1]);
    const pw = specs.match(/kW\(PS\) (\d+)\((\d+)\)/);
    const powerCh = pw ? Number(pw[2]) : null;
    const ccm = deInt(specs.match(/ccm ([\d.]+)/)?.[1]);
    // « ccm 1395, Mangangrau, 5-türig, Hybrid-Plugin Automatik/Frontantrieb »
    const after = specs.match(/ccm [\d.]+,\s*(.*)$/)?.[1] ?? '';
    const parts = after.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
    const doorsIdx = parts.findIndex((p) => /^\d-?\s?türig$/i.test(p));
    const color = doorsIdx > 0 ? parts.slice(0, doorsIdx).join(', ') : (parts[0] && !/türig|antrieb/i.test(parts[0]) ? parts[0] : null);
    const doors = doorsIdx >= 0 ? Number(parts[doorsIdx].match(/\d/)?.[0]) : null;
    const drive = parts[doorsIdx >= 0 ? doorsIdx + 1 : 1] ?? '';   // « Hybrid-Plugin Automatik/Frontantrieb »
    const [driveFuelBox, transmission] = drive.split('/');
    const getriebe = body.match(/GETRIEBE:\s*([^*]+?)(?:\s*\*\*\*|$)/)?.[1] ?? '';
    const free = parseFreeLine(title);
    const fuel = fuelDe(driveFuelBox ?? '') ?? free.fuel;
    const gearbox = gearboxDe(driveFuelBox ?? '') ?? gearboxDe(getriebe) ?? free.gearbox ?? (fuel === 'ELECTRIQUE' ? 'AUTOMATIQUE' : null);
    const neupreis = deInt(body.match(/Neupreis\s*([\d.]+)\s*(?:Euro|€)/i)?.[1]);
    const imported: boolean | null = /Kein EU-Import|Deutsches Fahrzeug/i.test(body) ? false : /EU-Import|Reimport|EU-Neuwagen/i.test(body) ? true : null;

    // Marque : modèle connu dans le titre, sinon marque en tête du titre, sinon le fichier.
    let brand = brandOfModelWord(title, known) ?? '';
    let versionLine = title;
    if (!brand) {
      const sp = splitBrand(title, knownBrands);
      if (knownBrands.includes(sp.brand)) { brand = sp.brand; versionLine = sp.rest || title; }
    }
    if (!brand) brand = fileBrand;
    const models = known[brand] ?? known[brand.toUpperCase()] ?? [];
    const model = guessModel(brand, versionLine, models).toUpperCase();
    if (!priceTtc) warnings.push(`${id} : prix non lu sur la ligne « ${title.slice(0, 50)} ».`);

    const extras: Record<string, string> = { 'Nr.': id };
    if (offerType && offerType !== '---') extras['Angebotstyp'] = offerType;
    if (transmission) extras['Antrieb'] = transmission.trim();
    if (doors) extras['Türen'] = String(doors);
    if (ccm) extras['ccm'] = String(ccm);
    if (neupreis) extras['Neupreis (€)'] = String(neupreis);
    if (vatText) extras['TVA (site)'] = vatText.replace(/!$/, '');
    vehicles.push({
      id, vin: null, brand, model, version: versionLine, reg_date: ez, year: ez ? Number(ez.slice(0, 4)) : null,
      km, color, fuel, engine: free.engine ?? (ccm ? `${(ccm / 1000).toFixed(1)} (${ccm} ccm)` : null), power_ch: powerCh, gearbox,
      co2: null, damages: null, report_url: null, location: id.split('/')[0] || null,
      price_ht: null, price_ttc: priceTtc, vat_recoverable: vatRecoverable, vat_rate: GERMAN_VAT, imported,
      extras, selected: true, sale_price: null, quantity: 1,
    });
  });
  if (warnings.length > 12) { warnings.length = 12; warnings.push('… (avertissements suivants masqués)'); }
  if (!fileBrand && vehicles.some((v) => !v.brand)) warnings.push('Marque introuvable (ni modèle connu, ni marque dans le nom du fichier) : à renseigner sur les lots.');
  return { vehicles, warnings, brand: fileBrand || vehicles.find((v) => v.brand)?.brand || '', issued_on: issued };
}
