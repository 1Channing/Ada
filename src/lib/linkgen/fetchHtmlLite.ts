/**
 * Fetch HTML léger pour le Scout Check du Link Gen (bouton Vérifier).
 *
 * Extrait de feu scraperClient.ts (retiré le 28/07 — il dupliquait les
 * parsers du noyau et créait un risque de dérive entre pipelines). Ce module
 * ne contient AUCUN parsing : le HTML récupéré est analysé par les parsers
 * partagés de study-core, les mêmes que le worker. Seul le transport diffère
 * (Zyte appelé depuis le navigateur avec la clé VITE, deux tentatives).
 */
export async function fetchHtmlLite(targetUrl: string): Promise<string | null> {
  if (!targetUrl) return null;

  const apiKey =
    (import.meta.env.VITE_ZYTE_API_KEY as string | undefined) ||
    (import.meta.env.ZYTE_API_KEY as string | undefined) ||
    '';

  if (!apiKey) {
    console.warn('[LINKGEN_VALIDATION] fetchHtmlLite: no Zyte API key configured');
    return null;
  }

  const authHeader = `Basic ${btoa(apiKey + ':')}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      if (attempt === 2) await new Promise((r) => setTimeout(r, 1000));

      const response = await fetch('https://api.zyte.com/v1/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ url: targetUrl, browserHtml: true }),
      });

      if (!response.ok) {
        console.warn(`[LINKGEN_VALIDATION] fetchHtmlLite HTTP ${response.status} on attempt ${attempt}`);
        continue;
      }

      const json = await response.json();
      const html: string = json.browserHtml ?? json.httpResponseBody ?? '';
      if (html) return html;
    } catch (err) {
      console.warn(`[LINKGEN_VALIDATION] fetchHtmlLite error on attempt ${attempt}:`, err);
    }
  }

  return null;
}
