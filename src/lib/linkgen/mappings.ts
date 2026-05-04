import type { SiteKey } from './types';

// Brand mapping: normalise raw brand value per site
const BRAND_MAP: Record<SiteKey, Record<string, string>> = {
  MARKTPLAATS: {
    TOYOTA: 'toyota',
    BMW: 'bmw',
    MERCEDES: 'mercedes-benz',
    VOLKSWAGEN: 'volkswagen',
    AUDI: 'audi',
    PEUGEOT: 'peugeot',
    RENAULT: 'renault',
    FORD: 'ford',
    HONDA: 'honda',
    NISSAN: 'nissan',
    HYUNDAI: 'hyundai',
    KIA: 'kia',
    VOLVO: 'volvo',
    SKODA: 'skoda',
    SEAT: 'seat',
    CITROEN: 'citroen',
    OPEL: 'opel',
  },
  LEBONCOIN: {
    TOYOTA: 'TOYOTA',
    BMW: 'BMW',
    MERCEDES: 'MERCEDES-BENZ',
    VOLKSWAGEN: 'VOLKSWAGEN',
    AUDI: 'AUDI',
    PEUGEOT: 'PEUGEOT',
    RENAULT: 'RENAULT',
    FORD: 'FORD',
    HONDA: 'HONDA',
    NISSAN: 'NISSAN',
    HYUNDAI: 'HYUNDAI',
    KIA: 'KIA',
    VOLVO: 'VOLVO',
    SKODA: 'SKODA',
    SEAT: 'SEAT',
    CITROEN: 'CITROEN',
    OPEL: 'OPEL',
  },
};

// Model mapping: normalise raw model value per site
const MODEL_MAP: Record<SiteKey, Record<string, string>> = {
  MARKTPLAATS: {
    RAV4: 'rav4',
    'RAV 4': 'rav4',
    YARIS: 'yaris',
    COROLLA: 'corolla',
    CAMRY: 'camry',
    PRIUS: 'prius',
    'C-HR': 'c-hr',
    CHR: 'c-hr',
    GOLF: 'golf',
    POLO: 'polo',
    PASSAT: 'passat',
    '3 SERIES': '3-series',
    '5 SERIES': '5-series',
    'A-CLASS': 'a-klasse',
    'C-CLASS': 'c-klasse',
    'E-CLASS': 'e-klasse',
  },
  LEBONCOIN: {
    RAV4: 'RAV 4',
    'RAV 4': 'RAV 4',
    YARIS: 'YARIS',
    COROLLA: 'COROLLA',
    CAMRY: 'CAMRY',
    PRIUS: 'PRIUS',
    'C-HR': 'C-HR',
    CHR: 'C-HR',
    GOLF: 'GOLF',
    POLO: 'POLO',
    PASSAT: 'PASSAT',
  },
};

// Fuel mapping per site
const FUEL_MAP: Record<SiteKey, Record<string, string>> = {
  MARKTPLAATS: {
    ESSENCE: 'benzine',
    DIESEL: 'diesel',
    HYBRIDE: 'hybride',
    ELECTRIQUE: 'elektrisch',
    GPL: 'lpg',
    GASOLINE: 'benzine',
    PETROL: 'benzine',
    HYBRID: 'hybride',
    ELECTRIC: 'elektrisch',
  },
  LEBONCOIN: {
    ESSENCE: '1',
    DIESEL: '2',
    HYBRIDE: '3',
    ELECTRIQUE: '5',
    GPL: '6',
    GASOLINE: '1',
    PETROL: '1',
    HYBRID: '3',
    ELECTRIC: '5',
  },
};

export function mapBrand(site: SiteKey, brand: string): string {
  const key = brand.trim().toUpperCase();
  return BRAND_MAP[site][key] ?? brand.trim();
}

export function mapModel(site: SiteKey, model: string): string {
  const key = model.trim().toUpperCase();
  return MODEL_MAP[site][key] ?? model.trim();
}

export function mapFuel(site: SiteKey, fuel: string): string {
  const key = fuel.trim().toUpperCase();
  return FUEL_MAP[site][key] ?? fuel.trim();
}
