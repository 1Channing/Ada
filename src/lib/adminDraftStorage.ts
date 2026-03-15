const DRAFT_KEY = 'admin_form_draft';

export type AdminFormDraft = {
  transactionType: 'purchase' | 'sale';
  vehicleForm: {
    plate_number: string;
    vin: string;
    brand: string;
    model: string;
    commercial_name: string;
    type_variant_version: string;
    national_type: string;
    first_registration_date: string;
    mileage: string;
    registration_certificate_present: boolean;
    registration_certificate_number: string;
    known_defects: string;
  };
  sellerForm: {
    company_name: string;
    first_name: string;
    last_name: string;
    birth_date: string;
    birth_place: string;
    address_line1: string;
    address_line2: string;
    postal_code: string;
    city: string;
    country: string;
    siren: string;
  };
  sellerForm2: {
    company_name: string;
    first_name: string;
    last_name: string;
    birth_date: string;
    birth_place: string;
    address_line1: string;
    address_line2: string;
    postal_code: string;
    city: string;
    country: string;
    siren: string;
  };
  buyerForm: {
    company_name: string;
    first_name: string;
    last_name: string;
    birth_date: string;
    birth_place: string;
    address_line1: string;
    address_line2: string;
    postal_code: string;
    city: string;
    country: string;
    siren: string;
  };
  buyerForm2: {
    company_name: string;
    first_name: string;
    last_name: string;
    birth_date: string;
    birth_place: string;
    address_line1: string;
    address_line2: string;
    postal_code: string;
    city: string;
    country: string;
    siren: string;
  };
  transactionForm: {
    transaction_price: string;
    transaction_date: string;
    transaction_time: string;
    pickup_location: string;
    pickup_contact: string;
    pickup_datetime: string;
    destination: string;
    transporter: string;
  };
  showSecondSeller: boolean;
  showSecondBuyer: boolean;
  selectedSellerContactId: string | null;
  selectedSeller2ContactId: string | null;
  selectedBuyerContactId: string | null;
  selectedBuyer2ContactId: string | null;
  lastSavedTransactionId: string | null;
};

export function saveDraft(draft: AdminFormDraft): void {
  try {
    const serialized = JSON.stringify(draft);
    localStorage.setItem(DRAFT_KEY, serialized);
    console.log('[ADMIN_DRAFT] saving draft to localStorage');
  } catch (error) {
    console.error('[ADMIN_DRAFT] Failed to save draft:', error);
  }
}

export function loadDraft(): AdminFormDraft | null {
  try {
    const serialized = localStorage.getItem(DRAFT_KEY);
    if (!serialized) {
      return null;
    }
    const draft = JSON.parse(serialized) as AdminFormDraft;
    console.log('[ADMIN_DRAFT] restored draft from localStorage');
    return draft;
  } catch (error) {
    console.error('[ADMIN_DRAFT] Failed to load draft:', error);
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
    console.log('[ADMIN_DRAFT] cleared draft');
  } catch (error) {
    console.error('[ADMIN_DRAFT] Failed to clear draft:', error);
  }
}
