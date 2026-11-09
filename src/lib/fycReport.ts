/**
 * FYC — LECTURE D'UN RAPPORT D'INSPECTION (10/11). Partie pure : des lignes de texte (PDF VTI / Macadam, en
 * français ou en anglais) → les champs de la voiture et les dommages. Testée hors navigateur sur le rapport
 * Cupra Born n° 11145241 (texte anglais du PDF et texte français de la visionneuse).
 *
 * Les rapports mettent l'intitulé et la valeur sur la même ligne (« Make: Cupra ») ou sur deux lignes
 * (« Marque » puis « Cupra ») : les deux formes sont lues.
 */
export interface FycDamage { zone: string; kind: string; action: string; raw: string }
export interface FycReportFields {
  report_number: string | null; report_date: string | null; vin: string | null;
  brand: string | null; model: string | null; version: string | null; body: string | null;
  first_registration: string | null; year: number | null; km: number | null;
  fuel: string | null; gearbox: string | null; power_ch: number | null; color: string | null;
  doors: number | null; seats: number | null; repainted: boolean | null;
  damages: { devaluation: FycDamage[]; usage: FycDamage[] };
  raw_fields: Record<string, string>;
}

type Rule = { key: keyof FycReportFields | 'order_date' | 'power_raw' | 'repaint_raw' | 'model_type'; re: RegExp };
const RULES: Rule[] = [
  { key: 'report_number', re: /^(?:Report number|N[°o]\s*de rapport|Assessment Number)\s*:?/i },
  { key: 'order_date', re: /^(?:Order completed|Inspecté le|Date d'inspection)\s*:?/i },
  { key: 'vin', re: /^(?:VIN|N[°o]\s*de ch[aâ]ssis|Chassis number|Fahrgestellnummer)\s*:?/i },
  { key: 'brand', re: /^(?:Make|Marque|Merk|Marke)\s*:?/i },
  { key: 'model', re: /^(?:Model|Modèle|Modell)\s*:?/i },
  { key: 'model_type', re: /^(?:Manufacturers and type code|HSN\s*\/\s*TSN)\s*:?/i },
  { key: 'body', re: /^(?:Vehicle type|Type de carrosserie|Body type)\s*:?/i },
  { key: 'first_registration', re: /^(?:Date of first registration|Date de 1[èe]re immatriculation|Première immatriculation|First registration)\s*:?/i },
  { key: 'km', re: /^(?:Mileage|Kilométrage|Kilometerstand)\s*:?/i },
  { key: 'fuel', re: /^(?:Fuel|Carburant|Énergie|Energie|Brandstof)\s*:?/i },
  { key: 'gearbox', re: /^(?:Gearbox|Boîte de vitesses?|Transmission|Getriebe)\s*:?/i },
  { key: 'power_raw', re: /^(?:Performance|Puissance|Power|Leistung)\s*:?/i },
  { key: 'color', re: /^(?:Exterior colou?r|Couleur extérieure)\s*:?/i },
  { key: 'doors', re: /^(?:Number of doors|Nombre de portes)\s*:?/i },
  { key: 'seats', re: /^(?:Number of seats|Nombre de sièges|Nombre de places)\s*:?/i },
  { key: 'repaint_raw', re: /^(?:Repainting present|Peinture refaite|Repeinte|Présence de repeinture|Traces de peinture)\s*:?/i },
];
const ANY_LABEL = /^[A-Za-zÀ-ÿ'’/ ()°.-]{3,60}\s*:\s*$/;
const SECTION = /^»\s*(.+)$/;
const DEVAL_HEAD = /^(?:DEVALUATION FACTORS|Devaluation Damages|FACTEURS DE DÉVALUATION|Dommages de dévaluation|Dégâts de dévaluation)/i;
const USAGE_HEAD = /^(?:USAGE DAMAGES|Usage damages|DOMMAGES D'USAGE|Dommages d'usage|Dégâts d'usage)/i;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const num = (s: string | null): number | null => { if (!s) return null; const m = s.replace(/[\s  .,](?=\d{3}\b)/g, '').match(/\d+/); return m ? Number(m[0]) : null; };
const isoDate = (s: string | null): string | null => { const m = (s ?? '').match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };

export function parseFycReport(lines: string[]): FycReportFields {
  const L = lines.map(clean).filter(Boolean);
  const raw: Record<string, string> = {};
  const got: Partial<Record<Rule['key'], string>> = {};
  const valueAt = (i: number, re: RegExp): string => {
    const same = L[i].replace(re, '').trim();
    if (same) return same;
    // Valeur sur la ligne suivante, sauf si c'est un autre intitulé.
    const next = L[i + 1] ?? '';
    if (!next || ANY_LABEL.test(next) || RULES.some((r) => r.re.test(next)) || SECTION.test(next) || /^Page \d+ of \d+/i.test(next)) return '';
    return next;
  };
  let section = '';
  const dev: FycDamage[] = []; const use: FycDamage[] = [];
  let list: FycDamage[] | null = null;
  for (let i = 0; i < L.length; i++) {
    const line = L[i];
    const sec = line.match(SECTION);
    if (sec) { section = sec[1]; list = /Devaluation Damages|dévaluation/i.test(section) ? dev : null; continue; }
    if (DEVAL_HEAD.test(line)) { list = dev; continue; }
    if (USAGE_HEAD.test(line)) { list = use; continue; }
    if (list) {
      const d = line.match(/^(\d{1,3})\s*-\s*(.+)$/);
      if (d) {
        const parts = d[2].split(/\s+-\s+/).map((x) => x.trim());
        list.push({ zone: parts[0] ?? '', kind: parts[1] ?? '', action: parts.slice(2).join(' - '), raw: d[2] });
        continue;
      }
      if (/^Page \d+ of \d+/i.test(line) || /^Macadam|^Assessment Number|^From:|^- Vehicle Inspection Report|^Rapport d'inspection|^N[°o] de rapport|^Du:/i.test(line)) continue;
    }
    for (const r of RULES) {
      if (got[r.key] != null) continue;
      if (r.re.test(line)) {
        const v = valueAt(i, r.re);
        // Un kilométrage ou une puissance sans chiffre n'est pas une valeur (légende de photo « Kilométrage »).
        if (v && !((r.key === 'km' || r.key === 'power_raw' || r.key === 'doors' || r.key === 'seats') && !/\d/.test(v))) { got[r.key] = v; raw[r.key] = v; }
        break;
      }
    }
  }
  const power = got.power_raw ?? '';
  const ps = power.match(/(\d{2,4})\s*(?:PS|CV|ch|hp)/i)?.[1];
  const kw = power.match(/(\d{2,4})\s*kW/i)?.[1];
  const reg = isoDate(got.first_registration ?? null);
  const repaint = got.repaint_raw ?? null;
  return {
    report_number: got.report_number ?? null,
    report_date: isoDate(got.order_date ?? null),
    vin: (got.vin ?? '').match(/[A-HJ-NPR-Z0-9]{17}/i)?.[0]?.toUpperCase() ?? null,
    brand: got.brand ?? null,
    model: got.model ?? null,
    version: got.model_type ?? null,
    body: got.body ?? null,
    first_registration: reg,
    year: reg ? Number(reg.slice(0, 4)) : null,
    km: num(got.km ?? null),
    fuel: got.fuel ?? null,
    gearbox: got.gearbox ?? null,
    power_ch: ps ? Number(ps) : kw ? Math.round(Number(kw) * 1.36) : null,
    color: got.color ?? null,
    doors: num(got.doors ?? null),
    seats: num(got.seats ?? null),
    repainted: repaint == null ? null : /^(yes|oui|ja)/i.test(repaint) ? true : /^(no|non|nein)/i.test(repaint) ? false : null,
    damages: { devaluation: dev, usage: use },
    raw_fields: raw,
  };
}

/** Résumé court des dommages (pastilles) : « 4 pneus à remplacer », « 1 jante à retoucher »… */
export function damageSummary(d: FycReportFields['damages']): string[] {
  const out: string[] = [];
  const tyres = d.devaluation.filter((x) => /tyre|pneu|reifen|band/i.test(x.zone)).length;
  const rims = d.devaluation.filter((x) => /rim|jante|felge|velg/i.test(x.zone)).length;
  const bodyDev = d.devaluation.length - tyres - rims;
  if (tyres) out.push(`${tyres} pneu${tyres > 1 ? 's' : ''} à remplacer`);
  if (rims) out.push(`${rims} jante${rims > 1 ? 's' : ''} à retoucher`);
  if (bodyDev > 0) out.push(`${bodyDev} dommage${bodyDev > 1 ? 's' : ''} de dévaluation`);
  if (d.usage.length) out.push(`${d.usage.length} trace${d.usage.length > 1 ? 's' : ''} d'usage`);
  if (!out.length) out.push('rien à signaler');
  return out;
}
