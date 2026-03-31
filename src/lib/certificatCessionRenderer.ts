import { PDFDocument, PDFForm, PDFTextField, PDFCheckBox, PDFRadioGroup } from 'pdf-lib';
import { DocumentData } from './templateEngine';

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
    console.log(`[CESSION_NORMALIZE] field=${fieldName} raw="${raw}" normalized="${normalized}"`);
  }

  return normalized;
}

function splitDate(dateString?: string): { day: string; month: string; year: string } {
  if (!dateString) return { day: '', month: '', year: '' };

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return { day: '', month: '', year: '' };

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());

  return { day, month, year };
}

function splitTime(timeString?: string): { hours: string; minutes: string } {
  if (!timeString) return { hours: '', minutes: '' };

  const match = timeString.match(/(\d{1,2}):(\d{2})/);
  if (!match) return { hours: '', minutes: '' };

  const hours = match[1].padStart(2, '0');
  const minutes = match[2].padStart(2, '0');

  return { hours, minutes };
}

function fillFieldSafely(
  form: PDFForm,
  fieldName: string,
  value: string,
  context: string,
  errors: string[],
  isRequired: boolean = false
): void {
  if (!value) return;

  try {
    const field = form.getField(fieldName);

    if (field instanceof PDFTextField) {
      field.setText(value);
      console.log(`[CESSION_FILL] ${fieldName} = "${value}" (${context})`);
    } else if (field instanceof PDFCheckBox) {
      if (value.toLowerCase() === 'yes' || value === '1' || value === 'true') {
        field.check();
        console.log(`[CESSION_FILL] ${fieldName} = checked (${context})`);
      }
    } else if (field instanceof PDFRadioGroup) {
      try {
        field.select(value);
        console.log(`[CESSION_FILL] ${fieldName} = "${value}" (${context})`);
      } catch (radioError) {
        console.warn(`[CESSION_FILL_WARN] Radio button selection failed for "${fieldName}" with value "${value}". Trying alternative values...`);

        const options = field.getOptions();
        console.log(`[CESSION_FILL_WARN] Available options for ${fieldName}:`, options);

        if (!isRequired) {
          console.warn(`[CESSION_FILL_WARN] Skipping optional radio field "${fieldName}"`);
        } else {
          const errorMsg = `Radio button "${fieldName}" (${context}): Failed to select "${value}". Available options: ${options.join(', ')}`;
          console.error(`[CESSION_FILL_ERROR] ${errorMsg}`);
          errors.push(errorMsg);
        }
      }
    } else {
      const errorMsg = `Type mismatch for "${fieldName}" (${context}): expected TextField/CheckBox/RadioGroup, got ${field.constructor.name}`;
      console.warn(`[CESSION_FILL_WARN] ${errorMsg}`);
      if (isRequired) {
        errors.push(errorMsg);
      }
    }
  } catch (error) {
    const errorMsg = `Missing or inaccessible field: "${fieldName}" for ${context}`;
    console.warn(`[CESSION_FILL_WARN] ${errorMsg}`);
    if (isRequired) {
      console.error(`[CESSION_FILL_ERROR] Required field failed: ${errorMsg}`);
      errors.push(errorMsg);
    }
  }
}

function discoverPDFFields(pdfDoc: PDFDocument): void {
  console.log(`[CESSION_DISCOVER] PDF has ${pdfDoc.getPageCount()} pages`);

  const form = pdfDoc.getForm();
  console.log(`[CESSION_DISCOVER] Form has XFA: ${form.hasXFA()}`);

  const fields = form.getFields();
  console.log(`[CESSION_DISCOVER] Found ${fields.length} form fields`);
}

