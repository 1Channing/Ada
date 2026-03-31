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
