// Moved to src/lib/study-core/marketplaces/normalizer.ts so the site
// adapters (which live in study-core, shared with the worker) can use it
// without linkgen depending on study-core depending back on linkgen.
// Re-exported here for backward compatibility.
export { normalizeForMatch } from '../study-core/marketplaces/normalizer';