export async function renderCertificatCession(
  pdfDoc: PDFDocument,
  data: DocumentData
): Promise<void> {
  console.log('[CESSION_RENDER] Starting AcroForm-based certificate rendering');

  discoverPDFFields(pdfDoc);

  const form = pdfDoc.getForm();
  if (form.hasXFA()) {
    console.log('[CESSION_XFA] XFA detected, removing to enable standard AcroForm fields');
    form.deleteXFA();
  } else {
    console.log('[CESSION_XFA] No XFA detected');
  }

  const errors: string[] = [];
  let successCount = 0;
  let warnCount = 0;

  for (const page of ['Page1', 'Page2']) {
    const prefix = `topmostSubform[0].${page}[0]`;

    if (data.vehicle?.plate_number) {
      const normalized = normalizeBoxedValue('plate_number', data.vehicle.plate_number);
      fillFieldSafely(form, `${prefix}.num_Immatriculation[0]`, normalized, `vehicle.plate_number (${page})`, errors, true);
      successCount++;
    }

    if (data.vehicle?.vin) {
      const normalized = normalizeBoxedValue('vin', data.vehicle.vin);
      fillFieldSafely(form, `${prefix}.num_Identification[0]`, normalized, `vehicle.vin (${page})`, errors, true);
      successCount++;
    }

    if (data.vehicle?.first_registration_date) {
      const { day, month, year } = splitDate(data.vehicle.first_registration_date);
      fillFieldSafely(form, `${prefix}.num_DateImmatriculationJour[0]`, day, `vehicle.first_registration_date.day (${page})`, errors);
      fillFieldSafely(form, `${prefix}.num_DateImmatriculationMois[0]`, month, `vehicle.first_registration_date.month (${page})`, errors);
      fillFieldSafely(form, `${prefix}.num_DateImmatriculationAnnée[0]`, year, `vehicle.first_registration_date.year (${page})`, errors);
    }

    if (data.vehicle?.brand) {
      fillFieldSafely(form, `${prefix}.txt_MarqueVéhicule[0]`, data.vehicle.brand, `vehicle.brand (${page})`, errors);
    }

    if (data.vehicle?.type_variant_version) {
      fillFieldSafely(form, `${prefix}.txt_TypeVarianteVersionVéhicule[0]`, data.vehicle.type_variant_version, `vehicle.type_variant_version (${page})`, errors);
    }

    if (data.vehicle?.national_type) {
      fillFieldSafely(form, `${prefix}.txt_GenreNational[0]`, data.vehicle.national_type, `vehicle.national_type (${page})`, errors);
    }

    if (data.vehicle?.commercial_name) {
      fillFieldSafely(form, `${prefix}.txt_DénominationCommerciale[0]`, data.vehicle.commercial_name, `vehicle.commercial_name (${page})`, errors);
    }

    if (data.vehicle?.mileage) {
      fillFieldSafely(form, `${prefix}.num_KilométrageCompteur[0]`, String(data.vehicle.mileage), `vehicle.mileage (${page})`, errors);
    }

    if (data.vehicle?.registration_certificate_number) {
      const normalized = normalizeBoxedValue('registration_certificate_number', data.vehicle.registration_certificate_number);
      fillFieldSafely(form, `${prefix}.num_Formule[0]`, normalized, `vehicle.registration_certificate_number (${page})`, errors);
    }

    const sellerIdentity = data.seller?.company_name ||
      `${data.seller?.first_name || ''} ${data.seller?.last_name || ''}`.trim();

    if (sellerIdentity) {
      fillFieldSafely(form, `${prefix}.txt_IdentitéVendeur[0]`, sellerIdentity, `seller.identity (${page})`, errors);
    }

    if (data.seller?.siren) {
      const normalized = normalizeBoxedValue('siret', data.seller.siren);
      fillFieldSafely(form, `${prefix}.Num_Siret[0]`, normalized, `seller.siren (${page})`, errors);
    }

    if (data.seller?.address_line1) {
      fillFieldSafely(form, `${prefix}.txt_NomVoie[0]`, data.seller.address_line1, `seller.address_line1 (${page})`, errors);
    }

    if (data.seller?.city) {
      fillFieldSafely(form, `${prefix}.txt_CommuneAdresse[0]`, data.seller.city, `seller.city (${page})`, errors);
    }

    if (data.seller?.postal_code) {
      const normalized = normalizeBoxedValue('postal_code', data.seller.postal_code);
      fillFieldSafely(form, `${prefix}.num_CodePostalAdresse[0]`, normalized, `seller.postal_code (${page})`, errors);
    }

    if (data.transaction?.transaction_date) {
      const { day, month, year } = splitDate(data.transaction.transaction_date);
      fillFieldSafely(form, `${prefix}.num_DateVenteJour[0]`, day, `transaction.date.day (${page})`, errors);
      fillFieldSafely(form, `${prefix}.num_DateVenteMois[0]`, month, `transaction.date.month (${page})`, errors);
      fillFieldSafely(form, `${prefix}.num_DateVenteAnnée[0]`, year, `transaction.date.year (${page})`, errors);
    }

    if (data.transaction?.transaction_time) {
      const { hours, minutes } = splitTime(data.transaction.transaction_time);
      fillFieldSafely(form, `${prefix}.num_HoraireVente1[0]`, hours, `transaction.time.hours (${page})`, errors);
      fillFieldSafely(form, `${prefix}.num_HoraireVente2[0]`, minutes, `transaction.time.minutes (${page})`, errors);
    }

    const buyerIdentity = data.buyer?.company_name ||
      `${data.buyer?.first_name || ''} ${data.buyer?.last_name || ''}`.trim();

    if (buyerIdentity) {
      fillFieldSafely(form, `${prefix}.txt_IdentitéAcheteur[0]`, buyerIdentity, `buyer.identity (${page})`, errors);
    }

    if (data.buyer?.siren) {
      const normalized = normalizeBoxedValue('siret', data.buyer.siren);
      fillFieldSafely(form, `${prefix}.num_SiretAcheteur[0]`, normalized, `buyer.siren (${page})`, errors);
    }

    if (data.buyer?.birth_date) {
      const { day, month, year } = splitDate(data.buyer.birth_date);
      fillFieldSafely(form, `${prefix}.num_DateNaissanceAcheteurJ[0]`, day, `buyer.birth_date.day (${page})`, errors);
      fillFieldSafely(form, `${prefix}.num_DateNaissanceAcheteurM[0]`, month, `buyer.birth_date.month (${page})`, errors);
      fillFieldSafely(form, `${prefix}.num_DateNaissanceAcheteurA[0]`, year, `buyer.birth_date.year (${page})`, errors);
    }

    if (data.buyer?.birth_place) {
      fillFieldSafely(form, `${prefix}.txt_LieuNaissanceAcheteur[0]`, data.buyer.birth_place, `buyer.birth_place (${page})`, errors);
    }

    if (data.buyer?.address_line1) {
      fillFieldSafely(form, `${prefix}.txt_NomVoieAdresseAcheteur[0]`, data.buyer.address_line1, `buyer.address_line1 (${page})`, errors);
    }

    if (data.buyer?.city) {
      fillFieldSafely(form, `${prefix}.txt_CommuneAdresseAcheteur[0]`, data.buyer.city, `buyer.city (${page})`, errors);
    }

    if (data.buyer?.postal_code) {
      const normalized = normalizeBoxedValue('postal_code', data.buyer.postal_code);
      fillFieldSafely(form, `${prefix}.num_CodePostalAdresseAcheteur[0]`, normalized, `buyer.postal_code (${page})`, errors);
    }

    const sellerIsMoral = !!data.seller?.company_name;
    fillFieldSafely(form, `${prefix}.Groupe_de_boutons_radio1[0]`, sellerIsMoral ? '0' : '1', `seller.person_type (${page})`, errors);

    const regCertPresent = data.vehicle?.registration_certificate_present ?? false;
    fillFieldSafely(form, `${prefix}.Groupe_de_boutons_radio2[0]`, regCertPresent ? '0' : '1', `registration_certificate_present (${page})`, errors);

    fillFieldSafely(form, `${prefix}.Groupe_de_boutons_radio3[0]`, '0', `seller.action_ceder (${page})`, errors);

    fillFieldSafely(form, `${prefix}.ckb_ValidationDéclaration1[0]`, 'yes', `seller.validation (${page})`, errors);

    const buyerIsMoral = !!data.buyer?.company_name;
    fillFieldSafely(form, `${prefix}.Groupe_de_boutons_radio5[0]`, buyerIsMoral ? '0' : '1', `buyer.person_type (${page})`, errors);

    fillFieldSafely(form, `${prefix}.Groupe_de_boutons_radio6[0]`, '0', `buyer.action_acquerir (${page})`, errors);

    fillFieldSafely(form, `${prefix}.ckb_ValidationDéclarationA1[0]`, 'yes', `buyer.validation.acquerir (${page})`, errors);
    fillFieldSafely(form, `${prefix}.ckb_ValidationDéclarationA2[0]`, 'yes', `buyer.validation.informe (${page})`, errors);
  }

  try {
    console.log('[CESSION_FLATTEN] Flattening form to lock values');
    form.flatten();
    console.log('[CESSION_FLATTEN] Form flattened successfully');
  } catch (error) {
    const errorMsg = `Failed to flatten form: ${error}`;
    console.error('[CESSION_FLATTEN_ERROR]', errorMsg);
    errors.push(errorMsg);
  }

  if (errors.length > 0) {
    console.error(`[CESSION_RENDER] Completed with ${errors.length} CRITICAL error(s):`);
    errors.forEach(err => console.error(`  - ${err}`));
    console.error(`[CESSION_RENDER] Note: Some optional fields may have been skipped (warnings in logs)`);
    throw new Error(`Certificate rendering failed with ${errors.length} critical error(s). Some required fields could not be filled. Check console for details.`);
  } else {
    console.log(`[CESSION_RENDER] Certificate rendering completed successfully! Fields processed: ${successCount}`);
    if (warnCount > 0) {
      console.log(`[CESSION_RENDER] Note: ${warnCount} optional fields were skipped (see warnings in logs)`);
    }
  }
}
