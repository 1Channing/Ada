# Template System Testing Guide

## Quick Verification Steps

### 1. Open Browser Console
Press F12 to open developer tools and go to the Console tab.

### 2. Navigate to Administrative Page
Go to the Administrative page in your application.

### 3. Fill in Form Data
Enter minimal test data:
- **Vehicle:** Brand, Model, Plate Number
- **Seller:** Name or Company Name
- **Buyer:** Name or Company Name
- **Transaction:** Date

### 4. Test Each Document Type

#### Test 1: Bon d'achat
1. Click "Generate Bon d'achat" button
2. **Expected Console Logs:**
   ```
   [ADMIN_DOC_GEN] Generating document: Bon d'achat
   [TEMPLATE_ENGINE] Loading mapping configuration for: Bon d'achat
   [TEMPLATE_ENGINE] Fetching mapping from: /admin/templates/bon_achat_mapping.json
   [TEMPLATE_ENGINE] Mapping loaded: { template_file: "pdf-templates/Bon_d_achat.pdf", has_form_fields: false, use_coordinates: true, ... }
   [TEMPLATE_ENGINE] Loading template: pdf-templates/Bon_d_achat.pdf
   [TEMPLATE_ENGINE] Fetching template from: /pdf-templates/Bon_d_achat.pdf
   [TEMPLATE_ENGINE] Template loaded successfully (49.20 KB)
   [TEMPLATE_ENGINE] PDF loaded with 1 page(s)
   [TEMPLATE_ENGINE] Using coordinate overlay
   [TEMPLATE_ENGINE] Applying coordinate overlay
   [TEMPLATE_ENGINE] Applying to 1 page(s)
   [TEMPLATE_ENGINE] Overlay applied: X fields mapped across 1 page(s)
   [TEMPLATE_ENGINE] PDF exported successfully (XX.XX KB)
   [ADMIN_DOC_GEN] Document generated and download started
   ```
3. **Expected Result:** PDF downloads automatically

#### Test 2: Certificat de cession (Multi-Page)
1. Click "Generate Certificat de cession" button
2. **Expected Console Logs:**
   ```
   [ADMIN_DOC_GEN] Generating document: Certificat de cession
   [TEMPLATE_ENGINE] Loading mapping configuration for: Certificat de cession
   [TEMPLATE_ENGINE] Fetching mapping from: /admin/templates/certificat_cession_mapping.json
   [TEMPLATE_ENGINE] Mapping loaded: { template_file: "pdf-templates/Certificat_de_cession.pdf", has_form_fields: false, use_coordinates: true, is_multi_page: true, ... }
   [TEMPLATE_ENGINE] Loading template: pdf-templates/Certificat_de_cession.pdf
   [TEMPLATE_ENGINE] Fetching template from: /pdf-templates/Certificat_de_cession.pdf
   [TEMPLATE_ENGINE] Template loaded successfully (670.67 KB)
   [TEMPLATE_ENGINE] PDF loaded with 2 page(s)
   [TEMPLATE_ENGINE] Using coordinate overlay
   [TEMPLATE_ENGINE] Applying coordinate overlay
   [TEMPLATE_ENGINE] Applying to 2 page(s)
   [TEMPLATE_ENGINE] Overlay applied: X fields mapped across 2 page(s)
   [TEMPLATE_ENGINE] PDF exported successfully (XXX.XX KB)
   [ADMIN_DOC_GEN] Document generated and download started
   ```
3. **Expected Result:**
   - PDF downloads automatically
   - **BOTH pages should have data** (check the downloaded PDF)

#### Test 3: Déclaration d'achat
1. Click "Generate Déclaration d'achat" button
2. **Expected Console Logs:** Similar to Test 1
3. **Expected Result:** PDF downloads automatically

#### Test 4: Fiche enlèvement
1. Click "Generate Fiche enlèvement" button
2. **Expected Console Logs:** Similar to Test 1
3. **Expected Result:** PDF downloads automatically

#### Test 5: Réception / Expédition
1. Click "Generate Réception / Expédition" button
2. **Expected Console Logs:** Similar to Test 1
3. **Expected Result:** PDF downloads automatically

### 5. Verify Error Handling

