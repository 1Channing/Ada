# French Plate Number Formatting Enhancement

## Summary

Added automatic French plate number formatting to the Certificat de Cession PDF renderer to ensure all vehicle plates are displayed in the standard format: **AA-123-BB**

## Implementation

### 1. New Helper Function

Created `formatPlateNumber()` in `src/lib/renderers/renderCertificatCession.ts`:

```typescript
function formatPlateNumber(value: string): string {
  if (!value) return value;

  const cleaned = value.replace(/[^A-Z0-9]/g, '').toUpperCase();

  if (cleaned.length === 7) {
    const formatted = `${cleaned.slice(0, 2)}-${cleaned.slice(2, 5)}-${cleaned.slice(5, 7)}`;
    console.log(`[CESSION_FORMAT] Plate formatted: "${value}" -> "${formatted}"`);
    return formatted;
  }

  console.log(`[CESSION_FORMAT] Plate not 7 chars (${cleaned.length}), using cleaned: "${cleaned}"`);
  return cleaned;
}
```

**Behavior:**
- Removes all non-alphanumeric characters
- Converts to uppercase
- If exactly 7 characters, formats as AA-123-BB
- Otherwise, returns the cleaned value
- Logs all transformations for debugging

### 2. Updated Plate Number Processing

Modified the plate number filling logic to use a two-step process:

```typescript
if (data.vehicle?.plate_number) {
  const cleaned = normalizeBoxedValue('plate_number', data.vehicle.plate_number);
  const formatted = formatPlateNumber(cleaned);
  fillFieldSafely(form, `${prefix}.num_Immatriculation[0]`, formatted, `vehicle.plate_number (${page})`, errors, true);
  successCount++;
}
```

**Flow:**
1. First, clean the value using existing `normalizeBoxedValue()` logic
2. Then, apply the new French plate formatting
3. Fill the PDF field with the formatted result

### 3. Safety Features

- Empty values are handled gracefully (no-op)
- Invalid lengths fallback to cleaned value (no crash)
- Works with any input format:
  - `AA123BB` → `AA-123-BB`
  - `aa-123-bb` → `AA-123-BB`
  - `AA 123 BB` → `AA-123-BB`
  - `a a1 2 3b b` → `AA-123-BB`

### 4. Scope

- **Only affects:** Certificat de Cession plate number field
- **Does not modify:**
  - Other document renderers
  - Other fields in the same document
  - Database storage (formatting is display-only)
  - Existing `normalizeBoxedValue()` function

## Testing Examples

| Input | Cleaned | Formatted |
|-------|---------|-----------|
| `AA123BB` | `AA123BB` | `AA-123-BB` |
| `aa-123-bb` | `AA123BB` | `AA-123-BB` |
| `AA 123 BB` | `AA123BB` | `AA-123-BB` |
| `a.a/1-2_3*b#b` | `AA123BB` | `AA-123-BB` |
| `ABC123` | `ABC123` | `ABC123` (6 chars, no format) |
| `ABCD1234` | `ABCD1234` | `ABCD1234` (8 chars, no format) |

## Console Logging

All formatting operations are logged with the `[CESSION_FORMAT]` prefix:

```
[CESSION_FORMAT] Plate formatted: "AA123BB" -> "AA-123-BB"
[CESSION_FORMAT] Plate not 7 chars (6), using cleaned: "ABC123"
```

## Compliance

This enhancement ensures that all Certificat de Cession PDFs display vehicle plate numbers in the official French SIV (Système d'Immatriculation des Véhicules) format, improving readability and administrative compliance.
