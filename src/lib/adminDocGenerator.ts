import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import { supabase } from './supabase';

type VehicleData = {
  plate_number?: string;
  vin?: string;
  brand?: string;
  model?: string;
  commercial_name?: string;
  type_variant_version?: string;
  national_type?: string;
  first_registration_date?: string;
  mileage?: number;
  registration_certificate_present?: boolean;
  registration_certificate_number?: string;
  known_defects?: string;
};

type ContactData = {
  company_name?: string;
  first_name?: string;
  last_name?: string;
  birth_date?: string;
  birth_place?: string;
  address_line1?: string;
  address_line2?: string;
  postal_code?: string;
  city?: string;
  country?: string;
  siren?: string;
};

type TransactionData = {
  transaction_type?: string;
  transaction_date?: string;
  transaction_time?: string;
  transaction_price?: number;
  pickup_location?: string;
  pickup_contact?: string;
  pickup_datetime?: string;
  destination?: string;
  transporter?: string;
};

type DocumentData = {
  vehicle: VehicleData;
  transaction: TransactionData;
  seller?: ContactData;
  seller2?: ContactData;
  buyer?: ContactData;
  buyer2?: ContactData;
};

type FieldMapping = {
  field: string;
  value: string;
};

type CoordinateMapping = {
  text: string;
  x: number;
  y: number;
  size?: number;
};

const TEMPLATE_PATHS = {
  'Certificat de cession': '/pdf-templates/Certificat_de_cession.pdf',
  'Déclaration d\'achat': '/pdf-templates/Declaration_d\'achat.pdf',
  'Bon d\'achat': '/pdf-templates/Bon_d_achat.pdf',
  'Fiche enlèvement': '/pdf-templates/ENLÈVEMENT_VÉHICULE-12.pdf',
  'Réception / Expédition': '/pdf-templates/Réception___Expédition.pdf',
};

function formatDate(dateString?: string): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('fr-FR');
}

function formatFullName(contact?: ContactData): string {
  if (!contact) return '';
  const parts = [];
  if (contact.first_name) parts.push(contact.first_name);
  if (contact.last_name) parts.push(contact.last_name);
  return parts.join(' ');
}

function formatAddress(contact?: ContactData): string {
  if (!contact) return '';
  const parts = [];
  if (contact.address_line1) parts.push(contact.address_line1);
  if (contact.address_line2) parts.push(contact.address_line2);
  const cityPart = [];
  if (contact.postal_code) cityPart.push(contact.postal_code);
  if (contact.city) cityPart.push(contact.city);
  if (cityPart.length > 0) parts.push(cityPart.join(' '));
  return parts.join(', ');
}

