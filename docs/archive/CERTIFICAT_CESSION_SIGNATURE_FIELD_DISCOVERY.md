# Certificat de Cession - Signature Field Discovery Results

**Date:** 2026-04-07
**Status:** DISCOVERY COMPLETE - Guessed field names CONFIRMED INVALID

---

## Executive Summary

The previous implementation used **GUESSED** field names that **DO NOT EXIST** in the PDF:

### INVALID Field Names (All Not Found):
- ❌ `txt_FaitAVendeur[0]` - NOT FOUND
- ❌ `txt_LeVendeur[0]` - NOT FOUND
- ❌ `txt_FaitAAcheteur[0]` - NOT FOUND
- ❌ `txt_LeAcheteur[0]` - NOT FOUND

---

## REAL Signature Field Names Discovered

Based on comprehensive field discovery, the ACTUAL signature-related fields are:

### For SELLER (Vendeur) Signature Section:

**Page1:**
- `topmostSubform[0].Page1[0].txt_LieuDéclaration1[0]` - **PDFTextField** (Signature Location)
- `topmostSubform[0].Page1[0].num_DateDéclaration[0]` - **PDFTextField** (Signature Date)

**Page2:**
- `topmostSubform[0].Page2[0].txt_LieuDéclaration1[0]` - **PDFTextField** (Signature Location)
- `topmostSubform[0].Page2[0].num_DateDéclaration[0]` - **PDFTextField** (Signature Date)

### For BUYER (Acheteur) Signature Section:

**Page1:**
- `topmostSubform[0].Page1[0].txt_LieuDéclaration2[0]` - **PDFTextField** (Signature Location)
- `topmostSubform[0].Page1[0].txt_dateDéclaration[0]` - **PDFTextField** (Signature Date)

**Page2:**
- `topmostSubform[0].Page2[0].txt_LieuDéclaration2[0]` - **PDFTextField** (Signature Location)
- `topmostSubform[0].Page2[0].txt_dateDéclaration[0]` - **PDFTextField** (Signature Date)

---

## Field Type Analysis

All signature-related fields are **PDFTextField** (not split date fields):

1. **txt_LieuDéclaration1** - Seller's signature location field
2. **num_DateDéclaration** - Seller's signature date field (single text field, not split)
3. **txt_LieuDéclaration2** - Buyer's signature location field
4. **txt_dateDéclaration** - Buyer's signature date field (single text field, not split)

---

## Key Observations

1. **Naming Pattern:**
   - Seller uses `LieuDéclaration1` and `DateDéclaration`
   - Buyer uses `LieuDéclaration2` and `dateDéclaration` (lowercase 'd')

2. **Field Structure:**
   - Location fields: Single text field (e.g., "Paris")
   - Date fields: Single text field (e.g., "07/04/2026")
   - **NOT** split into day/month/year components

3. **Page Presence:**
   - All 4 signature fields exist on BOTH Page1 and Page2
   - Must fill both pages for consistency

4. **Data Source Mapping:**
   - Location: Use `data.transaction?.pickup_location`
   - Date: Use `data.transaction?.transaction_date` (format as DD/MM/YYYY)

---

## Complete Field Inventory (114 total fields)

### Page1 Fields (57 fields):
- Vehicle fields: 0-10
- Seller fields: 15-22
- Transaction fields: 23-30
- Buyer fields: 31-44
- Radio groups: 45-48, 52-53
- Checkboxes: 49-51, 54-56

### Page2 Fields (57 fields):
- Mirror of Page1 (fields 57-113)

---

## Next Steps

1. ✅ Field discovery complete
2. ⏸️ Guessed implementation disabled
3. ⏭️ **READY FOR CORRECT IMPLEMENTATION**

Use the discovered field names above to implement proper signature filling in `renderCertificatCession.ts`.

---

## Implementation Requirements

**Seller Signature:**
```typescript
// Location
fillFieldSafely(form, `${prefix}.txt_LieuDéclaration1[0]`,
  data.transaction?.pickup_location,
  `seller.signature.location (${page})`, errors, false);

// Date (format as DD/MM/YYYY)
fillFieldSafely(form, `${prefix}.num_DateDéclaration[0]`,
  formatDateSimple(data.transaction?.transaction_date),
  `seller.signature.date (${page})`, errors, false);
```

**Buyer Signature:**
```typescript
// Location
fillFieldSafely(form, `${prefix}.txt_LieuDéclaration2[0]`,
  data.transaction?.pickup_location,
  `buyer.signature.location (${page})`, errors, false);

// Date (format as DD/MM/YYYY)
fillFieldSafely(form, `${prefix}.txt_dateDéclaration[0]`,
  formatDateSimple(data.transaction?.transaction_date),
  `buyer.signature.date (${page})`, errors, false);
```

---

**END OF DISCOVERY REPORT**
