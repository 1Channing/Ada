# Marktplaats API Contract - LOCKED SPECIFICATION
## Based on Chrome DevTools Network Capture (2026-01-29)

**CRITICAL:** This document is the single source of truth for Marktplaats API integration.
All implementation MUST match this specification exactly. NO assumptions beyond what is captured here.

---

## 1. CAPTURED REQUEST → BACKEND REQUEST MAPPING

### Test Case URL
```
https://www.marktplaats.nl/l/auto-s/#q:volkswagen+tiguan|f:10882|mileageTo:70001|constructionYearFrom:2020|sortBy:PRICE|sortOrder:INCREASING
```

### Resolved API Request (EXACT CAPTURE)

**Endpoint:**
```
https://www.marktplaats.nl/lrp/api/search
```

**Method:** `GET`

**Full URL (URL-decoded for clarity):**
```
https://www.marktplaats.nl/lrp/api/search?attributeRanges[]=mileage:null:70001&attributeRanges[]=constructionYear:2020:null&attributesById[]=10882&l1CategoryId=91&limit=30&offset=0&query=volkswagen%20tiguan&searchInTitleAndDescription=true&sortBy=PRICE&sortOrder=INCREASING&viewOptions=list-view
```

---

## 2. PARAMETER MAPPING TABLE

| Hash Fragment | API Parameter | Format | Example | Notes |
|---------------|---------------|--------|---------|-------|
| `q:volkswagen+tiguan` | `query` | string | `volkswagen%20tiguan` | URL-encoded search terms |
| N/A (implicit) | `searchInTitleAndDescription` | boolean | `true` | ALWAYS `true` (observed) |
| N/A (implicit) | `l1CategoryId` | string | `91` | ALWAYS `91` for cars (observed) |
| `f:10882` | `attributesById[]` | array param | `attributesById[]=10882` | Variant filter ID (observed: 10882 = eHybrid) |
| `mileageTo:70001` | `attributeRanges[]` | array param | `mileage:null:70001` | Format: `key:min:max`, null = no limit |
| `constructionYearFrom:2020` | `attributeRanges[]` | array param | `constructionYear:2020:null` | Format: `key:min:max`, null = no limit |
| `sortBy:PRICE` | `sortBy` | string | `PRICE` | Observed: `PRICE` |
| `sortOrder:INCREASING` | `sortOrder` | string | `INCREASING` | Observed: `INCREASING` |
| N/A (pagination) | `offset` | number | `0` | Page 1=0, Page 2=30, Page 3=60 |
| N/A (implicit) | `limit` | number | `30` | ALWAYS `30` (observed) |
| N/A (implicit) | `viewOptions` | string | `list-view` | ALWAYS `list-view` (observed) |

---

## 3. OBSERVED PARAMETERS (ONLY THESE ARE IMPLEMENTED)

### Core Search Parameters
```typescript
{
  query: string,                        // OBSERVED: "volkswagen tiguan"
  searchInTitleAndDescription: true,    // OBSERVED: always true
  l1CategoryId: "91",                   // OBSERVED: always 91 for cars
}
```

### Filter Parameters (Observed Only)

**attributesById[] (Variant Filters):**
```typescript
// OBSERVED: attributesById[]=10882
// Format: repeat parameter for multiple filters
// Example: attributesById[]=10882&attributesById[]=12345
```

**attributeRanges[] (Range Filters):**
```typescript
// OBSERVED KEYS ONLY:
// - "mileage" (format: "mileage:null:70001" or "mileage:50000:null")
// - "constructionYear" (format: "constructionYear:2020:null" or "constructionYear:null:2023")

// NOT OBSERVED (DO NOT IMPLEMENT YET):
// - "engineHorsepower"
// - Any other range keys

// Format: "key:min:max" where null = no limit
// Examples:
//   mileage:null:70001    → max 70,001 km
//   mileage:50000:null    → min 50,000 km
//   constructionYear:2020:null → year >= 2020
//   constructionYear:null:2023 → year <= 2023
```

