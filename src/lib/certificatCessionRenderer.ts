import { PDFDocument, PDFPage, PDFFont, rgb } from 'pdf-lib';
import { DocumentData } from './templateEngine';

type BoxedFieldConfig = {
  startX: number;
  startY: number;
  charSpacing: number;
  maxChars: number;
  size: number;
};

type TextFieldConfig = {
  x: number;
  y: number;
  size: number;
  maxWidth?: number;
};

type CheckboxConfig = {
  x: number;
  y: number;
  size: number;
};

const CESSION_MAPPING = {
  boxed_fields: {
    plate_number: { startX: 60, startY: 735, charSpacing: 10, maxChars: 9, size: 9 },
    vin: { startX: 280, startY: 735, charSpacing: 8, maxChars: 17, size: 9 },
    first_registration_date: { startX: 490, startY: 735, charSpacing: 8, maxChars: 8, size: 9 },
    registration_certificate_number: { startX: 180, startY: 675, charSpacing: 9, maxChars: 12, size: 9 },
    seller_postal_code: { startX: 60, startY: 550, charSpacing: 10, maxChars: 5, size: 9 },
    seller_siret: { startX: 430, startY: 590, charSpacing: 9, maxChars: 14, size: 9 },
    buyer_birth_date: { startX: 80, startY: 280, charSpacing: 8, maxChars: 8, size: 9 },
    buyer_postal_code: { startX: 60, startY: 240, charSpacing: 10, maxChars: 5, size: 9 },
    buyer_siret: { startX: 430, startY: 300, charSpacing: 9, maxChars: 14, size: 9 },
    transaction_date: { startX: 120, startY: 445, charSpacing: 8, maxChars: 8, size: 9 },
    transaction_time: { startX: 200, startY: 445, charSpacing: 8, maxChars: 4, size: 9 },
  },
  text_fields: {
    vehicle_brand: { x: 60, y: 715, size: 9 },
    vehicle_type_variant_version: { x: 230, y: 715, size: 9, maxWidth: 150 },
    vehicle_national_type: { x: 390, y: 715, size: 9, maxWidth: 70 },
    vehicle_commercial_name: { x: 470, y: 715, size: 9, maxWidth: 100 },
    vehicle_mileage: { x: 230, y: 695, size: 9 },
    seller_company_name: { x: 100, y: 600, size: 9, maxWidth: 300 },
    seller_full_name: { x: 100, y: 590, size: 9, maxWidth: 300 },
    seller_address_line1: { x: 145, y: 570, size: 9, maxWidth: 400 },
    seller_address_line2: { x: 145, y: 558, size: 9, maxWidth: 400 },
    seller_city: { x: 120, y: 550, size: 9, maxWidth: 200 },
    buyer_company_name: { x: 100, y: 310, size: 9, maxWidth: 300 },
    buyer_full_name: { x: 100, y: 300, size: 9, maxWidth: 300 },
    buyer_birth_place: { x: 190, y: 280, size: 9, maxWidth: 200 },
    buyer_address_line1: { x: 145, y: 260, size: 9, maxWidth: 400 },
    buyer_address_line2: { x: 145, y: 248, size: 9, maxWidth: 400 },
    buyer_city: { x: 120, y: 240, size: 9, maxWidth: 200 },
  },
  checkboxes: {
    seller_person_type_physical: { x: 55, y: 595, size: 10 },
    seller_person_type_moral: { x: 55, y: 585, size: 10 },
    registration_certificate_present_yes: { x: 55, y: 660, size: 10 },
    registration_certificate_present_no: { x: 85, y: 660, size: 10 },
    seller_action_ceder: { x: 55, y: 525, size: 10 },
    seller_action_ceder_destruction: { x: 55, y: 512, size: 10 },
    buyer_person_type_physical: { x: 55, y: 305, size: 10 },
    buyer_person_type_moral: { x: 55, y: 295, size: 10 },
    buyer_action_acquerir: { x: 55, y: 215, size: 10 },
    buyer_action_informe: { x: 55, y: 202, size: 10 },
  },
};

function normalizeBoxedValue(fieldName: string, value: string): string {
  const raw = value;
  let normalized = value;

  if (fieldName === 'plate_number') {
    normalized = value.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  } else if (fieldName === 'vin') {
    normalized = value.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  } else if (fieldName.includes('postal_code')) {
    normalized = value.replace(/\D/g, '');
  } else if (fieldName.includes('siret')) {
    normalized = value.replace(/\D/g, '');
  } else if (fieldName.includes('date')) {
    normalized = value.replace(/\D/g, '');
  } else if (fieldName === 'transaction_time') {
    normalized = value.replace(/\D/g, '').slice(0, 4);
  }

  if (normalized !== raw) {
    console.log(`[CESSION_BOXED] field=${fieldName} raw="${raw}" normalized="${normalized}"`);
  }

  return normalized;
}

