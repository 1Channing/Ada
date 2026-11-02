/**
 * PUISSANCE LUE DANS UN TEXTE LIBRE (02/11, Channing : « regarde si les vitrines donnent la puissance,
 * et fais les liens entre puissances équivalentes »). Titres de vitrines : « 145 AT8 », « 130 hv »
 * (finnois), « 132kW », « 150 pk » (néerlandais), « 190 PS » (allemand), « 120CH », « 110 cv ».
 * Les « kWh » (batteries) ne sont jamais une puissance. kW → ch (× 1,36). Rend des chevaux, ou null.
 */
export function powerFromText(text: string | null | undefined): number | null {
  const t = (text ?? '').replace(/\s+/g, ' ');
  if (!t) return null;
  const kw = t.match(/(\d{2,3})\s?kw(?!h)\b/i);
  if (kw) { const n = Math.round(Number(kw[1]) * 1.35962); return n >= 40 && n <= 900 ? n : null; }
  const ch = t.match(/(\d{2,3})\s?(ch|cv|hv|pk|hk|ps|hp)\b/i);
  if (ch) { const n = Number(ch[1]); return n >= 40 && n <= 900 ? n : null; }
  // Stellantis et consorts : la puissance précède le code de boîte (« 145 AT8 », « 130 EAT8 », « 180 EAT 8 »,
  // « 130 MT6 », « 120 BVM6 », « 145 e-DCS6 ») — nombre nu, puis boîte.
  const gear = t.match(/\b(\d{2,3})\s?(e-?)?(AT|EAT|MT|BVM|BVA|DCT|DCS|DSG|CVT)[- ]?\d?\b/i);
  if (gear) { const n = Number(gear[1]); return n >= 60 && n <= 500 ? n : null; }
  return null;
}

/** Puissances équivalentes : à 10 % près (10 ch au moins) — « 130 » et « 131 » (kW convertis) sont la même. */
export function samePower(a: number | null | undefined, b: number | null | undefined): boolean | null {
  if (a == null || b == null) return null;
  return Math.abs(a - b) <= Math.max(10, 0.1 * Math.max(a, b));
}
