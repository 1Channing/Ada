import type { SiteKey } from './types';

export const SEARCH_TEMPLATES: Record<SiteKey, string> = {
  // sort=price&order=asc confirmed on live leboncoin.fr
  LEBONCOIN:
    'https://www.leboncoin.fr/recherche?category=2' +
    '&u_car_brand={brand}' +
    '&u_car_model={model}' +
    '&regdate={yearFrom}-{yearTo}' +
    '&mileage=min-{mileage}' +
    '&fuel={fuel}' +
    '&text={trim}' +
    '&sort=price&order=asc',

  // sortBy:PRICE|sortOrder:INCREASING confirmed on live marktplaats.nl
  MARKTPLAATS:
    'https://www.marktplaats.nl/l/auto-s/#q:{query}' +
    '|constructionYearFrom:{yearFrom}' +
    '|constructionYearTo:{yearTo}' +
    '|mileageTo:{mileage}' +
    '|sortBy:PRICE' +
    '|sortOrder:INCREASING',

  // sortby=price&sortorder=asc confirmed via Bilbasen URL structure
  BILBASEN:
    'https://www.bilbasen.dk/brugt/bil' +
    '?make={brand}' +
    '&model={model}' +
    '&yearfrom={yearFrom}' +
    '&yearto={yearTo}' +
    '&mileageto={mileage}' +
    '&fuel={fuel}' +
    '&sortby=price&sortorder=asc',
};

export const SITE_COUNTRIES: Record<SiteKey, string> = {
  LEBONCOIN: 'France',
  MARKTPLAATS: 'Netherlands',
  BILBASEN: 'Denmark',
};

export const EXPECTED_DOMAINS: Record<SiteKey, string> = {
  LEBONCOIN: 'leboncoin.fr',
  MARKTPLAATS: 'marktplaats.nl',
  BILBASEN: 'bilbasen.dk',
};
