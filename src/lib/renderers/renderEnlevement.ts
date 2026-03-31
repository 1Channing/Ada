import { PDFDocument, rgb } from 'pdf-lib';
import { DocumentData } from '../templateEngine';
import { normalizeBoxedValue, formatValue } from './utils/fieldHelpers';
import { renderBoxedField, renderMultilineText } from './utils/drawHelpers';

export async function renderEnlevement(
  pdfDoc: PDFDocument,
  data: DocumentData
): Promise<void> {
  console.log('[ENLEVEMENT] Starting coordinate-based fiche enlèvement rendering');

  const pages = pdfDoc.getPages();
  const page = pages[0];
  const font = await pdfDoc.embedFont('Helvetica');

  console.log(`[ENLEVEMENT] PDF has ${pages.length} page(s)`);

  if (data.vehicle?.brand && data.vehicle?.model) {
    const description = `${data.vehicle.brand} ${data.vehicle.model}`.trim();
    page.drawText(description, { x: 100, y: 715, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[ENLEVEMENT] vehicle.description = "${description}"`);
  }

  if (data.vehicle?.plate_number) {
    const normalized = normalizeBoxedValue('plate_number', data.vehicle.plate_number);
    renderBoxedField(page, normalized, 140, 700, 10, font, 10);
    console.log(`[ENLEVEMENT] vehicle.plate_number = "${normalized}" (boxed)`);
  }

  if (data.vehicle?.vin) {
    const normalized = normalizeBoxedValue('vin', data.vehicle.vin);
    renderBoxedField(page, normalized, 155, 685, 10, font, 8);
    console.log(`[ENLEVEMENT] vehicle.vin = "${normalized}" (boxed)`);
  }

  if (data.vehicle?.mileage) {
    const mileageStr = String(data.vehicle.mileage);
    page.drawText(mileageStr, { x: 125, y: 670, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[ENLEVEMENT] vehicle.mileage = "${mileageStr}"`);
  }

  if (data.vehicle?.known_defects) {
    renderMultilineText(page, data.vehicle.known_defects, 140, 655, 10, font, 50, 3, 12);
    console.log(`[ENLEVEMENT] vehicle.known_defects = "${data.vehicle.known_defects}" (multiline)`);
  }

  if (data.transaction?.pickup_location) {
    page.drawText(data.transaction.pickup_location, { x: 155, y: 525, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[ENLEVEMENT] transaction.pickup_location = "${data.transaction.pickup_location}"`);
  }

  if (data.transaction?.pickup_contact) {
    page.drawText(data.transaction.pickup_contact, { x: 250, y: 510, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[ENLEVEMENT] transaction.pickup_contact = "${data.transaction.pickup_contact}"`);
  }

  if (data.transaction?.pickup_datetime) {
    const formatted = formatValue(data.transaction.pickup_datetime, 'date');
    page.drawText(formatted, { x: 230, y: 480, size: 10, font, color: rgb(0, 0, 0) });
    console.log(`[ENLEVEMENT] transaction.pickup_datetime = "${formatted}"`);
  }

  console.log('[ENLEVEMENT] Fiche enlèvement rendering completed successfully');
}
