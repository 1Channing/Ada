/**
 * RECHERCHE DANS LES TITRES DES LEADS (09/11 soir, Channing : « en tapant t roc je trouve une Aygo » — « t » dans
 * Toyota et « roc » dans irréprochable). Partie pure, testable hors navigateur.
 *
 * Règle : chaque mot tapé doit COMMENCER un mot du titre ; et la requête collée (« troc ») est aussi cherchée
 * au début d'une suite de mots du titre, pour que « t roc », « t-roc » et « troc » se valent (« c4x » ↔ « C4 X »).
 */
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const tokensOf = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
export function matchesQuery(title: string, q: string): boolean {
  const words = tokensOf(q);
  if (words.length === 0) return true;
  const tokens = tokensOf(title);
  if (words.every((w) => tokens.some((t) => t.startsWith(w)))) return true;
  const joined = words.join('');
  for (let i = 0; i < tokens.length; i++) if (tokens.slice(i).join('').startsWith(joined)) return true;
  return false;
}
