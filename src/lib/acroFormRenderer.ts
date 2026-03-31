import { PDFDocument } from 'pdf-lib';
import { normalizeBoxedValue, splitDate, splitTime, fillFieldSafely, discoverPDFFields } from './pdfFieldHelpers';

export interface AcroFormMappings {
  [dataPath: string]: string;
}

export async function renderWithAcroForm(
  pdfDoc: PDFDocument,
  data: Record<string, any>,
  acroFormMappings: AcroFormMappings,
  requiredFields: string[] = []
): Promise<void> {
  console.log('[ACROFORM] Starting generic AcroForm rendering');
  console.log(`[ACROFORM] Mappings count: ${Object.keys(acroFormMappings).length}`);
  console.log(`[ACROFORM] Required fields count: ${requiredFields.length}`);

  discoverPDFFields(pdfDoc);

  const form = pdfDoc.getForm();
  if (form.hasXFA()) {
    console.log('[ACROFORM] XFA detected, removing to enable standard AcroForm fields');
    form.deleteXFA();
  } else {
    console.log('[ACROFORM] No XFA detected');
  }

  const errors: string[] = [];
  let successCount = 0;

  for (const [dataPath, pdfFieldMapping] of Object.entries(acroFormMappings)) {
    const isRequired = requiredFields.includes(dataPath);

    let value = resolveDataPath(data, dataPath);

    if (dataPath.endsWith('.identity')) {
      const entity = dataPath.split('.')[0];
      const entityData = data[entity];
      if (entityData) {
        value = entityData.company_name ||
                `${entityData.first_name || ''} ${entityData.last_name || ''}`.trim();
      }
    }

    if (dataPath === 'seller.person_type' && data.seller) {
      value = data.seller.company_name ? '0' : '1';
    }

    if (dataPath === 'buyer.person_type' && data.buyer) {
      value = data.buyer.company_name ? '0' : '1';
    }

    if (dataPath === 'vehicle.registration_certificate_present' && data.vehicle) {
      const present = data.vehicle.registration_certificate_present ?? false;
      value = present ? '0' : '1';
    }

    if (dataPath === 'seller.action_ceder') {
      value = '0';
    }

    if (dataPath === 'buyer.action_acquerir') {
      value = '0';
    }

    if (dataPath === 'seller.validation' || dataPath === 'buyer.validation_acquerir' || dataPath === 'buyer.validation_informe') {
      value = true;
    }

    if (dataPath === 'vehicle.plate_number_page2') {
      value = data.vehicle?.plate_number;
    }

    if (dataPath === 'vehicle.vin_page2') {
      value = data.vehicle?.vin;
    }

    if (value === undefined || value === null || value === '') {
      if (isRequired) {
        const errorMsg = `Required field "${dataPath}" has no value in data`;
        console.error(`[ACROFORM_ERROR] ${errorMsg}`);
        errors.push(errorMsg);
      }
      continue;
    }

    if (pdfFieldMapping.includes('|')) {
      const fieldNames = pdfFieldMapping.split('|');

      if (fieldNames.length === 3) {
        const { day, month, year } = splitDate(String(value));
        fillFieldSafely(form, fieldNames[0], day, `${dataPath}.day`, errors, isRequired);
        fillFieldSafely(form, fieldNames[1], month, `${dataPath}.month`, errors, isRequired);
        fillFieldSafely(form, fieldNames[2], year, `${dataPath}.year`, errors, isRequired);
        successCount++;
      } else if (fieldNames.length === 2) {
        const { hours, minutes } = splitTime(String(value));
        fillFieldSafely(form, fieldNames[0], hours, `${dataPath}.hours`, errors, isRequired);
        fillFieldSafely(form, fieldNames[1], minutes, `${dataPath}.minutes`, errors, isRequired);
        successCount++;
      } else {
        console.warn(`[ACROFORM_WARN] Unexpected split format for "${dataPath}": ${fieldNames.length} parts`);
      }
    } else {
      const normalizedValue = typeof value === 'string'
        ? normalizeBoxedValue(dataPath, value)
        : value;

      fillFieldSafely(form, pdfFieldMapping, normalizedValue, dataPath, errors, isRequired);
      successCount++;
    }
  }

  try {
    console.log('[ACROFORM] Flattening form to lock values');
    form.flatten();
    console.log('[ACROFORM] Form flattened successfully');
  } catch (error) {
    const errorMsg = `Failed to flatten form: ${error}`;
    console.error('[ACROFORM_ERROR]', errorMsg);
    errors.push(errorMsg);
  }

  if (errors.length > 0) {
    console.error(`[ACROFORM] Completed with ${errors.length} CRITICAL error(s):`);
    errors.forEach(err => console.error(`  - ${err}`));
    throw new Error(`AcroForm rendering failed with ${errors.length} critical error(s). Some required fields could not be filled. Check console for details.`);
  } else {
    console.log(`[ACROFORM] Rendering completed successfully! Fields processed: ${successCount}`);
  }
}

function resolveDataPath(data: Record<string, any>, path: string): any {
  const parts = path.split('.');
  let current: any = data;

  for (const part of parts) {
    if (current === undefined || current === null) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}
