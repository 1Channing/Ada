const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sanitizeUUID(input: string | null | undefined): string {
  if (!input) {
    throw new Error('UUID input is null or undefined');
  }

  let cleaned = input.trim();
  cleaned = cleaned.replace(/^<+/, '').replace(/>+$/, '');
  cleaned = cleaned.trim();

  if (!UUID_REGEX.test(cleaned)) {
    console.error('[UUID_SANITIZER] Invalid UUID format:', input, '-> cleaned:', cleaned);
    throw new Error(`Invalid UUID format: "${input}"`);
  }

  return cleaned;
}

export function isValidUUID(input: string | null | undefined): boolean {
  if (!input) return false;

  try {
    const cleaned = input.trim().replace(/^<+/, '').replace(/>+$/, '').trim();
    return UUID_REGEX.test(cleaned);
  } catch {
    return false;
  }
}

export function sanitizeUUIDSafe(input: string | null | undefined, fallback: string = ''): string {
  try {
    return sanitizeUUID(input);
  } catch {
    return fallback;
  }
}
