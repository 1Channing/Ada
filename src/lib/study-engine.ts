/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STUDY EXECUTION ENGINE - COMPATIBILITY LAYER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **IMPORTANT: THIS FILE NOW DELEGATES TO study-core/business-logic.ts**
 *
 * This file is maintained for backwards compatibility with existing code that
 * imports from './study-engine'. All actual business logic has been moved to
 * the study-core module to ensure identical behavior across environments.
 *
 * **MIGRATION STATUS:**
 * - ✅ All business logic moved to src/lib/study-core/business-logic.ts
 * - ✅ This file now re-exports from study-core
 * - ✅ Backwards compatibility maintained
 *
 * **FOR NEW CODE:**
 * Import directly from study-core instead:
 * ```typescript
 * import { filterListingsByStudy, computeTargetMarketStats } from './study-core';
 * ```
 *
 * **WHY THIS CHANGE:**
 * Previously, instant searches (frontend) and scheduled searches (backend)
 * had separate implementations that drifted apart, causing inconsistent results.
 * The study-core module ensures DETERMINISTIC results regardless of execution
 * environment (browser/Node.js/Deno).
 *
 * **SYNCHRONIZED COPIES:**
 * The following files have been updated to use study-core:
 * - ✅ src/lib/study-engine.ts (this file) - Re-exports from study-core
 * - 🔄 worker/scraper.js - Being migrated to use study-core
 * - 🔄 supabase/functions/_shared/studyExecutor.ts - Being deprecated
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RE-EXPORTS FROM STUDY CORE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * All exports below delegate to study-core/business-logic.ts.
 * NO LOGIC IS DUPLICATED - this is purely a compatibility layer.
 */

// Re-export all types
export type {
  Currency,
  ScrapedListing,
  StudyCriteria,
  MarketStats,
  OpportunityResult,
  StudyExecutionResult,
} from './study-core/types';

// Re-export all business logic functions
export {
  toEur,
  matchesBrandModel,
  shouldFilterListing,
  filterListingsByStudy,
  computeTargetMarketStats,
  detectOpportunity,
  executeStudyAnalysis,
  hashStudyResult,
} from './study-core/business-logic';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BACKWARDS COMPATIBILITY NOTES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This file maintains 100% API compatibility with the original study-engine.ts.
 * All existing imports will continue to work:
 *
 * ```typescript
 * // These imports still work exactly as before:
 * import { toEur, filterListingsByStudy } from './study-engine';
 * import type { ScrapedListing, StudyCriteria } from './study-engine';
 * ```
 *
 * However, the actual implementation now comes from study-core, ensuring
 * consistency across all execution environments.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Module metadata
 */
export const MODULE_INFO = {
  name: 'study-engine (compatibility layer)',
  version: '2.0.0',
  migrationDate: '2026-01-07',
  delegatesTo: 'study-core/business-logic.ts',
  status: 'active (compatibility layer)',
};