function renderBoxedCharacters(
  page: PDFPage,
  value: string,
  config: BoxedFieldConfig,
  font: PDFFont
): void {
  const normalized = normalizeBoxedValue(value.split('_').pop() || '', value);
  const chars = normalized.toUpperCase().split('').slice(0, config.maxChars);

  console.log(`[CESSION_BOXED] Rendering field at (${config.startX}, ${config.startY}), charCount=${chars.length}, spacing=${config.charSpacing}`);

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const charWidth = font.widthOfTextAtSize(char, config.size);
    const charX = config.startX + (i * config.charSpacing) + (config.charSpacing - charWidth) / 2;

    page.drawText(char, {
      x: charX,
      y: config.startY,
      size: config.size,
      font: font,
      color: rgb(0, 0, 0),
    });
  }

  console.log(`[CESSION_BOXED] Rendered ${chars.length} characters`);
}

function renderTextField(
  page: PDFPage,
  value: string,
  config: TextFieldConfig,
  font: PDFFont
): void {
  if (!value) return;

  let text = value;
  if (config.maxWidth) {
    const textWidth = font.widthOfTextAtSize(text, config.size);
    if (textWidth > config.maxWidth) {
      while (font.widthOfTextAtSize(text + '...', config.size) > config.maxWidth && text.length > 0) {
        text = text.slice(0, -1);
      }
      text = text + '...';
    }
  }

  console.log(`[CESSION_TEXT] field at (${config.x}, ${config.y}) value="${text}"`);

  page.drawText(text, {
    x: config.x,
    y: config.y,
    size: config.size,
    font: font,
    color: rgb(0, 0, 0),
  });
}

function renderCheckbox(
  page: PDFPage,
  checked: boolean,
  config: CheckboxConfig,
  font: PDFFont
): void {
  if (!checked) return;

  console.log(`[CESSION_CHECKBOX] Rendering check at (${config.x}, ${config.y})`);

  page.drawText('X', {
    x: config.x,
    y: config.y,
    size: config.size,
    font: font,
    color: rgb(0, 0, 0),
  });
}

