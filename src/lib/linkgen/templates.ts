import type { SiteKey } from './types';

export const SEARCH_TEMPLATES: Record<SiteKey, string> = {
  LEBONCOIN:
    'https://www.leboncoin.fr/recherche?category=2' +
    '&u_car_brand={brand}' +
    '&u_car_model={model}' +
    '&regdate={year}-{year}' +
    '&mileage=min-{mileage}' +
    '&fuel={fuel}' +
    '&text={trim}',

  MARKTPLAATS:
    'https://www.marktplaats.nl/l/auto-s/#q:{query}' +
    '|constructionYearFrom:{year}' +
    '|constructionYearTo:{year}' +
    '|mileageTo:{mileage}',
};
