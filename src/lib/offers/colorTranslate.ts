/**
 * TRADUCTION DES COULEURS (13/10, Channing : « un outil pour traduire les
 * couleurs, peu importe la langue d'origine »). Les fichiers fournisseurs
 * écrivent la couleur dans leur langue, souvent collée à un nom commercial
 * (« SCUBABLÅ METALLIC », « GLACIÄRVIT », « MAGNETGRÅ », « DEEP BLACK
 * PÄRLEFFEKT », « KINGS RED METALLIC ») et suivie de l'intérieur
 * (« , BLACK-BLACK/BLACK… (YM) »).
 *
 * Règle : la couleur EXTÉRIEURE est le premier segment (avant la virgule ou
 * la barre) ; on y cherche un mot de couleur connu — tel quel, ou en FIN de
 * mot composé (suédois, danois, norvégien, allemand, néerlandais) — et une
 * finition (métallisé, nacré, mat). Résultat dans la langue de l'offre
 * (« Bleu métallisé » / « Blue metallic »). Rien de reconnu = la couleur
 * d'origine, telle quelle : rien n'est inventé, l'original reste visible.
 */
export type ColorKey =
  | 'WHITE' | 'BLACK' | 'GREY' | 'ANTHRACITE' | 'SILVER' | 'BLUE' | 'RED' | 'GREEN' | 'YELLOW' | 'ORANGE'
  | 'BROWN' | 'BEIGE' | 'PURPLE' | 'PINK' | 'GOLD' | 'BRONZE' | 'BORDEAUX' | 'TURQUOISE' | 'COPPER';
type Finish = 'METALLIC' | 'PEARL' | 'MATTE';

const LABELS: Record<ColorKey, { fr: string; en: string }> = {
  WHITE: { fr: 'Blanc', en: 'White' }, BLACK: { fr: 'Noir', en: 'Black' }, GREY: { fr: 'Gris', en: 'Grey' },
  ANTHRACITE: { fr: 'Gris anthracite', en: 'Anthracite' }, SILVER: { fr: 'Argent', en: 'Silver' }, BLUE: { fr: 'Bleu', en: 'Blue' },
  RED: { fr: 'Rouge', en: 'Red' }, GREEN: { fr: 'Vert', en: 'Green' }, YELLOW: { fr: 'Jaune', en: 'Yellow' }, ORANGE: { fr: 'Orange', en: 'Orange' },
  BROWN: { fr: 'Marron', en: 'Brown' }, BEIGE: { fr: 'Beige', en: 'Beige' }, PURPLE: { fr: 'Violet', en: 'Purple' }, PINK: { fr: 'Rose', en: 'Pink' },
  GOLD: { fr: 'Doré', en: 'Gold' }, BRONZE: { fr: 'Bronze', en: 'Bronze' }, BORDEAUX: { fr: 'Bordeaux', en: 'Burgundy' },
  TURQUOISE: { fr: 'Turquoise', en: 'Turquoise' }, COPPER: { fr: 'Cuivre', en: 'Copper' },
};
const FINISH_LABELS: Record<Finish, { fr: string; en: string }> = {
  METALLIC: { fr: 'métallisé', en: 'metallic' }, PEARL: { fr: 'nacré', en: 'pearl' }, MATTE: { fr: 'mat', en: 'matte' },
};

