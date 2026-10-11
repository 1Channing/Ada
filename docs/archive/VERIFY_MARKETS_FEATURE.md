# Verify Markets Feature

## Summary

Added a "Verify markets" button for study results with zero listings, allowing users to manually check target and source market URLs.

## Problem

When a study run returns NULL due to "No valid target listings found" or "No valid source listings found", users had no easy way to manually verify the markets to confirm the scraper results.

## Solution

Added a minimal UI enhancement:
- **Detection**: Helper function `hasZeroListings()` checks if target_stats is null, count is 0, or error reason indicates no listings
- **Button**: "Verify markets" button appears in the Actions column for affected results
- **Modal**: Clicking opens a modal with two clickable links (Target and Source markets)
- **URLs**: Uses trim-filtered URLs from target_stats when available, falls back to original study URLs

## Files Changed

### `src/pages/StudiesV2Results.tsx`

**Added**:
1. State: `verifyMarketsResult` (line 83)
2. Helper: `hasZeroListings()` function (lines 87-92)
3. Button: Shows "Verify markets" link when zero listings detected (lines 603-610)
4. Modal: "Verify Markets" modal with target/source links (lines 830-875)

**Logic**:
- Detects zero listings: `!target_stats || target_stats.count === 0 || error message includes "No valid...listings found"`
- URLs priority: `target_stats.targetMarketUrl` > `studies_v2.market_target_url` (trim-filtered URL preferred)

## UI Behavior

**When shown**:
- Result status = NULL
- AND target_error_reason exists
- AND (no target_stats OR count=0 OR error mentions "No valid...listings found")

**When clicked**:
- Opens modal with heading "Verify Markets"
- Shows 2 clickable cards:
  - Target Market (blue label, country_target)
  - Source Market (emerald label, country_source)
- Each opens in new tab with trim/finish filters applied (if available)

## No Logic Changes

- Scraping: **unchanged**
- Business logic: **unchanged**
- Filtering: **unchanged**
- Database: **unchanged**
- Detection purely UI-based using existing stored data

## Acceptance Criteria Met

✅ For NULL results with listings but below threshold: No button (unchanged UI)
✅ For results with zero listings: "Verify markets" button appears
✅ Clicking button shows modal with target/source market links
✅ URLs include trim filters when available
✅ No other UI changes
✅ Build passes
