# Bon d'achat Font Embedding Fix

## Problem
Text truncation was occurring on Bon d'achat PDF across different devices, particularly mobile devices. The issue was caused by non-embedded fonts leading to device-dependent font substitution and incorrect text width calculations.

## Root Cause
- `form.updateFieldAppearances()` was called without an embedded font parameter
- PDF relied on system fonts for rendering
- Different devices substituted different fonts
- Text metrics varied across devices → truncation

## Solution Implemented

### Changes Made
File: `src/lib/renderers/renderBonAchat.ts`

1. **Added StandardFonts import**
   ```typescript
   import { PDFDocument, StandardFonts } from 'pdf-lib';
   ```

2. **Embedded Helvetica font**
   ```typescript
   const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
   console.log('[BON_ACHAT_ACROFORM] Embedded Helvetica font for consistent rendering');
   ```

3. **Updated field appearances with embedded font**
   ```typescript
   form.updateFieldAppearances(font);
   ```

### What Was NOT Changed
- Field mapping logic (fillVehicleFields, fillTransactionFields, fillSellerFields)
- Data transformations
- Error handling
- Form flattening (kept as-is)
- All other renderers remain unchanged

## Expected Result
- Text renders identically across ALL devices (desktop, mobile, tablets)
- No truncation on any platform
- Consistent text width calculations
- No dependency on system-installed fonts
- Predictable, embedded font ensures reliable rendering

## Technical Details
- Font: StandardFonts.Helvetica (embedded into PDF)
- Font embedding ensures PDF contains all necessary font data
- `updateFieldAppearances(font)` uses embedded font metrics for appearance streams
- Form is still flattened after appearance update for maximum compatibility

## Testing Recommendations
1. Generate a Bon d'achat PDF with vehicle data containing long text strings
2. Test on multiple devices:
   - Desktop browsers (Chrome, Firefox, Safari, Edge)
   - Mobile browsers (iOS Safari, Chrome Android)
   - PDF viewers (Adobe Reader, Preview, mobile PDF viewers)
3. Verify all text is fully visible without truncation
4. Compare appearance across all devices for consistency
