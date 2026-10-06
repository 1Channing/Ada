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
    // Une page en échec (timeout 57014, réseau) était abandonnée en silence
    // et la lecture s'arrêtait là : la liste rendue était tronquée sans que
    // rien ne le dise (constat MI 06/10 : purge des annonces disparues
    // passoire). On réessaie deux fois avant d'abandonner, et on dit alors
    // combien de lignes manquent.
    let page: { data: unknown[] | null; error: { message: string } | null } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
      page = await build(from, Math.min(from + PAGE, maxRows) - 1);
      if (!page.error) break;
    }
    const { data, error } = page!;
    if (error) {
      console.warn(`[${tag}] paged read failed at row ${from} after 3 attempts — result truncated to ${out.length} rows:`, error.message);
      break;
    }
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
