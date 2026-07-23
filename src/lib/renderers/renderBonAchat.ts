import { PDFDocument, StandardFonts } from 'pdf-lib';
import { DocumentData } from '../templateEngine';
import { finalizeAcroForm } from './pdfFormUtils';

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

  // Aplatissement fiable : apparences régénérées (une-ligne, taille fixe),
  // widgets réparés (les /P du template sont cassés → le flatten échouait en
  // silence), texte gravé dans la page. Sans cela, chaque lecteur PDF
  // redessinait les champs vivants à sa façon — alignés sur une machine,
  // décalés sur une autre (signalement Antoine, 20/07).
  if (finalizeAcroForm(pdfDoc, form, font)) {
    console.log('[BON_ACHAT] Form flattened successfully');
  } else {
    console.warn('[BON_ACHAT_WARN] Form flattening failed — champs laissés vivants');
    form.getFields().forEach(field => field.enableReadOnly());
  }

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
      // Le champ s'appelle « Vendeur x Adresse » : il attend le nom ET
      // l'adresse — n'y mettre que le nom perdait l'adresse du vendeur.
      const addressBits = [
        data.seller.address_line1,
        data.seller.address_line2,
        [data.seller.postal_code, data.seller.city].filter(Boolean).join(' '),
      ].filter((s) => s && String(s).trim());
      // Nom sur la 1ère ligne, adresse sur la 2ème (signalement Antoine
      // 21/07 : tout sur une ligne débordait et se faisait couper). La boîte
      // du template ne fait qu'une ligne de haut — on l'étend vers le bas
      // (espace blanc dispo avant le paragraphe suivant) avant l'aplatissement.
      const sellerFull = addressBits.length > 0
        ? `${sellerName}\n${addressBits.join(', ')}`
        : sellerName;
      const field = form.getTextField('Vendeur x Adresse');
      field.setText(sellerFull);
      const widget = field.acroField.getWidgets()[0];
      if (widget && sellerFull.includes('\n')) {
        const r = widget.getRectangle();
        const extra = 15; // ~une ligne à 11 pt
        widget.setRectangle({ x: r.x, y: r.y - extra, width: r.width, height: r.height + extra });
      }
      console.log(`[BON_ACHAT_ACROFORM] Filled Vendeur x Adresse: "${sellerFull.replace(/\n/g, ' ⏎ ')}"`);
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
