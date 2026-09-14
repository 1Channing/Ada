/**
 * CONTRÔLE DE PARAMÉTRAGE À LA SAISIE D'UNE ÉTUDE (décision Channing 14/09 :
 * « on fiabilise avant de développer autour »). Trois des six études qui ne
 * rapportaient rien le 14/09 auraient été arrêtées ici :
 *   - Hyundai Tucson à 325 ch de puissance minimale (aucun Tucson) ;
 *   - finition cible « 1.5 Hybrid Executive » : trois mots à retrouver À LA
 *     SUITE dans chaque titre → 100 % des annonces NL écartées ;
 *   - Suzuki Ignis en « hybride » : AutoScout FR classe l'Ignis 1.2 Dualjet
 *     Hybrid en « Essence »/« Autres » (preuve curl 14/09 : fuel=2 → 0).
 * Chaque règle ne dit que ce qui est PROUVÉ ; « block » arrête, « warn »
 * demande confirmation. Aucune règle ne devine.
 */

export interface StudyCheckInput {
  brand?: string; model?: string; fuel?: string;
  trim?: string; trim_target?: string;
  power_min?: number | null;
  year_min?: number | null; year_max?: number | null;
  price_gap_min?: number; price_gap_max?: number;
  mileage_max?: number | null;
}

export interface StudyCheck { level: 'block' | 'warn'; text: string }

/**
 * Modèles dont la motorisation « hybride » n'est PAS reconnue comme telle par
 * au moins un site (micro-hybrides classées essence). Chaque entrée porte sa
 * preuve ; on n'y met rien sans URL humaine ou curl.
 */
const MILD_HYBRID_AS_PETROL: Record<string, Record<string, string>> = {
  SUZUKI: {
    IGNIS: 'AutoScout FR classe l\'Ignis 1.2 Dualjet Hybrid en « Essence » / « Autres » (preuve 14/09 : avec filtre hybride 0 annonce, sans filtre 3). La Centrale était à 0 aussi.',
  },
};

/** Au-delà, aucun modèle grand public : on demande confirmation ; au-delà de 600 ch on refuse. */
const POWER_WARN_CH = 300;
const POWER_BLOCK_CH = 600;

const words = (s?: string) => (s ?? '').trim().split(/\s+/).filter(Boolean);

export function studyChecks(s: StudyCheckInput): StudyCheck[] {
  const out: StudyCheck[] = [];
  const brand = (s.brand ?? '').trim().toUpperCase();
  const model = (s.model ?? '').trim().toUpperCase();

  if (s.year_min != null && s.year_max != null && s.year_min > s.year_max) {
    out.push({ level: 'block', text: `Années inversées : ${s.year_min} > ${s.year_max}.` });
  }
  if (s.price_gap_min != null && s.price_gap_max != null && s.price_gap_min > s.price_gap_max) {
    out.push({ level: 'block', text: `Écart voulu inversé : ${s.price_gap_min} > ${s.price_gap_max} €.` });
  }
  if (s.power_min != null && s.power_min >= POWER_BLOCK_CH) {
    out.push({ level: 'block', text: `Puissance minimale ${s.power_min} ch : aucun ${model || 'modèle'} n'atteint cette puissance, l'étude ne rendrait rien.` });
  } else if (s.power_min != null && s.power_min >= POWER_WARN_CH) {
    out.push({ level: 'warn', text: `Puissance minimale ${s.power_min} ch : très peu de ${model || 'modèles'} dépassent ${POWER_WARN_CH} ch. Vérifie que ce n'est pas 1${String(s.power_min).slice(1)} ou 2${String(s.power_min).slice(1)}.` });
  }
  for (const [label, value] of [['finition', s.trim], ['finition cible', s.trim_target]] as const) {
    const w = words(value);
    if (w.length >= 3) {
      out.push({ level: 'warn', text: `${label[0].toUpperCase()}${label.slice(1)} « ${value} » : ${w.length} mots, tous à retrouver à la suite dans chaque titre — c'est ce qui vidait « YARIS CROSS COLLECTION » côté NL. Un seul mot (« ${w[w.length - 1]} ») suffit presque toujours.` });
    } else if (w.some((t) => /^\d+([.,]\d+)?$/.test(t))) {
      out.push({ level: 'warn', text: `${label[0].toUpperCase()}${label.slice(1)} « ${value} » contient une cylindrée : elle n'est pas dans tous les titres, préfère le nom de la finition seul.` });
    }
  }
  if (/HYBRID/i.test(s.fuel ?? '') && !/RECHARGEABLE|PLUG/i.test(s.fuel ?? '')) {
    const proof = MILD_HYBRID_AS_PETROL[brand]?.[model];
    if (proof) out.push({ level: 'warn', text: `Carburant « hybride » sur ${brand} ${model} : ${proof} Avec ce filtre, ce site rendra 0. Mets « toutes » ou « essence » pour ce modèle.` });
  }
  return out;
}
