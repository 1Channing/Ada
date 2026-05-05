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
  BILBASEN: {
    TOYOTA: 'Toyota',
    BMW: 'BMW',
    MERCEDES: 'Mercedes-Benz',
    VOLKSWAGEN: 'Volkswagen',
    AUDI: 'Audi',
    PEUGEOT: 'Peugeot',
    RENAULT: 'Renault',
    FORD: 'Ford',
    HONDA: 'Honda',
    NISSAN: 'Nissan',
    HYUNDAI: 'Hyundai',
    KIA: 'Kia',
    VOLVO: 'Volvo',
    SKODA: 'Skoda',
    SEAT: 'Seat',
    CITROEN: 'Citroen',
    OPEL: 'Opel',
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
  BILBASEN: {
    RAV4: 'RAV4',
    'RAV 4': 'RAV4',
    YARIS: 'Yaris',
    COROLLA: 'Corolla',
    CAMRY: 'Camry',
    PRIUS: 'Prius',
    'C-HR': 'C-HR',
    CHR: 'C-HR',
    GOLF: 'Golf',
    POLO: 'Polo',
    PASSAT: 'Passat',
    '3 SERIES': '3',
    '5 SERIES': '5',
    'A-CLASS': 'A-Klasse',
    'C-CLASS': 'C-Klasse',
    'E-CLASS': 'E-Klasse',
  },
};

// Fuel mapping per site
// HYBRID and PLUG_IN_HYBRID are always distinct values
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
    PLUG_IN_HYBRID: 'plug-in-hybride',
  },
  // Codes verified live on leboncoin.fr/recherche — do not modify without re-verification
  // 1=Essence, 2=Diesel, 3=GPL, 4=Electrique, 5=Autre (used for PHEV), 6=Hybride, 7=GNV
  LEBONCOIN: {
    ESSENCE: '1',
    GASOLINE: '1',
    PETROL: '1',
    DIESEL: '2',
    GPL: '3',
    ELECTRIQUE: '4',
    ELECTRIC: '4',
    PLUG_IN_HYBRID: '5',
    HYBRIDE: '6',
    HYBRID: '6',
  },
  BILBASEN: {
    ESSENCE: 'Benzin',
    DIESEL: 'Diesel',
    HYBRIDE: 'Hybrid',
    ELECTRIQUE: 'El',
    GASOLINE: 'Benzin',
    PETROL: 'Benzin',
    HYBRID: 'Hybrid',
    ELECTRIC: 'El',
    PLUG_IN_HYBRID: 'Plugin-hybrid',
    GPL: '',
  },
};

// Parameters not yet supported by each site
// When a param is listed here, the generator emits a WARNING instead of injecting a bad value
export const UNSUPPORTED_PARAMS: Record<SiteKey, string[]> = {
  LEBONCOIN: ['minPower'],
  MARKTPLAATS: ['minPower'],
  BILBASEN: ['minPower'],
};

export function isSupportedParam(site: SiteKey, paramName: string): boolean {
  return !UNSUPPORTED_PARAMS[site].includes(paramName);
}

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
