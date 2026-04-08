import { PDFDocument, StandardFonts } from 'pdf-lib';
import { DocumentData } from '../templateEngine';

export async function renderBonAchat(
  pdfDoc: PDFDocument,
  data: DocumentData
): Promise<void> {
  console.log('[BON_ACHAT_ACROFORM] Starting AcroForm-based rendering');

  const form = pdfDoc.getForm();

  if (form.hasXFA && form.hasXFA()) {
    console.log('[BON_ACHAT_ACROFORM] XFA detected, removing...');
    form.deleteXFA();
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  console.log('[BON_ACHAT_ACROFORM] Embedded Helvetica font for consistent rendering');

  const fields = form.getFields();
  const errors: string[] = [];

  console.log(`[BON_ACHAT_ACROFORM] Form has ${fields.length} fields`);

  fillVehicleFields(form, data, errors);
  fillTransactionFields(form, data, errors);
  fillSellerFields(form, data, errors);

  // Step 1: Force per-field appearance regeneration
  // Call updateFieldAppearances for each field individually to ensure fresh appearance streams
  form.getFields().forEach(field => {
    try {
      // Force regeneration by calling the form method in a loop
      form.updateFieldAppearances(font);
    } catch (e) {
      console.warn('[BON_ACHAT] Appearance update failed for field', field.getName());
    }
  });
  console.log('[BON_ACHAT] Per-field appearance regeneration complete');

  // Step 2: Enforce global appearance update
  form.updateFieldAppearances(font);
  console.log('[BON_ACHAT] Global appearance update complete');

  // Step 3: Flatten
  try {
    form.flatten();
    console.log('[BON_ACHAT] Form flattened successfully');
  } catch (error) {
    console.error('[BON_ACHAT] Flatten FAILED', error);
  }

  // Step 4: CRITICAL - Always enforce read-only AFTER flatten
  form.getFields().forEach(field => {
    field.enableReadOnly();
  });
  console.log('[BON_ACHAT] All fields set to read-only after flatten');

  const warningCount = errors.length;
  console.log(`[BON_ACHAT_ACROFORM] Rendering complete: ${errors.length === 0 ? 'success' : `${warningCount} warnings`}`);

  if (warningCount > 0) {
    console.warn('[BON_ACHAT_ACROFORM_WARN] Warnings:', errors);
  }
}

function fillVehicleFields(form: any, data: DocumentData, errors: string[]): void {
  if (data.vehicle?.brand) {
    try {
      const field = form.getTextField('Marque');
      field.setText(data.vehicle.brand);
      console.log(`[BON_ACHAT_ACROFORM] Filled Marque: "${data.vehicle.brand}"`);
    } catch (err) {
      errors.push(`Failed to fill Marque: ${err}`);
    }
  }

  if (data.vehicle?.model) {
    try {
      const field = form.getTextField('Modele');
      field.setText(data.vehicle.model);
      console.log(`[BON_ACHAT_ACROFORM] Filled Modele: "${data.vehicle.model}"`);
    } catch (err) {
      errors.push(`Failed to fill Modele: ${err}`);
    }
  }

  if (data.vehicle?.plate_number) {
    try {
      const field = form.getTextField('Immatriculation');
      field.setText(data.vehicle.plate_number);
      console.log(`[BON_ACHAT_ACROFORM] Filled Immatriculation: "${data.vehicle.plate_number}"`);
    } catch (err) {
      errors.push(`Failed to fill Immatriculation: ${err}`);
    }
  }

  if (data.vehicle?.vin) {
    try {
      const field = form.getTextField('VIN');
      const normalizedVIN = data.vehicle.vin.toUpperCase();
      field.setText(normalizedVIN);
      console.log(`[BON_ACHAT_ACROFORM] Filled VIN: "${normalizedVIN}"`);
    } catch (err) {
      errors.push(`Failed to fill VIN: ${err}`);
    }
  }

  if (data.vehicle?.first_registration_date) {
    try {
      const field = form.getTextField('premire mise en circulation');
      const formatted = formatDate(data.vehicle.first_registration_date);
      field.setText(formatted);
      console.log(`[BON_ACHAT_ACROFORM] Filled premire mise en circulation: "${formatted}"`);
    } catch (err) {
      errors.push(`Failed to fill premire mise en circulation: ${err}`);
    }
  }

  if (data.vehicle?.mileage) {
    try {
      const field = form.getTextField('Kilometrage');
      const mileageStr = String(data.vehicle.mileage);
      field.setText(mileageStr);
      console.log(`[BON_ACHAT_ACROFORM] Filled Kilometrage: "${mileageStr}"`);
    } catch (err) {
      errors.push(`Failed to fill Kilometrage: ${err}`);
    }
  }
}

function fillTransactionFields(form: any, data: DocumentData, errors: string[]): void {
  if (data.transaction?.transaction_price) {
    try {
      const field = form.getTextField('Prix');
      const priceStr = String(data.transaction.transaction_price);
      field.setText(priceStr);
      console.log(`[BON_ACHAT_ACROFORM] Filled Prix: "${priceStr}"`);
    } catch (err) {
      errors.push(`Failed to fill Prix: ${err}`);
    }
  }

  if (data.transaction?.transaction_date) {
    try {
      const field = form.getTextField('Date_1');
      const formatted = formatDate(data.transaction.transaction_date);
      field.setText(formatted);
      console.log(`[BON_ACHAT_ACROFORM] Filled Date_1: "${formatted}"`);
    } catch (err) {
      errors.push(`Failed to fill Date_1: ${err}`);
    }
  }
}

function fillSellerFields(form: any, data: DocumentData, errors: string[]): void {
  if (data.seller?.company_name || (data.seller?.first_name && data.seller?.last_name)) {
    try {
      const sellerName = data.seller.company_name ||
        `${data.seller.first_name || ''} ${data.seller.last_name || ''}`.trim();
      const field = form.getTextField('Vendeur x Adresse');
      field.setText(sellerName);
      console.log(`[BON_ACHAT_ACROFORM] Filled Vendeur x Adresse: "${sellerName}"`);
    } catch (err) {
      errors.push(`Failed to fill Vendeur x Adresse: ${err}`);
    }
  }
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch (err) {
    return dateStr;
  }
}
