import { PDFDocument, rgb } from 'pdf-lib';
import { DocumentData } from '../templateEngine';
import { normalizeBoxedValue, formatValue } from './utils/fieldHelpers';
import { renderBoxedField } from './utils/drawHelpers';

export async function renderBonAchat(
  pdfDoc: PDFDocument,
  data: DocumentData
): Promise<void> {
  console.log('[BON_ACHAT] Starting coordinate-based bon d\'achat rendering');

  const pages = pdfDoc.getPages();
  const page = pages[0];
  const font = await pdfDoc.embedFont('Helvetica');

  console.log(`[BON_ACHAT] PDF has ${pages.length} page(s)`);

  if (data.vehicle?.brand) {
    page.drawText(data.vehicle.brand, { x: 120, y: 595, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[BON_ACHAT] vehicle.brand = "${data.vehicle.brand}"`);
  }

  if (data.vehicle?.model) {
    page.drawText(data.vehicle.model, { x: 120, y: 580, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[BON_ACHAT] vehicle.model = "${data.vehicle.model}"`);
  }

  if (data.vehicle?.plate_number) {
    const normalized = normalizeBoxedValue('plate_number', data.vehicle.plate_number);
    renderBoxedField(page, normalized, 150, 565, 10, font, 10);
    console.log(`[BON_ACHAT] vehicle.plate_number = "${normalized}" (boxed)`);
  }

  if (data.vehicle?.vin) {
    const normalized = normalizeBoxedValue('vin', data.vehicle.vin);
    renderBoxedField(page, normalized, 165, 550, 10, font, 8);
    console.log(`[BON_ACHAT] vehicle.vin = "${normalized}" (boxed)`);
  }

  if (data.vehicle?.first_registration_date) {
    const formatted = formatValue(data.vehicle.first_registration_date, 'date');
    page.drawText(formatted, { x: 180, y: 535, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[BON_ACHAT] vehicle.first_registration_date = "${formatted}"`);
  }

  if (data.vehicle?.mileage) {
    const mileageStr = String(data.vehicle.mileage);
    page.drawText(mileageStr, { x: 140, y: 520, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[BON_ACHAT] vehicle.mileage = "${mileageStr}"`);
  }

  if (data.transaction?.transaction_price) {
    const formatted = formatValue(String(data.transaction.transaction_price), 'currency');
    page.drawText(formatted, { x: 400, y: 455, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[BON_ACHAT] transaction.transaction_price = "${formatted}"`);
  }

  if (data.seller?.company_name || (data.seller?.first_name && data.seller?.last_name)) {
    const sellerName = data.seller.company_name || `${data.seller.first_name || ''} ${data.seller.last_name || ''}`.trim();
    page.drawText(sellerName, { x: 80, y: 425, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[BON_ACHAT] seller.full_name = "${sellerName}"`);
  }

  if (data.transaction?.transaction_date) {
    const formatted = formatValue(data.transaction.transaction_date, 'date');
    page.drawText(formatted, { x: 170, y: 280, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[BON_ACHAT] transaction.transaction_date = "${formatted}"`);
  }

  console.log('[BON_ACHAT] Bon d\'achat rendering completed successfully');
}
