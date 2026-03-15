import { PDFDocument, rgb } from 'pdf-lib';

export type TemplateMapping = {
  template_name: string;
  template_file: string;
  has_form_fields: boolean;
  use_coordinates: boolean;
  is_multi_page?: boolean;
  field_mappings?: Record<string, string>;
  coordinate_mappings?: Record<string, {
    x: number;
    y: number;
    size?: number;
    format?: 'date' | 'date_time' | 'currency';
    type?: 'text' | 'boxed' | 'checkbox' | 'multiline';
    char_spacing?: number;
    max_chars?: number;
    max_lines?: number;
    line_height?: number;
  }>;
  boxed_fields?: string[];
  checkbox_fields?: string[];
  multiline_fields?: string[];
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
  seller?: {
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
  buyer?: {
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
};

export async function loadTemplateMapping(templateName: string): Promise<TemplateMapping> {
  console.log('[TEMPLATE_ENGINE] Loading mapping configuration for:', templateName);

  const mappingFiles: Record<string, string> = {
    'Bon d\'achat': '/admin/templates/bon_achat_mapping.json',
    'Certificat de cession': '/admin/templates/certificat_cession_mapping.json',
    'Déclaration d\'achat': '/admin/templates/declaration_achat_mapping.json',
    'Fiche enlèvement': '/admin/templates/fiche_enlevement_mapping.json',
    'Réception / Expédition': '/admin/templates/reception_expedition_mapping.json',
  };

  const mappingPath = mappingFiles[templateName];
  if (!mappingPath) {
    throw new Error(`No mapping found for template: ${templateName}`);
  }

  console.log('[TEMPLATE_ENGINE] Fetching mapping from:', mappingPath);
  const response = await fetch(mappingPath);
  if (!response.ok) {
    console.error(`[TEMPLATE_ENGINE] Failed to load mapping from ${mappingPath} - Status: ${response.status} ${response.statusText}`);
    throw new Error(`Failed to load mapping from ${mappingPath}: ${response.status} ${response.statusText}`);
  }

  const mapping: TemplateMapping = await response.json();
  console.log('[TEMPLATE_ENGINE] Mapping loaded:', {
    template_file: mapping.template_file,
    has_form_fields: mapping.has_form_fields,
    use_coordinates: mapping.use_coordinates,
    is_multi_page: mapping.is_multi_page || false,
    field_count: mapping.field_mappings ? Object.keys(mapping.field_mappings).length : 0,
    coordinate_count: mapping.coordinate_mappings ? Object.keys(mapping.coordinate_mappings).length : 0
  });

  return mapping;
}

export async function loadTemplate(templatePath: string): Promise<ArrayBuffer> {
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

function resolveValue(data: DocumentData, path: string): string {
  const parts = path.split('.');
  let value: any = data;

  for (const part of parts) {
    if (value && typeof value === 'object') {
      value = value[part as keyof typeof value];
    } else {
      return '';
    }
  }

  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

function formatValue(value: string, format?: string): string {
  if (!value || !format) return value;

  if (format === 'date' && value) {
    const date = new Date(value);
    return date.toLocaleDateString('fr-FR');
  }

  if (format === 'date_time' && value) {
    const date = new Date(value);
    return `${date.toLocaleDateString('fr-FR')} ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  if (format === 'currency' && value) {
    return `${value} €`;
  }

  return value;
}

function prepareData(data: DocumentData): DocumentData {
  const prepared = { ...data };

  if (prepared.seller) {
    prepared.seller = { ...prepared.seller };
    if (!prepared.seller.full_name) {
      const parts = [];
      if (prepared.seller.first_name) parts.push(prepared.seller.first_name);
      if (prepared.seller.last_name) parts.push(prepared.seller.last_name);
      prepared.seller.full_name = parts.length > 0 ? parts.join(' ') : (prepared.seller.company_name || '');
    }
    if (!prepared.seller.address) {
      const parts = [];
      if (prepared.seller.address_line1) parts.push(prepared.seller.address_line1);
      if (prepared.seller.address_line2) parts.push(prepared.seller.address_line2);
      prepared.seller.address = parts.join(', ');
    }
  }

  if (prepared.buyer) {
    prepared.buyer = { ...prepared.buyer };
    if (!prepared.buyer.full_name) {
      const parts = [];
      if (prepared.buyer.first_name) parts.push(prepared.buyer.first_name);
      if (prepared.buyer.last_name) parts.push(prepared.buyer.last_name);
      prepared.buyer.full_name = parts.length > 0 ? parts.join(' ') : (prepared.buyer.company_name || '');
    }
    if (!prepared.buyer.address) {
      const parts = [];
      if (prepared.buyer.address_line1) parts.push(prepared.buyer.address_line1);
      if (prepared.buyer.address_line2) parts.push(prepared.buyer.address_line2);
      prepared.buyer.address = parts.join(', ');
    }
  }

  if (prepared.vehicle) {
    prepared.vehicle = { ...prepared.vehicle };
    if (!prepared.vehicle.description) {
      prepared.vehicle.description = `${prepared.vehicle.brand || ''} ${prepared.vehicle.model || ''}`.trim();
    }
  }

  return prepared;
}

function renderBoxedField(
  page: any,
  text: string,
  x: number,
  y: number,
  size: number,
  font: any,
  charSpacing: number = 12
): void {
  console.log(`[ADMIN_PDF_BOXED] Rendering boxed field: "${text}" at (${x}, ${y}) with char spacing ${charSpacing}`);

  const chars = text.toUpperCase().split('');

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const charX = x + (i * charSpacing);

    page.drawText(char, {
      x: charX,
      y: y,
      size: size,
      font: font,
      color: rgb(0, 0, 0),
    });
  }

  console.log(`[ADMIN_PDF_BOXED] Rendered ${chars.length} characters`);
}

function renderCheckbox(
  page: any,
  checked: boolean,
  x: number,
  y: number,
  size: number,
  font: any
): void {
  console.log(`[ADMIN_PDF_CHECKBOX] Rendering checkbox at (${x}, ${y}), checked=${checked}`);

  if (checked) {
    page.drawText('X', {
      x: x,
      y: y,
      size: size,
      font: font,
      color: rgb(0, 0, 0),
    });
  }
}

function renderMultilineText(
  page: any,
  text: string,
  x: number,
  y: number,
  size: number,
  font: any,
  maxCharsPerLine: number = 60,
  maxLines: number = 5,
  lineHeight: number = 12
): void {
  console.log(`[ADMIN_PDF_MULTILINE] Rendering multiline text at (${x}, ${y}), max ${maxLines} lines`);

  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;

    if (testLine.length <= maxCharsPerLine) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  const linesToRender = lines.slice(0, maxLines);

  for (let i = 0; i < linesToRender.length; i++) {
    const line = linesToRender[i];
    const lineY = y - (i * lineHeight);

    page.drawText(line, {
      x: x,
      y: lineY,
      size: size,
      font: font,
      color: rgb(0, 0, 0),
    });
  }

  console.log(`[ADMIN_PDF_MULTILINE] Rendered ${linesToRender.length} lines`);
}

function getFieldType(fieldPath: string, mapping: TemplateMapping): string {
  if (mapping.boxed_fields?.includes(fieldPath)) {
    return 'boxed';
  }
  if (mapping.checkbox_fields?.includes(fieldPath)) {
    return 'checkbox';
  }
  if (mapping.multiline_fields?.includes(fieldPath)) {
    return 'multiline';
  }

  const coordMapping = mapping.coordinate_mappings?.[fieldPath];
  if (coordMapping?.type) {
    return coordMapping.type;
  }

  return 'text';
}

export async function fillPDFWithCoordinates(
  pdfDoc: PDFDocument,
  mapping: TemplateMapping,
  data: DocumentData
): Promise<void> {
  console.log('[ADMIN_PDF] Applying coordinate overlay');

  if (!mapping.coordinate_mappings) {
    console.log('[ADMIN_PDF] No coordinate mappings found');
    return;
  }

  const preparedData = prepareData(data);
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont('Helvetica');

  const pageIndexes = mapping.is_multi_page ? pages.map((_, i) => i) : [0];
  console.log(`[ADMIN_PDF] Applying to ${pageIndexes.length} page(s)`);

  let appliedCount = 0;

  for (const pageIndex of pageIndexes) {
    const page = pages[pageIndex];
    if (!page) continue;

    for (const [fieldPath, coords] of Object.entries(mapping.coordinate_mappings)) {
      const rawValue = resolveValue(preparedData, fieldPath);
      const fieldType = getFieldType(fieldPath, mapping);

      if (!rawValue && fieldType !== 'checkbox') {
        continue;
      }

      const value = formatValue(rawValue, coords.format);
      const size = coords.size || 10;

      console.log(`[ADMIN_PDF] Field: ${fieldPath}, Type: ${fieldType}, Value: "${value}"`);

      if (fieldType === 'boxed') {
        const charSpacing = coords.char_spacing || 12;
        renderBoxedField(page, value, coords.x, coords.y, size, font, charSpacing);
        appliedCount++;
      } else if (fieldType === 'checkbox') {
        const checked = rawValue === 'true' || rawValue === 'yes' || (typeof rawValue === 'boolean' && rawValue);
        renderCheckbox(page, checked, coords.x, coords.y, size, font);
        appliedCount++;
      } else if (fieldType === 'multiline') {
        const maxChars = coords.max_chars || 60;
        const maxLines = coords.max_lines || 5;
        const lineHeight = coords.line_height || 12;
        renderMultilineText(page, value, coords.x, coords.y, size, font, maxChars, maxLines, lineHeight);
        appliedCount++;
      } else {
        if (value) {
          page.drawText(value, {
            x: coords.x,
            y: coords.y,
            size: size,
            font: font,
            color: rgb(0, 0, 0),
          });
          appliedCount++;
        }
      }
    }
  }

  console.log(`[ADMIN_PDF] Overlay applied: ${appliedCount} fields mapped across ${pageIndexes.length} page(s)`);
}

export async function fillPDFWithFields(
  pdfDoc: PDFDocument,
  mapping: TemplateMapping,
  data: DocumentData
): Promise<boolean> {
  console.log('[ADMIN_PDF] Applying form field mapping');

  if (!mapping.field_mappings) {
    console.log('[ADMIN_PDF] No field mappings found');
    return false;
  }

  const preparedData = prepareData(data);

  let form;
  try {
    form = pdfDoc.getForm();
    const fields = form.getFields();
    console.log(`[ADMIN_PDF] PDF has ${fields.length} form fields`);

    if (fields.length === 0) {
      console.warn('[ADMIN_PDF] PDF has no form fields, cannot use field mapping');
      return false;
    }

    console.log('[ADMIN_PDF] Available form field names:', fields.map(f => f.getName()).join(', '));
  } catch (error) {
    console.warn('[ADMIN_PDF] Failed to get form from PDF:', error);
    return false;
  }

  let appliedCount = 0;
  let failedCount = 0;

  for (const [dataPath, fieldName] of Object.entries(mapping.field_mappings)) {
    const value = resolveValue(preparedData, dataPath);

    if (value) {
      try {
        const field = form.getTextField(fieldName);
        field.setText(value);
        console.log(`[ADMIN_PDF_FIELD] Successfully filled field "${fieldName}" with "${value}"`);
        appliedCount++;
      } catch (error) {
        console.warn(`[ADMIN_PDF_FIELD] Field not found: ${fieldName}, will use overlay fallback`);
        failedCount++;
      }
    }
  }

  if (appliedCount === 0 && failedCount > 0) {
    console.warn(`[ADMIN_PDF] No fields were mapped successfully (${failedCount} failed)`);
    return false;
  }

  try {
    form.flatten();
    console.log(`[ADMIN_PDF] Form mapping applied: ${appliedCount} fields mapped, ${failedCount} failed`);
    return true;
  } catch (error) {
    console.warn('[ADMIN_PDF] Failed to flatten form:', error);
    return false;
  }
}

export async function generatePDFFromTemplate(
  templateName: string,
  data: DocumentData
): Promise<Uint8Array> {
  console.log('[ADMIN_PDF] Starting PDF generation for:', templateName);

  const mapping = await loadTemplateMapping(templateName);

  const templateBytes = await loadTemplate(mapping.template_file);

  const pdfDoc = await PDFDocument.load(templateBytes);
  const pageCount = pdfDoc.getPageCount();
  console.log(`[ADMIN_PDF] PDF loaded with ${pageCount} page(s)`);

  try {
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    console.log(`[ADMIN_PDF] detected ${fields.length} form fields for ${templateName}`);
    if (fields.length > 0) {
      console.log('[ADMIN_PDF] Form field names:', fields.map(f => f.getName()).slice(0, 10).join(', '));
    }
  } catch (error) {
    console.log('[ADMIN_PDF] No form fields detected');
  }

  let fillSuccess = false;

  if (mapping.has_form_fields && mapping.field_mappings) {
    console.log('[ADMIN_PDF] using AcroForm mode');
    fillSuccess = await fillPDFWithFields(pdfDoc, mapping, data);

    if (!fillSuccess && mapping.use_coordinates && mapping.coordinate_mappings) {
      console.log('[ADMIN_PDF_FALLBACK] Form field filling failed, falling back to coordinate overlay');
      await fillPDFWithCoordinates(pdfDoc, mapping, data);
      fillSuccess = true;
    }
  } else if (mapping.use_coordinates && mapping.coordinate_mappings) {
    console.log('[ADMIN_PDF] Using coordinate overlay (no form fields configured)');
    await fillPDFWithCoordinates(pdfDoc, mapping, data);
    fillSuccess = true;
  } else {
    console.warn('[ADMIN_PDF] No mapping strategy defined');
  }

  if (!fillSuccess) {
    console.warn('[ADMIN_PDF] No data was filled into the PDF - returning blank template');
  }

  const pdfBytes = await pdfDoc.save();
  console.log(`[ADMIN_PDF] PDF exported successfully (${(pdfBytes.length / 1024).toFixed(2)} KB)`);

  return pdfBytes;
}