#### Test Error: Clear Form and Generate
1. Clear all form data
2. Click any "Generate..." button
3. **Expected Behavior:**
   - Should save form first (may show validation errors if required fields empty)
   - Console should show clear error messages if save fails
   - Error message in UI should show real Supabase error (not generic message)

#### Test Error: Network Failure Simulation
1. Open Network tab in DevTools
2. Set throttling to "Offline"
3. Click any "Generate..." button
4. **Expected Behavior:**
   - Console shows: `Failed to load mapping from /admin/templates/xxx_mapping.json - Status: XXX`
   - UI shows error message with the real network error
   - No silent failures

## Success Criteria

✅ All 5 document types generate and download automatically
✅ Console logs show detailed information at each step
✅ Certificat de cession has data on BOTH pages
✅ Error messages show real errors (not generic placeholders)
✅ No 404 errors in console
✅ No undefined or null reference errors
✅ PDFs contain the data that was entered in the form

## Common Issues and Solutions

### Issue: 404 on mapping files
**Symptoms:**
```
Failed to load mapping from /admin/templates/xxx_mapping.json - Status: 404 Not Found
```

**Solution:**
- Verify files exist in `/public/admin/templates/`
- Rebuild the project: `npm run build`
- Check that `/dist/admin/templates/` contains the JSON files after build

### Issue: 404 on PDF templates
**Symptoms:**
```
Failed to load template from /pdf-templates/XXX.pdf - Status: 404 Not Found
```

**Solution:**
- Verify files exist in `/public/pdf-templates/`
- Rebuild the project: `npm run build`
- Check that `/dist/pdf-templates/` contains the PDFs after build

### Issue: Blank PDFs
**Symptoms:**
- PDF downloads but has no data
- Console shows: `Overlay applied: 0 fields mapped`

**Solution:**
- Check that form has data filled in
- Verify mapping JSON has `coordinate_mappings` defined
- Check browser console for any parsing errors

### Issue: Multi-page PDF only has data on first page
**Symptoms:**
- Certificat de cession only shows data on page 1
- Page 2 is blank

**Solution:**
- Verify mapping JSON has `"is_multi_page": true`
- Check console log shows: `Applying to 2 page(s)`
- If not, the mapping file may not have been updated

## Production Deployment Checklist

Before deploying to production:

- [ ] Run `npm run build` successfully
- [ ] Verify `/dist/admin/templates/` contains all 5 JSON files
- [ ] Verify `/dist/pdf-templates/` contains all 5 PDFs
- [ ] Test all 5 document types in local build (`npm run preview`)
- [ ] Verify Certificat de cession is multi-page
- [ ] Verify error messages are clear and helpful
- [ ] Test with empty form to ensure proper error handling
- [ ] Check browser console for any warnings or errors

## Advanced Testing

### Test Fallback Mechanism
Currently all templates use coordinate overlay (`has_form_fields: false`), so the fallback won't trigger. To test the fallback:

1. Edit a mapping file and change:
   ```json
   "has_form_fields": true,
   "use_coordinates": true,
   "field_mappings": {
     "vehicle.brand": "nonexistent_field"
   }
   ```

2. Generate the document

3. **Expected Console Logs:**
   ```
   [TEMPLATE_ENGINE] Attempting form field filling
   [TEMPLATE_ENGINE] PDF has 0 form fields
   [TEMPLATE_ENGINE] PDF has no form fields, cannot use field mapping
   [TEMPLATE_ENGINE] Form field filling failed, falling back to coordinate overlay
   [TEMPLATE_ENGINE] Applying coordinate overlay
   ```

4. **Expected Result:** PDF still generates correctly using coordinates

### Verify Template File Sizes
Check that templates are loading completely:

```javascript
// In browser console after a successful generation:
// You should see sizes like:
[TEMPLATE_ENGINE] Template loaded successfully (49.20 KB)    // Bon d'achat
[TEMPLATE_ENGINE] Template loaded successfully (670.67 KB)   // Certificat de cession
[TEMPLATE_ENGINE] Template loaded successfully (149.40 KB)   // Déclaration d'achat
[TEMPLATE_ENGINE] Template loaded successfully (76.27 KB)    // Fiche enlèvement
[TEMPLATE_ENGINE] Template loaded successfully (56.90 KB)    // Réception / Expédition
```

If sizes are 0 or very small (< 10 KB), the file didn't load properly.
