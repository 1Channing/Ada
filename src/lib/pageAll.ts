/**
 * TOUTES LES LIGNES, PAR PAGES DE 1 000 (02/10, constat Channing : « deuxième
 * relevé Louwman, aucun véhicule disparu »). PostgREST ne rend JAMAIS plus de
 * 1 000 lignes par requête, quel que soit `.limit(n)` : un `.limit(5000)`
 * rend 1 000 lignes en silence. Le relevé précédent de Louwman (3 904
 * voitures) lu tronqué → 2 904 voitures connues prises pour nouvelles.
 *
 * Usage : `pageAll((from, to) => builder.range(from, to))`. Le builder DOIT
 * porter un ordre déterministe (une colonne unique en dernier, `id` ou
 * `external_id`), sinon les pages peuvent se chevaucher. `max` borne le total.
 */
export async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  max = 100_000,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(from, Math.min(from + 999, max - 1));
    if (error) return { data: out, error };
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return { data: out, error: null };
}
