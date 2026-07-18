import { PDFDocument } from 'pdf-lib';
import { renderCertificatCession } from './renderers/renderCertificatCession';
import { renderDeclarationAchat } from './renderers/renderDeclarationAchat';
import { renderBonAchat } from './renderers/renderBonAchat';
import { renderEnlevement } from './renderers/renderEnlevement';
import { renderReceptionExpedition } from './renderers/renderReceptionExpedition';

// DB rows are `T | null`; renderers use truthiness guards, so null is as
// harmless as undefined here — accepting both removes a whole class of
// null-vs-undefined friction between Supabase and the generator.
type Maybe<T> = T | null | undefined;

export type ContactData = {
  company_name?: Maybe<string>;
  first_name?: Maybe<string>;
  last_name?: Maybe<string>;
  birth_date?: Maybe<string>;
  birth_place?: Maybe<string>;
  address_line1?: Maybe<string>;
  address_line2?: Maybe<string>;
  postal_code?: Maybe<string>;
  city?: Maybe<string>;
  country?: Maybe<string>;
  siren?: Maybe<string>;
  full_name?: Maybe<string>;
  address?: Maybe<string>;
};

export type DocumentData = {
  vehicle: {
    plate_number?: Maybe<string>;
    vin?: Maybe<string>;
    brand?: Maybe<string>;
    model?: Maybe<string>;
    commercial_name?: Maybe<string>;
    type_variant_version?: Maybe<string>;
    national_type?: Maybe<string>;
    first_registration_date?: Maybe<string>;
    mileage?: Maybe<number>;
    registration_certificate_present?: Maybe<boolean>;
    registration_certificate_number?: Maybe<string>;
    known_defects?: Maybe<string>;
    description?: Maybe<string>;
  };
  transaction: {
    transaction_type?: Maybe<string>;
    transaction_date?: Maybe<string>;
    transaction_time?: Maybe<string>;
    transaction_price?: Maybe<number>;
    pickup_location?: Maybe<string>;
    pickup_contact?: Maybe<string>;
    pickup_datetime?: Maybe<string>;
    destination?: Maybe<string>;
    transporter?: Maybe<string>;
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
      // ASCII-only filename: the accented original was stored NFD on disk while
      // the code asked for NFC — random 404s depending on the static host.
      templatePath = 'pdf-templates/enlevement_vehicule.pdf';
      renderer = renderEnlevement;
      break;

    case 'Réception / Expédition':
      templatePath = 'pdf-templates/reception_expedition.pdf';
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
