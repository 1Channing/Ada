/**
 * FAMILLES D'ÉNERGIE ET DE BOÎTE (14/11) — la lecture d'un mot de site (« Híbrido enchufable », « Benzine »,
 * « Autom. 7-Gang »…) en famille comparable, partagée par les écrans (stockCompare, vitrines de nos clients) et
 * testable sans le client Supabase. Sortie de stockCompare.ts / clientShowcases.ts telle quelle, élargie aux valeurs
 * réelles relevées dans les vitrines (audit du 14/11).
 */
export type FuelFamily = 'phev' | 'hybrid' | 'electric' | 'diesel' | 'petrol' | 'gas';

/** Famille d'énergie, lue dans n'importe quelle langue des sites (Kamux « Hybride rechargeable essence »,
 *  dvnl « Benzine », Bilbasen « benzin / el », nos offres « HYBRIDE RECHARGEABLE », ventes « RAV4 PLUG IN »). */
export function fuelFamily(text: string | null | undefined): FuelFamily | null {
  const t = (text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (!t.trim()) return null;
  // 14/11 (audit des vitrines) : 11 428 voitures en stock avaient une énergie illisible ici — Flexicar « Híbrido
  // (no) enchufable », « Electra », « GLP » ; Italie « Ibrida », « Gasolio », « Metano » ; Allemagne « Erdgas ».
  // « no enchufable » (non rechargeable) avant le rechargeable.
  if (/no enchufable/.test(t)) return 'hybrid';
  // Rechargeable : mot explicite, ou NOM DE GAMME Stellantis (15/11, 408 NL : « 1.6 HYbrid 225 EAT8 » lue hybride légère
  // alors que chez Peugeot / Citroën / DS / Opel « Hybrid 180 / 195 / 225 / 300 / 360 », « Hybrid4 », « E-Tense 225/300/360 »
  // et la boîte « e-EAT8 » ne désignent que les rechargeables ; « Hybrid 136 / 145 » reste l'hybride légère 48 V).
  if (/plug[- ]?in|rechargeable|phev|e-?hybrid|\bplugin\b|enchufable|hybrid\s?(?:180|195|225|300|360)(?:\s?(?:pk|ch|cv|hp|ps))?\b|hybrid4\b|e-tense\s?(?:225|300|360)\b|\be-eat8\b/.test(t)) return 'phev';
  // Même gamme, chiffre déplacé (« HYbrid Allure Pack 225 EAT8 ») ou collé (« HYBRID 225PK ») : seulement sur un titre Stellantis.
  if (/peugeot|citroen|\bds\b|opel|vauxhall|eat8/.test(t) && !/hybrid\s?(?:100|110|120|130|136|145)(?:\s?(?:pk|ch|cv|hp|ps))?\b/.test(t) && /hybrid\b.{0,30}\b(?:180|195|225|300|360)(?:\s?(?:pk|ch|cv|hp|ps))?\b/.test(t)) return 'phev';
  // 19/11 (Hongrie, Das WeltAuto) : « Hibr.B/E külső töltő » = hybride à recharge extérieure ; « Benzin/elektromos »,
  // « benzín + elektro » = hybride (sinon lu « électrique » par la ligne suivante).
  if (/kulso tolto/.test(t)) return 'phev';
  if (/hybrid|hybride|hybridi|\bhibrid|\bhibr\b|\bibrid|\bhev\b|mhev|e-tech|\bh\b|\d{2,3}h\b/.test(t)
    || /(?:benzin|dizel|diesel|nafta|petrol|essence)\s*[\/+]\s*(?:elektr|electr)|(?:elektr|electr)\w*\s*[\/+]\s*(?:benzin|dizel|diesel|nafta|petrol|essence)/.test(t)) return 'hybrid';
  if (/electri|elektr|sahko|\bev\b|\bbev\b|\bel\b|elettric|electric|\belectra\b/.test(t)) return 'electric';
  // 19/11 : « Dízel » (HU), « Nafta » (SK).
  if (/diesel|\bdizel\b|\bnafta\b|gasolio|\btdi\b|\bhdi\b|\bdci\b|\bcdi\b|\bcrdi\b|\bd4d\b|bluehdi|\bgazole\b/.test(t)) return 'diesel';
  if (/essence|benzin|bensin|bensiini|petrol|gasolin|super ?plus|\be85\b|ethanol|etanol|\btsi\b|\btfsi\b|\btce\b|puretech|\bvti\b/.test(t)) return 'petrol';
  if (/\bgpl\b|\bglp\b|\blpg\b|\bcng\b|\bgnv\b|metano|erdgas|autogas|kaasu|\bgaz\b|\bgas\b/.test(t)) return 'gas';
  return null;
}

export type GearboxFamily = 'auto' | 'manual';

/** Boîte lue dans une colonne de relevé (« Automaat », « Handgeschakeld », « Automatique ») ou un titre (« *Automaat »). */
export function gearboxFamily(text: string | null | undefined): GearboxFamily | null {
  const t = (text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (!t.trim()) return null;
  // 14/11 (audit des vitrines) : « Autom. 7-Gang » (DE), « A Var Continu » (variateur), « Rob Double / Simple Embray »
  // (robotisée, DMD) n'étaient pas reconnues.
  if (/automa|automaat|\bautom\b|\bauto\b|\baut\.?\b|\bcvt\b|\bdsg\b|\bdct\b|e-?cvt|steptronic|tiptronic|s-?tronic|\bbva\b|\beat\d\b|\bedc\b|var(iateur)? continu|robotis|\brob\b|embray/.test(t)) return 'auto';
  if (/handgeschakeld|handbak|manual|manuel|schalt|\bbvm\b|\bmt\b/.test(t)) return 'manual';
  return null;
}
