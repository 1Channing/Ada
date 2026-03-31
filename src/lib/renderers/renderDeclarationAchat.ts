import { PDFDocument, rgb } from 'pdf-lib';
import { DocumentData } from '../templateEngine';
import { normalizeBoxedValue, formatValue } from './utils/fieldHelpers';
import { renderBoxedField } from './utils/drawHelpers';

export async function renderDeclarationAchat(
  pdfDoc: PDFDocument,
  data: DocumentData
): Promise<void> {
  // ==================== TEMPORARY DEBUG CODE - START ====================
  // This section is for field discovery only. Remove after capturing field names.
  console.log('[DECL_ACHAT_DEBUG] Starting field discovery...');

  const form = pdfDoc.getForm();

  // Check and remove XFA if present
  if (form.hasXFA()) {
    console.log('[DECL_ACHAT_DEBUG] XFA detected, removing...');
    form.deleteXFA();
  }

  // Log all form fields
  const fields = form.getFields();
  console.log(`[DECL_ACHAT_DEBUG] Found ${fields.length} form fields:`);

  fields.forEach((field, index) => {
    console.log('[DECL_ACHAT_FIELD]', {
      index,
      name: field.getName(),
      type: field.constructor.name
    });
  });

  // Early return - do not proceed with rendering
  console.log('[DECL_ACHAT_DEBUG] Field discovery complete. Returning early.');
  return;
  // ==================== TEMPORARY DEBUG CODE - END ====================

  console.log('[DECL_ACHAT] Starting coordinate-based declaration rendering');

  const pages = pdfDoc.getPages();
  const page = pages[0];
  const font = await pdfDoc.embedFont('Helvetica');

  console.log(`[DECL_ACHAT] PDF has ${pages.length} page(s)`);

  if (data.buyer?.company_name || (data.buyer?.first_name && data.buyer?.last_name)) {
    const buyerName = data.buyer.company_name || `${data.buyer.first_name || ''} ${data.buyer.last_name || ''}`.trim();
    page.drawText(buyerName, { x: 100, y: 705, size: 9, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] buyer.full_name = "${buyerName}"`);
  }

  if (data.buyer?.siren) {
    const normalized = normalizeBoxedValue('siren', data.buyer.siren);
    renderBoxedField(page, normalized, 450, 705, 9, font, 10);
    console.log(`[DECL_ACHAT] buyer.siren = "${normalized}" (boxed)`);
  }

  if (data.buyer?.address_line1) {
    page.drawText(data.buyer.address_line1, { x: 70, y: 685, size: 9, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] buyer.address_line1 = "${data.buyer.address_line1}"`);
  }

  if (data.buyer?.postal_code) {
    const normalized = normalizeBoxedValue('postal_code', data.buyer.postal_code);
    renderBoxedField(page, normalized, 60, 665, 9, font, 10);
    console.log(`[DECL_ACHAT] buyer.postal_code = "${normalized}" (boxed)`);
  }

  if (data.buyer?.city) {
    page.drawText(data.buyer.city, { x: 120, y: 665, size: 9, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] buyer.city = "${data.buyer.city}"`);
  }

  if (data.transaction?.transaction_date) {
    const formatted = formatValue(data.transaction.transaction_date, 'date_time');
    page.drawText(formatted, { x: 120, y: 570, size: 9, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] transaction.transaction_date = "${formatted}"`);
  }

  if (data.vehicle?.plate_number) {
    const normalized = normalizeBoxedValue('plate_number', data.vehicle.plate_number);
    renderBoxedField(page, normalized, 80, 525, 9, font, 10);
    console.log(`[DECL_ACHAT] vehicle.plate_number = "${normalized}" (boxed)`);
  }

  if (data.vehicle?.vin) {
    const normalized = normalizeBoxedValue('vin', data.vehicle.vin);
    renderBoxedField(page, normalized, 280, 525, 9, font, 8);
    console.log(`[DECL_ACHAT] vehicle.vin = "${normalized}" (boxed)`);
  }

  if (data.vehicle?.brand) {
    page.drawText(data.vehicle.brand, { x: 460, y: 525, size: 9, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] vehicle.brand = "${data.vehicle.brand}"`);
  }

  if (data.vehicle?.type_variant_version) {
    page.drawText(data.vehicle.type_variant_version, { x: 80, y: 505, size: 9, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] vehicle.type_variant_version = "${data.vehicle.type_variant_version}"`);
  }

  if (data.vehicle?.commercial_name) {
    page.drawText(data.vehicle.commercial_name, { x: 280, y: 505, size: 9, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] vehicle.commercial_name = "${data.vehicle.commercial_name}"`);
  }

  if (data.vehicle?.national_type) {
    page.drawText(data.vehicle.national_type, { x: 460, y: 505, size: 9, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] vehicle.national_type = "${data.vehicle.national_type}"`);
  }

  if (data.vehicle?.registration_certificate_number) {
    page.drawText(data.vehicle.registration_certificate_number, { x: 230, y: 470, size: 9, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] vehicle.registration_certificate_number = "${data.vehicle.registration_certificate_number}"`);
  }

  if (data.seller?.company_name || (data.seller?.first_name && data.seller?.last_name)) {
    const sellerName = data.seller.company_name || `${data.seller.first_name || ''} ${data.seller.last_name || ''}`.trim();
    page.drawText(sellerName, { x: 100, y: 280, size: 9, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] seller.full_name = "${sellerName}"`);
  }

  if (data.seller?.siren) {
    const normalized = normalizeBoxedValue('siren', data.seller.siren);
    renderBoxedField(page, normalized, 450, 280, 9, font, 10);
    console.log(`[DECL_ACHAT] seller.siren = "${normalized}" (boxed)`);
  }

  if (data.seller?.address_line1) {
    page.drawText(data.seller.address_line1, { x: 70, y: 260, size: 9, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] seller.address_line1 = "${data.seller.address_line1}"`);
  }

  if (data.seller?.postal_code) {
    const normalized = normalizeBoxedValue('postal_code', data.seller.postal_code);
    renderBoxedField(page, normalized, 60, 240, 9, font, 10);
    console.log(`[DECL_ACHAT] seller.postal_code = "${normalized}" (boxed)`);
  }

  if (data.seller?.city) {
    page.drawText(data.seller.city, { x: 120, y: 240, size: 9, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] seller.city = "${data.seller.city}"`);
  }

  console.log('[DECL_ACHAT] Declaration rendering completed successfully');
}
