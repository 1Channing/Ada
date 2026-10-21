import type { ReactNode, MouseEvent } from 'react';
import { humanListingUrl } from '../services/marketData';
import { isBlockedRedirect, openListing } from '../services/listingLink';

/**
 * Le lien d'une annonce. Un lien que le navigateur ne peut plus ouvrir lui-même
 * (Gaspedaal, 21/10) passe par le worker, qui rend la fiche chez le vendeur ;
 * les autres s'ouvrent comme avant. Clic droit / « copier le lien » gardent
 * l'adresse d'origine.
 */
export function ListingLink({ href, children, className, title }: { href: string; children: ReactNode; className?: string; title?: string }) {
  const human = humanListingUrl(href);
  const blocked = isBlockedRedirect(human);
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!blocked || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openListing(human);
  };
  return (
    <a href={human} target="_blank" rel="noreferrer" onClick={onClick} className={className} title={blocked ? `${title ? `${title} — ` : ''}Gaspedaal : la fiche chez le vendeur s'ouvre via Ada (quelques secondes)` : title}>
      {children}
    </a>
  );
}