/** Mots de couleur, par langue (fr, en, de, nl, it, es, pt, sv, da, no, pl, cs, hu, fi), normalisés sans diacritiques. */
const WORDS: Record<ColorKey, string[]> = {
  WHITE: ['blanc', 'blanche', 'white', 'weiss', 'wit', 'bianco', 'bianca', 'blanco', 'blanca', 'branco', 'branca', 'vit', 'hvid', 'hvit', 'bialy', 'biala', 'bily', 'bila', 'feher', 'valkoinen'],
  BLACK: ['noir', 'noire', 'black', 'schwarz', 'zwart', 'nero', 'nera', 'negro', 'negra', 'preto', 'preta', 'svart', 'sort', 'czarny', 'czarna', 'cerny', 'cerna', 'fekete', 'musta'],
  ANTHRACITE: ['anthracite', 'anthrazit', 'antraciet', 'antracite', 'antracita', 'antracit', 'antracyt', 'antracitova'],
  GREY: ['gris', 'grise', 'grey', 'gray', 'grau', 'grijs', 'grigio', 'grigia', 'cinza', 'cinzento', 'gra', 'graa', 'szary', 'szara', 'sedy', 'seda', 'szurke', 'harmaa'],
  SILVER: ['argent', 'argente', 'argentee', 'silver', 'silber', 'zilver', 'argento', 'plata', 'plateado', 'prata', 'solv', 'soelv', 'srebrny', 'srebrna', 'stribrny', 'stribrna', 'ezust', 'hopea'],
  BLUE: ['bleu', 'bleue', 'blue', 'blau', 'blauw', 'blu', 'azzurro', 'azzurra', 'azul', 'bla', 'blaa', 'niebieski', 'niebieska', 'modry', 'modra', 'kek', 'sininen'],
  RED: ['rouge', 'red', 'rot', 'rood', 'rosso', 'rossa', 'rojo', 'roja', 'vermelho', 'vermelha', 'rod', 'roed', 'czerwony', 'czerwona', 'cerveny', 'cervena', 'piros', 'voros', 'punainen'],
  GREEN: ['vert', 'verte', 'green', 'grun', 'gruen', 'groen', 'verde', 'gron', 'groenn', 'gronn', 'zielony', 'zielona', 'zeleny', 'zelena', 'zold', 'vihrea'],
  YELLOW: ['jaune', 'yellow', 'gelb', 'geel', 'giallo', 'gialla', 'amarillo', 'amarilla', 'amarelo', 'amarela', 'gul', 'zolty', 'zolta', 'zluty', 'zluta', 'sarga', 'keltainen'],
  ORANGE: ['orange', 'oranje', 'arancio', 'arancione', 'naranja', 'laranja', 'pomaranczowy', 'oranzovy', 'oranzova', 'narancs', 'oranssi'],
  BROWN: ['marron', 'brun', 'brune', 'brown', 'braun', 'bruin', 'marrone', 'castanho', 'castanha', 'brazowy', 'brazowa', 'hnedy', 'hneda', 'barna', 'ruskea'],
  BEIGE: ['beige', 'bez', 'bezovy', 'bezova', 'bezs'],
  PURPLE: ['violet', 'violette', 'purple', 'violett', 'lila', 'paars', 'viola', 'purpura', 'morado', 'morada', 'roxo', 'roxa', 'fioletowy', 'fialovy', 'fialova', 'violetti'],
  PINK: ['rose', 'pink', 'rosa', 'roze', 'rozowy', 'rozowa', 'ruzovy', 'ruzova', 'rozsaszin', 'pinkki'],
  GOLD: ['or', 'dore', 'doree', 'gold', 'goud', 'oro', 'dorado', 'dourado', 'guld', 'gull', 'zloty', 'zlota', 'zlaty', 'zlata', 'arany', 'kulta'],
  BRONZE: ['bronze', 'bronce', 'bronzo', 'bronz', 'brons'],
  BORDEAUX: ['bordeaux', 'burgundy', 'bordo', 'weinrot', 'vinrod', 'vinroed', 'bordowy', 'bordova'],
  TURQUOISE: ['turquoise', 'turkis', 'turkoois', 'turchese', 'turquesa', 'turkos', 'turkusowy', 'tyrkysova', 'turkiz'],
  COPPER: ['cuivre', 'copper', 'kupfer', 'koper', 'rame', 'cobre', 'koppar', 'kobber'],
};
const FINISH_WORDS: Record<Finish, string[]> = {
  METALLIC: ['metallise', 'metallisee', 'metallic', 'metallik', 'metalizado', 'metalizada', 'metallizzato', 'metallizzata', 'metalic', 'metaliczny', 'metaliza', 'met'],
  PEARL: ['nacre', 'nacree', 'pearl', 'perle', 'perlmutt', 'perleffekt', 'parleffekt', 'perlato', 'perla', 'perlado', 'parelmoer', 'perlowy'],
  MATTE: ['mat', 'mate', 'matt', 'matte', 'opaco', 'opaca', 'matowy', 'matny', 'matta'],
};
/** Mots qui se COLLENT en fin de mot composé (« Scubablå », « Glaciärvit », « Perlweiss », « Monosilver »). */
const COMPOUND = new Set(['vit', 'bla', 'gra', 'svart', 'rod', 'gron', 'gul', 'brun', 'silver', 'hvid', 'hvit', 'sort', 'weiss', 'schwarz', 'grau', 'blau', 'rot', 'grun', 'gelb', 'braun', 'silber', 'violett', 'wit', 'zwart', 'grijs', 'blauw', 'rood', 'groen', 'geel', 'bruin', 'zilver', 'white', 'black', 'grey', 'gray', 'blue', 'red', 'green']);
/** « Couleur inconnue » dans la langue du fournisseur : rien à exporter. */
const UNKNOWN = /^(okand|ukendt|ukjent|unknown|inconnue?|unbekannt|onbekend|sconosciuto|desconocido|na|missing|tbd)$/;

