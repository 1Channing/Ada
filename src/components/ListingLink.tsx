import type { ReactNode, MouseEvent } from 'react';
import { humanListingUrl } from '../services/marketData';
import { isBlockedRedirect, openListing } from '../services/listingLink';

/**
 * Le lien d'une annonce. Un lien que le navigateur ne peut plus ouvrir lui-même
 * (Gaspedaal, 21/10) mène à la page de résultats Gaspedaal où figure l'annonce
 * (repli sûr, `fallback`), ou à défaut passe par le worker, qui rend la fiche
 * chez le vendeur ; les autres liens s'ouvrent comme avant.
 */
export function ListingLink({ href, fallback, children, className, title }: { href: string; fallback?: string | null; children: ReactNode; className?: string; title?: string }) {
  const human = humanListingUrl(href);
  const blocked = isBlockedRedirect(human);
  // Lien bloqué avec un repli connu : l'adresse du lien EST la page Gaspedaal (clic, clic du milieu, copie — tout marche).
  const shown = blocked && fallback ? fallback : human;
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!blocked || fallback || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openListing(human);
  };
  const hint = !blocked ? title : fallback
    ? `${title ? `${title} — ` : ''}Gaspedaal : ouvre la page de résultats où figure l'annonce ; cliquez-y sur la voiture pour la fiche chez le vendeur`
    : `${title ? `${title} — ` : ''}Gaspedaal : la fiche chez le vendeur s'ouvre via Ada (quelques secondes)`;
  return (
    <a href={shown} target="_blank" rel="noreferrer" onClick={onClick} className={className} title={hint}>
      {children}
    </a>
  );
}
