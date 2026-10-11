# Administrative Template System Guide

## Overview

The Administrative module uses a flexible, maintainable template-based PDF generation system. Templates and their mappings are completely decoupled from code, allowing easy updates without modifying application logic.

## Architecture

### Directory Structure

```
/admin/templates/
├── bon_achat.pdf/Bon_d_achat.pdf
├── bon_achat_mapping.json
├── certificat_cession.pdf/Certificat_de_cession.pdf
├── certificat_cession_mapping.json
├── declaration_achat.pdf/Declaration_d'achat.pdf
├── declaration_achat_mapping.json
├── fiche_enlevement.pdf/ENLÈVEMENT_VÉHICULE-12.pdf
├── fiche_enlevement_mapping.json
├── reception_expedition.pdf/Réception___Expédition.pdf
└── reception_expedition_mapping.json
```

## Template Engine Flow

1. **Load Mapping Configuration**: Reads JSON mapping file for the requested document type
2. **Load PDF Template**: Fetches the PDF template file
3. **Detect Strategy**: Determines if using form fields or coordinate overlay
4. **Apply Data**: Injects transaction data into the PDF
5. **Export**: Generates final PDF and uploads to storage

## Mapping Configuration Format

### Structure

```json
{
  "template_name": "Document Name",
  "template_file": "path/to/template.pdf",
  "has_form_fields": false,
  "use_coordinates": true,
  "coordinate_mappings": {
    "data.path": {
      "x": 100,
      "y": 500,
      "size": 10,
      "format": "date"
    }
  }
}
```

### Data Paths

Use dot notation to reference data:

- `vehicle.plate_number`
- `vehicle.vin`
- `vehicle.brand`
- `vehicle.model`
- `vehicle.mileage`
- `vehicle.first_registration_date`
- `transaction.transaction_date`
- `transaction.transaction_price`
- `seller.full_name` (computed from first_name + last_name)
- `seller.company_name`
- `seller.address` (computed from address fields)
- `buyer.full_name`
- `buyer.company_name`

### Format Options

- `"date"`: Formats as DD/MM/YYYY
- `"date_time"`: Formats as DD/MM/YYYY HH:MM
- `"currency"`: Formats with € symbol

## Coordinate System

PDF coordinates start from bottom-left corner:
- X increases right
- Y increases up
- Origin (0,0) is bottom-left

Example positions:
```json
{
  "vehicle.brand": { "x": 120, "y": 595, "size": 10 },
  "vehicle.model": { "x": 120, "y": 580, "size": 10 }
}
```

## Adding a New Template

### Step 1: Add PDF Template

Place your PDF file in `/admin/templates/`:
```
/admin/templates/new_document.pdf
```

### Step 2: Create Mapping Configuration

Create `new_document_mapping.json`:
```json
{
  "template_name": "New Document",
  "template_file": "new_document.pdf",
  "has_form_fields": false,
  "use_coordinates": true,
  "coordinate_mappings": {
    "vehicle.plate_number": { "x": 100, "y": 700, "size": 10 },
    "transaction.transaction_date": { "x": 100, "y": 680, "size": 10, "format": "date" }
  }
}
```

### Step 3: Register in Template Engine

Update `/src/lib/templateEngine.ts`:
```typescript
const mappingFiles: Record<string, string> = {
  'Bon d\'achat': '/admin/templates/bon_achat_mapping.json',
  'New Document': '/admin/templates/new_document_mapping.json',
  // ... other templates
};
```

### Step 4: Add UI Button

Update `/src/pages/Administrative.tsx` to add a generation button.

## Modifying Existing Templates

### Replacing a PDF Template

1. Replace the PDF file in `/admin/templates/`
2. Keep the same filename OR update `template_file` in mapping JSON
3. No code changes required

### Adjusting Field Positions

1. Open the mapping JSON file
2. Adjust `x`, `y` coordinates
3. Save and test

Example:
```json
{
  "vehicle.plate_number": {
    "x": 150,  // Changed from 100
    "y": 565,  // Changed from 700
    "size": 10
  }
}
```

## Finding Coordinates

### Method 1: PDF Viewer

1. Open PDF in a viewer that shows coordinates
2. Measure distances from bottom-left corner
3. Note X (horizontal) and Y (vertical) positions

### Method 2: Trial and Error

1. Set initial estimate
2. Generate document
3. Measure offset
4. Adjust coordinates
5. Repeat until positioned correctly

### Tips

- Start with approximate positions
- Adjust in increments of 5-10 points
- Font size affects vertical spacing
- Test with actual data, not placeholders

## Debug Logging

The system logs detailed information:

```
[TEMPLATE_ENGINE] Loading mapping configuration for: Bon d'achat
[TEMPLATE_ENGINE] Mapping configuration loaded successfully
[TEMPLATE_ENGINE] Loading template: bon_achat.pdf/Bon_d_achat.pdf
[TEMPLATE_ENGINE] Template loaded
[TEMPLATE_ENGINE] Applying coordinate overlay
[TEMPLATE_ENGINE] Overlay applied: 9 fields mapped
[TEMPLATE_ENGINE] PDF exported successfully
```

## Troubleshooting

### Fields Not Appearing

1. Check coordinates are within PDF boundaries
2. Verify data path exists in DocumentData
3. Ensure font color is visible (currently black)
4. Check font size is reasonable (8-12pt typical)

### Wrong Position

1. Remember: Y=0 is bottom, not top
2. Verify you're editing the correct mapping file
3. Clear browser cache after mapping changes
4. Check PDF page dimensions

### Data Not Mapping

1. Verify data path matches DocumentData structure
2. Check transaction has required data fields
3. Look for typos in field paths
3. Review console logs for errors

## Security

- Templates are publicly readable (required for browser loading)
- Generated documents are stored in Supabase Storage
- RLS policies restrict access to authenticated users
- Sensitive data only appears in generated PDFs, not templates

## Performance

- Template and mapping files are loaded on-demand
- Browser caches mapping configurations
- PDF generation happens client-side
- Upload to storage is async

## Best Practices

1. **Version Control**: Commit all mapping JSON files
2. **Test Data**: Always test with realistic transaction data
3. **Backup**: Keep original PDF templates backed up
4. **Documentation**: Comment complex coordinate calculations
5. **Consistency**: Use same font sizes across similar fields
6. **Validation**: Verify all required fields are mapped

## Future Enhancements

Potential improvements:
- Multi-page document support
- Conditional field rendering
- Dynamic font sizing
- Image/logo insertion
- Signature field handling
- Barcode/QR code generation
