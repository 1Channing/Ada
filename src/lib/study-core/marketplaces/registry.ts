import { detectBlockedContent } from '../blockDetection';
import type { SiteAdapter, SiteKey, SiteRegistry } from './types';

class SiteRegistryImpl implements SiteRegistry {
  private adapters = new Map<SiteKey, SiteAdapter>();

  register(adapter: SiteAdapter): void {
    this.adapters.set(adapter.key, adapter);
  }

  get(key: SiteKey): SiteAdapter {
    const adapter = this.adapters.get(key);
    if (!adapter) {
      throw new Error(`[SITE_REGISTRY] Unknown site adapter: "${key}". Registered: ${[...this.adapters.keys()].join(', ')}`);
    }
    return adapter;
  }

  has(key: SiteKey): boolean {
    return this.adapters.has(key);
  }

  all(): SiteAdapter[] {
    return [...this.adapters.values()];
  }

  byDomain(hostname: string): SiteAdapter | undefined {
    const host = extractHostname(hostname).toLowerCase();
    return this.all().find(
      (a) => host === a.domain || host === `www.${a.domain}` || host.endsWith(`.${a.domain}`)
    );
  }
}

function extractHostname(urlOrHostname: string): string {
  try {
    return new URL(urlOrHostname).hostname;
  } catch {
    // Already a bare hostname, or malformed — use as-is.
    return urlOrHostname;
  }
}

/** Singleton registry — adapters register themselves via index.ts on module load. */
export const siteRegistry = new SiteRegistryImpl();

/** Default pagination scheme shared by every site today (?page=N). */
export function defaultBuildPaginatedUrl(baseUrl: string, pageNumber: number): string {
  if (pageNumber <= 1) return baseUrl;
  try {
    const urlObj = new URL(baseUrl);
    urlObj.searchParams.set('page', String(pageNumber));
    return urlObj.toString();
  } catch {
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}page=${pageNumber}`;
  }
}

/** Default anti-bot detection shared by every site unless a site overrides it. */
export function defaultDetectBlocked(html: string, hasListings: boolean): boolean {
  return detectBlockedContent(html, hasListings).isBlocked;
}