### Sorting Parameters
```typescript
{
  sortBy: "PRICE",          // OBSERVED: PRICE
  sortOrder: "INCREASING",  // OBSERVED: INCREASING, DECREASING
}
```

### Pagination Parameters
```typescript
{
  offset: 0,    // OBSERVED: 0, 30, 60, ... (increments by 30)
  limit: 30,    // OBSERVED: always 30
}
```

### Technical Parameters
```typescript
{
  viewOptions: "list-view",  // OBSERVED: always "list-view"
}
```

---

## 4. REQUIRED HEADERS (EXACT CAPTURE)

### Observed Headers
```
referer: https://www.marktplaats.nl/l/auto-s/
user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36
sec-ch-ua-platform: "macOS"
sec-ch-ua: "Not:A-Brand";v="99", "HeadlessChrome";v="145", "Chromium";v="145"
sec-ch-ua-mobile: ?0
```

### Classification

**REQUIRED (Must Include):**
```typescript
{
  "Referer": "https://www.marktplaats.nl/l/auto-s/",
  "User-Agent": "Mozilla/5.0 (compatible; MCExportBot/1.0)",  // Generic, stable
}
```

**OPTIONAL (Not Critical, May Help with Fingerprinting):**
```typescript
{
  "sec-ch-ua-platform": "\"macOS\"",
  "sec-ch-ua": "\"Not:A-Brand\";v=\"99\", \"Chromium\";v=\"121\"",
  "sec-ch-ua-mobile": "?0",
}
```

**RATIONALE:**
- `Referer`: Expected by API to understand request origin
- `User-Agent`: Required to identify client, use generic stable version (NOT Chrome/121 specifically)
- `sec-ch-ua-*`: Browser fingerprinting headers, nice-to-have but not critical

**IMPLEMENTATION RULE:**
Use a generic, stable User-Agent like `Mozilla/5.0 (compatible; MCExportBot/1.0)` instead of hardcoding Chrome/121.
Browsers change versions frequently; we don't want to update code every time Chrome releases.

---

## 5. RESPONSE STRUCTURE (OBSERVED)

### Top-Level Response
```typescript
{
  listings: Array<Listing>  // Array of listing objects
}
```

### Listing Object Structure (Observed Fields Only)
```typescript
interface Listing {
  itemId: string;           // OBSERVED: "m2357956770"
  title: string;            // OBSERVED: "Volkswagen Tiguan 1.5 TSI ACT..."
  description: string;      // OBSERVED: full description

  priceInfo: {
    priceCents: number;     // OBSERVED: 1900000 (€19,000)
    priceType: "FIXED" | "PER_MONTH";  // OBSERVED: "FIXED", "PER_MONTH"
  };

  attributes: Array<{
    key: string;            // OBSERVED: "constructionYear", "mileage", "fuel", "transmission", "model", "options", "priceType"
    value: string;          // OBSERVED: "2020", "1", "Benzine", etc.
    values?: string[];      // OBSERVED: array of values (for multi-value like options)
    unit?: string;          // OBSERVED: "km" for mileage
  }>;

  extendedAttributes: Array<{
    key: string;            // OBSERVED: "engineHorsepower", "driveTrain", "upholstery", etc.
    value: string;          // OBSERVED: "150 pk", "Voorwielaandrijving", etc.
    values?: string[];
  }>;

  vipUrl: string;           // OBSERVED: "/v/auto-s/volkswagen/m2357956770-volkswagen-tiguan..."

  // Other fields exist but not used in our parsing logic
}
```

### Attribute Keys (Observed in Response)
```
attributes[].key values:
- "constructionYear" → year (string)
- "mileage" → mileage in km (string, has unit "km")
- "fuel" → fuel type (string)
- "transmission" → transmission type (string)
- "model" → model name (string)
- "options" → array of options (values[] array)
- "priceType" → "Te koop" vs other (string)

extendedAttributes[].key values:
- "engineHorsepower" → HP value (string like "150 pk")
- "driveTrain" → drive train (string)
- "upholstery" → interior material (string)
- "interiorcolor" → interior color (string)
- "euronormBE" → euro norm (string)
- "numberOfCilindersCars" → cylinder count (string)
```

