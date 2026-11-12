/**
 * MODÈLE DÉDUIT DU VIN (12/11, Channing : « sur l'inspection il y a marqué Model Y alors que c'est une Model 3,
 * vérifie ! ») : le rapport Macadam de la LRW3E7EB4NC573682 l'étiquetait « TESLA MODEL Y » alors que son VIN
 * (4e caractère « 3 »), sa carrosserie « Berline » et ses pneus 235/40 R19 disent Model 3. Chez Tesla le 4e caractère
 * du VIN est le modèle (S, 3, X, Y) : il l'emporte sur l'étiquette du rapport. Module pur.
 */
const TESLA_MODELS: Record<string, string> = { S: 'MODEL S', '3': 'MODEL 3', X: 'MODEL X', Y: 'MODEL Y' };

export function modelFromVin(brand: string | null | undefined, vin: string | null | undefined): string | null {
  if (!vin || vin.length !== 17) return null;
  const b = (brand ?? '').toUpperCase();
  const wmi = vin.slice(0, 3).toUpperCase();
  const isTesla = b.includes('TESLA') || /^(5YJ|7SA|LRW|XP7|7G2|SFZ)$/.test(wmi);
  if (!isTesla) return null;
  return TESLA_MODELS[vin[3].toUpperCase()] ?? null;
}

/** Corrige `model` quand le VIN dit autre chose (« MODEL Y » → « MODEL 3 », « 3 » → « MODEL 3 ») ; le reste du libellé
 *  (« LONG RANGE ») est gardé quand il ne contredit pas le VIN. */
export function applyVinModel<T extends { brand: string | null; model: string | null; vin: string | null }>(fields: T): T {
  const want = modelFromVin(fields.brand, fields.vin);
  if (!want) return fields;
  const cur = (fields.model ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (cur.startsWith(want)) return fields;
  // « MODEL Y PERFORMANCE » → « MODEL 3 PERFORMANCE » ; « 3 » ou vide → « MODEL 3 ».
  const rest = cur.replace(/^(MODEL\s*)?[S3XY]\b/, '').trim();
  return { ...fields, model: rest ? `${want} ${rest}` : want };
}
