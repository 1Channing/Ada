import { PDFDocument } from 'pdf-lib';
import { renderCertificatCession } from './renderers/renderCertificatCession';
import { renderDeclarationAchat } from './renderers/renderDeclarationAchat';
import { renderBonAchat } from './renderers/renderBonAchat';
import { renderEnlevement } from './renderers/renderEnlevement';
import { renderReceptionExpedition } from './renderers/renderReceptionExpedition';

export type ContactData = {
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
  full_name?: string;
  address?: string;
};

export type DocumentData = {
  vehicle: {
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
    description?: string;
  };
  transaction: {
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
  seller?: ContactData;
  seller2?: ContactData;
  buyer?: ContactData;
  buyer2?: ContactData;
};

async function loadTemplate(templatePath: string): Promise<ArrayBuffer> {
  console.log('[TEMPLATE_ENGINE] Loading template:', templatePath);

  const fullPath = `/${templatePath}`;
  console.log('[TEMPLATE_ENGINE] Fetching template from:', fullPath);

  const response = await fetch(fullPath);
  if (!response.ok) {
    console.error(`[TEMPLATE_ENGINE] Failed to load template from ${fullPath} - Status: ${response.status} ${response.statusText}`);
    throw new Error(`Failed to load template from ${fullPath}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const sizeKB = (arrayBuffer.byteLength / 1024).toFixed(2);
  console.log(`[TEMPLATE_ENGINE] Template loaded successfully (${sizeKB} KB)`);
  return arrayBuffer;
}

export async function generatePDFFromTemplate(
  templateName: string,
  data: DocumentData
): Promise<Uint8Array> {
  console.log('[TEMPLATE_ENGINE] Starting PDF generation for:', templateName);

  let templatePath: string;
  let renderer: (pdfDoc: PDFDocument, data: DocumentData) => Promise<void>;

  switch (templateName) {
    case 'Certificat de cession':
      templatePath = 'pdf-templates/Certificat_de_cession.pdf';
      renderer = renderCertificatCession;
      break;

    case 'Déclaration d\'achat':
      templatePath = 'pdf-templates/Declaration_d\'achat.pdf';
      renderer = renderDeclarationAchat;
      break;

    case 'Bon d\'achat':
      templatePath = 'pdf-templates/Bon_d_achat.pdf';
      renderer = renderBonAchat;
      break;

    case 'Fiche enlèvement':
      templatePath = 'pdf-templates/ENLÈVEMENT_VÉHICULE-12.pdf';
      renderer = renderEnlevement;
      break;

    case 'Réception / Expédition':
      templatePath = 'pdf-templates/Réception___Expédition.pdf';
      renderer = renderReceptionExpedition;
      break;

    default:
      throw new Error(`Unknown template: ${templateName}`);
  }

  console.log(`[TEMPLATE_ENGINE] Using dedicated renderer for: ${templateName}`);

  const templateBytes = await loadTemplate(templatePath);
  const pdfDoc = await PDFDocument.load(templateBytes);

  console.log(`[TEMPLATE_ENGINE] PDF loaded with ${pdfDoc.getPageCount()} page(s)`);

  await renderer(pdfDoc, data);

  const pdfBytes = await pdfDoc.save();
  console.log(`[TEMPLATE_ENGINE] PDF exported successfully (${(pdfBytes.length / 1024).toFixed(2)} KB)`);

  return pdfBytes;
}
