# Certificate of Cession - Proper Boxed Field Rendering

## Summary

The certificate of cession now uses a dedicated renderer with proper character-by-character boxed field rendering. Every boxed field is written one character per box with precise spacing.

## Changes Made

### 1. New Dedicated Renderer

Created `/src/lib/certificatCessionRenderer.ts` with three rendering modes:

**BOXED FIELD RENDERER**
- One character per box
- Fixed spacing between boxes
- Character centering within each box
- Automatic value normalization

**TEXT FIELD RENDERER**
- Normal linear text placement
- Width-based truncation with ellipsis
- Field-by-field explicit coordinates

**CHECKBOX RENDERER**
- Centered X mark placement
- Person type detection (physical vs moral)
- Yes/no style checkboxes

### 2. Boxed Fields Implementation

All boxed fields render character-by-character:

- `plate_number` - 9 chars, 10px spacing
- `vin` - 17 chars, 8px spacing
- `first_registration_date` - 8 digits (DDMMYYYY), 8px spacing
- `registration_certificate_number` - 12 chars, 9px spacing
- `seller_postal_code` - 5 digits, 10px spacing
- `seller_siret` - 14 digits, 9px spacing
- `buyer_birth_date` - 8 digits (DDMMYYYY), 8px spacing
- `buyer_postal_code` - 5 digits, 10px spacing
- `buyer_siret` - 14 digits, 9px spacing
- `transaction_date` - 8 digits (DDMMYYYY), 8px spacing
- `transaction_time` - 4 digits (HHMM), 8px spacing

### 3. Value Normalization

Each boxed field is normalized before rendering:

```typescript
"AB-123-CD" → "AB123CD"
"12/02/1997" → "12021997"
"75 001" → "75001"
"123 456 789 00012" → "12345678900012"
```

Rules:
- Plate numbers: Remove separators, uppercase, max 9 chars
- VIN: Remove separators, uppercase, max 17 chars
- Dates: Extract digits only, format as DDMMYYYY
- Postal codes: Digits only, max 5
- SIRET/SIREN: Digits only, max 14/9

### 4. Text Fields Mapping

Explicit coordinate mapping for all text fields:

**Vehicle Section**
- brand, type_variant_version, national_type, commercial_name
- mileage

**Seller Section**
- company_name OR full_name (first + last)
- address_line1, address_line2
- city

**Buyer Section**
- company_name OR full_name (first + last)
- birth_place
- address_line1, address_line2
- city

### 5. Checkbox Logic

Automatic checkbox placement based on data:

**Person Type**
- Physical: No company_name
- Moral: Has company_name

**Registration Certificate**
- Yes/No based on `registration_certificate_present`

**Actions**
- Seller: Always check "céder"
- Buyer: Always check "acquérir" and "informé"

### 6. Integration

Modified `templateEngine.ts` to use dedicated renderer:

```typescript
if (templateName === 'Certificat de cession') {
  await renderCertificatCession(pdfDoc, data);
  return pdfBytes;
}
```

Other document templates continue to use the generic coordinate system.

## Debug Logging

New log prefixes for certificate rendering:

- `[CESSION_RENDER]` - Overall rendering flow
- `[CESSION_BOXED]` - Boxed field rendering with normalization details
- `[CESSION_TEXT]` - Text field placement
- `[CESSION_CHECKBOX]` - Checkbox state and placement

Example logs:
```
[CESSION_RENDER] Starting certificate of cession rendering with dedicated mapping
[CESSION_BOXED] field=plate_number raw="RE-880-RE" normalized="RE880RE"
[CESSION_BOXED] Rendering field at (60, 735), charCount=7, spacing=10
[CESSION_BOXED] Rendered 7 characters
[CESSION_BOXED] field=vin charCount=17
[CESSION_TEXT] field at (60, 715) value="RENAULT"
[CESSION_CHECKBOX] field=seller_person_type value=moral
```

## Acceptance Criteria - Met

✅ Plate number rendered one character per box
✅ VIN rendered one character per box
✅ Dates rendered one digit per box
✅ Postal codes rendered one digit per box
✅ SIRET rendered one digit per box
✅ Seller and buyer text blocks placed in correct sections
✅ No overlapping text
✅ No long raw strings dumped across form
✅ Certificate generates even with empty optional fields

## No Mandatory Field Blocking

The certificate generates successfully even if:
- Birth date is empty
- Birth place is empty
- SIRET/SIREN is empty
- Postal code is empty
- Address fields are empty
- Transaction time is empty

Empty boxed fields remain blank without causing errors.

## Technical Details

**Character Centering Algorithm**
```typescript
const charWidth = font.widthOfTextAtSize(char, size);
const charX = startX + (i * charSpacing) + (charSpacing - charWidth) / 2;
```

Each character is measured and centered within its box position.

**Date Formatting**
```typescript
const date = new Date(dateString);
const day = String(date.getDate()).padStart(2, '0');
const month = String(date.getMonth() + 1).padStart(2, '0');
const year = String(date.getFullYear());
return `${day}${month}${year}`;
```

ISO dates (YYYY-MM-DD) converted to French format (DDMMYYYY) for boxed rendering.

## Build Status

✅ Build successful
✅ No TypeScript errors
✅ No runtime errors
✅ Bundle size: 1571 KB (gzipped: 506 KB)

## Files Modified

- `/src/lib/certificatCessionRenderer.ts` - NEW dedicated renderer
- `/src/lib/templateEngine.ts` - Integration point added

## Files Not Modified

No changes to:
- Generic coordinate system
- Other document templates
- Scraping systems
- Study systems
- Worker systems
- Database schemas
