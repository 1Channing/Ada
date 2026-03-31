import { PDFDocument, PDFForm, PDFTextField, PDFCheckBox, PDFRadioGroup } from 'pdf-lib';

export function normalizeBoxedValue(fieldPath: string, value: string): string {
  const raw = value;
  let normalized = value;

  const lowerPath = fieldPath.toLowerCase();

  if (lowerPath.includes('plate_number') || lowerPath.includes('immatriculation')) {
    normalized = value.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  } else if (lowerPath.includes('vin') || lowerPath.includes('identification')) {
    normalized = value.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  } else if (lowerPath.includes('postal_code') || lowerPath.includes('codepostal')) {
    normalized = value.replace(/\D/g, '');
  } else if (lowerPath.includes('siren') || lowerPath.includes('siret')) {
    normalized = value.replace(/\D/g, '');
  } else if (lowerPath.includes('date')) {
    normalized = value.replace(/\D/g, '');
  }

  if (normalized !== raw) {
    console.log(`[PDF_NORMALIZE] field="${fieldPath}" raw="${raw}" normalized="${normalized}"`);
  }

  return normalized;
}

export function splitDate(isoDate?: string): { day: string; month: string; year: string } {
  if (!isoDate) return { day: '', month: '', year: '' };

  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return { day: '', month: '', year: '' };

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());

  return { day, month, year };
}

export function splitTime(timeString?: string): { hours: string; minutes: string } {
  if (!timeString) return { hours: '', minutes: '' };

  const match = timeString.match(/(\d{1,2}):(\d{2})/);
  if (!match) return { hours: '', minutes: '' };

  const hours = match[1].padStart(2, '0');
  const minutes = match[2].padStart(2, '0');

  return { hours, minutes };
}

export function fillFieldSafely(
  form: PDFForm,
  fieldName: string,
  value: string | boolean,
  context: string,
  errors: string[],
  isRequired: boolean = false
): void {
  if (value === undefined || value === null || value === '') return;

  try {
    const field = form.getField(fieldName);

    if (field instanceof PDFTextField) {
      const textValue = String(value);
      field.setText(textValue);
      console.log(`[PDF_FILL] ${fieldName} = "${textValue}" (${context})`);
    } else if (field instanceof PDFCheckBox) {
      const boolValue = typeof value === 'boolean'
        ? value
        : (value === 'yes' || value === '1' || value === 'true' || value === true);

      if (boolValue) {
        field.check();
        console.log(`[PDF_FILL] ${fieldName} = checked (${context})`);
      } else {
        field.uncheck();
        console.log(`[PDF_FILL] ${fieldName} = unchecked (${context})`);
      }
    } else if (field instanceof PDFRadioGroup) {
      try {
        const radioValue = String(value);
        field.select(radioValue);
        console.log(`[PDF_FILL] ${fieldName} = "${radioValue}" (${context})`);
      } catch (radioError) {
        console.warn(`[PDF_FILL_WARN] Radio button selection failed for "${fieldName}" with value "${value}".`);

        const options = field.getOptions();
        console.log(`[PDF_FILL_WARN] Available options for ${fieldName}:`, options);

        if (!isRequired) {
          console.warn(`[PDF_FILL_WARN] Skipping optional radio field "${fieldName}"`);
        } else {
          const errorMsg = `Radio button "${fieldName}" (${context}): Failed to select "${value}". Available options: ${options.join(', ')}`;
          console.error(`[PDF_FILL_ERROR] ${errorMsg}`);
          errors.push(errorMsg);
        }
      }
    } else {
      const errorMsg = `Type mismatch for "${fieldName}" (${context}): expected TextField/CheckBox/RadioGroup, got ${field.constructor.name}`;
      console.warn(`[PDF_FILL_WARN] ${errorMsg}`);
      if (isRequired) {
        errors.push(errorMsg);
      }
    }
  } catch (error) {
    const errorMsg = `Missing or inaccessible field: "${fieldName}" for ${context}`;
    console.warn(`[PDF_FILL_WARN] ${errorMsg}`);
    if (isRequired) {
      console.error(`[PDF_FILL_ERROR] Required field failed: ${errorMsg}`);
      errors.push(errorMsg);
    }
  }
}

export function discoverPDFFields(pdfDoc: PDFDocument): void {
  console.log(`[PDF_DISCOVER] PDF has ${pdfDoc.getPageCount()} pages`);

  const form = pdfDoc.getForm();
  console.log(`[PDF_DISCOVER] Form has XFA: ${form.hasXFA()}`);

  const fields = form.getFields();
  console.log(`[PDF_DISCOVER] Found ${fields.length} form fields`);

  fields.forEach((field, index) => {
    const name = field.getName();
    const type = field.constructor.name;
    console.log(`[PDF_DISCOVER] Field ${index + 1}: "${name}" (${type})`);
  });
}
