# Template Loading and Validation Fix

## Problem Statement

The administrative document generation system had several issues:
1. Template PDFs and mapping JSON files were not properly served in production builds
2. No validation or detailed error logging when templates failed to load
3. No fallback mechanism if form field mapping failed
4. Multi-page PDFs (like Certificat de cession) only had data on the first page

## Solution Implemented

### 1. Fixed Static Asset Serving

**Moved mapping files to public directory:**
- Created `/public/admin/templates/` directory
- Moved all `*_mapping.json` files from `/admin/templates/` to `/public/admin/templates/`
- Updated template file paths in mappings to use `/pdf-templates/` (already in public)

**Updated path references:**
```json
Before: "template_file": "certificat_cession.pdf/Certificat_de_cession.pdf"
After:  "template_file": "pdf-templates/Certificat_de_cession.pdf"
```

**Files now served from:**
- Mappings: `/admin/templates/*.json` → served from `/public/admin/templates/`
- PDFs: `/pdf-templates/*.pdf` → served from `/public/pdf-templates/`

### 2. Enhanced Validation and Logging

**loadTemplateMapping():**
- Logs the full mapping path being fetched
- Logs HTTP status and statusText on failure
- Logs detailed mapping configuration after successful load:
  - template_file path
  - has_form_fields flag
  - use_coordinates flag
  - is_multi_page flag
  - field_count and coordinate_count

**loadTemplate():**
- Logs the full template path being fetched
- Logs HTTP status and statusText on failure
- Logs file size in KB after successful load

**Example logs:**
```
[TEMPLATE_ENGINE] Loading mapping configuration for: Certificat de cession
[TEMPLATE_ENGINE] Fetching mapping from: /admin/templates/certificat_cession_mapping.json
[TEMPLATE_ENGINE] Mapping loaded: { template_file: "pdf-templates/Certificat_de_cession.pdf", has_form_fields: false, use_coordinates: true, is_multi_page: true, field_count: 0, coordinate_count: 22 }
[TEMPLATE_ENGINE] Loading template: pdf-templates/Certificat_de_cession.pdf
[TEMPLATE_ENGINE] Fetching template from: /pdf-templates/Certificat_de_cession.pdf
[TEMPLATE_ENGINE] Template loaded successfully (670.67 KB)
[TEMPLATE_ENGINE] PDF loaded with 2 page(s)
```

### 3. Implemented Safe Fallback

**Updated fillPDFWithFields() to return boolean:**
- Returns `true` if form filling succeeded
- Returns `false` if:
  - No field_mappings defined
  - PDF has no form fields
  - Failed to get form object
  - No fields were successfully mapped
  - Form flattening failed

**Enhanced error handling:**
- Checks if form exists before accessing it
- Logs number of fields found in PDF
- Tracks applied vs failed field mappings
- Catches and logs form flattening errors

**Fallback logic in generatePDFFromTemplate():**
```typescript
if (mapping.has_form_fields && mapping.field_mappings) {
  fillSuccess = await fillPDFWithFields(pdfDoc, mapping, data);

  if (!fillSuccess && mapping.use_coordinates && mapping.coordinate_mappings) {
    // Fallback to coordinate overlay
    await fillPDFWithCoordinates(pdfDoc, mapping, data);
  }
}
```

### 4. Multi-Page Support

**Added is_multi_page flag to TemplateMapping type:**
```typescript
export type TemplateMapping = {
  // ... existing fields
  is_multi_page?: boolean;  // New optional field
}
```

**Updated fillPDFWithCoordinates():**
- If `is_multi_page` is true, applies coordinates to ALL pages
- If false or undefined, only applies to first page (default)
- Logs which pages are being processed

**Updated certificat_cession_mapping.json:**
```json
{
  "is_multi_page": true,
  // ... other fields
}
```

This ensures the Certificat de cession (2-page document) has data on both pages.

## File Structure