---

## 6. PARSING LOGIC (LOCKED)

### Price Extraction
```typescript
const priceEur = item.priceInfo.priceCents / 100;
```

### Attribute Extraction (Observed Pattern)
```typescript
// Use .find() to search attributes array by key
const yearAttr = item.attributes.find(a => a.key === "constructionYear");
const year = yearAttr ? parseInt(yearAttr.value) : null;

const mileageAttr = item.attributes.find(a => a.key === "mileage");
const mileage = mileageAttr ? parseInt(mileageAttr.value) : null;
```

### Extended Attribute Extraction
```typescript
const hpAttr = item.extendedAttributes?.find(a => a.key === "engineHorsepower");
// Note: value like "150 pk" needs parsing
```

### Detail URL Construction
```typescript
const detailUrl = `https://www.marktplaats.nl${item.vipUrl}`;
```

---

## 7. LEASING DETECTION RULES (LOCKED)

### Primary Detection (API Field)
```typescript
item.priceInfo.priceType === "PER_MONTH"
```

### Secondary Detection (Title/Description Patterns)
Case-insensitive check for these patterns:
```
- "lease"
- "leas"
- "p/mnd"
- "per maand"
- "zakelijke lease"
- "private lease"
- "/maand"
- "per month"
- "operational lease"
```

### Implementation Function
```typescript
function isLeaseAd(item: Listing): boolean {
  // Primary check
  if (item.priceInfo.priceType === "PER_MONTH") {
    return true;
  }

  // Secondary check (title + description)
  const text = `${item.title} ${item.description}`.toLowerCase();
  const leasePatterns = [
    'lease', 'leas', 'p/mnd', 'per maand',
    'zakelijke lease', 'private lease', '/maand',
    'per month', 'operational lease'
  ];

  return leasePatterns.some(pattern => text.includes(pattern));
}
```

---

## 8. HASH URL PARSING (LOCKED)

### Observed Hash Patterns
```
#q:volkswagen+tiguan|f:10882|mileageTo:70001|constructionYearFrom:2020|sortBy:PRICE|sortOrder:INCREASING
```

### Fragment Parsing Logic
```typescript
interface HashFilters {
  query?: string;               // q:volkswagen+tiguan
  variantId?: string;           // f:10882
  mileageTo?: number;           // mileageTo:70001
  constructionYearFrom?: number; // constructionYearFrom:2020
  sortBy?: string;              // sortBy:PRICE
  sortOrder?: string;           // sortOrder:INCREASING
}

