import { PDFDocument } from 'pdf-lib';
import { DocumentData } from '../templateEngine';
import {
  fillFieldSafely,
  fillSplitField,
  fillSplitDateFields,
  fillSplitTimeFields,
  normalizeForAcroForm
} from './utils/acroformHelpers';

export async function renderDeclarationAchat(
  pdfDoc: PDFDocument,
  data: DocumentData
): Promise<void> {
  console.log('[DECL_ACHAT_ACROFORM] Starting AcroForm-based rendering');

  const form = pdfDoc.getForm();
  const fields = form.getFields();
  const errors: string[] = [];

  console.log(`[DECL_ACHAT_ACROFORM] Form has ${fields.length} fields`);

  fillVehicleFields(form, data, errors);
  fillTransactionFields(form, data, errors);
  fillSellerFields(form, data, errors);

  form.flatten();

  const warningCount = errors.filter(e => !e.includes('Required')).length;
  const errorCount = errors.filter(e => e.includes('Required')).length;

  console.log(`[DECL_ACHAT_ACROFORM] Rendering complete: ${errors.length === 0 ? 'success' : `${warningCount} warnings, ${errorCount} errors`}`);

  if (errorCount > 0) {
    console.error('[DECL_ACHAT_ACROFORM_ERROR] Critical errors:', errors.filter(e => e.includes('Required')));
  }

  if (warningCount > 0) {
    console.warn('[DECL_ACHAT_ACROFORM_WARN] Warnings:', errors.filter(e => !e.includes('Required')));
  }
}

function fillVehicleFields(form: any, data: DocumentData, errors: string[]): void {
  if (data.vehicle?.plate_number) {
    const normalized = normalizeForAcroForm(data.vehicle.plate_number, 'plate');
    fillFieldSafely(form, 'vehicule_plate', normalized, 'vehicle plate', errors, true);
  }

  if (data.vehicle?.vin) {
    const normalized = normalizeForAcroForm(data.vehicle.vin, 'vin');
    fillFieldSafely(form, 'vehicle_vin', normalized, 'vehicle VIN', errors, true);
  }

  if (data.vehicle?.brand) {
    fillFieldSafely(form, 'vehicle_brand', data.vehicle.brand, 'vehicle brand', errors, true);
  }

  if (data.vehicle?.model) {
    fillFieldSafely(form, 'vehicle_model', data.vehicle.model, 'vehicle model', errors, false);
  }
}

function fillTransactionFields(form: any, data: DocumentData, errors: string[]): void {
  const transactionDate = data.transaction?.transaction_date;
  const transactionTime = data.transaction?.transaction_time;
  const transactionLocation = data.transaction?.pickup_location;

  if (transactionDate) {
    fillSplitDateFields(
      form,
      'transaction_day_',
      'transaction_month_',
      'transaction_year_',
      transactionDate,
      errors,
      'transaction date (top)'
    );

    fillSplitDateFields(
      form,
      'transaction_day_central_',
      'transaction_month_central_',
      'transaction_year_central_',
      transactionDate,
      errors,
      'transaction date (central)'
    );

    fillSplitDateFields(
      form,
      'transaction_day_bottom_',
      'transaction_month_bottom_',
      'transaction_year_bottom_',
      transactionDate,
      errors,
      'transaction date (bottom)'
    );
  }

  if (transactionTime) {
    fillSplitTimeFields(
      form,
      'transaction_hour_',
      'transaction_minute_',
      transactionTime,
      errors,
      'transaction time'
    );
  }

  if (transactionLocation) {
    fillFieldSafely(form, 'transaction_city_central', transactionLocation, 'transaction location (central)', errors, false);
    fillFieldSafely(form, 'transaction_place_bottom', transactionLocation, 'transaction location (bottom)', errors, false);
  }
}

function fillSellerFields(form: any, data: DocumentData, errors: string[]): void {
  if (!data.seller) {
    console.warn('[DECL_ACHAT_ACROFORM_WARN] No seller data provided');
    return;
  }

  const sellerName = data.seller.company_name ||
    (data.seller.first_name && data.seller.last_name
      ? `${data.seller.first_name} ${data.seller.last_name}`.trim()
      : data.seller.full_name || '');

  if (sellerName) {
    fillFieldSafely(form, 'NOM / PRENOM / RAISON SOCIAL - VENDEUR', sellerName, 'seller name', errors, true);
  }

  if (data.seller.address_line1) {
    const parts = parseAddressLine(data.seller.address_line1);

    if (parts.number) {
      fillFieldSafely(form, 'NUMEROS DE VOIE - VENDEUR', parts.number, 'seller street number', errors, false);
    }
    if (parts.extension) {
      fillFieldSafely(form, 'EXTENSION DE VOIE - VENDEUR', parts.extension, 'seller street extension', errors, false);
    }
    if (parts.type) {
      fillFieldSafely(form, 'TYPE DE VOIE - VENDEUR', parts.type, 'seller street type', errors, false);
    }
    if (parts.name) {
      fillFieldSafely(form, 'NOM DE LA VOIE - VENDEUR', parts.name, 'seller street name', errors, false);
    }
  }

  if (data.seller.postal_code) {
    const normalized = normalizeForAcroForm(data.seller.postal_code, 'postal');
    const postalDigits = normalized.padEnd(5, ' ').slice(0, 5);

    for (let i = 0; i < 5; i++) {
      const digit = postalDigits[i];
      if (digit && digit !== ' ') {
        fillFieldSafely(form, `CODE POSTALE ${i + 1}/5 -VENDEUR`, digit, `seller postal code digit ${i + 1}`, errors, false);
      }
    }
  }

  if (data.seller.city) {
    fillFieldSafely(form, 'COMMUNE - VENDEUR', data.seller.city, 'seller city', errors, true);
  }
}

function parseAddressLine(addressLine: string): {
  number: string;
  extension: string;
  type: string;
  name: string;
} {
  const result = { number: '', extension: '', type: '', name: '' };

  const parts = addressLine.trim().split(/\s+/);
  if (parts.length === 0) return result;

  const numberMatch = parts[0].match(/^(\d+)([A-Z]*)?$/i);
  if (numberMatch) {
    result.number = numberMatch[1];
    result.extension = numberMatch[2] || '';
    parts.shift();
  }

  const streetTypes = ['RUE', 'AVENUE', 'BOULEVARD', 'PLACE', 'ROUTE', 'CHEMIN', 'IMPASSE', 'ALLEE', 'COURS'];
  const firstWordUpper = parts[0]?.toUpperCase();

  if (streetTypes.includes(firstWordUpper)) {
    result.type = parts[0];
    parts.shift();
  }

  result.name = parts.join(' ');

  return result;
}