const WORD_TO_KEY = new Map<string, ColorKey>();
for (const [key, words] of Object.entries(WORDS) as Array<[ColorKey, string[]]>) for (const w of words) if (!WORD_TO_KEY.has(w)) WORD_TO_KEY.set(w, key);
const FINISH_TO_KEY = new Map<string, Finish>();
for (const [key, words] of Object.entries(FINISH_WORDS) as Array<[Finish, string[]]>) for (const w of words) FINISH_TO_KEY.set(w, key);

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss').replace(/ł/g, 'l').replace(/đ/g, 'd');

export interface ColorTranslation {
  /** Libellé dans la langue demandée, ou la couleur d'origine si rien n'est reconnu. */
  label: string;
  key: ColorKey | null;
  finish: Finish | null;
  translated: boolean;
}

/** Traduit une couleur de fichier fournisseur ; l'original est rendu tel quel si rien n'est reconnu. */
export function translateColor(raw: string | null | undefined, lang: 'fr' | 'en' = 'fr'): ColorTranslation {
  const original = (raw ?? '').trim();
  if (!original) return { label: '', key: null, finish: null, translated: false };
  // Extérieur = premier segment ; une ligne qui COMMENCE par l'intérieur (« , BLACK-BLACK/… ») n'a pas d'extérieur lisible.
  const segment = original.split(/[,;|]/)[0].replace(/\(.*?\)/g, '').trim();
  if (/^[\s?.-]*$/.test(segment) || UNKNOWN.test(norm(segment).replace(/[^a-z]/g, ''))) return { label: '', key: null, finish: null, translated: true };
  const exterior = segment.split('/')[0].trim();
  const tokens = norm(exterior).split(/[^a-z]+/).filter(Boolean);
  let key: ColorKey | null = null;
  let finish: Finish | null = null;
  for (const t of tokens) {
    if (!key) {
      const exact = WORD_TO_KEY.get(t);
      if (exact) { key = exact; continue; }
      // Mot composé : le mot de couleur en fin (« scubabla » → « bla »), au moins 3 lettres devant.
      for (const c of COMPOUND) if (t.length > c.length + 2 && t.endsWith(c)) { key = WORD_TO_KEY.get(c) ?? null; break; }
      if (key) continue;
    }
    if (!finish) finish = FINISH_TO_KEY.get(t) ?? null;
  }
  if (!key) return { label: original.replace(/^[,/|;\s]+/, '').trim() || original, key: null, finish: null, translated: false };
  const label = `${LABELS[key][lang]}${finish ? ` ${FINISH_LABELS[finish][lang]}` : ''}`;
  return { label, key, finish, translated: true };
}

/** Couleur à afficher / exporter : traduite quand on la reconnaît, sinon celle du fichier. */
export const colorLabel = (raw: string | null | undefined, lang: 'fr' | 'en' = 'fr'): string => translateColor(raw, lang).label;
