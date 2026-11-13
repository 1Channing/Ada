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
  if (/plug[- ]?in|rechargeable|phev|e-?hybrid|\bplugin\b|enchufable/.test(t)) return 'phev';
  if (/hybrid|hybride|hybridi|\bhibrid|\bibrid|\bhev\b|mhev|e-tech|\bh\b|\d{2,3}h\b/.test(t)) return 'hybrid';
  if (/electri|elektr|sahko|\bev\b|\bbev\b|\bel\b|elettric|electric|\belectra\b/.test(t)) return 'electric';
  if (/diesel|gasolio|\btdi\b|\bhdi\b|\bdci\b|\bcdi\b|\bcrdi\b|\bd4d\b|bluehdi|\bgazole\b/.test(t)) return 'diesel';
  if (/essence|benzin|bensin|bensiini|petrol|gasolin|super ?plus|\be85\b|ethanol|\btsi\b|\btfsi\b|\btce\b|puretech|\bvti\b/.test(t)) return 'petrol';
  if (/\bgpl\b|\bglp\b|\blpg\b|\bcng\b|\bgnv\b|metano|erdgas|kaasu|\bgaz\b|\bgas\b/.test(t)) return 'gas';
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
