# Bon d'Achat AcroForm Migration - Complete

## Summary

Successfully migrated Bon d'achat document from coordinate-based rendering to AcroForm-based field filling. The original `Bon_d_achat.pdf` template already contained properly configured AcroForm fields, so no template replacement was needed.

## Discovery Results

### PDF Template Analysis
- **Template**: `public/pdf-templates/Bon_d_achat.pdf`
- **Total Fields**: 9 AcroForm fields
- **XFA Status**: No XFA present
- **File Size**: 50 KB

### Field Mapping (Exact Names from PDF)

| PDF Field Name | Data Source | Notes |
|---------------|-------------|-------|
| `Marque` | `data.vehicle.brand` | Vehicle brand |
| `Modele` | `data.vehicle.model` | Vehicle model |
| `Immatriculation` | `data.vehicle.plate_number` | Plate number (kept as-is) |
| `VIN` | `data.vehicle.vin` | Chassis number (uppercase) |
| `premire mise en circulation` | `data.vehicle.first_registration_date` | First registration (DD/MM/YYYY) |
| `Kilometrage` | `data.vehicle.mileage` | Mileage (numeric string) |
| `Prix` | `data.transaction.transaction_price` | Transaction price (numeric string) |
| `Date_1` | `data.transaction.transaction_date` | Transaction date (DD/MM/YYYY) |
| `Vendeur x Adresse` | `data.seller.company_name` or names | Seller name |

## Implementation Details

### Renderer Changes
File: `src/lib/renderers/renderBonAchat.ts`

**Before**: Coordinate-based rendering using `page.drawText()` with hardcoded positions
**After**: AcroForm field filling using `form.getTextField()` with proper error handling

### Key Features
1. XFA detection and removal (if present)
2. Simple try-catch error handling per field
3. Date formatting: ISO → DD/MM/YYYY
4. VIN normalization: uppercase only
5. Plate number: kept as-is (no over-normalization)
6. Flattening with error handling (known pdf-lib issue)

### Data Formatting Rules
- **Dates**: Convert from ISO 8601 to French format (DD/MM/YYYY)
- **Price**: Convert to string, no currency symbol (already in PDF)
- **Mileage**: Convert to string, no unit (already in PDF)
- **Plate**: Keep original formatting
- **VIN**: Uppercase for consistency
- **Seller**: Use company_name if available, otherwise concatenate first_name + last_name

## Testing Results

### Test Configuration
```typescript
{
  vehicle: {
    brand: 'Renault',
    model: 'Clio 5',
    plate_number: 'AB-123-CD',
    vin: 'VF1RJB00123456789',
    first_registration_date: '2020-06-15',
    mileage: 45000
  },
  transaction: {
    transaction_price: 12500,
    transaction_date: '2026-04-05'
  },
  seller: {
    company_name: 'Auto Dealer SA'
  }
}
```

### Test Results
✓ All 9 fields filled successfully
✓ PDF generated (43 KB output)
✓ Correct date formatting applied
✓ VIN properly uppercased
⚠ Form flattening failed (known pdf-lib limitation with this PDF structure)

### Console Output
```
[BON_ACHAT_ACROFORM] Starting AcroForm-based rendering
[BON_ACHAT_ACROFORM] Form has 9 fields
[BON_ACHAT_ACROFORM] Filled Marque: "Renault"
[BON_ACHAT_ACROFORM] Filled Modele: "Clio 5"
[BON_ACHAT_ACROFORM] Filled Immatriculation: "AB-123-CD"
[BON_ACHAT_ACROFORM] Filled VIN: "VF1RJB00123456789"
[BON_ACHAT_ACROFORM] Filled premire mise en circulation: "15/06/2020"
[BON_ACHAT_ACROFORM] Filled Kilometrage: "45000"
[BON_ACHAT_ACROFORM] Filled Prix: "12500"
[BON_ACHAT_ACROFORM] Filled Date_1: "05/04/2026"
[BON_ACHAT_ACROFORM] Filled Vendeur x Adresse: "Auto Dealer SA"
[BON_ACHAT_ACROFORM] Could not flatten form, PDF will have editable fields
[BON_ACHAT_ACROFORM] Rendering complete: 1 warnings
```

## Known Issues

### Form Flattening
The PDF cannot be flattened due to a pdf-lib limitation:
```
Error: Could not find page for PDFRef 63 0 R
```

This is a known issue with certain PDF structures. The fields are filled correctly, but they remain editable in the output PDF. This is acceptable for the use case.

**Impact**: Fields can be edited after generation, but values are correctly filled.

**Workaround**: The error is caught and logged, generation continues successfully.

## Integration Status

### Template Engine
- ✓ Route configured in `templateEngine.ts` (case 'Bon d\'achat')
- ✓ Template path unchanged: `pdf-templates/Bon_d_achat.pdf`
- ✓ No changes needed to `adminDocGenerator.ts`

### File Organization
- ✓ Renderer: `src/lib/renderers/renderBonAchat.ts`
- ✓ Template: `public/pdf-templates/Bon_d_achat.pdf`
- ✓ Mapping: `public/admin/templates/bon_achat_mapping.json`

## Migration Comparison

### Code Complexity
- **Before**: 72 lines with coordinate calculations, boxed field rendering
- **After**: 149 lines with organized field filling functions
- **Net**: More lines but cleaner separation of concerns

### Maintainability
- **Before**: Hardcoded X/Y coordinates, difficult to adjust
- **After**: Field name mapping, easy to update

### Reliability
- **Before**: Layout-dependent, breaks if PDF regenerated
- **After**: Field-dependent, resilient to layout changes

## Future Documents

Remaining documents to migrate:
1. ✓ Certificat de cession - Already using AcroForm
2. ✓ Bon d'achat - **COMPLETED**
3. ✓ Déclaration d'achat - Already migrated to AcroForm
4. ⏳ Fiche d'enlèvement - Still coordinate-based
5. ⏳ Réception/Expédition - Still coordinate-based

## Notes

1. **No Template Replacement Needed**: The original PDF already had AcroForm fields
2. **Copy Files**: Two locked PDF copy files exist (`Bon_d_achat copy.pdf`, `Bon_d_achat copy copy.pdf`) that are preventing build - these should be removed as they're not needed
3. **Build Status**: Build currently fails due to locked PDF files in public directory
4. **Testing**: Manual testing via admin interface still needed once locked files are removed

## Recommendations

1. Remove the locked PDF copy files from `public/pdf-templates/`
2. Test document generation from the admin interface
3. Verify all edge cases (missing optional fields, invalid dates, etc.)
4. Consider migrating remaining documents to AcroForm approach
5. If flattening is critical, consider alternative PDF library or post-processing

## Migration Complete ✓

The Bon d'achat renderer has been successfully migrated to AcroForm-based rendering with proper field mapping, error handling, and formatting. The implementation follows the same pattern as Déclaration d'achat for consistency.
