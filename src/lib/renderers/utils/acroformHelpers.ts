import { PDFForm, PDFTextField, PDFCheckBox, PDFRadioGroup } from 'pdf-lib';

export function fillFieldSafely(
  form: PDFForm,
  fieldName: string,
  value: string,
  context: string,
  errors: string[],
  isRequired: boolean = false
): void {
  if (!value) {
    if (isRequired) {
      errors.push(`Required field "${fieldName}" (${context}) has no value`);
    }
    return;
  }

  try {
    const field = form.getField(fieldName);

    if (field instanceof PDFTextField) {
      field.setText(value);
    } else if (field instanceof PDFCheckBox) {
      if (value.toLowerCase() === 'yes' || value === '1' || value === 'true') {
        field.check();
      } else {
        field.uncheck();
      }
    } else if (field instanceof PDFRadioGroup) {
      try {
        field.select(value);
      } catch (radioError) {
        const options = field.getOptions();
        if (isRequired) {
          errors.push(`Radio button "${fieldName}" (${context}): Failed to select "${value}". Available: ${options.join(', ')}`);
        }
      }
    }
  } catch (error) {
    const message = `Field "${fieldName}" (${context}) not found or inaccessible`;
    if (isRequired) {
      errors.push(message);
    }
  }
}

export function fillSplitField(
  form: PDFForm,
  fieldPrefix: string,
  value: string,
  errors: string[],
  startIndex: number = 1
): void {
  if (!value) return;

  const chars = value.split('');
  chars.forEach((char, index) => {
    const fieldName = `${fieldPrefix}${startIndex + index}`;
    fillFieldSafely(form, fieldName, char, `split field ${fieldPrefix}`, errors, false);
  });
}

export function fillSplitDateFields(
  form: PDFForm,
  dayPrefix: string,
  monthPrefix: string,
  yearPrefix: string,
  dateString: string | undefined,
  errors: string[],
  context: string = 'date'
): void {
  if (!dateString) return;

  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    errors.push(`Invalid date format for ${context}: "${dateString}"`);
    return;
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());

  fillSplitField(form, dayPrefix, day, errors, 1);
  fillSplitField(form, monthPrefix, month, errors, 1);
  fillSplitField(form, yearPrefix, year, errors, 1);
}

export function fillSplitTimeFields(
  form: PDFForm,
  hourPrefix: string,
  minutePrefix: string,
  timeString: string | undefined,
  errors: string[],
  context: string = 'time'
): void {
  if (!timeString) return;

  const match = timeString.match(/(\d{1,2}):(\d{2})/);
  if (!match) {
    errors.push(`Invalid time format for ${context}: "${timeString}"`);
    return;
  }

  const hours = match[1].padStart(2, '0');
  const minutes = match[2].padStart(2, '0');

  fillSplitField(form, hourPrefix, hours, errors, 1);
  fillSplitField(form, minutePrefix, minutes, errors, 1);
}

export function normalizeForAcroForm(value: string, fieldType: 'plate' | 'vin' | 'postal' | 'siren' | 'generic' = 'generic'): string {
  if (!value) return '';

  switch (fieldType) {
    case 'plate':
    case 'vin':
      return value.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    case 'postal':
    case 'siren':
      return value.replace(/\D/g, '');
    default:
      return value.trim();
  }
}
