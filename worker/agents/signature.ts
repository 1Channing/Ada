/**
 * LA SIGNATURE AVEC LOGO (18/10, Channing : « ajouter automatiquement des
 * signatures de mails à Ada et Dana ») : public/signatures/<agente>.png, la
 * même image que l'aperçu des Réglages, jointe à chaque mail qui part de sa
 * boîte — intégrée au mail, jamais un lien vers une image hébergée (rien à
 * télécharger, rien qui ressemble à un pixel de suivi). Sans l'image, le
 * mail part en texte simple, comme avant. Le worker tourne depuis worker/
 * (Railway, construit depuis la racine du dépôt) ; les tests, depuis la racine.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pngSize, type SignatureImage } from '../../src/lib/agents/mail';

const cache = new Map<string, SignatureImage | null>();

export async function signatureImage(agent: string, displayName: string): Promise<SignatureImage | null> {
  if (cache.has(agent)) return cache.get(agent) ?? null;
  let out: SignatureImage | null = null;
  if (/^[a-z]+$/.test(agent)) {
    for (const root of [resolve(process.cwd(), '..'), process.cwd()]) {
      try {
        const bytes = await readFile(resolve(root, 'public', 'signatures', `${agent}.png`));
        const size = pngSize(bytes);
        if (size) { out = { base64: bytes.toString('base64'), name: `signature-${agent}.png`, alt: `${displayName} — MC Export · mc-export.com`, ...size }; break; }
      } catch { /* l'autre racine */ }
    }
  }
  if (!out) console.warn(`[AGENTS] signature de ${agent} introuvable (public/signatures/${agent}.png) : ses mails partent sans logo`);
  cache.set(agent, out);
  return out;
}
