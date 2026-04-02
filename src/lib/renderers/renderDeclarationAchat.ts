import { PDFDocument, rgb } from 'pdf-lib';
import { DocumentData } from '../templateEngine';
import { normalizeBoxedValue, formatValue } from './utils/fieldHelpers';
import { renderBoxedField } from './utils/drawHelpers';

const DEBUG_MODE = false;

function drawDebugMarker(page: any, x: number, y: number, label: string, font: any) {
  if (!DEBUG_MODE) return;

  page.drawText('•', { x, y, size: 12, font, color: rgb(1, 0, 0) });
  page.drawText(label, { x: x + 10, y, size: 6, font, color: rgb(1, 0, 0) });
}

export async function renderDeclarationAchat(
  pdfDoc: PDFDocument,
  data: DocumentData
): Promise<void> {
  console.log('[DECL_ACHAT] Starting coordinate-based rendering (NO AcroForm fields available)');

  const pages = pdfDoc.getPages();
  const page = pages[0];
  const font = await pdfDoc.embedFont('Helvetica');

  console.log(`[DECL_ACHAT] PDF has ${pages.length} page(s)`);

  if (data.vehicle?.plate_number) {
    const normalized = normalizeBoxedValue('plate_number', data.vehicle.plate_number);
    drawDebugMarker(page, 100, 500, 'plate', font);
    renderBoxedField(page, normalized, 100, 500, 10, font, 12);
    console.log(`[DECL_ACHAT] vehicle.plate_number = "${normalized}" at (100, 500)`);
  }

  if (data.vehicle?.vin) {
    const normalized = normalizeBoxedValue('vin', data.vehicle.vin);
    drawDebugMarker(page, 100, 480, 'vin', font);
    renderBoxedField(page, normalized, 100, 480, 9, font, 9);
    console.log(`[DECL_ACHAT] vehicle.vin = "${normalized}" at (100, 480)`);
  }

  if (data.vehicle?.brand) {
    drawDebugMarker(page, 100, 460, 'brand', font);
    page.drawText(data.vehicle.brand, { x: 100, y: 460, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] vehicle.brand = "${data.vehicle.brand}" at (100, 460)`);
  }

  if (data.vehicle?.model) {
    drawDebugMarker(page, 100, 440, 'model', font);
    page.drawText(data.vehicle.model, { x: 100, y: 440, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] vehicle.model = "${data.vehicle.model}" at (100, 440)`);
  }

  if (data.seller?.company_name || (data.seller?.first_name && data.seller?.last_name)) {
    const sellerName = data.seller.company_name || `${data.seller.first_name || ''} ${data.seller.last_name || ''}`.trim();
    drawDebugMarker(page, 100, 380, 'seller_name', font);
    page.drawText(sellerName, { x: 100, y: 380, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] seller.name = "${sellerName}" at (100, 380)`);
  }

  if (data.seller?.address_line1) {
    drawDebugMarker(page, 100, 360, 'seller_address', font);
    page.drawText(data.seller.address_line1, { x: 100, y: 360, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] seller.address = "${data.seller.address_line1}" at (100, 360)`);
  }

  if (data.seller?.postal_code && data.seller?.city) {
    const location = `${data.seller.postal_code} ${data.seller.city}`;
    drawDebugMarker(page, 100, 340, 'seller_city', font);
    page.drawText(location, { x: 100, y: 340, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] seller.location = "${location}" at (100, 340)`);
  }

  if (data.buyer?.company_name || (data.buyer?.first_name && data.buyer?.last_name)) {
    const buyerName = data.buyer.company_name || `${data.buyer.first_name || ''} ${data.buyer.last_name || ''}`.trim();
    drawDebugMarker(page, 100, 280, 'buyer_name', font);
    page.drawText(buyerName, { x: 100, y: 280, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] buyer.name = "${buyerName}" at (100, 280)`);
  }

  if (data.buyer?.address_line1) {
    drawDebugMarker(page, 100, 260, 'buyer_address', font);
    page.drawText(data.buyer.address_line1, { x: 100, y: 260, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] buyer.address = "${data.buyer.address_line1}" at (100, 260)`);
  }

  if (data.buyer?.postal_code && data.buyer?.city) {
    const location = `${data.buyer.postal_code} ${data.buyer.city}`;
    drawDebugMarker(page, 100, 240, 'buyer_city', font);
    page.drawText(location, { x: 100, y: 240, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] buyer.location = "${location}" at (100, 240)`);
  }

  if (data.transaction?.transaction_date) {
    const formatted = formatValue(data.transaction.transaction_date, 'date');
    drawDebugMarker(page, 100, 180, 'date', font);
    page.drawText(formatted, { x: 100, y: 180, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[DECL_ACHAT] transaction_date = "${formatted}" at (100, 180)`);
  }

  console.log('[DECL_ACHAT] Coordinate-based rendering complete');
}
