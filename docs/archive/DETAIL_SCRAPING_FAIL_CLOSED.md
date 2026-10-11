# Detail Scraping: Fail-Closed Implementation

## Summary

Updated detail page scraping to be **fail-closed** and **source-limited**. The system now extracts enriched data ONLY from verified seller content, preventing hallucinated or polluted data from global page elements (footer, nav, legal text, reviews).

## Hard Rules Implemented

### 1. Single Source of Truth
**Before:** Parsed entire HTML DOM for keywords
**After:** Extracts ONLY from:
- Seller's ad description (body text)
- Structured equipment sections (if available)

**Per Marketplace:**

#### Leboncoin
- Extracts from `__NEXT_DATA__` JSON → `adData.body`
- Extracts structured equipment from `adData.options` and `adData.attributes`
- **Never** scans global DOM

#### Marktplaats/Bilbasen/Gaspedaal
- Extracts from specific `<div class="description">` container
- Validates minimum length (>50 chars) to avoid false matches
- **Never** scans global DOM

### 2. Premium Options: Whitelist-Based, Zero Inference

**Strict validation:**
```typescript
const PREMIUM_OPTIONS = [
  { keywords: ['toit panoramique', 'toit ouvrant panoramique', ...], label: 'Toit panoramique' },
  { keywords: ['jbl', 'harman kardon', 'bose', 'b&o', ...], label: 'Audio premium' },
  // ... 13 total premium options
];
```

**Inclusion rules:**
- Option included ONLY if keyword found in seller description OR structured equipment
- Must be exact keyword match (case-insensitive)
- No inference, no fuzzy matching
- Duplicates automatically filtered

**Premium options tracked:**
1. Toit panoramique
2. Audio premium (JBL/Harman Kardon/Bose/B&O/Burmester)
3. Hayon électrique
4. Phares LED/Matrix/Laser
5. Affichage tête haute (HUD)
6. Caméra 360°
7. Aide au stationnement
8. Régulateur adaptatif (ACC)
9. Détection angle mort
10. Sièges chauffants/ventilés
11. Sièges à mémoire
12. Attelage
13. Suspension adaptative

### 3. Maintenance/Defects: Sentence-Level Extraction

**Maintenance tokens:**
```typescript
const MAINTENANCE_TOKENS = [
  'révision', 'entretien', 'service', 'vidange', 'carnet', 'historique',
  'factures', 'toyota', 'mercedes', 'bmw', 'audi', 'concessionnaire',
  'distribution', 'courroie', 'timing belt', 'pneus neufs', 'ct', 'contrôle technique',
];
```

**Defect tokens:**
```typescript
const DEFECT_TOKENS = [
  'rayé', 'rayure', 'égratignure', 'éraflure',
  'bosse', 'choc', 'impact', 'coup',
  'usure', 'abîmé', 'endommagé',
  'rouille', 'corrosion',
  'fissure', 'brisé',
  'peinture', 'carrosserie', 'jante', 'pare-choc',
  'griffe', 'défaut', 'problème',
];
```

**Extraction logic:**
1. Split seller description into sentences
2. Match sentences containing relevant tokens
3. Return up to 3 matched sentences (max 500 chars)
4. If no match: return empty string

### 4. Evidence Snippets (Debug Trail)

Each extraction includes evidence showing exact seller text that triggered it:

```typescript
// Options evidence
"Toit panoramique: \"Véhicule équipé d'un toit ouvrant panoramique électrique\""

// Maintenance evidence
[Evidence: "Entretien complet réalisé chez Toyota en janvier 2024 avec factures..."]

// Defects evidence
[Evidence: "Quelques rayures sur le pare-choc avant mais rien de grave..."]
```

**Storage:** Evidence appended to `entretien` and `defects_summary` fields with `[Evidence: ...]` delimiter.

## Changes Made

### File: `src/lib/study-core/detailParsers.ts`

