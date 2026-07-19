import { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Save, X, UserPlus, FileText, Download, History, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { generateAdminDocument } from '../lib/adminDocGenerator';
import { saveDraft, loadDraft, clearDraft } from '../lib/adminDraftStorage';

// DB columns are nullable — mirror that so typed Supabase rows fit directly.
type Contact = {
  id: string;
  type?: string | null;
  company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | null;
  birth_place?: string | null;
  siren?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
};

type VehicleForm = {
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

type ContactForm = {
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

type TransactionForm = {
  transaction_price: string;
  reference: string;
  transaction_date: string;
  transaction_time: string;
  pickup_location: string;
  pickup_contact: string;
  pickup_datetime: string;
  destination: string;
  transporter: string;
};

// MC Export's own identity — auto-placed as buyer (when MC buys) or seller
// (when MC sells) so its side is never retyped. Reconciled to a single DB
// contact on load (by SIREN) so documents reuse it without duplicates.
const MC_EXPORT_SIREN = '93033811600013';
const MC_EXPORT_FORM: ContactForm = {
  company_name: 'MC-EXPORT',
  first_name: '',
  last_name: '',
  birth_date: '',
  birth_place: '',
  address_line1: '88 B AVENUE JEAN BOUTTON',
  address_line2: '',
  postal_code: '49130',
  city: 'Les ponts de cé',
  country: 'FR',
  siren: MC_EXPORT_SIREN,
};

// direction 'purchase' = MC Export achète (MC = acheteur, le client est vendeur)
// direction 'sale'     = MC Export vend   (MC = vendeur, le client est acheteur)
const DOCS_BY_DIRECTION: Record<'purchase' | 'sale', string[]> = {
  purchase: ['Certificat de cession', "Bon d'achat", 'Fiche enlèvement', "Déclaration d'achat"],
  sale: ['Certificat de cession', 'Réception / Expédition'],
};

export function Administrative() {
  const [transactionType, setTransactionType] = useState<'purchase' | 'sale'>('purchase');
  const [vehicleForm, setVehicleForm] = useState<VehicleForm>({
    plate_number: '',
    vin: '',
    brand: '',
    model: '',
    commercial_name: '',
    type_variant_version: '',
    national_type: '',
    first_registration_date: '',
    mileage: '',
    registration_certificate_present: false,
    registration_certificate_number: '',
    known_defects: '',
  });

  const [sellerForm, setSellerForm] = useState<ContactForm>({
    company_name: '',
    first_name: '',
    last_name: '',
    birth_date: '',
    birth_place: '',
    address_line1: '',
    address_line2: '',
    postal_code: '',
    city: '',
    country: 'FR',
    siren: '',
  });

  const [sellerForm2, setSellerForm2] = useState<ContactForm>({
    company_name: '',
    first_name: '',
    last_name: '',
    birth_date: '',
    birth_place: '',
    address_line1: '',
    address_line2: '',
    postal_code: '',
    city: '',
    country: 'FR',
    siren: '',
  });

  const [buyerForm, setBuyerForm] = useState<ContactForm>({
    company_name: '',
    first_name: '',
    last_name: '',
    birth_date: '',
    birth_place: '',
    address_line1: '',
    address_line2: '',
    postal_code: '',
    city: '',
    country: 'FR',
    siren: '',
  });

  const [buyerForm2, setBuyerForm2] = useState<ContactForm>({
    company_name: '',
    first_name: '',
    last_name: '',
    birth_date: '',
    birth_place: '',
    address_line1: '',
    address_line2: '',
    postal_code: '',
    city: '',
    country: 'FR',
    siren: '',
  });

  const [transactionForm, setTransactionForm] = useState<TransactionForm>({
    transaction_price: '',
    reference: '',
    transaction_date: '',
    transaction_time: '',
    pickup_location: '',
    pickup_contact: '',
    pickup_datetime: '',
    destination: '',
    transporter: '',
  });

  const [showSecondSeller, setShowSecondSeller] = useState(false);
  const [showSecondBuyer, setShowSecondBuyer] = useState(false);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSellerSearch, setShowSellerSearch] = useState(false);
  const [showSeller2Search, setShowSeller2Search] = useState(false);
  const [showBuyerSearch, setShowBuyerSearch] = useState(false);
  const [showBuyer2Search, setShowBuyer2Search] = useState(false);

  const [selectedSellerContact, setSelectedSellerContact] = useState<Contact | null>(null);
  const [selectedSeller2Contact, setSelectedSeller2Contact] = useState<Contact | null>(null);
  const [selectedBuyerContact, setSelectedBuyerContact] = useState<Contact | null>(null);
  const [selectedBuyer2Contact, setSelectedBuyer2Contact] = useState<Contact | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const [savingSellerContact, setSavingSellerContact] = useState(false);
  const [savingSeller2Contact, setSavingSeller2Contact] = useState(false);
  const [savingBuyerContact, setSavingBuyerContact] = useState(false);
  const [savingBuyer2Contact, setSavingBuyer2Contact] = useState(false);

  const [lastSavedTransactionId, setLastSavedTransactionId] = useState<string | null>(null);
  const [generatingDoc, setGeneratingDoc] = useState<string | null>(null);
  const [docPreview, setDocPreview] = useState<{ url: string; docType: string; fileName: string; missing: string[] } | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  // MC Export's single reconciled contact + the contacts-management panel.
  const [mcExport, setMcExport] = useState<Contact | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deletingContactId, setDeletingContactId] = useState<string | null>(null);

  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      setTransactionType(draft.transactionType);
      setVehicleForm(draft.vehicleForm);
      setSellerForm(draft.sellerForm);
      setSellerForm2(draft.sellerForm2);
      setBuyerForm(draft.buyerForm);
      setBuyerForm2(draft.buyerForm2);
      setTransactionForm({ reference: '', ...draft.transactionForm });
      setShowSecondSeller(draft.showSecondSeller);
      setShowSecondBuyer(draft.showSecondBuyer);
      setLastSavedTransactionId(draft.lastSavedTransactionId);

      setIsDirty(false);
      console.log('[ADMIN_DRAFT] Form state restored from draft, isDirty initialized to false');
    }
  }, []);

  useEffect(() => {
    loadContacts();
  }, []);

  const loadContacts = async () => {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setContacts(data);
    }
  };

  const contactToForm = (c: Contact): ContactForm => ({
    company_name: c.company_name || '',
    first_name: c.first_name || '',
    last_name: c.last_name || '',
    birth_date: c.birth_date || '',
    birth_place: c.birth_place || '',
    address_line1: c.address_line1 || '',
    address_line2: c.address_line2 || '',
    postal_code: c.postal_code || '',
    city: c.city || '',
    country: c.country || 'FR',
    siren: c.siren || '',
  });

  // Reconcile MC Export to a SINGLE contact (find by SIREN, else create) so
  // documents reuse it and the contacts list never fills with duplicates.
  useEffect(() => {
    (async () => {
      const { data: found } = await supabase
        .from('contacts')
        .select('*')
        .eq('siren', MC_EXPORT_SIREN)
        .limit(1)
        .maybeSingle();
      if (found) { setMcExport(found as Contact); return; }
      const { data: created } = await supabase
        .from('contacts')
        .insert({ type: 'company', ...MC_EXPORT_FORM })
        .select()
        .single();
      if (created) { setMcExport(created as Contact); loadContacts(); }
    })();
  }, []);

  // Place MC Export on its side (buyer when MC buys, seller when MC sells).
  // Selecting it (not just filling the form) makes save reuse its contact id.
  const placeMcOnSide = (direction: 'purchase' | 'sale', mc: Contact) => {
    const form = contactToForm(mc);
    if (direction === 'purchase') {
      setBuyerForm(form); setSelectedBuyerContact(mc);
    } else {
      setSellerForm(form); setSelectedSellerContact(mc);
    }
  };

  const EMPTY_CONTACT: ContactForm = {
    company_name: '', first_name: '', last_name: '', birth_date: '', birth_place: '',
    address_line1: '', address_line2: '', postal_code: '', city: '', country: 'FR', siren: '',
  };

  // Once MC Export is known, seed it onto the current side (unless a draft
  // already placed a real contact there).
  useEffect(() => {
    if (!mcExport) return;
    const mcSideSelected = transactionType === 'purchase' ? selectedBuyerContact : selectedSellerContact;
    if (!mcSideSelected) placeMcOnSide(transactionType, mcExport);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mcExport]);

  const filterContacts = (query: string) => {
    if (!query.trim()) return contacts;

    const lowerQuery = query.toLowerCase();
    return contacts.filter(contact =>
      contact.first_name?.toLowerCase().includes(lowerQuery) ||
      contact.last_name?.toLowerCase().includes(lowerQuery) ||
      contact.company_name?.toLowerCase().includes(lowerQuery) ||
      contact.siren?.toLowerCase().includes(lowerQuery)
    );
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveDraft({
        transactionType,
        vehicleForm,
        sellerForm,
        sellerForm2,
        buyerForm,
        buyerForm2,
        transactionForm,
        showSecondSeller,
        showSecondBuyer,
        selectedSellerContactId: selectedSellerContact?.id || null,
        selectedSeller2ContactId: selectedSeller2Contact?.id || null,
        selectedBuyerContactId: selectedBuyerContact?.id || null,
        selectedBuyer2ContactId: selectedBuyer2Contact?.id || null,
        lastSavedTransactionId,
      });
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [
    transactionType,
    vehicleForm,
    sellerForm,
    sellerForm2,
    buyerForm,
    buyerForm2,
    transactionForm,
    showSecondSeller,
    showSecondBuyer,
    selectedSellerContact,
    selectedSeller2Contact,
    selectedBuyerContact,
    selectedBuyer2Contact,
    lastSavedTransactionId,
  ]);

  const markDirty = () => {
    if (lastSavedTransactionId && !isDirty) {
      setIsDirty(true);
      console.log('[ADMIN_DIRTY] Form changed, dirty=true');
    }
  };

  const updateVehicleForm = (updates: Partial<VehicleForm>) => {
    setVehicleForm(prev => ({ ...prev, ...updates }));
    markDirty();
  };

  const updateSellerForm = (updates: Partial<ContactForm>) => {
    setSellerForm(prev => ({ ...prev, ...updates }));
    markDirty();
  };

  const updateSellerForm2 = (updates: Partial<ContactForm>) => {
    setSellerForm2(prev => ({ ...prev, ...updates }));
    markDirty();
  };

  const updateBuyerForm = (updates: Partial<ContactForm>) => {
    setBuyerForm(prev => ({ ...prev, ...updates }));
    markDirty();
  };

  const updateBuyerForm2 = (updates: Partial<ContactForm>) => {
    setBuyerForm2(prev => ({ ...prev, ...updates }));
    markDirty();
  };

  const updateTransactionForm = (updates: Partial<TransactionForm>) => {
    setTransactionForm(prev => ({ ...prev, ...updates }));
    markDirty();
  };

  const toggleShowSecondSeller = (value: boolean) => {
    setShowSecondSeller(value);
    markDirty();
  };

  const toggleShowSecondBuyer = (value: boolean) => {
    setShowSecondBuyer(value);
    markDirty();
  };

  const updateTransactionType = (type: 'purchase' | 'sale') => {
    setTransactionType(type);
    // Reset both parties, then re-seat MC Export on its new side; the client
    // side starts empty for a fresh selection.
    setSellerForm(EMPTY_CONTACT); setSelectedSellerContact(null);
    setBuyerForm(EMPTY_CONTACT); setSelectedBuyerContact(null);
    setSellerForm2(EMPTY_CONTACT); setSelectedSeller2Contact(null); setShowSecondSeller(false);
    setBuyerForm2(EMPTY_CONTACT); setSelectedBuyer2Contact(null); setShowSecondBuyer(false);
    if (mcExport) placeMcOnSide(type, mcExport);
    markDirty();
  };

  const deleteContact = async (id: string) => {
    if (id === mcExport?.id) return; // never delete MC Export itself
    setDeletingContactId(id);
    try {
      await supabase.from('contacts').delete().eq('id', id);
      await loadContacts();
    } finally {
      setDeletingContactId(null);
    }
  };

  const selectContact = (contact: Contact, type: 'seller' | 'seller2' | 'buyer' | 'buyer2') => {
    const form: ContactForm = {
      company_name: contact.company_name || '',
      first_name: contact.first_name || '',
      last_name: contact.last_name || '',
      birth_date: contact.birth_date || '',
      birth_place: contact.birth_place || '',
      address_line1: contact.address_line1 || '',
      address_line2: contact.address_line2 || '',
      postal_code: contact.postal_code || '',
      city: contact.city || '',
      country: contact.country || 'FR',
      siren: contact.siren || '',
    };

    if (type === 'seller') {
      setSellerForm(form);
      setSelectedSellerContact(contact);
      setShowSellerSearch(false);
    } else if (type === 'seller2') {
      setSellerForm2(form);
      setSelectedSeller2Contact(contact);
      setShowSeller2Search(false);
    } else if (type === 'buyer') {
      setBuyerForm(form);
      setSelectedBuyerContact(contact);
      setShowBuyerSearch(false);
    } else if (type === 'buyer2') {
      setBuyerForm2(form);
      setSelectedBuyer2Contact(contact);
      setShowBuyer2Search(false);
    }
    setSearchQuery('');

    if (lastSavedTransactionId) {
      setIsDirty(true);
      console.log('[ADMIN_DIRTY] Contact selection changed, dirty=true');
    }
  };

  const handleClearForm = useCallback(() => {
    console.log('[ADMIN_DRAFT] Clearing form');

    setTransactionType('purchase');
    setVehicleForm({
      plate_number: '',
      vin: '',
      brand: '',
      model: '',
      commercial_name: '',
      type_variant_version: '',
      national_type: '',
      first_registration_date: '',
      mileage: '',
      registration_certificate_present: false,
      registration_certificate_number: '',
      known_defects: '',
    });
    setSellerForm({
      company_name: '',
      first_name: '',
      last_name: '',
      birth_date: '',
      birth_place: '',
      address_line1: '',
      address_line2: '',
      postal_code: '',
      city: '',
      country: 'FR',
      siren: '',
    });
    setSellerForm2({
      company_name: '',
      first_name: '',
      last_name: '',
      birth_date: '',
      birth_place: '',
      address_line1: '',
      address_line2: '',
      postal_code: '',
      city: '',
      country: 'FR',
      siren: '',
    });
    setBuyerForm({
      company_name: '',
      first_name: '',
      last_name: '',
      birth_date: '',
      birth_place: '',
      address_line1: '',
      address_line2: '',
      postal_code: '',
      city: '',
      country: 'FR',
      siren: '',
    });
    setBuyerForm2({
      company_name: '',
      first_name: '',
      last_name: '',
      birth_date: '',
      birth_place: '',
      address_line1: '',
      address_line2: '',
      postal_code: '',
      city: '',
      country: 'FR',
      siren: '',
    });
    setTransactionForm({
      transaction_price: '',
      reference: '',
      transaction_date: '',
      transaction_time: '',
      pickup_location: '',
      pickup_contact: '',
      pickup_datetime: '',
      destination: '',
      transporter: '',
    });
    setShowSecondSeller(false);
    setShowSecondBuyer(false);
    setSelectedSellerContact(null);
    setSelectedSeller2Contact(null);
    setSelectedBuyerContact(null);
    setSelectedBuyer2Contact(null);
    setLastSavedTransactionId(null);
    setSaveMessage(null);
    setGeneratingDoc(null);
    setIsDirty(false);

    clearDraft();
    console.log('[ADMIN_DRAFT] Form cleared, isDirty=false');
    setSaveMessage({ type: 'success', text: 'Form cleared' });
    setTimeout(() => setSaveMessage(null), 3000);
  }, []);

  const saveContactAs = async (
    form: ContactForm,
    selectedContact: Contact | null,
    setSavingState: (val: boolean) => void,
    role: 'seller' | 'buyer'
  ) => {
    setSavingState(true);
    try {
      if (selectedContact) {
        const { error } = await supabase
          .from('contacts')
          .update({
            company_name: form.company_name || null,
            first_name: form.first_name || null,
            last_name: form.last_name || null,
            birth_date: form.birth_date || null,
            birth_place: form.birth_place || null,
            address_line1: form.address_line1 || null,
            address_line2: form.address_line2 || null,
            postal_code: form.postal_code || null,
            city: form.city || null,
            country: form.country || 'FR',
            siren: form.siren || null,
          })
          .eq('id', selectedContact.id);

        if (error) throw error;
        setSaveMessage({ type: 'success', text: 'Contact updated successfully!' });
      } else {
        const { error } = await supabase
          .from('contacts')
          .insert({
            type: role,
            company_name: form.company_name || null,
            first_name: form.first_name || null,
            last_name: form.last_name || null,
            birth_date: form.birth_date || null,
            birth_place: form.birth_place || null,
            address_line1: form.address_line1 || null,
            address_line2: form.address_line2 || null,
            postal_code: form.postal_code || null,
            city: form.city || null,
            country: form.country || 'FR',
            siren: form.siren || null,
          });

        if (error) throw error;
        setSaveMessage({ type: 'success', text: 'Contact created successfully!' });
      }

      await loadContacts();
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error) {
      console.error('Error saving contact:', error);
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save contact'
      });
    } finally {
      setSavingState(false);
    }
  };

  const getErrorMessage = (err: unknown): string => {
    if (err instanceof Error) {
      return err.message;
    }
    if (err && typeof err === 'object') {
      const obj = err as Record<string, unknown>;

      // Handle Supabase/PostgrestError with code, details, hint
      if ('message' in obj && typeof obj.message === 'string') {
        let message = obj.message;

        if ('code' in obj && obj.code) {
          message += ` [Code: ${obj.code}]`;
        }
        if ('details' in obj && obj.details) {
          message += ` (Details: ${obj.details})`;
        }
        if ('hint' in obj && obj.hint) {
          message += ` Hint: ${obj.hint}`;
        }

        return message;
      }
    }
    try {
      return JSON.stringify(err);
    } catch {
      return 'An unknown error occurred';
    }
  };

  const handleSave = async (): Promise<string> => {
    setSaving(true);
    setSaveMessage(null);

    try {
      const { data: vehicleData, error: vehicleError } = await supabase
        .from('vehicles_admin')
        .insert({
          plate_number: vehicleForm.plate_number,
          vin: vehicleForm.vin,
          brand: vehicleForm.brand,
          model: vehicleForm.model,
          commercial_name: vehicleForm.commercial_name,
          type_variant_version: vehicleForm.type_variant_version,
          national_type: vehicleForm.national_type,
          first_registration_date: vehicleForm.first_registration_date || null,
          mileage: vehicleForm.mileage ? parseInt(vehicleForm.mileage) : null,
          registration_certificate_present: vehicleForm.registration_certificate_present,
          registration_certificate_number: vehicleForm.registration_certificate_number,
          known_defects: vehicleForm.known_defects,
        })
        .select()
        .single();

      if (vehicleError) throw vehicleError;

      let sellerContactId1: string | null = null;
      let sellerContactId2: string | null = null;
      let buyerContactId1: string | null = null;
      let buyerContactId2: string | null = null;

      if (selectedSellerContact) {
        sellerContactId1 = selectedSellerContact.id;
      } else if (sellerForm.first_name || sellerForm.last_name || sellerForm.company_name) {
        const { data: newSeller, error: sellerError } = await supabase
          .from('contacts')
          .insert({
            type: transactionType === 'purchase' ? 'seller' : 'buyer',
            ...sellerForm,
          })
          .select()
          .single();

        if (sellerError) throw sellerError;
        sellerContactId1 = newSeller.id;
      }

      if (showSecondSeller) {
        if (selectedSeller2Contact) {
          sellerContactId2 = selectedSeller2Contact.id;
        } else if (sellerForm2.first_name || sellerForm2.last_name || sellerForm2.company_name) {
          const { data: newSeller2, error: seller2Error } = await supabase
            .from('contacts')
            .insert({
              type: transactionType === 'purchase' ? 'seller' : 'buyer',
              ...sellerForm2,
            })
            .select()
            .single();

          if (seller2Error) throw seller2Error;
          sellerContactId2 = newSeller2.id;
        }
      }

      if (selectedBuyerContact) {
        buyerContactId1 = selectedBuyerContact.id;
      } else if (buyerForm.first_name || buyerForm.last_name || buyerForm.company_name) {
        const { data: newBuyer, error: buyerError } = await supabase
          .from('contacts')
          .insert({
            type: transactionType === 'sale' ? 'buyer' : 'seller',
            ...buyerForm,
          })
          .select()
          .single();

        if (buyerError) throw buyerError;
        buyerContactId1 = newBuyer.id;
      }

      if (showSecondBuyer) {
        if (selectedBuyer2Contact) {
          buyerContactId2 = selectedBuyer2Contact.id;
        } else if (buyerForm2.first_name || buyerForm2.last_name || buyerForm2.company_name) {
          const { data: newBuyer2, error: buyer2Error } = await supabase
            .from('contacts')
            .insert({
              type: transactionType === 'sale' ? 'buyer' : 'seller',
              ...buyerForm2,
            })
            .select()
            .single();

          if (buyer2Error) throw buyer2Error;
          buyerContactId2 = newBuyer2.id;
        }
      }

      const { data: transactionData, error: transactionError } = await supabase
        .from('transactions_admin')
        .insert({
          transaction_type: transactionType,
          vehicle_id: vehicleData.id,
          seller_contact_id: sellerContactId1,
          seller_contact_id_2: sellerContactId2,
          buyer_contact_id: buyerContactId1,
          buyer_contact_id_2: buyerContactId2,
          transaction_price: transactionForm.transaction_price ? parseFloat(transactionForm.transaction_price) : null,
          reference: transactionForm.reference || null,
          transaction_date: transactionForm.transaction_date || null,
          transaction_time: transactionForm.transaction_time || null,
          pickup_location: transactionForm.pickup_location || null,
          pickup_contact: transactionForm.pickup_contact || null,
          pickup_datetime: transactionForm.pickup_datetime || null,
          destination: transactionForm.destination || null,
          transporter: transactionForm.transporter || null,
        })
        .select()
        .single();

      if (transactionError) throw transactionError;

      const savedTransactionId = transactionData.id;
      setLastSavedTransactionId(savedTransactionId);
      setIsDirty(false);

      console.log('[ADMIN_SAVE] Transaction saved successfully, id:', savedTransactionId, 'isDirty=false');
      setSaveMessage({ type: 'success', text: 'Transaction saved successfully!' });

      await loadContacts();

      setTimeout(() => setSaveMessage(null), 5000);

      return savedTransactionId;
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      console.error('[ADMIN_UI] Error saving transaction:', errorMsg);
      console.error('[ADMIN_UI] Full error object:', error);
      setSaveMessage({
        type: 'error',
        text: errorMsg
      });
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateTransaction = async (): Promise<string> => {
    if (!lastSavedTransactionId) {
      throw new Error('No saved transaction to update');
    }

    console.log('[ADMIN_UPDATE] Updating existing transaction:', lastSavedTransactionId);
    setSaving(true);
    setSaveMessage(null);

    try {
      const { data: existingTransaction, error: fetchError } = await supabase
        .from('transactions_admin')
        .select('vehicle_id')
        .eq('id', lastSavedTransactionId)
        .single();

      if (fetchError) throw fetchError;
      if (!existingTransaction) throw new Error('Transaction not found');

      const { error: vehicleError } = await supabase
        .from('vehicles_admin')
        .update({
          plate_number: vehicleForm.plate_number,
          vin: vehicleForm.vin,
          brand: vehicleForm.brand,
          model: vehicleForm.model,
          commercial_name: vehicleForm.commercial_name,
          type_variant_version: vehicleForm.type_variant_version,
          national_type: vehicleForm.national_type,
          first_registration_date: vehicleForm.first_registration_date || null,
          mileage: vehicleForm.mileage ? parseInt(vehicleForm.mileage) : null,
          registration_certificate_present: vehicleForm.registration_certificate_present,
          registration_certificate_number: vehicleForm.registration_certificate_number,
          known_defects: vehicleForm.known_defects,
        })
        .eq('id', existingTransaction.vehicle_id);

      if (vehicleError) throw vehicleError;

      let sellerContactId1: string | null = null;
      let sellerContactId2: string | null = null;
      let buyerContactId1: string | null = null;
      let buyerContactId2: string | null = null;

      if (selectedSellerContact) {
        sellerContactId1 = selectedSellerContact.id;
      } else if (sellerForm.first_name || sellerForm.last_name || sellerForm.company_name) {
        const { data: newSeller, error: sellerError } = await supabase
          .from('contacts')
          .insert({
            type: transactionType === 'purchase' ? 'seller' : 'buyer',
            ...sellerForm,
          })
          .select()
          .single();

        if (sellerError) throw sellerError;
        sellerContactId1 = newSeller.id;
      }

      if (showSecondSeller) {
        if (selectedSeller2Contact) {
          sellerContactId2 = selectedSeller2Contact.id;
        } else if (sellerForm2.first_name || sellerForm2.last_name || sellerForm2.company_name) {
          const { data: newSeller2, error: seller2Error } = await supabase
            .from('contacts')
            .insert({
              type: transactionType === 'purchase' ? 'seller' : 'buyer',
              ...sellerForm2,
            })
            .select()
            .single();

          if (seller2Error) throw seller2Error;
          sellerContactId2 = newSeller2.id;
        }
      }

      if (selectedBuyerContact) {
        buyerContactId1 = selectedBuyerContact.id;
      } else if (buyerForm.first_name || buyerForm.last_name || buyerForm.company_name) {
        const { data: newBuyer, error: buyerError } = await supabase
          .from('contacts')
          .insert({
            type: transactionType === 'sale' ? 'buyer' : 'seller',
            ...buyerForm,
          })
          .select()
          .single();

        if (buyerError) throw buyerError;
        buyerContactId1 = newBuyer.id;
      }

      if (showSecondBuyer) {
        if (selectedBuyer2Contact) {
          buyerContactId2 = selectedBuyer2Contact.id;
        } else if (buyerForm2.first_name || buyerForm2.last_name || buyerForm2.company_name) {
          const { data: newBuyer2, error: buyer2Error } = await supabase
            .from('contacts')
            .insert({
              type: transactionType === 'sale' ? 'buyer' : 'seller',
              ...buyerForm2,
            })
            .select()
            .single();

          if (buyer2Error) throw buyer2Error;
          buyerContactId2 = newBuyer2.id;
        }
      }

      const { error: transactionError } = await supabase
        .from('transactions_admin')
        .update({
          transaction_type: transactionType,
          seller_contact_id: sellerContactId1,
          seller_contact_id_2: sellerContactId2,
          buyer_contact_id: buyerContactId1,
          buyer_contact_id_2: buyerContactId2,
          transaction_price: transactionForm.transaction_price ? parseFloat(transactionForm.transaction_price) : null,
          reference: transactionForm.reference || null,
          transaction_date: transactionForm.transaction_date || null,
          transaction_time: transactionForm.transaction_time || null,
          pickup_location: transactionForm.pickup_location || null,
          pickup_contact: transactionForm.pickup_contact || null,
          pickup_datetime: transactionForm.pickup_datetime || null,
          destination: transactionForm.destination || null,
          transporter: transactionForm.transporter || null,
        })
        .eq('id', lastSavedTransactionId);

      if (transactionError) throw transactionError;

      setIsDirty(false);

      console.log('[ADMIN_UPDATE] Transaction updated successfully, id:', lastSavedTransactionId, 'isDirty=false');
      setSaveMessage({ type: 'success', text: 'Transaction updated successfully!' });

      await loadContacts();

      setTimeout(() => setSaveMessage(null), 5000);

      return lastSavedTransactionId;
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      console.error('[ADMIN_UPDATE] Error updating transaction:', errorMsg);
      console.error('[ADMIN_UPDATE] Full error object:', error);
      setSaveMessage({
        type: 'error',
        text: errorMsg
      });
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateDocument = async (documentType: string) => {
    console.log('[ADMIN_GEN] Starting document generation for:', documentType);

    let transactionId = lastSavedTransactionId;

    if (!transactionId) {
      console.log('[ADMIN_GEN] No saved transaction, creating current transaction first');
      setSaveMessage({
        type: 'info',
        text: 'Saving transaction before generating document...'
      });

      try {
        transactionId = await handleSave();
        console.log('[ADMIN_GEN] Transaction saved with ID:', transactionId);
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        console.error('[ADMIN_GEN] Save failed:', errorMsg);
        setSaveMessage({
          type: 'error',
          text: `Failed to save transaction: ${errorMsg}`
        });
        return;
      }
    } else if (isDirty) {
      console.log('[ADMIN_GEN] Form dirty, updating existing transaction id=', transactionId);
      setSaveMessage({
        type: 'info',
        text: 'Updating transaction with current data...'
      });

      try {
        transactionId = await handleUpdateTransaction();
        console.log('[ADMIN_GEN] Transaction updated with ID:', transactionId);
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        console.error('[ADMIN_GEN] Update failed:', errorMsg);
        setSaveMessage({
          type: 'error',
          text: `Failed to update transaction: ${errorMsg}`
        });
        return;
      }
    } else {
      console.log('[ADMIN_GEN] Using existing transaction, no update needed, id=', transactionId);
    }

    setGeneratingDoc(documentType);
    try {
      const plateNumber = vehicleForm.plate_number || 'NO_PLATE';
      const sanitizedPlate = plateNumber.replace(/[^a-zA-Z0-9]/g, '');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);

      console.log('[ADMIN_GEN] Generating', documentType, 'for current plate=', plateNumber);
      const { blob, missing } = await generateAdminDocument(
        documentType as any,
        transactionId
      );

      const docTypeSlug = documentType.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const fileName = `${docTypeSlug}_${sanitizedPlate}_${timestamp}.pdf`;

      // Aperçu + rapport de complétude : l'opérateur voit le PDF et la liste
      // des champs vides AVANT d'imprimer, au lieu de découvrir les trous après.
      setDocPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return { url: URL.createObjectURL(blob), docType: documentType, fileName, missing };
      });

      setSaveMessage({
        type: missing.length > 0 ? 'info' : 'success',
        text: missing.length > 0
          ? `${documentType} généré — ${missing.length} champ(s) vide(s), voir l'aperçu ci-dessous.`
          : `${documentType} généré — toutes les données étaient présentes.`
      });

      setTimeout(() => setSaveMessage(null), 6000);
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      console.error('[ADMIN_GEN] Generation failed:', errorMsg);
      console.error('[ADMIN_GEN] Full error object:', error);
      setSaveMessage({
        type: 'error',
        text: `Failed to generate document: ${errorMsg}`
      });
    } finally {
      setGeneratingDoc(null);
    }
  };

  const renderContactSearch = (
    show: boolean,
    setShow: (val: boolean) => void,
    onSelect: (contact: Contact) => void,
    label: string
  ) => {
    const filteredContacts = filterContacts(searchQuery);

    return (
      <div className="mb-4">
        <button
          onClick={() => setShow(!show)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors text-sm font-medium"
        >
          <Search size={16} />
          {label}
        </button>

        {show && (
          <div className="mt-2 border border-zinc-700 rounded-lg bg-zinc-900 p-4">
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                placeholder="Search by name, company, or SIREN..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => {
                  setShow(false);
                  setSearchQuery('');
                }}
                className="p-2 hover:bg-zinc-800 rounded transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-2">
              {filteredContacts.length === 0 ? (
                <p className="text-sm text-zinc-500 text-center py-4">No contacts found</p>
              ) : (
                filteredContacts.map((contact) => (
                  <button
                    key={contact.id}
                    onClick={() => onSelect(contact)}
                    className="w-full text-left px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
                  >
                    <div className="text-sm font-medium">
                      {contact.company_name || `${contact.first_name} ${contact.last_name}`}
                    </div>
                    <div className="text-xs text-zinc-400 mt-0.5">
                      {contact.siren && <span>SIREN: {contact.siren}</span>}
                      {contact.siren && contact.city && <span className="mx-2">•</span>}
                      {contact.city && <span>{contact.city}</span>}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderContactFields = (
    form: ContactForm,
    setForm: (form: ContactForm) => void,
    selectedContact: Contact | null,
    label: string,
    savingState: boolean,
    setSavingState: (val: boolean) => void,
    role: 'seller' | 'buyer'
  ) => {
    return (
      <div className="space-y-4">
        {selectedContact && (
          <div className="px-3 py-2 bg-blue-900/30 border border-blue-700/50 rounded text-sm">
            Using existing contact: <span className="font-medium">
              {selectedContact.company_name || `${selectedContact.first_name} ${selectedContact.last_name}`}
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        <div>
          <label className="block text-sm font-medium mb-1 text-zinc-300">Company Name</label>
          <input
            type="text"
            value={form.company_name}
            onChange={(e) => setForm({ ...form, company_name: e.target.value })}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-zinc-300">SIREN</label>
          <input
            type="text"
            value={form.siren}
            onChange={(e) => setForm({ ...form, siren: e.target.value })}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-zinc-300">First Name</label>
          <input
            type="text"
            value={form.first_name}
            onChange={(e) => setForm({ ...form, first_name: e.target.value })}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-zinc-300">Last Name</label>
          <input
            type="text"
            value={form.last_name}
            onChange={(e) => setForm({ ...form, last_name: e.target.value })}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-zinc-300">Birth Date</label>
          <input
            type="date"
            value={form.birth_date}
            onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-zinc-300">Birth Place</label>
          <input
            type="text"
            value={form.birth_place}
            onChange={(e) => setForm({ ...form, birth_place: e.target.value })}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1 text-zinc-300">Address Line 1</label>
          <input
            type="text"
            value={form.address_line1}
            onChange={(e) => setForm({ ...form, address_line1: e.target.value })}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1 text-zinc-300">Address Line 2</label>
          <input
            type="text"
            value={form.address_line2}
            onChange={(e) => setForm({ ...form, address_line2: e.target.value })}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-zinc-300">Postal Code</label>
          <input
            type="text"
            value={form.postal_code}
            onChange={(e) => setForm({ ...form, postal_code: e.target.value })}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-zinc-300">City</label>
          <input
            type="text"
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-zinc-300">Country</label>
          <input
            type="text"
            value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
          />
        </div>
        </div>

        <button
          onClick={() => saveContactAs(form, selectedContact, setSavingState, role)}
          disabled={savingState}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg transition-colors text-sm font-medium"
        >
          <UserPlus size={16} />
          {savingState ? 'Saving...' : selectedContact ? 'Update Contact' : 'Save as Contact'}
        </button>
      </div>
    );
  };

  // Read-only card for MC Export's own side — it's us, never retyped.
  const renderMcCard = (role: 'acheteur' | 'vendeur') => (
    <div className="rounded-lg border border-blue-700/40 bg-blue-900/15 p-4">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-blue-200">{MC_EXPORT_FORM.company_name}</span>
        <span className="text-[11px] uppercase tracking-wide text-blue-400/80">{role} · vous</span>
      </div>
      <div className="mt-1 text-sm text-zinc-400 space-y-0.5">
        <div>{MC_EXPORT_FORM.address_line1}</div>
        <div>{MC_EXPORT_FORM.postal_code} {MC_EXPORT_FORM.city} · {MC_EXPORT_FORM.country}</div>
        <div className="text-zinc-500">SIREN {MC_EXPORT_FORM.siren}</div>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">Pré-rempli automatiquement dans les documents.</p>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Administratif</h1>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setSettingsOpen((v) => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors font-medium ${
              settingsOpen ? 'bg-zinc-700 text-white' : 'bg-zinc-800 hover:bg-zinc-700'
            }`}
          >
            <UserPlus size={18} />
            Contacts
          </button>
          <button
            onClick={handleClearForm}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors font-medium"
          >
            <Trash2 size={18} />
            Vider
          </button>
          <button
            onClick={() => {
              console.log('[ADMIN_UI] Navigating to history');
              window.history.pushState({}, '', '/admin/history');
            }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors font-medium"
          >
            <History size={18} />
            Historique
          </button>
        </div>
      </div>

      {settingsOpen && (
        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-zinc-100">Contacts enregistrés</h2>
              <p className="text-sm text-zinc-500">Faites le propre : supprimez les doublons. MC Export ne peut pas être supprimé.</p>
            </div>
            <span className="text-sm text-zinc-500">{contacts.length} contact(s)</span>
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-zinc-800">
            {contacts.length === 0 && <p className="text-sm text-zinc-500 py-4">Aucun contact pour l'instant.</p>}
            {contacts.map((c) => {
              const isMc = c.id === mcExport?.id || c.siren === MC_EXPORT_SIREN;
              const name = c.company_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '(sans nom)';
              const loc = [c.postal_code, c.city].filter(Boolean).join(' ');
              return (
                <div key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm text-zinc-200 truncate flex items-center gap-2">
                      {name}
                      {isMc && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300">MC Export</span>}
                    </div>
                    <div className="text-xs text-zinc-500 truncate">
                      {[c.address_line1, loc, c.siren && `SIREN ${c.siren}`].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {!isMc && (
                    <button
                      onClick={() => deleteContact(c.id)}
                      disabled={deletingContactId === c.id}
                      className="shrink-0 flex items-center gap-1 text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                    >
                      <Trash2 size={14} /> Supprimer
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {saveMessage && (
        <div className={`mb-6 px-4 py-3 rounded-lg ${
          saveMessage.type === 'success'
            ? 'bg-green-900/30 border border-green-700/50 text-green-200'
            : saveMessage.type === 'info'
            ? 'bg-blue-900/30 border border-blue-700/50 text-blue-200'
            : 'bg-red-900/30 border border-red-700/50 text-red-200'
        }`}>
          {saveMessage.text}
        </div>
      )}

      <div className="space-y-8">
        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4 text-zinc-100">Vehicle Information</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Plate Number</label>
              <input
                type="text"
                value={vehicleForm.plate_number}
                onChange={(e) => updateVehicleForm({ plate_number: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">VIN</label>
              <input
                type="text"
                value={vehicleForm.vin}
                onChange={(e) => updateVehicleForm({ vin: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Brand</label>
              <input
                type="text"
                value={vehicleForm.brand}
                onChange={(e) => updateVehicleForm({ brand: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Model</label>
              <input
                type="text"
                value={vehicleForm.model}
                onChange={(e) => updateVehicleForm({ model: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Commercial Name</label>
              <input
                type="text"
                value={vehicleForm.commercial_name}
                onChange={(e) => updateVehicleForm({ commercial_name: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Type / Variant / Version</label>
              <input
                type="text"
                value={vehicleForm.type_variant_version}
                onChange={(e) => updateVehicleForm({ type_variant_version: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">National Type</label>
              <input
                type="text"
                value={vehicleForm.national_type}
                onChange={(e) => updateVehicleForm({ national_type: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">First Registration Date</label>
              <input
                type="date"
                value={vehicleForm.first_registration_date}
                onChange={(e) => updateVehicleForm({ first_registration_date: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Mileage</label>
              <input
                type="number"
                value={vehicleForm.mileage}
                onChange={(e) => updateVehicleForm({ mileage: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center gap-3 pt-7">
              <input
                type="checkbox"
                id="registration-cert"
                checked={vehicleForm.registration_certificate_present}
                onChange={(e) => updateVehicleForm({ registration_certificate_present: e.target.checked })}
                className="w-4 h-4 rounded border-zinc-700 bg-zinc-800 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="registration-cert" className="text-sm font-medium text-zinc-300">
                Registration Certificate Present
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Registration Certificate Number</label>
              <input
                type="text"
                value={vehicleForm.registration_certificate_number}
                onChange={(e) => updateVehicleForm({ registration_certificate_number: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1 text-zinc-300">Known Defects</label>
              <textarea
                value={vehicleForm.known_defects}
                onChange={(e) => updateVehicleForm({ known_defects: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-1 text-zinc-100">La vente</h2>
          <p className="text-sm text-zinc-500 mb-4">Choisissez le sens : MC Export est placé automatiquement du bon côté.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => updateTransactionType('purchase')}
              className={`text-left px-5 py-4 rounded-xl border transition-colors ${
                transactionType === 'purchase'
                  ? 'bg-blue-600/20 border-blue-500 text-white'
                  : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:border-zinc-600'
              }`}
            >
              <div className="font-semibold flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${transactionType === 'purchase' ? 'bg-blue-400' : 'bg-zinc-600'}`} />
                MC Export achète
              </div>
              <div className="text-xs mt-1 text-zinc-500">Le client est le vendeur · Cession, Bon d'achat, Enlèvement, Déclaration d'achat</div>
            </button>
            <button
              onClick={() => updateTransactionType('sale')}
              className={`text-left px-5 py-4 rounded-xl border transition-colors ${
                transactionType === 'sale'
                  ? 'bg-blue-600/20 border-blue-500 text-white'
                  : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:border-zinc-600'
              }`}
            >
              <div className="font-semibold flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${transactionType === 'sale' ? 'bg-blue-400' : 'bg-zinc-600'}`} />
                MC Export vend
              </div>
              <div className="text-xs mt-1 text-zinc-500">Le client est l'acheteur · Cession, Réception / Expédition</div>
            </button>
          </div>

          {/* Prix + Référence — le cœur de la vente */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Prix (€)</label>
              <input
                type="number"
                step="0.01"
                value={transactionForm.transaction_price}
                onChange={(e) => updateTransactionForm({ transaction_price: e.target.value })}
                placeholder="9 500"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Référence <span className="text-zinc-500 font-normal">(votre code, ex. I63, TGE789)</span></label>
              <input
                type="text"
                value={transactionForm.reference}
                onChange={(e) => updateTransactionForm({ reference: e.target.value })}
                placeholder="I63"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </section>

        {/* ─── Vendeur ─────────────────────────────────────────────── */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4 text-zinc-100">
            {transactionType === 'sale' ? 'Vendeur — MC Export (vous)' : 'Vendeur (le client)'}
          </h2>

          {transactionType === 'sale' ? (
            renderMcCard('vendeur')
          ) : (
            <>
              {renderContactSearch(
                showSellerSearch,
                setShowSellerSearch,
                (contact) => selectContact(contact, 'seller'),
                'Rechercher un contact existant'
              )}
              {renderContactFields(
                sellerForm, setSellerForm, selectedSellerContact,
                'Vendeur', savingSellerContact, setSavingSellerContact, 'seller'
              )}
              <div className="mt-4">
                {!showSecondSeller ? (
                  <button
                    onClick={() => toggleShowSecondSeller(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors text-sm"
                  >
                    <Plus size={16} /> Ajouter un co-vendeur
                  </button>
                ) : (
                  <div className="border-t border-zinc-800 pt-4 mt-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-medium text-zinc-200">Co-vendeur</h3>
                      <button
                        onClick={() => { toggleShowSecondSeller(false); setSelectedSeller2Contact(null); setSellerForm2(EMPTY_CONTACT); }}
                        className="p-1 hover:bg-zinc-800 rounded transition-colors"
                      >
                        <X size={18} />
                      </button>
                    </div>
                    {renderContactSearch(showSeller2Search, setShowSeller2Search, (contact) => selectContact(contact, 'seller2'), 'Rechercher un contact existant')}
                    {renderContactFields(sellerForm2, setSellerForm2, selectedSeller2Contact, 'Co-vendeur', savingSeller2Contact, setSavingSeller2Contact, 'seller')}
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        {/* ─── Acheteur ────────────────────────────────────────────── */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4 text-zinc-100">
            {transactionType === 'purchase' ? 'Acheteur — MC Export (vous)' : 'Acheteur (le client)'}
          </h2>

          {transactionType === 'purchase' ? (
            renderMcCard('acheteur')
          ) : (
            <>
              {renderContactSearch(
                showBuyerSearch,
                setShowBuyerSearch,
                (contact) => selectContact(contact, 'buyer'),
                'Rechercher un contact existant'
              )}
              {renderContactFields(
                buyerForm, setBuyerForm, selectedBuyerContact,
                'Acheteur', savingBuyerContact, setSavingBuyerContact, 'buyer'
              )}
              <div className="mt-4">
                {!showSecondBuyer ? (
                  <button
                    onClick={() => toggleShowSecondBuyer(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors text-sm"
                  >
                    <Plus size={16} /> Ajouter un co-acheteur
                  </button>
                ) : (
                  <div className="border-t border-zinc-800 pt-4 mt-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-medium text-zinc-200">Co-acheteur</h3>
                      <button
                        onClick={() => { toggleShowSecondBuyer(false); setSelectedBuyer2Contact(null); setBuyerForm2(EMPTY_CONTACT); }}
                        className="p-1 hover:bg-zinc-800 rounded transition-colors"
                      >
                        <X size={18} />
                      </button>
                    </div>
                    {renderContactSearch(showBuyer2Search, setShowBuyer2Search, (contact) => selectContact(contact, 'buyer2'), 'Rechercher un contact existant')}
                    {renderContactFields(buyerForm2, setBuyerForm2, selectedBuyer2Contact, 'Co-acheteur', savingBuyer2Contact, setSavingBuyer2Contact, 'buyer')}
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4 text-zinc-100">Date de la transaction</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Transaction Date</label>
              <input
                type="date"
                value={transactionForm.transaction_date}
                onChange={(e) => updateTransactionForm({ transaction_date: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Transaction Time</label>
              <input
                type="time"
                value={transactionForm.transaction_time}
                onChange={(e) => updateTransactionForm({ transaction_time: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </section>

        {transactionType === 'purchase' && (
          <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4 text-zinc-100">Pickup</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-zinc-300">Pickup Location</label>
                <input
                  type="text"
                  value={transactionForm.pickup_location}
                  onChange={(e) => updateTransactionForm({ pickup_location: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-zinc-300">Pickup Contact</label>
                <input
                  type="text"
                  value={transactionForm.pickup_contact}
                  onChange={(e) => updateTransactionForm({ pickup_contact: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 text-zinc-300">Pickup Date & Time</label>
                <input
                  type="datetime-local"
                  value={transactionForm.pickup_datetime}
                  onChange={(e) => updateTransactionForm({ pickup_datetime: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </section>
        )}

        {transactionType === 'sale' && (
          <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4 text-zinc-100">Delivery</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-zinc-300">Destination</label>
                <input
                  type="text"
                  value={transactionForm.destination}
                  onChange={(e) => updateTransactionForm({ destination: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-zinc-300">Transporter</label>
                <input
                  type="text"
                  value={transactionForm.transporter}
                  onChange={(e) => updateTransactionForm({ transporter: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </section>
        )}

        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-1">
            <FileText className="text-blue-500" size={24} />
            <h2 className="text-xl font-semibold text-zinc-100">Documents</h2>
          </div>
          <p className="text-sm text-zinc-500 mb-6">
            {transactionType === 'purchase'
              ? 'MC Export achète — documents côté achat (MC Export pré-rempli en acheteur).'
              : 'MC Export vend — documents côté vente (MC Export pré-rempli en vendeur).'}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {DOCS_BY_DIRECTION[transactionType].map((doc) => (
              <button
                key={doc}
                onClick={() => handleGenerateDocument(doc)}
                disabled={generatingDoc !== null}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed rounded-lg transition-colors font-medium border border-zinc-700"
              >
                {generatingDoc === doc ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-zinc-400 border-t-transparent rounded-full"></div>
                    Génération…
                  </>
                ) : (
                  <>
                    <Download size={18} />
                    {doc}
                  </>
                )}
              </button>
            ))}
          </div>
        </section>

        {/* Aperçu + rapport de complétude du dernier document généré */}
        {docPreview && (
          <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-200">
                Aperçu — {docPreview.docType}
              </h2>
              <div className="flex items-center gap-3">
                <a
                  href={docPreview.url}
                  download={docPreview.fileName}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium"
                >
                  <Download size={14} /> Télécharger
                </a>
                <button
                  onClick={() => {
                    URL.revokeObjectURL(docPreview.url);
                    setDocPreview(null);
                  }}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Fermer
                </button>
              </div>
            </div>
            {docPreview.missing.length > 0 ? (
              <div className="text-xs space-y-1.5">
                <p className="text-amber-400 font-medium">
                  {docPreview.missing.length} champ(s) vide(s) sur ce document — complétez le formulaire puis régénérez :
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {docPreview.missing.map((m) => (
                    <span key={m} className="px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-300">{m}</span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-emerald-400">Toutes les données attendues étaient présentes.</p>
            )}
            <iframe
              src={docPreview.url}
              title={`Aperçu ${docPreview.docType}`}
              className="w-full rounded-lg border border-zinc-800 bg-white"
              style={{ height: 560 }}
            />
          </section>
        )}
      </div>
    </div>
  );
}
