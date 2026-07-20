import { PDFDocument, StandardFonts } from 'pdf-lib';
import { DocumentData } from '../templateEngine';
import { finalizeAcroForm } from './pdfFormUtils';

export async function renderReceptionExpedition(
  pdfDoc: PDFDocument,
  data: DocumentData
): Promise<void> {
  console.log('[RECEPTION_EXP] Starting AcroForm-based réception/expédition rendering');

  const form = pdfDoc.getForm();
  let errorCount = 0;

  // Field mapping: DocumentData -> PDF AcroForm field names
  // Discovered fields from PDF:
  // - Marque et modele
  // - Immatriculation
  // - VIN
  // - Kilometrage
  // - Defauts constates
  // Note: This PDF has NO checkboxes, only text fields

  // 1. Marque et modele (brand and model combined)
  if (data.vehicle?.brand || data.vehicle?.model) {
    const brandAndModel = `${data.vehicle.brand || ''} ${data.vehicle.model || ''}`.trim();
    try {
      const field = form.getTextField('Marque et modele');
      field.setText(brandAndModel);
      console.log(`[RECEPTION_EXP] Marque et modele = "${brandAndModel}"`);
    } catch (error) {
      errorCount++;
      console.warn(`[RECEPTION_EXP_WARN] Failed to fill Marque et modele:`, error);
    }
  }

  // 2. Immatriculation (plate number)
  if (data.vehicle?.plate_number) {
    try {
      const field = form.getTextField('Immatriculation');
      field.setText(data.vehicle.plate_number);
      console.log(`[RECEPTION_EXP] Immatriculation = "${data.vehicle.plate_number}"`);
    } catch (error) {
      errorCount++;
      console.warn(`[RECEPTION_EXP_WARN] Failed to fill Immatriculation:`, error);
    }
  }

  // 3. VIN (chassis number)
  if (data.vehicle?.vin) {
    try {
      const field = form.getTextField('VIN');
      field.setText(data.vehicle.vin.toUpperCase());
      console.log(`[RECEPTION_EXP] VIN = "${data.vehicle.vin.toUpperCase()}"`);
    } catch (error) {
      errorCount++;
      console.warn(`[RECEPTION_EXP_WARN] Failed to fill VIN:`, error);
    }
  }

  // 4. Kilometrage (mileage)
  if (data.vehicle?.mileage !== undefined && data.vehicle?.mileage !== null) {
    try {
      const field = form.getTextField('Kilometrage');
      field.setText(String(data.vehicle.mileage));
      console.log(`[RECEPTION_EXP] Kilometrage = "${data.vehicle.mileage}"`);
    } catch (error) {
      errorCount++;
      console.warn(`[RECEPTION_EXP_WARN] Failed to fill Kilometrage:`, error);
    }
  }

  // 5. Defauts constates (known defects)
  if (data.vehicle?.known_defects) {
    try {
      const field = form.getTextField('Defauts constates');
      field.setText(data.vehicle.known_defects);
      console.log(`[RECEPTION_EXP] Defauts constates = "${data.vehicle.known_defects}"`);
    } catch (error) {
      errorCount++;
      console.warn(`[RECEPTION_EXP_WARN] Failed to fill Defauts constates:`, error);
    }
  }

  // Note: The PDF template does NOT contain fields for:
  // - transaction_date (Date de réception)
  // - destination
  // - transporter
  // These appear to be labels only in the template, not fillable fields.
  // If these fields are needed, the PDF template must be updated in Acrobat
  // to include AcroForm fields for these values.

  // Aplatissement fiable : apparences régénérées, widgets réparés, texte
  // gravé dans la page — sinon chaque lecteur PDF redessine les champs à sa
  // façon (décalages vus sur certaines machines, signalement 20/07).
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  if (finalizeAcroForm(pdfDoc, form, font)) {
    console.log('[RECEPTION_EXP] Form flattened successfully');
  } else {
    console.warn('[RECEPTION_EXP_WARN] Form flattening failed — champs laissés vivants');
  }

  console.log(`[RECEPTION_EXP] Réception/Expédition rendering completed (${errorCount} field errors)`);
}
