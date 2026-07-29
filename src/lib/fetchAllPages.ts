/**
 * Lecture paginée complète (PostgREST).
 *
 * PostgREST plafonne SILENCIEUSEMENT toute requête à ~1000 lignes — même
 * `.limit(5000)` en rend 1000. Toute lecture d'une table qui dépasse ce seuil
 * doit passer par ici, sinon elle voit une fraction arbitraire des données
 * sans la moindre erreur : le Market Intelligence ne voyait que les 1000 plus
 * vieilles observations (26/07), et la cartographie que 1000 des 13 470
 * entrées du dictionnaire de taxonomie — d'où un compteur « modèles couverts »
 * figé alors que les campagnes de découverte apprenaient par milliers (29/07).
 *
 * Trier DESC quand l'ordre compte : si le garde-fou `maxRows` est atteint,
 * c'est la donnée la plus ancienne qui tombe, jamais la plus fraîche.
 */
export async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  maxRows: number,
  tag = 'PAGED_READ',
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE) {
    const { data, error } = await build(from, Math.min(from + PAGE, maxRows) - 1);
    if (error) {
      console.warn(`[${tag}] paged read failed:`, error.message);
      break;
    }
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