async function loadTemplate(templatePath: string): Promise<ArrayBuffer> {
  console.log('[ADMIN_DOC_GEN] Loading template:', templatePath);

  const response = await fetch(templatePath);
  if (!response.ok) {
    throw new Error(`Failed to load template: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  console.log('[ADMIN_DOC_GEN] Template loaded successfully');
  return arrayBuffer;
}

async function detectFormFields(pdfDoc: PDFDocument): Promise<string[]> {
  const form = pdfDoc.getForm();
  const fields = form.getFields();

  console.log('[ADMIN_DOC_GEN] Detected form fields:', fields.length);

  return fields.map(field => field.getName());
}

function getFieldMappings(documentType: string, data: DocumentData): FieldMapping[] {
  const mappings: FieldMapping[] = [];

  return mappings;
}

function getCoordinateMappings(documentType: string, data: DocumentData): CoordinateMapping[] {
  const mappings: CoordinateMapping[] = [];
  const { vehicle, transaction, seller, buyer } = data;

  if (documentType === 'Bon d\'achat') {
    if (vehicle.brand) mappings.push({ text: vehicle.brand, x: 120, y: 595, size: 10 });
    if (vehicle.model) mappings.push({ text: vehicle.model, x: 120, y: 580, size: 10 });
    if (vehicle.plate_number) mappings.push({ text: vehicle.plate_number, x: 150, y: 565, size: 10 });
    if (vehicle.vin) mappings.push({ text: vehicle.vin, x: 165, y: 550, size: 10 });
    if (vehicle.first_registration_date) {
      mappings.push({ text: formatDate(vehicle.first_registration_date), x: 180, y: 535, size: 10 });
    }
    if (vehicle.mileage) {
      mappings.push({ text: `${vehicle.mileage}`, x: 140, y: 520, size: 10 });
    }
    if (transaction.transaction_price) {
      mappings.push({ text: `${transaction.transaction_price}`, x: 400, y: 455, size: 10 });
    }
    if (seller) {
      const sellerName = formatFullName(seller) || seller.company_name || '';
      mappings.push({ text: sellerName, x: 80, y: 425, size: 10 });
    }
    if (transaction.transaction_date) {
      mappings.push({ text: formatDate(transaction.transaction_date), x: 170, y: 280, size: 10 });
    }
  } else if (documentType === 'Fiche enlèvement') {
    const vehicleDesc = `${vehicle.brand || ''} ${vehicle.model || ''}`.trim();
    if (vehicleDesc) mappings.push({ text: vehicleDesc, x: 100, y: 715, size: 10 });
    if (vehicle.plate_number) mappings.push({ text: vehicle.plate_number, x: 140, y: 700, size: 10 });
    if (vehicle.vin) mappings.push({ text: vehicle.vin, x: 155, y: 685, size: 10 });
    if (vehicle.mileage) mappings.push({ text: `${vehicle.mileage}`, x: 125, y: 670, size: 10 });
    if (vehicle.known_defects) mappings.push({ text: vehicle.known_defects, x: 140, y: 655, size: 10 });
    if (transaction.pickup_location) {
      mappings.push({ text: transaction.pickup_location, x: 155, y: 525, size: 10 });
    }
    if (transaction.pickup_contact) {
      mappings.push({ text: transaction.pickup_contact, x: 250, y: 510, size: 10 });
    }
    if (transaction.pickup_datetime) {
      mappings.push({ text: formatDate(transaction.pickup_datetime), x: 230, y: 480, size: 10 });
    }
  } else if (documentType === 'Réception / Expédition') {
    if (transaction.transaction_date) {
      mappings.push({ text: formatDate(transaction.transaction_date), x: 180, y: 755, size: 10 });
    }
    const vehicleDesc = `${vehicle.brand || ''} ${vehicle.model || ''}`.trim();
    if (vehicleDesc) mappings.push({ text: vehicleDesc, x: 100, y: 730, size: 10 });
    if (vehicle.plate_number) mappings.push({ text: vehicle.plate_number, x: 145, y: 715, size: 10 });
    if (vehicle.vin) mappings.push({ text: vehicle.vin, x: 80, y: 700, size: 10 });
    if (vehicle.mileage) mappings.push({ text: `${vehicle.mileage}`, x: 130, y: 685, size: 10 });
    if (vehicle.known_defects) {
      mappings.push({ text: vehicle.known_defects, x: 145, y: 670, size: 10 });
    }
    if (transaction.destination) {
      mappings.push({ text: transaction.destination, x: 130, y: 405, size: 10 });
    }
    if (transaction.transporter) {
      mappings.push({ text: transaction.transporter, x: 135, y: 390, size: 10 });
    }
  }

  return mappings;
}

async function fillPDFWithCoordinates(
  pdfDoc: PDFDocument,
  mappings: CoordinateMapping[]
): Promise<void> {
  console.log('[ADMIN_DOC_GEN] Using coordinate overlay for', mappings.length, 'fields');

  const pages = pdfDoc.getPages();
  const firstPage = pages[0];
  const font = await pdfDoc.embedFont('Helvetica');

  for (const mapping of mappings) {
    firstPage.drawText(mapping.text, {
      x: mapping.x,
      y: mapping.y,
      size: mapping.size || 10,
      font: font,
      color: rgb(0, 0, 0),
    });
  }

  console.log('[ADMIN_DOC_GEN] Coordinate overlay complete');
}

async function fillPDFWithFields(
  pdfDoc: PDFDocument,
  mappings: FieldMapping[]
): Promise<void> {
  console.log('[ADMIN_DOC_GEN] Using form field mapping for', mappings.length, 'fields');

  const form = pdfDoc.getForm();

  for (const mapping of mappings) {
    try {
      const field = form.getTextField(mapping.field);
      field.setText(mapping.value);
    } catch (error) {
      console.warn(`[ADMIN_DOC_GEN] Field not found: ${mapping.field}`);
    }
  }

  form.flatten();
  console.log('[ADMIN_DOC_GEN] Form field mapping complete');
}

export async function generateAdminDocument(
  documentType: keyof typeof TEMPLATE_PATHS,
  transactionId: string
): Promise<Blob> {
  console.log('[ADMIN_DOC_GEN] Starting document generation:', documentType);

  const { data: transaction, error: txError } = await supabase
    .from('transactions_admin')
    .select(`
      *,
      vehicle:vehicles_admin(*),
      seller:seller_contact_id(*),
      seller2:seller_contact_id_2(*),
      buyer:buyer_contact_id(*),
      buyer2:buyer_contact_id_2(*)
    `)
    .eq('id', transactionId)
    .single();

  if (txError || !transaction) {
    throw new Error('Failed to load transaction data');
  }

  const documentData: DocumentData = {
    vehicle: transaction.vehicle || {},
    transaction: transaction,
    seller: transaction.seller,
    seller2: transaction.seller2,
    buyer: transaction.buyer,
    buyer2: transaction.buyer2,
  };

  const templatePath = TEMPLATE_PATHS[documentType];
  const templateBytes = await loadTemplate(templatePath);

  const pdfDoc = await PDFDocument.load(templateBytes);
  console.log('[ADMIN_DOC_GEN] PDF template loaded');

  const formFields = await detectFormFields(pdfDoc);

  if (formFields.length > 0) {
    console.log('[ADMIN_DOC_GEN] Form fields detected');
    const fieldMappings = getFieldMappings(documentType, documentData);
    await fillPDFWithFields(pdfDoc, fieldMappings);
  } else {
    console.log('[ADMIN_DOC_GEN] No form fields detected, using coordinate overlay');
    const coordinateMappings = getCoordinateMappings(documentType, documentData);
    await fillPDFWithCoordinates(pdfDoc, coordinateMappings);
  }

  const pdfBytes = await pdfDoc.save();
  console.log('[ADMIN_DOC_GEN] PDF generated successfully');

  const blob = new Blob([pdfBytes], { type: 'application/pdf' });

  const fileName = `${documentType.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('admin-documents')
    .upload(`transactions/${transactionId}/${fileName}`, blob);

  if (uploadError) {
    console.error('[ADMIN_DOC_GEN] Upload error:', uploadError);
    throw new Error('Failed to upload document');
  }

  const { data: urlData } = supabase.storage
    .from('admin-documents')
    .getPublicUrl(uploadData.path);

  await supabase.from('documents_admin_history').insert({
    transaction_id: transactionId,
    document_type: documentType,
    pdf_url: urlData.publicUrl,
  });

  console.log('[ADMIN_DOC_GEN] Document saved to history');

  return blob;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
