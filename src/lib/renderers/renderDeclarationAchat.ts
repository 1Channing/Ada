import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { DocumentData, signatureLocationOf } from '../templateEngine';
import {
  fillFieldSafely,
  fillSplitDateFields,
  fillSplitTimeFields,
  normalizeForAcroForm
} from './utils/acroformHelpers';
import { parseAddressLine } from './utils/fieldHelpers';

export async function renderDeclarationAchat(
  pdfDoc: PDFDocument,
  data: DocumentData
): Promise<void> {
  console.log('[DECL_ACHAT_ACROFORM] Starting AcroForm-based rendering');

  const form = pdfDoc.getForm();

  // Handle XFA if present (safety check for future PDF updates)
  if (form.hasXFA && form.hasXFA()) {
    console.log('[DECL_ACHAT_ACROFORM] XFA detected, removing...');
    form.deleteXFA();
  }

  const fields = form.getFields();
  const errors: string[] = [];

  console.log(`[DECL_ACHAT_ACROFORM] Form has ${fields.length} fields`);

  fillVehicleFields(form, data, errors);
  fillTransactionFields(form, data, errors);
  fillSellerFields(form, data, errors);

  form.flatten();

  // 20/11 (l'équipe : « dans MC Export vend, ajouter la déclaration d'achat, avec MC Export en vendeur et l'acheteur en
  // acheteur ») : côté vente, le déclarant « Je soussigné(e) » n'est plus MC Export — imprimé en dur sur le modèle —
  // mais le client ; on blanchit le bloc imprimé et on écrit l'acheteur par-dessus. Le certificat de vente (bas de page)
  // porte MC Export : c'est le vendeur de la transaction, rempli par fillSellerFields.
  if (data.transaction?.transaction_type === 'sale') await drawBuyerAsDeclarant(pdfDoc, data);

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
  // Lieu de la transaction = lieu de signature (jamais le lieu d'enlèvement, 26/09).
  const transactionLocation = signatureLocationOf(data.transaction);

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

  const mainName = data.seller.company_name ||
    (data.seller.first_name && data.seller.last_name
      ? `${data.seller.first_name} ${data.seller.last_name}`.trim()
      : data.seller.full_name || '');
  // Co-titulaire carte grise : une seule ligne d'identité sur le CERFA — les
  // co-titulaires y figurent à la suite (« NOM Prénom / NOM Prénom »),
  // l'adresse reste celle du titulaire principal (Channing 28/08).
  const coName = data.seller2
    ? (data.seller2.company_name || `${data.seller2.first_name || ''} ${data.seller2.last_name || ''}`.trim())
    : '';
  const sellerName = [mainName, coName].filter(Boolean).join(' / ');

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


/**
 * Le bloc « Je soussigné(e) » du cerfa 13751, mesuré sur le modèle (pdftotext -bbox, page 595 × 842) : MC EXPORT en
 * x 107–143 / y 719–729 ; « 88 BIS AVENUE JEAN BOUTTON » en y 694–706 (n° x 103, extension x 156, type x 204,
 * voie x 283) ; code postal en cases à x 92, 106, 119, 132, 147 (y 674) ; commune x 180 (y 672) ; les neuf cases
 * du SIREN à x 471 + 11,4 × i (y 720).
 */
async function drawBuyerAsDeclarant(pdfDoc: PDFDocument, data: DocumentData): Promise<void> {
  const b = data.buyer;
  if (!b) { console.warn('[DECL_ACHAT_ACROFORM_WARN] Côté vente sans acheteur : le déclarant reste MC Export'); return; }
  const page = pdfDoc.getPage(0);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const white = rgb(1, 1, 1);
  const size = 9;
  // Helvetica (WinAnsi) ne connaît pas toutes les lettres (ł, ő…) : sans accents, en capitales, comme le cerfa.
  const text = (t: string, x: number, y: number) => {
    const clean = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '').toUpperCase().trim();
    if (clean) page.drawText(clean, { x, y, size, font, color: rgb(0, 0, 0) });
  };
  // Blanchir le bloc imprimé (entre les traits de base des cases, jamais dessus).
  page.drawRectangle({ x: 103, y: 718.5, width: 350, height: 11.5, color: white });
  page.drawRectangle({ x: 102, y: 694, width: 460, height: 12, color: white });
  page.drawRectangle({ x: 88, y: 671.5, width: 470, height: 12, color: white });
  const main = b.company_name || (b.first_name && b.last_name ? `${b.first_name} ${b.last_name}`.trim() : b.full_name || '');
  const co = data.buyer2 ? (data.buyer2.company_name || `${data.buyer2.first_name || ''} ${data.buyer2.last_name || ''}`.trim()) : '';
  text(normalizeForAcroForm([main, co].filter(Boolean).join(' / '), 'generic').slice(0, 70), 107, 720);
  const siren = (b.siren ?? '').replace(/\D/g, '').slice(0, 9);
  for (let i = 0; i < siren.length; i++) text(siren[i], 468 + 11.4 * i, 720);
  if (b.address_line1) {
    const parts = parseAddressLine(b.address_line1);
    text(parts.number, 103, 696);
    text(parts.extension, 156, 696);
    text(parts.type, 204, 696);
    text(normalizeForAcroForm(parts.name, 'generic').slice(0, 55), 283, 696);
  }
  const cp = (b.postal_code ?? '').replace(/\D/g, '').slice(0, 5);
  const cpX = [92.3, 105.6, 119, 132.3, 147.3];
  for (let i = 0; i < cp.length; i++) text(cp[i], cpX[i], 674.5);
  if (b.city) text(normalizeForAcroForm(b.city, 'generic').slice(0, 40), 180, 673);
}
