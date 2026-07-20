import { PDFDocument, StandardFonts } from 'pdf-lib';
import { DocumentData } from '../templateEngine';
import { finalizeAcroForm } from './pdfFormUtils';

export async function renderEnlevement(
  pdfDoc: PDFDocument,
  data: DocumentData
): Promise<void> {
  console.log('[ENLEVEMENT] Starting AcroForm-based fiche enlèvement rendering');

  const form = pdfDoc.getForm();
  let errorCount = 0;

  // Field mapping: DocumentData -> PDF AcroForm field names
  // Discovered fields:
  // - Marque
  // - Immatriculation
  // - VIN
  // - Kilometrage
  // - defauts connu
  // - Lieu enlevement
  // - Coordonnees contact
  // - Date enlevement

  // 1. Marque (brand and model combined)
  if (data.vehicle?.brand || data.vehicle?.model) {
    const brandAndModel = `${data.vehicle.brand || ''} ${data.vehicle.model || ''}`.trim();
    try {
      const field = form.getTextField('Marque');
      field.setText(brandAndModel);
      console.log(`[ENLEVEMENT] Marque = "${brandAndModel}"`);
    } catch (error) {
      errorCount++;
      console.warn(`[ENLEVEMENT_WARN] Failed to fill Marque:`, error);
    }
  }

  // 2. Immatriculation (plate number)
  if (data.vehicle?.plate_number) {
    try {
      const field = form.getTextField('Immatriculation');
      field.setText(data.vehicle.plate_number);
      console.log(`[ENLEVEMENT] Immatriculation = "${data.vehicle.plate_number}"`);
    } catch (error) {
      errorCount++;
      console.warn(`[ENLEVEMENT_WARN] Failed to fill Immatriculation:`, error);
    }
  }

  // 3. VIN (chassis number)
  if (data.vehicle?.vin) {
    try {
      const field = form.getTextField('VIN');
      field.setText(data.vehicle.vin.toUpperCase());
      console.log(`[ENLEVEMENT] VIN = "${data.vehicle.vin.toUpperCase()}"`);
    } catch (error) {
      errorCount++;
      console.warn(`[ENLEVEMENT_WARN] Failed to fill VIN:`, error);
    }
  }

  // 4. Kilometrage (mileage)
  if (data.vehicle?.mileage !== undefined && data.vehicle?.mileage !== null) {
    try {
      const field = form.getTextField('Kilometrage');
      field.setText(String(data.vehicle.mileage));
      console.log(`[ENLEVEMENT] Kilometrage = "${data.vehicle.mileage}"`);
    } catch (error) {
      errorCount++;
      console.warn(`[ENLEVEMENT_WARN] Failed to fill Kilometrage:`, error);
    }
  }

  // 5. defauts connu (known defects)
  if (data.vehicle?.known_defects) {
    try {
      const field = form.getTextField('defauts connu');
      field.setText(data.vehicle.known_defects);
      console.log(`[ENLEVEMENT] defauts connu = "${data.vehicle.known_defects}"`);
    } catch (error) {
      errorCount++;
      console.warn(`[ENLEVEMENT_WARN] Failed to fill defauts connu:`, error);
    }
  }

  // 6. Lieu enlevement (pickup location)
  if (data.transaction?.pickup_location) {
    try {
      const field = form.getTextField('Lieu enlevement');
      field.setText(data.transaction.pickup_location);
      console.log(`[ENLEVEMENT] Lieu enlevement = "${data.transaction.pickup_location}"`);
    } catch (error) {
      errorCount++;
      console.warn(`[ENLEVEMENT_WARN] Failed to fill Lieu enlevement:`, error);
    }
  }

  // 7. Coordonnees contact (pickup contact)
  if (data.transaction?.pickup_contact) {
    try {
      const field = form.getTextField('Coordonnees contact');
      field.setText(data.transaction.pickup_contact);
      console.log(`[ENLEVEMENT] Coordonnees contact = "${data.transaction.pickup_contact}"`);
    } catch (error) {
      errorCount++;
      console.warn(`[ENLEVEMENT_WARN] Failed to fill Coordonnees contact:`, error);
    }
  }

  // 8. Date enlevement (pickup date/time)
  if (data.transaction?.pickup_datetime) {
    try {
      const formatted = formatPickupDateTime(data.transaction.pickup_datetime);
      const field = form.getTextField('Date enlevement');
      field.setText(formatted);
      console.log(`[ENLEVEMENT] Date enlevement = "${formatted}"`);
    } catch (error) {
      errorCount++;
      console.warn(`[ENLEVEMENT_WARN] Failed to fill Date enlevement:`, error);
    }
  }

  // Aplatissement fiable : apparences régénérées, widgets réparés, texte
  // gravé dans la page — sinon chaque lecteur PDF redessine les champs à sa
  // façon (décalages vus sur certaines machines, signalement 20/07).
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  if (finalizeAcroForm(pdfDoc, form, font)) {
    console.log('[ENLEVEMENT] Form flattened successfully');
  } else {
    console.warn('[ENLEVEMENT_WARN] Form flattening failed — champs laissés vivants');
  }

  console.log(`[ENLEVEMENT] Fiche enlèvement rendering completed (${errorCount} field errors)`);
}

function formatPickupDateTime(dateTime: string): string {
  try {
    // Try parsing ISO 8601 format
    const date = new Date(dateTime);

    if (isNaN(date.getTime())) {
      // If not a valid date, return as-is
      return dateTime;
    }

    // Format as DD/MM/YYYY HH:mm
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${day}/${month}/${year} ${hours}:${minutes}`;
  } catch (error) {
    // If formatting fails, return original
    console.warn('[ENLEVEMENT_WARN] Date formatting failed, using original value');
    return dateTime;
  }
}
