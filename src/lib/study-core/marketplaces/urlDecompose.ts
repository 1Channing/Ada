/**
 * Generic URL decomposition — query params, hash params (Marktplaats
 * `#q:...|key:value` convention included) and raw path segments.
 *
 * Moved verbatim from src/lib/linkgen/csvMappingLearner.ts (decomposeUrl)
 * so both the CSV learner and the Ingestion pipeline share one
 * implementation. Pure function, no I/O — safe for browser/Node/Deno.
 */

export interface DetectedParams {
  rawUrl: string;
  domain: string;
  queryParams: Record<string, string>;
  hashParams: Record<string, string>;
  pathSegments: string[];
}

export function decomposeUrl(rawUrl: string): DetectedParams | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    console.warn(`[URL_ANALYSIS] Cannot parse URL: ${rawUrl}`);
    return null;
  }

  const queryParams: Record<string, string> = {};
  parsed.searchParams.forEach((v, k) => { queryParams[k] = v; });

  const hashParams: Record<string, string> = {};
  const hash = parsed.hash.replace(/^#/, '');
  if (hash) {
    const pipeSegments = hash.split('|');
    for (const seg of pipeSegments) {
      const colonIdx = seg.indexOf(':');
      if (colonIdx > 0) {
        const k = seg.slice(0, colonIdx).trim();
        const v = seg.slice(colonIdx + 1).trim();
        if (k) hashParams[k] = v;
      } else {
        const eqIdx = seg.indexOf('=');
        if (eqIdx > 0) {
          hashParams[seg.slice(0, eqIdx).trim()] = seg.slice(eqIdx + 1).trim();
        }
      }
    }
    try {
      const hashSearchParams = new URLSearchParams(hash);
      hashSearchParams.forEach((v, k) => {
        if (!(k in hashParams)) hashParams[k] = v;
      });
    } catch { /* ignore */ }
  }

  const pathSegments = parsed.pathname
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    rawUrl,
    domain: parsed.hostname,
    queryParams,
    hashParams,
    pathSegments,
  };
}
