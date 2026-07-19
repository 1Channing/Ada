export function normalizeBoxedValue(fieldName: string, value: string): string {
  const raw = value;
  let normalized = value;

  if (fieldName === 'plate_number' || fieldName.includes('plate_number')) {
    normalized = value.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  } else if (fieldName === 'vin' || fieldName.includes('vin')) {
    normalized = value.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  } else if (fieldName.includes('postal_code')) {
    normalized = value.replace(/\D/g, '');
  } else if (fieldName.includes('siren') || fieldName.includes('siret')) {
    normalized = value.replace(/\D/g, '');
  } else if (fieldName.includes('date')) {
    normalized = value.replace(/\D/g, '');
  } else if (fieldName === 'transaction_time') {
    normalized = value.replace(/\D/g, '').slice(0, 4);
  }

  if (normalized !== raw) {
    console.log(`[FIELD_NORMALIZE] field=${fieldName} raw="${raw}" normalized="${normalized}"`);
  }

  return normalized;
}

export function splitDate(dateString?: string): { day: string; month: string; year: string } {
  if (!dateString) return { day: '', month: '', year: '' };

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return { day: '', month: '', year: '' };

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());

  return { day, month, year };
}

export function splitTime(timeString?: string): { hours: string; minutes: string } {
  if (!timeString) return { hours: '', minutes: '' };

  const match = timeString.match(/(\d{1,2}):(\d{2})/);
  if (!match) return { hours: '', minutes: '' };

  const hours = match[1].padStart(2, '0');
  const minutes = match[2].padStart(2, '0');

  return { hours, minutes };
}

export function formatValue(value: string, format?: string): string {
  if (!value || !format) return value;

  if (format === 'date' && value) {
    const date = new Date(value);
    return date.toLocaleDateString('fr-FR');
  }

  if (format === 'date_time' && value) {
    const date = new Date(value);
    return `${date.toLocaleDateString('fr-FR')} ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  if (format === 'currency' && value) {
    return `${value} €`;
  }

  return value;
}

/**
 * Découpe une ligne d'adresse française en cases CERFA :
 * n° de voie / extension (BIS, TER…) / type de voie / nom de voie.
 * Partagé par le Certificat de cession et la Déclaration d'achat — le CERFA a
 * une case par élément, y verser la ligne entière mettait tout au mauvais
 * endroit. En cas d'adresse atypique, tout reste dans `name` (comportement sûr).
 */
export function parseAddressLine(addressLine: string): {
  number: string;
  extension: string;
  type: string;
  name: string;
} {
  const result = { number: '', extension: '', type: '', name: '' };

  const parts = addressLine.trim().split(/\s+/);
  if (parts.length === 0) return result;

  const numberMatch = parts[0]?.match(/^(\d+)([A-Z]*)?$/i);
  if (numberMatch) {
    result.number = numberMatch[1];
    result.extension = (numberMatch[2] || '').toUpperCase();
    parts.shift();
  }

  // Extension en mot séparé : « 12 BIS RUE … » ou lettre isolée « 88 B AVENUE … ».
  const EXTENSIONS = ['BIS', 'TER', 'QUATER'];
  const nextWord = parts[0]?.toUpperCase() ?? '';
  if (!result.extension && EXTENSIONS.includes(nextWord)) {
    result.extension = parts.shift()!.toUpperCase();
  } else if (!result.extension && result.number && /^[A-Z]$/.test(nextWord) && parts.length > 1) {
    // Lettre unique juste après le numéro et suivie d'autre chose (le type/nom
    // de voie) : c'est une extension (88 B av. …), pas le début du nom de voie.
    result.extension = parts.shift()!.toUpperCase();
  }

  const TYPE_ALIASES: Record<string, string> = {
    AV: 'AVENUE', 'AV.': 'AVENUE',
    BD: 'BOULEVARD', 'BD.': 'BOULEVARD', BLVD: 'BOULEVARD',
    PL: 'PLACE', 'PL.': 'PLACE',
    RTE: 'ROUTE', CHE: 'CHEMIN', IMP: 'IMPASSE', ALL: 'ALLEE',
  };
  const STREET_TYPES = [
    'RUE', 'AVENUE', 'BOULEVARD', 'PLACE', 'ROUTE', 'CHEMIN', 'IMPASSE',
    'ALLEE', 'ALLÉE', 'COURS', 'QUAI', 'SQUARE', 'PASSAGE', 'VOIE',
    'SENTIER', 'RESIDENCE', 'RÉSIDENCE', 'LOTISSEMENT', 'HAMEAU', 'LIEU-DIT',
  ];
  const firstUpper = parts[0]?.toUpperCase() ?? '';
  if (TYPE_ALIASES[firstUpper]) {
    result.type = TYPE_ALIASES[firstUpper];
    parts.shift();
  } else if (STREET_TYPES.includes(firstUpper)) {
    result.type = parts.shift()!;
  }

  result.name = parts.join(' ');
  return result;
}