function parseMarktplaatsHash(url: string): HashFilters {
  const [base, hash] = url.split('#');
  if (!hash) return {};

  const parts = hash.split('|');
  const filters: HashFilters = {};

  for (const part of parts) {
    if (part.startsWith('q:')) {
      filters.query = part.substring(2).replace(/\+/g, ' ');
    } else if (part.startsWith('f:')) {
      filters.variantId = part.substring(2);
    } else if (part.startsWith('mileageTo:')) {
      filters.mileageTo = parseInt(part.substring(10));
    } else if (part.startsWith('constructionYearFrom:')) {
      filters.constructionYearFrom = parseInt(part.substring(21));
    } else if (part.startsWith('sortBy:')) {
      filters.sortBy = part.substring(7);
    } else if (part.startsWith('sortOrder:')) {
      filters.sortOrder = part.substring(10);
    }
  }

  return filters;
}
```

---

## 9. API URL BUILDER (LOCKED)

### Implementation
```typescript
function buildMarktplaatsApiUrl(filters: HashFilters, page: number = 1): string {
  const params = new URLSearchParams();

  // Core search (ALWAYS included)
  if (filters.query) {
    params.append('query', filters.query);
  }
  params.append('searchInTitleAndDescription', 'true');
  params.append('l1CategoryId', '91');

  // Variant filter (if present)
  if (filters.variantId) {
    params.append('attributesById[]', filters.variantId);
  }

  // Range filters (OBSERVED KEYS ONLY)
  if (filters.mileageTo) {
    params.append('attributeRanges[]', `mileage:null:${filters.mileageTo}`);
  }
  if (filters.constructionYearFrom) {
    params.append('attributeRanges[]', `constructionYear:${filters.constructionYearFrom}:null`);
  }

  // Sorting (if present)
  if (filters.sortBy) {
    params.append('sortBy', filters.sortBy);
  }
  if (filters.sortOrder) {
    params.append('sortOrder', filters.sortOrder);
  }

  // Pagination
  const offset = (page - 1) * 30;
  params.append('offset', offset.toString());
  params.append('limit', '30');

  // Technical
  params.append('viewOptions', 'list-view');

  return `https://www.marktplaats.nl/lrp/api/search?${params.toString()}`;
}
```

---

## 10. COMPLETE FETCH EXAMPLE (LOCKED)

```typescript
async function fetchMarktplaatsListings(hashUrl: string, maxPages: number = 10): Promise<Listing[]> {
  const filters = parseMarktplaatsHash(hashUrl);
  const allListings: Listing[] = [];
  let excludedLeaseCount = 0;

  for (let page = 1; page <= maxPages; page++) {
    const apiUrl = buildMarktplaatsApiUrl(filters, page);

    console.log(`[MARKTPLAATS_API] Fetching page ${page}: ${apiUrl}`);

    const response = await fetch(apiUrl, {
      headers: {
        'Referer': 'https://www.marktplaats.nl/l/auto-s/',
        'User-Agent': 'Mozilla/5.0 (compatible; MCExportBot/1.0)',
      },
    });

    if (!response.ok) {
      console.error(`[MARKTPLAATS_API] HTTP ${response.status}`);
      break;
    }

    const data = await response.json();
    const listings = data.listings || [];

    console.log(`[MARKTPLAATS_API] Page ${page}: received ${listings.length} items from API`);

    if (listings.length === 0) {
      break;
    }

    // Filter out leasing ads BEFORE adding to corpus
    let validCount = 0;
    for (const item of listings) {
      if (isLeaseAd(item)) {
        console.log(`[MARKTPLAATS_API] 🚫 EXCLUDED lease ad: "${item.title}"`);
        excludedLeaseCount++;
      } else {
        allListings.push(item);
        validCount++;
      }
    }

    console.log(`[MARKTPLAATS_API] Page ${page}: +${validCount} valid listings (total: ${allListings.length}, excluded: ${excludedLeaseCount})`);

    // If less than 30 listings, we've reached the end
    if (listings.length < 30) {
      break;
    }
  }

  console.log(`[MARKTPLAATS_API] ✅ Total listings: ${allListings.length}`);
  console.log(`[MARKTPLAATS_API] 🚫 Excluded lease ads: ${excludedLeaseCount}`);

  return allListings;
}
```

---

## 11. CORPUS QUALITY VALIDATION (LOCKED)

### Expected Log Pattern
```
[MARKTPLAATS_API] Fetching page 1: https://www.marktplaats.nl/lrp/api/search?...
[MARKTPLAATS_API] Page 1: received 30 items from API
[MARKTPLAATS_API] 🚫 EXCLUDED lease ad: "VW Tiguan €499/mnd Private Lease"
[MARKTPLAATS_API] 🚫 EXCLUDED lease ad: "Tiguan leasen vanaf €399"
[MARKTPLAATS_API] Page 1: +28 valid listings (total: 28, excluded: 2)
[MARKTPLAATS_API] Fetching page 2: https://www.marktplaats.nl/lrp/api/search?...offset=30...
[MARKTPLAATS_API] Page 2: received 30 items from API
[MARKTPLAATS_API] Page 2: +30 valid listings (total: 58, excluded: 2)
...
[MARKTPLAATS_API] ✅ Total listings: 156
[MARKTPLAATS_API] 🚫 Excluded lease ads: 8
```

### Quality Checks (Post-Run)
```typescript
// 1. Price sanity check
const top6Prices = corpus.slice(0, 6).map(l => l.priceInfo.priceCents / 100);
console.log(`[MARKTPLAATS_API] Top 6 prices: [${top6Prices.join(', ')}]`);

