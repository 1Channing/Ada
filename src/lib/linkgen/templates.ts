import type { SiteKey } from './types';

export const SEARCH_TEMPLATES: Record<SiteKey, string> = {
  LEBONCOIN:
    'https://www.leboncoin.fr/recherche?category=2' +
    '&u_car_brand={brand}' +
    '&u_car_model={model}' +
    '&regdate={yearFrom}-{yearTo}' +
    '&mileage=min-{mileage}' +
    '&fuel={fuel}' +
    '&text={trim}',

  MARKTPLAATS:
    'https://www.marktplaats.nl/l/auto-s/#q:{query}' +
    '|constructionYearFrom:{yearFrom}' +
    '|constructionYearTo:{yearTo}' +
    '|mileageTo:{mileage}',

  BILBASEN:
    'https://www.bilbasen.dk/brugt/bil' +
    '?make={brand}' +
    '&model={model}' +
    '&yearfrom={yearFrom}' +
    '&yearto={yearTo}' +
    '&mileageto={mileage}' +
    '&fuel={fuel}',
};

export const SITE_COUNTRIES: Record<SiteKey, string> = {
  LEBONCOIN: 'France',
  MARKTPLAATS: 'Netherlands',
  BILBASEN: 'Denmark',
};
