# Déclaration d'Achat Coordinate-Based Rendering Implementation

## Summary

The Déclaration d'achat PDF has been completely rebuilt to use coordinate-based rendering. Field discovery confirmed that the PDF does NOT contain usable AcroForm fields (only one radio button field was detected), making coordinate-based rendering the only viable approach.

## Final Rendering Strategy

| Document | Rendering Method |
|----------|-----------------|
| Certificat de cession | AcroForm fields |
| Bon d'achat | Coordinate-based |
| Déclaration d'achat | Coordinate-based |
| Bordereau d'enlèvement | Coordinate-based |
| Bordereau de réception/expédition | Coordinate-based |

## Implementation Changes

### 1. Removed All Debug Code
- Eliminated the entire TEMPORARY DEBUG CODE section (lines 10-37)
- Removed XFA detection and field discovery logic
- Cleaned up all AcroForm-related code

### 2. Fresh Coordinate System
- All coordinates rebuilt from scratch (old coordinates were unreliable)
- Initial placeholder positions at x=100 with varying y-values
- Coordinates ready for visual calibration

### 3. Core Fields Implemented

**Vehicle Information:**
- Plate number (boxed field) - position: (100, 500)
- VIN (boxed field) - position: (100, 480)
- Brand - position: (100, 460)
- Model - position: (100, 440)

**Seller Information:**
- Name (company or individual) - position: (100, 380)
- Address line 1 - position: (100, 360)
- Postal code + City - position: (100, 340)

**Buyer Information:**
- Name (company or individual) - position: (100, 280)
- Address line 1 - position: (100, 260)
- Postal code + City - position: (100, 240)

**Transaction Information:**
- Transaction date - position: (100, 180)

### 4. Debug Helper Added

```typescript
const DEBUG_MODE = false;

function drawDebugMarker(page: any, x: number, y: number, label: string, font: any) {
  if (!DEBUG_MODE) return;

  page.drawText('•', { x, y, size: 12, font, color: rgb(1, 0, 0) });
  page.drawText(label, { x: x + 10, y, size: 6, font, color: rgb(1, 0, 0) });
}
```

To enable visual calibration markers:
1. Set `DEBUG_MODE = true` at the top of the file
2. Generate a PDF
3. Red markers (•) will appear at each field position with labels
4. Adjust coordinates based on visual inspection
5. Set `DEBUG_MODE = false` when done

## Next Steps

### Phase 1: Visual Calibration (Required)
1. Enable DEBUG_MODE
2. Generate test PDF with sample data
3. Open PDF and inspect marker positions
4. Adjust x,y coordinates for each field to match actual form layout
5. Iterate until all fields align correctly

### Phase 2: Field Refinement (After coordinates are correct)
- Adjust font sizes if needed
- Fine-tune boxed field character spacing
- Add text truncation for long values
- Test with various data lengths

### Phase 3: Additional Fields (Optional, later)
- Phone numbers
- Email addresses
- Additional vehicle details
- Transaction price (if applicable)

## Testing Strategy

1. **Initial Placement Test:**
   - Use DEBUG_MODE to verify all markers appear on PDF
   - Confirm no runtime errors

2. **Alignment Test:**
   - Compare marker positions with actual PDF form fields
   - Adjust coordinates systematically (top to bottom)

3. **Data Test:**
   - Test with realistic data (names, addresses, VINs)
   - Verify boxed fields render correctly
   - Check text doesn't overflow field boundaries

4. **Edge Cases:**
   - Long company names
   - Long addresses
   - Special characters in names
   - Missing optional fields

## File Location

`src/lib/renderers/renderDeclarationAchat.ts`

## Build Status

✅ Build successful - no type errors
✅ All debug code removed
✅ Clean coordinate-based implementation ready for calibration