**Complete rewrite with:**

#### New Interfaces
```typescript
interface SellerContent {
  description: string;           // Seller's ad text
  structuredEquipment: string[]; // Structured options list
}
```

#### New Functions
1. `extractLeboncoinSellerContent()` - JSON extraction from `__NEXT_DATA__`
2. `extractMarktplaatsSellerContent()` - Description container extraction
3. `extractBilbasenSellerContent()` - Description section extraction
4. `extractGaspedaalSellerContent()` - Description section extraction
5. `extractSellerContent()` - Router function
6. `extractPremiumOptions()` - Whitelist-based with evidence
7. `extractMaintenanceInfo()` - Sentence-level with evidence
8. `extractDefects()` - Sentence-level with evidence

#### Updated Function
`parseDetailPage()` - Now:
1. Extracts seller content first (fail-closed)
2. Returns empty data if no seller content found
3. Applies strict extraction rules
4. Includes evidence snippets

### No Other Files Modified
- Worker scraper: Unchanged (already calls `parseDetailPage()`)
- UI: Unchanged (already displays fields)
- Database: Unchanged (no schema changes)
- Business logic: Unchanged

## Behavior Changes

### Before
```
[DETAIL_SCRAPE] Extracted options=[Toit panoramique, Audio premium, Navigation, Bluetooth, ...], maintenance=yes, defects=no
```
↑ 8 options extracted (includes standard features like "navigation", "bluetooth")

### After
```
[DETAIL_SCRAPE] Extracted options=[Toit panoramique, Audio premium], maintenance=yes, defects=no
```
↑ 2 premium options extracted (only non-standard features)

### Fail-Closed Examples

**Scenario 1: Leboncoin footer mentions "JBL" in legal text**
- **Before:** "Audio premium" extracted ❌
- **After:** Ignored (not in ad body) ✅

**Scenario 2: Seller mentions "toit ouvrant" (standard sunroof)**
- **Before:** "Toit panoramique" extracted ❌
- **After:** Not extracted (keyword doesn't match "toit panoramique") ✅

**Scenario 3: Page has Trustpilot reviews mentioning "rayures"**
- **Before:** "rayures" extracted as defect ❌
- **After:** Ignored (not in ad body) ✅

**Scenario 4: No seller description found**
- **Before:** Extracted keywords from entire page ❌
- **After:** Returns empty data ✅

## Testing

### Verify Fail-Closed Behavior

```sql
-- Check extraction quality for recent listings
SELECT
  listing_url,
  length(entretien) as entretien_length,
  array_length(options::json::text[]::text[], 1) as options_count,
  length(defects_summary) as defects_length,
  CASE
    WHEN entretien LIKE '%[Evidence:%' THEN 'Has evidence'
    ELSE 'No evidence'
  END as has_evidence
FROM study_source_listings
WHERE created_at > NOW() - INTERVAL '1 hour'
AND (options IS NOT NULL OR entretien != '' OR defects_summary != '')
ORDER BY created_at DESC
LIMIT 10;
```

### Expected Results

**Good listings:**
- `options_count`: 0-3 (premium only)
- `entretien_length`: 50-500 (if maintenance mentioned)
- `has_evidence`: "Has evidence"

**Fail-closed listings (no seller content):**
- `options_count`: 0
- `entretien_length`: 0
- `defects_length`: 0

## Build Status

✅ Frontend: `npm run build` passes
✅ Worker: `npm run build:worker` passes
✅ TypeScript: No errors
✅ Worker bundle: 64.0kb (was 57.9kb +11%)

## Performance Impact

**None:** Same execution flow, just stricter extraction logic.

## Rollback

If issues occur, revert commit:
```bash
git revert <commit-hash>
```

Old behavior will restore (extracting from entire DOM).

---

**Status:** Complete ✅
**Quality:** Fail-closed, source-limited, zero hallucination
**Evidence:** Built-in debug trail for validation