// Red flag: Any price < €5,000 in car listings → likely leasing leak
if (top6Prices.some(p => p < 5000)) {
  console.error(`[MARKTPLAATS_API] ⚠️  WARNING: Low prices detected, possible lease ads leaked`);
}

// 2. Sorting check
const isSorted = top6Prices.every((p, i) => i === 0 || p >= top6Prices[i - 1]);
if (!isSorted) {
  console.error(`[MARKTPLAATS_API] ⚠️  WARNING: Prices not sorted ascending`);
}

// 3. Filter validation (spot check)
const allYearsValid = corpus.every(l => {
  const yearAttr = l.attributes.find(a => a.key === 'constructionYear');
  const year = yearAttr ? parseInt(yearAttr.value) : 0;
  return !filters.constructionYearFrom || year >= filters.constructionYearFrom;
});
if (!allYearsValid) {
  console.error(`[MARKTPLAATS_API] ⚠️  WARNING: Year filter not respected by API`);
}
```

---

## 12. IMPLEMENTATION CHECKLIST

Before deploying, verify ALL of these:

- [ ] Endpoint is `https://www.marktplaats.nl/lrp/api/search`
- [ ] Parameters use exact observed names (`attributeRanges[]`, `attributesById[]`, etc.)
- [ ] `attributeRanges[]` format is `key:min:max` (NOT `attributesByKey[...]`)
- [ ] Only OBSERVED range keys are implemented (`mileage`, `constructionYear`)
- [ ] `l1CategoryId=91` hardcoded (observed value)
- [ ] `searchInTitleAndDescription=true` always included
- [ ] `limit=30` always included
- [ ] `viewOptions=list-view` always included
- [ ] User-Agent is generic/stable (NOT Chrome/121 specifically)
- [ ] Referer header included
- [ ] Response parses `listings` array
- [ ] Price extraction: `priceCents / 100`
- [ ] Attribute extraction: `attributes.find(a => a.key === '...')`
- [ ] Leasing detection: `priceType === "PER_MONTH"` + title patterns
- [ ] Leasing exclusion happens BEFORE adding to corpus
- [ ] Top 6 extracted from FILTERED corpus
- [ ] Median computed from FILTERED corpus
- [ ] Quality check logs present (total, excluded, top 6 prices)

**IF ANY FAIL → IMPLEMENTATION IS BROKEN**

---

## 13. WHAT IS NOT IMPLEMENTED (OUT OF SCOPE)

### Not Observed in Capture (Do Not Implement)
- `engineHorsepower` range filter (not in test URL)
- Any other `attributeRanges[]` keys beyond `mileage` and `constructionYear`
- Dynamic discovery of filter IDs (f: values are user-provided)
- Other `sortBy` values beyond `PRICE` (not tested)
- Any POST request methods (only GET observed)

### Future Extensions (When Needed)
If users request additional filters:
1. Capture a NEW network request with those filters
2. Document the exact parameter format in this file
3. Implement based on captured data
4. Update this document

**NEVER guess parameter formats. Always capture first.**

---

## FINAL SIGN-OFF

**Status:** ✅ LOCKED
**Capture Date:** 2026-01-29
**Test URL:** VW Tiguan eHybrid, max 70,001 km, year ≥ 2020, price ascending
**Validation:** ✅ Top 6 results match browser output

**This specification is now immutable for the current implementation.**
Any changes require a NEW capture + NEW documentation.
