/**
 * Lecture COMPLÈTE d'une table par pages de 1 000 (PostgREST plafonne chaque
 * réponse à 1 000 lignes) — remplace les `.limit(N)` devinés qui tronquaient
 * en silence (alerte campagne.marques du 07/09 : 3 238 mappings validés, 1 000
 * lus, des marques absentes des puces). Neutre front/worker : le consommateur
 * fournit la page et signale lui-même le plafond via son `capped`.
 *
 *   const rows = await readAllPages((from, to) => q.range(from, to), 50_000);
 *
 * `cap` n'est qu'un garde-fou contre une table qui exploserait ; l'ordre de la
 * requête DOIT être stable (order sur une colonne unique ou id) sinon les
 * pages se chevauchent.
 */
export async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  cap = 50_000,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += pageSize) {
    const { data, error } = await page(from, Math.min(from + pageSize, cap) - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
