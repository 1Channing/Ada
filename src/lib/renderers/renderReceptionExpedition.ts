import { PDFDocument, rgb } from 'pdf-lib';
import { DocumentData } from '../templateEngine';
import { normalizeBoxedValue, formatValue } from './utils/fieldHelpers';
import { renderBoxedField, renderMultilineText } from './utils/drawHelpers';

export async function renderReceptionExpedition(
  pdfDoc: PDFDocument,
  data: DocumentData
): Promise<void> {
  console.log('[RECEPTION_EXP] Starting coordinate-based réception/expédition rendering');

  const pages = pdfDoc.getPages();
  const page = pages[0];
  const font = await pdfDoc.embedFont('Helvetica');

  console.log(`[RECEPTION_EXP] PDF has ${pages.length} page(s)`);

  if (data.transaction?.transaction_date) {
    const formatted = formatValue(data.transaction.transaction_date, 'date');
    page.drawText(formatted, { x: 180, y: 755, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[RECEPTION_EXP] transaction.transaction_date = "${formatted}"`);
  }

  if (data.vehicle?.brand && data.vehicle?.model) {
    const description = `${data.vehicle.brand} ${data.vehicle.model}`.trim();
    page.drawText(description, { x: 100, y: 730, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[RECEPTION_EXP] vehicle.description = "${description}"`);
  }

  if (data.vehicle?.plate_number) {
    const normalized = normalizeBoxedValue('plate_number', data.vehicle.plate_number);
    renderBoxedField(page, normalized, 145, 715, 10, font, 10);
    console.log(`[RECEPTION_EXP] vehicle.plate_number = "${normalized}" (boxed)`);
  }

  if (data.vehicle?.vin) {
    const normalized = normalizeBoxedValue('vin', data.vehicle.vin);
    renderBoxedField(page, normalized, 80, 700, 10, font, 8);
    console.log(`[RECEPTION_EXP] vehicle.vin = "${normalized}" (boxed)`);
  }

  if (data.vehicle?.mileage) {
    const mileageStr = String(data.vehicle.mileage);
    page.drawText(mileageStr, { x: 130, y: 685, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[RECEPTION_EXP] vehicle.mileage = "${mileageStr}"`);
  }

  if (data.vehicle?.known_defects) {
    renderMultilineText(page, data.vehicle.known_defects, 145, 670, 10, font, 50, 3, 12);
    console.log(`[RECEPTION_EXP] vehicle.known_defects = "${data.vehicle.known_defects}" (multiline)`);
  }

  if (data.transaction?.destination) {
    page.drawText(data.transaction.destination, { x: 130, y: 405, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[RECEPTION_EXP] transaction.destination = "${data.transaction.destination}"`);
  }

  if (data.transaction?.transporter) {
    page.drawText(data.transaction.transporter, { x: 135, y: 390, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[RECEPTION_EXP] transaction.transporter = "${data.transaction.transporter}"`);
  }

  console.log('[RECEPTION_EXP] Réception/Expédition rendering completed successfully');
}