function formatDate(dateString?: string): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${day}${month}${year}`;
}

export async function renderCertificatCession(
  pdfDoc: PDFDocument,
  data: DocumentData
): Promise<void> {
  console.log('[CESSION_RENDER] Starting certificate of cession rendering with dedicated mapping');

  const pages = pdfDoc.getPages();
  const page = pages[0];
  if (!page) {
    throw new Error('PDF has no pages');
  }

  const font = await pdfDoc.embedFont('Helvetica');

  console.log('[CESSION_RENDER] Rendering boxed fields');

  if (data.vehicle?.plate_number) {
    const normalized = normalizeBoxedValue('plate_number', data.vehicle.plate_number);
    renderBoxedCharacters(page, normalized, CESSION_MAPPING.boxed_fields.plate_number, font);
  }

  if (data.vehicle?.vin) {
    const normalized = normalizeBoxedValue('vin', data.vehicle.vin);
    renderBoxedCharacters(page, normalized, CESSION_MAPPING.boxed_fields.vin, font);
  }

  if (data.vehicle?.first_registration_date) {
    const formatted = formatDate(data.vehicle.first_registration_date);
    renderBoxedCharacters(page, formatted, CESSION_MAPPING.boxed_fields.first_registration_date, font);
  }

  if (data.vehicle?.registration_certificate_number) {
    const normalized = normalizeBoxedValue('registration_certificate_number', data.vehicle.registration_certificate_number);
    renderBoxedCharacters(page, normalized, CESSION_MAPPING.boxed_fields.registration_certificate_number, font);
  }

  if (data.seller?.postal_code) {
    const normalized = normalizeBoxedValue('seller_postal_code', data.seller.postal_code);
    renderBoxedCharacters(page, normalized, CESSION_MAPPING.boxed_fields.seller_postal_code, font);
  }

  if (data.seller?.siren) {
    const normalized = normalizeBoxedValue('seller_siret', data.seller.siren);
    renderBoxedCharacters(page, normalized, CESSION_MAPPING.boxed_fields.seller_siret, font);
  }

  if (data.buyer?.birth_date) {
    const formatted = formatDate(data.buyer.birth_date);
    renderBoxedCharacters(page, formatted, CESSION_MAPPING.boxed_fields.buyer_birth_date, font);
  }

  if (data.buyer?.postal_code) {
    const normalized = normalizeBoxedValue('buyer_postal_code', data.buyer.postal_code);
    renderBoxedCharacters(page, normalized, CESSION_MAPPING.boxed_fields.buyer_postal_code, font);
  }

  if (data.buyer?.siren) {
    const normalized = normalizeBoxedValue('buyer_siret', data.buyer.siren);
    renderBoxedCharacters(page, normalized, CESSION_MAPPING.boxed_fields.buyer_siret, font);
  }

  if (data.transaction?.transaction_date) {
    const formatted = formatDate(data.transaction.transaction_date);
    renderBoxedCharacters(page, formatted, CESSION_MAPPING.boxed_fields.transaction_date, font);
  }

  if (data.transaction?.transaction_time) {
    const normalized = normalizeBoxedValue('transaction_time', data.transaction.transaction_time);
    renderBoxedCharacters(page, normalized, CESSION_MAPPING.boxed_fields.transaction_time, font);
  }

  console.log('[CESSION_RENDER] Rendering text fields');

  if (data.vehicle?.brand) {
    renderTextField(page, data.vehicle.brand, CESSION_MAPPING.text_fields.vehicle_brand, font);
  }

  if (data.vehicle?.type_variant_version) {
    renderTextField(page, data.vehicle.type_variant_version, CESSION_MAPPING.text_fields.vehicle_type_variant_version, font);
  }

  if (data.vehicle?.national_type) {
    renderTextField(page, data.vehicle.national_type, CESSION_MAPPING.text_fields.vehicle_national_type, font);
  }

  if (data.vehicle?.commercial_name) {
    renderTextField(page, data.vehicle.commercial_name, CESSION_MAPPING.text_fields.vehicle_commercial_name, font);
  }

  if (data.vehicle?.mileage) {
    renderTextField(page, String(data.vehicle.mileage), CESSION_MAPPING.text_fields.vehicle_mileage, font);
  }

  if (data.seller?.company_name) {
    renderTextField(page, data.seller.company_name, CESSION_MAPPING.text_fields.seller_company_name, font);
  } else {
    const sellerName = [data.seller?.first_name, data.seller?.last_name].filter(Boolean).join(' ');
    if (sellerName) {
      renderTextField(page, sellerName, CESSION_MAPPING.text_fields.seller_full_name, font);
    }
  }

  if (data.seller?.address_line1) {
    renderTextField(page, data.seller.address_line1, CESSION_MAPPING.text_fields.seller_address_line1, font);
  }

  if (data.seller?.address_line2) {
    renderTextField(page, data.seller.address_line2, CESSION_MAPPING.text_fields.seller_address_line2, font);
  }

  if (data.seller?.city) {
    renderTextField(page, data.seller.city, CESSION_MAPPING.text_fields.seller_city, font);
  }

  if (data.buyer?.company_name) {
    renderTextField(page, data.buyer.company_name, CESSION_MAPPING.text_fields.buyer_company_name, font);
  } else {
    const buyerName = [data.buyer?.first_name, data.buyer?.last_name].filter(Boolean).join(' ');
    if (buyerName) {
      renderTextField(page, buyerName, CESSION_MAPPING.text_fields.buyer_full_name, font);
    }
  }

  if (data.buyer?.birth_place) {
    renderTextField(page, data.buyer.birth_place, CESSION_MAPPING.text_fields.buyer_birth_place, font);
  }

  if (data.buyer?.address_line1) {
    renderTextField(page, data.buyer.address_line1, CESSION_MAPPING.text_fields.buyer_address_line1, font);
  }

  if (data.buyer?.address_line2) {
    renderTextField(page, data.buyer.address_line2, CESSION_MAPPING.text_fields.buyer_address_line2, font);
  }

  if (data.buyer?.city) {
    renderTextField(page, data.buyer.city, CESSION_MAPPING.text_fields.buyer_city, font);
  }

  console.log('[CESSION_RENDER] Rendering checkboxes');

  const sellerIsMoral = !!data.seller?.company_name;
  renderCheckbox(page, !sellerIsMoral, CESSION_MAPPING.checkboxes.seller_person_type_physical, font);
  renderCheckbox(page, sellerIsMoral, CESSION_MAPPING.checkboxes.seller_person_type_moral, font);
  console.log(`[CESSION_CHECKBOX] field=seller_person_type value=${sellerIsMoral ? 'moral' : 'physical'}`);

  const buyerIsMoral = !!data.buyer?.company_name;
  renderCheckbox(page, !buyerIsMoral, CESSION_MAPPING.checkboxes.buyer_person_type_physical, font);
  renderCheckbox(page, buyerIsMoral, CESSION_MAPPING.checkboxes.buyer_person_type_moral, font);
  console.log(`[CESSION_CHECKBOX] field=buyer_person_type value=${buyerIsMoral ? 'moral' : 'physical'}`);

  const regCertPresent = data.vehicle?.registration_certificate_present ?? false;
  renderCheckbox(page, regCertPresent, CESSION_MAPPING.checkboxes.registration_certificate_present_yes, font);
  renderCheckbox(page, !regCertPresent, CESSION_MAPPING.checkboxes.registration_certificate_present_no, font);
  console.log(`[CESSION_CHECKBOX] field=registration_certificate_present value=${regCertPresent}`);

  renderCheckbox(page, true, CESSION_MAPPING.checkboxes.seller_action_ceder, font);
  console.log('[CESSION_CHECKBOX] field=seller_action_ceder value=true');

  renderCheckbox(page, true, CESSION_MAPPING.checkboxes.buyer_action_acquerir, font);
  console.log('[CESSION_CHECKBOX] field=buyer_action_acquerir value=true');

  renderCheckbox(page, true, CESSION_MAPPING.checkboxes.buyer_action_informe, font);
  console.log('[CESSION_CHECKBOX] field=buyer_action_informe value=true');

  console.log('[CESSION_RENDER] Certificate of cession rendering complete');
}
