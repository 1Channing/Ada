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
  // 22/11 (Toyota Schiller, Budapest : « BMW X3 xDrive30e », « 330e », « Cupra Leon pHEV » rangées « Hibrid ») : les codes
  // BMW / Mercedes / Volvo des rechargeables — « 330e », « xDrive30e », « 225xe », « 300 de », « A 250 e », « Twin Engine ».
  if (/\b(?:[xs]drive\s?)?\d{2,3}\s?[xd]?e\b(?!-)|twin engine/.test(t)) return 'phev';
  // Même gamme, chiffre déplacé (« HYbrid Allure Pack 225 EAT8 ») ou collé (« HYBRID 225PK ») : seulement sur un titre Stellantis.
  if (/peugeot|citroen|\bds\b|opel|vauxhall|eat8/.test(t) && !/hybrid\s?(?:100|110|120|130|136|145)(?:\s?(?:pk|ch|cv|hp|ps))?\b/.test(t) && /hybrid\b.{0,30}\b(?:180|195|225|300|360)(?:\s?(?:pk|ch|cv|hp|ps))?\b/.test(t)) return 'phev';
  // 19/11 (Hongrie, Das WeltAuto) : « Hibr.B/E külső töltő » = hybride à recharge extérieure ; « Benzin/elektromos »,
  // « benzín + elektro » = hybride (sinon lu « électrique » par la ligne suivante).
  // Slovaquie (Das WeltAuto) : « Hybr.B/E ext.nab. », « Hybr.D/E ext.nab. » (externé nabíjanie = recharge extérieure).
  if (/kulso tolto|ext\.?\s?nab/.test(t)) return 'phev';
  // Renault « E-Tech » : électrique quand suivi de EV / 120 / 150 / 170 / 220 (Mégane, Scénic, 5, Twingo) ; hybride sinon (145 / 200).
  if (/e-tech\s?(?:ev\s?\d{2}|ev\b|120\b|150\b|170\b|220\b)/.test(t)) return 'electric';
  // 22/11 (Italie, Spazio Group) : « Diesel/Elettrica », « Benzina/Elettrica » (italien « elettr- », double t).
  // 25/11 (Danemark, Sand-Jensen) : « Benzin / El », « Diesel / El » (« el » = électrique en danois, suédois, norvégien).
  if (/hybrid|hybride|hybridi|\bhibrid|\bhibr\b|\bhybr\b|\bibrid|\bhev\b|mhev|e-tech|\bh\b|\d{2,3}h\b/.test(t)
    || /(?:benzin|dizel|diesel|nafta|petrol|essence|gasolio)\w*\s*[\/+]\s*(?:elektr|electr|elettr|el\b)|(?:elektr|electr|elettr|\bel\b)\w*\s*[\/+]\s*(?:benzin|dizel|diesel|nafta|petrol|essence|gasolio)/.test(t)) return 'hybrid';
  // 22/11 : noms de gamme électriques sans le mot — Stellantis « e-208 / e-2008 / ë-C4 / e-308 », BMW « i4 / i5 / iX1 / iX3 / eDrive ».
  // 23/11 (Portugal, Consilcar) : « Elétrico » (orthographe de 1990, sans le c).
  if (/electri|eletri|elektr|sahko|\bev\b|\bbev\b|\bel\b|elettric|electric|\belectra\b|\b[eë]-(?:208|2008|c[345]|308|3008|rifter|berlingo|partner|expert|jumpy|traveller|spacetourer)\b|\bi[3-7x]\b|\bix[1-3]\b|\bedrive\d{2}\b/.test(t)) return 'electric';
  // 19/11 : « Dízel », « Gázolaj » (HU), « Nafta » (SK).
  // 23/11 : « Gasóleo » (PT).
  if (/diesel|\bdizel\b|\bgazolaj\b|\bnafta\b|gasolio|\bgasoleo\b|\btdi\b|\bhdi\b|\bdci\b|\bcdi\b|\bcrdi\b|\bd4d\b|bluehdi|\bgazole\b/.test(t)) return 'diesel';
  if (/essence|benzin|bensin|bensiini|petrol|gasolin|super ?plus|\be85\b|ethanol|etanol|\btsi\b|\betsi\b|\btfsi\b|\btce\b|puretech|\bvti\b/.test(t)) return 'petrol';
  if (/\bgpl\b|\bglp\b|\blpg\b|\bcng\b|\bgnv\b|metano|erdgas|autogas|kaasu|\bgaz\b|\bgas\b/.test(t)) return 'gas';
  return null;
}

/**
 * Énergie d'un véhicule de vitrine : la colonne du site, précisée par le titre — un site qui range une « 330e » ou une
 * « Leon pHEV » sous « Hibrid » (22/11, Channing : « hybride rechargeable n'affiche aucun PHEV alors qu'il en existe,
 * prendre en compte le titre ») est corrigé par son titre ; sans colonne, le titre seul.
 */
export function vehicleFuelFamily(fuel: string | null | undefined, title: string | null | undefined): FuelFamily | null {
  const col = fuelFamily(fuel), fromTitle = fuelFamily(title);
  if (col === 'hybrid' && fromTitle === 'phev') return 'phev';
  return col ?? fromTitle;
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