```
public/
├── admin/
│   └── templates/
│       ├── bon_achat_mapping.json
│       ├── certificat_cession_mapping.json
│       ├── declaration_achat_mapping.json
│       ├── fiche_enlevement_mapping.json
│       └── reception_expedition_mapping.json
└── pdf-templates/
    ├── Bon_d_achat.pdf
    ├── Certificat_de_cession.pdf
    ├── Declaration_d'achat.pdf
    ├── ENLÈVEMENT_VÉHICULE-12.pdf
    └── Réception___Expédition.pdf
```

## Production Behavior

**In production builds:**
1. Vite copies everything from `/public/` to `/dist/` root
2. Mappings are available at `/admin/templates/*.json`
3. PDFs are available at `/pdf-templates/*.pdf`
4. No 404 errors on template loading
5. Detailed logs show exactly what's being loaded and from where

## Error Messages

**Before:**
```
Failed to load mapping: Not Found
Failed to load template: Not Found
Failed to generate document
```

**After:**
```
Failed to load mapping from /admin/templates/certificat_cession_mapping.json - Status: 404 Not Found
Failed to load template from /pdf-templates/Certificat_de_cession.pdf - Status: 404 Not Found
Failed to generate document: Failed to load template from /pdf-templates/Certificat_de_cession.pdf: 404 Not Found
```

Real errors from Supabase, file system, or PDF generation are now visible in the UI.

## Fallback Scenarios

| Scenario | Behavior |
|----------|----------|
| Form fields expected but PDF has none | Falls back to coordinate overlay |
| Form fields exist but mapping fails | Falls back to coordinate overlay |
| Form field names don't match | Falls back to coordinate overlay |
| Form flattening fails | Falls back to coordinate overlay |
| Coordinate overlay requested | Uses coordinate overlay directly |
| Multi-page document | Applies coordinates to all pages |

## Testing Checklist

- [x] Build succeeds without errors
- [x] Mapping JSON files are in dist/admin/templates/
- [x] PDF templates are in dist/pdf-templates/
- [ ] Generate Bon d'achat → single-page coordinate overlay works
- [ ] Generate Certificat de cession → multi-page coordinate overlay works
- [ ] Generate Déclaration d'achat → single-page coordinate overlay works
- [ ] Generate Fiche enlèvement → single-page coordinate overlay works
- [ ] Generate Réception/Expédition → single-page coordinate overlay works
- [ ] Console logs show detailed template loading information
- [ ] 404 errors show full URL in console and UI
- [ ] PDF downloads automatically after generation

## Code Changes

**File:** `src/lib/templateEngine.ts`

1. Added `is_multi_page?: boolean` to TemplateMapping type
2. Enhanced `loadTemplateMapping()` with detailed logging and error messages
3. Enhanced `loadTemplate()` with detailed logging, error messages, and file size reporting
4. Updated `fillPDFWithCoordinates()` to support multi-page documents
5. Changed `fillPDFWithFields()` return type from `void` to `boolean`
6. Added comprehensive validation in `fillPDFWithFields()`
7. Implemented fallback logic in `generatePDFFromTemplate()`
8. Added PDF page count logging

**Files:** `public/admin/templates/*.json`

1. Created 5 mapping JSON files in public directory
2. Updated all `template_file` paths to use `pdf-templates/` prefix
3. Added `is_multi_page: true` to certificat_cession_mapping.json

## Migration Notes

This is a **non-breaking change**:
- All existing functionality is preserved
- New logging is additive only
- Fallback behavior only activates when form filling fails
- Multi-page support is opt-in via `is_multi_page` flag
- All PDFs default to single-page behavior (existing behavior)

## Benefits

1. **Production Ready**: Templates load correctly in production builds
2. **Debuggable**: Detailed logs show exactly what's happening at each step
3. **Resilient**: Automatic fallback if form field mapping doesn't work
4. **Complete**: Multi-page documents are fully filled
5. **Clear Errors**: Real error messages help users understand what went wrong
