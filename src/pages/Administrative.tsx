import { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Save, X, UserPlus, FileText, Download, History, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { generateAdminDocument, downloadBlob } from '../lib/adminDocGenerator';
import { saveDraft, loadDraft, clearDraft } from '../lib/adminDraftStorage';

type Contact = {
  id: string;
  type?: string;
  company_name?: string;
  first_name?: string;
  last_name?: string;
  birth_date?: string;
  birth_place?: string;
  siren?: string;
  address_line1?: string;
  address_line2?: string;
  postal_code?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  notes?: string;
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
  transaction_date: string;
  transaction_time: string;
  pickup_location: string;
  pickup_contact: string;
  pickup_datetime: string;
  destination: string;
  transporter: string;
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

  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      setTransactionType(draft.transactionType);
      setVehicleForm(draft.vehicleForm);
      setSellerForm(draft.sellerForm);
      setSellerForm2(draft.sellerForm2);
      setBuyerForm(draft.buyerForm);
      setBuyerForm2(draft.buyerForm2);
      setTransactionForm(draft.transactionForm);
      setShowSecondSeller(draft.showSecondSeller);
      setShowSecondBuyer(draft.showSecondBuyer);
      setLastSavedTransactionId(draft.lastSavedTransactionId);

      console.log('[ADMIN_DRAFT] Form state restored from draft');
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

    clearDraft();
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

  const handleGenerateDocument = async (documentType: string) => {
    console.log('[ADMIN_DOC_GEN] Generating document:', documentType);

    let transactionId = lastSavedTransactionId;

    if (!transactionId) {
      console.log('[ADMIN_DOC_GEN] No saved transaction, saving first');
      setSaveMessage({
        type: 'info',
        text: 'Saving transaction before generating document...'
      });

      try {
        transactionId = await handleSave();
        console.log('[ADMIN_DOC_GEN] Transaction saved with ID:', transactionId);
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        console.error('[ADMIN_DOC_GEN] Save failed:', errorMsg);
        setSaveMessage({
          type: 'error',
          text: `Failed to save transaction: ${errorMsg}`
        });
        return;
      }
    }

    setGeneratingDoc(documentType);
    try {
      console.log('[ADMIN_DOC_GEN] Generating PDF for transaction:', transactionId);
      const blob = await generateAdminDocument(
        documentType as any,
        transactionId
      );

      const fileName = `${documentType.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
      downloadBlob(blob, fileName);
      console.log('[ADMIN_DOC_GEN] Document generated and download started');

      setSaveMessage({
        type: 'success',
        text: `${documentType} generated and downloaded successfully!`
      });

      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      console.error('[ADMIN_DOC_GEN] Generation failed:', errorMsg);
      console.error('[ADMIN_DOC_GEN] Full error object:', error);
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

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Administrative</h1>

        <div className="flex items-center gap-3">
          <button
            onClick={handleClearForm}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors font-medium"
          >
            <Trash2 size={18} />
            Clear Form
          </button>

          <button
            onClick={() => {
              console.log('[ADMIN_UI] Navigating to history');
              window.history.pushState({}, '', '/admin/history');
            }}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors font-medium"
          >
            <History size={18} />
            History
          </button>
        </div>
      </div>

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
                onChange={(e) => setVehicleForm({ ...vehicleForm, plate_number: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">VIN</label>
              <input
                type="text"
                value={vehicleForm.vin}
                onChange={(e) => setVehicleForm({ ...vehicleForm, vin: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Brand</label>
              <input
                type="text"
                value={vehicleForm.brand}
                onChange={(e) => setVehicleForm({ ...vehicleForm, brand: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Model</label>
              <input
                type="text"
                value={vehicleForm.model}
                onChange={(e) => setVehicleForm({ ...vehicleForm, model: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Commercial Name</label>
              <input
                type="text"
                value={vehicleForm.commercial_name}
                onChange={(e) => setVehicleForm({ ...vehicleForm, commercial_name: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Type / Variant / Version</label>
              <input
                type="text"
                value={vehicleForm.type_variant_version}
                onChange={(e) => setVehicleForm({ ...vehicleForm, type_variant_version: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">National Type</label>
              <input
                type="text"
                value={vehicleForm.national_type}
                onChange={(e) => setVehicleForm({ ...vehicleForm, national_type: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">First Registration Date</label>
              <input
                type="date"
                value={vehicleForm.first_registration_date}
                onChange={(e) => setVehicleForm({ ...vehicleForm, first_registration_date: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Mileage</label>
              <input
                type="number"
                value={vehicleForm.mileage}
                onChange={(e) => setVehicleForm({ ...vehicleForm, mileage: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center gap-3 pt-7">
              <input
                type="checkbox"
                id="registration-cert"
                checked={vehicleForm.registration_certificate_present}
                onChange={(e) => setVehicleForm({ ...vehicleForm, registration_certificate_present: e.target.checked })}
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
                onChange={(e) => setVehicleForm({ ...vehicleForm, registration_certificate_number: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1 text-zinc-300">Known Defects</label>
              <textarea
                value={vehicleForm.known_defects}
                onChange={(e) => setVehicleForm({ ...vehicleForm, known_defects: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4 text-zinc-100">Transaction Mode</h2>

          <div className="flex gap-4">
            <button
              onClick={() => setTransactionType('purchase')}
              className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${
                transactionType === 'purchase'
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              Purchase
            </button>
            <button
              onClick={() => setTransactionType('sale')}
              className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${
                transactionType === 'sale'
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              Sale
            </button>
          </div>
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4 text-zinc-100">Seller</h2>

          {renderContactSearch(
            showSellerSearch,
            setShowSellerSearch,
            (contact) => selectContact(contact, 'seller'),
            'Search Existing Contact'
          )}

          {renderContactFields(
            sellerForm,
            setSellerForm,
            selectedSellerContact,
            'Seller',
            savingSellerContact,
            setSavingSellerContact,
            'seller'
          )}

          <div className="mt-4">
            {!showSecondSeller ? (
              <button
                onClick={() => setShowSecondSeller(true)}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors text-sm"
              >
                <Plus size={16} />
                Add Second Owner
              </button>
            ) : (
              <div className="border-t border-zinc-800 pt-4 mt-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-zinc-200">Second Seller</h3>
                  <button
                    onClick={() => {
                      setShowSecondSeller(false);
                      setSelectedSeller2Contact(null);
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
                    }}
                    className="p-1 hover:bg-zinc-800 rounded transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>

                {renderContactSearch(
                  showSeller2Search,
                  setShowSeller2Search,
                  (contact) => selectContact(contact, 'seller2'),
                  'Search Existing Contact'
                )}

                {renderContactFields(
                  sellerForm2,
                  setSellerForm2,
                  selectedSeller2Contact,
                  'Second Seller',
                  savingSeller2Contact,
                  setSavingSeller2Contact,
                  'seller'
                )}
              </div>
            )}
          </div>
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4 text-zinc-100">Buyer</h2>

          {renderContactSearch(
            showBuyerSearch,
            setShowBuyerSearch,
            (contact) => selectContact(contact, 'buyer'),
            'Search Existing Contact'
          )}

          {renderContactFields(
            buyerForm,
            setBuyerForm,
            selectedBuyerContact,
            'Buyer',
            savingBuyerContact,
            setSavingBuyerContact,
            'buyer'
          )}

          <div className="mt-4">
            {!showSecondBuyer ? (
              <button
                onClick={() => setShowSecondBuyer(true)}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors text-sm"
              >
                <Plus size={16} />
                Add Second Owner
              </button>
            ) : (
              <div className="border-t border-zinc-800 pt-4 mt-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-zinc-200">Second Buyer</h3>
                  <button
                    onClick={() => {
                      setShowSecondBuyer(false);
                      setSelectedBuyer2Contact(null);
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
                    }}
                    className="p-1 hover:bg-zinc-800 rounded transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>

                {renderContactSearch(
                  showBuyer2Search,
                  setShowBuyer2Search,
                  (contact) => selectContact(contact, 'buyer2'),
                  'Search Existing Contact'
                )}

                {renderContactFields(
                  buyerForm2,
                  setBuyerForm2,
                  selectedBuyer2Contact,
                  'Second Buyer',
                  savingBuyer2Contact,
                  setSavingBuyer2Contact,
                  'buyer'
                )}
              </div>
            )}
          </div>
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4 text-zinc-100">Transaction Info</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Transaction Price</label>
              <input
                type="number"
                step="0.01"
                value={transactionForm.transaction_price}
                onChange={(e) => setTransactionForm({ ...transactionForm, transaction_price: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Transaction Date</label>
              <input
                type="date"
                value={transactionForm.transaction_date}
                onChange={(e) => setTransactionForm({ ...transactionForm, transaction_date: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">Transaction Time</label>
              <input
                type="time"
                value={transactionForm.transaction_time}
                onChange={(e) => setTransactionForm({ ...transactionForm, transaction_time: e.target.value })}
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
                  onChange={(e) => setTransactionForm({ ...transactionForm, pickup_location: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-zinc-300">Pickup Contact</label>
                <input
                  type="text"
                  value={transactionForm.pickup_contact}
                  onChange={(e) => setTransactionForm({ ...transactionForm, pickup_contact: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 text-zinc-300">Pickup Date & Time</label>
                <input
                  type="datetime-local"
                  value={transactionForm.pickup_datetime}
                  onChange={(e) => setTransactionForm({ ...transactionForm, pickup_datetime: e.target.value })}
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
                  onChange={(e) => setTransactionForm({ ...transactionForm, destination: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-zinc-300">Transporter</label>
                <input
                  type="text"
                  value={transactionForm.transporter}
                  onChange={(e) => setTransactionForm({ ...transactionForm, transporter: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </section>
        )}

        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <FileText className="text-blue-500" size={24} />
            <h2 className="text-xl font-semibold text-zinc-100">Generate Documents</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <button
              onClick={() => handleGenerateDocument('Certificat de cession')}
              disabled={generatingDoc !== null}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed rounded-lg transition-colors font-medium border border-zinc-700"
            >
              {generatingDoc === 'Certificat de cession' ? (
                <>
                  <div className="animate-spin h-4 w-4 border-2 border-zinc-400 border-t-transparent rounded-full"></div>
                  Generating...
                </>
              ) : (
                <>
                  <Download size={18} />
                  Certificat de cession
                </>
              )}
            </button>

            <button
              onClick={() => handleGenerateDocument('Déclaration d\'achat')}
              disabled={generatingDoc !== null}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed rounded-lg transition-colors font-medium border border-zinc-700"
            >
              {generatingDoc === 'Déclaration d\'achat' ? (
                <>
                  <div className="animate-spin h-4 w-4 border-2 border-zinc-400 border-t-transparent rounded-full"></div>
                  Generating...
                </>
              ) : (
                <>
                  <Download size={18} />
                  Déclaration d'achat
                </>
              )}
            </button>

            <button
              onClick={() => handleGenerateDocument('Bon d\'achat')}
              disabled={generatingDoc !== null}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed rounded-lg transition-colors font-medium border border-zinc-700"
            >
              {generatingDoc === 'Bon d\'achat' ? (
                <>
                  <div className="animate-spin h-4 w-4 border-2 border-zinc-400 border-t-transparent rounded-full"></div>
                  Generating...
                </>
              ) : (
                <>
                  <Download size={18} />
                  Bon d'achat
                </>
              )}
            </button>

            <button
              onClick={() => handleGenerateDocument('Fiche enlèvement')}
              disabled={generatingDoc !== null}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed rounded-lg transition-colors font-medium border border-zinc-700"
            >
              {generatingDoc === 'Fiche enlèvement' ? (
                <>
                  <div className="animate-spin h-4 w-4 border-2 border-zinc-400 border-t-transparent rounded-full"></div>
                  Generating...
                </>
              ) : (
                <>
                  <Download size={18} />
                  Fiche enlèvement
                </>
              )}
            </button>

            <button
              onClick={() => handleGenerateDocument('Réception / Expédition')}
              disabled={generatingDoc !== null}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed rounded-lg transition-colors font-medium border border-zinc-700"
            >
              {generatingDoc === 'Réception / Expédition' ? (
                <>
                  <div className="animate-spin h-4 w-4 border-2 border-zinc-400 border-t-transparent rounded-full"></div>
                  Generating...
                </>
              ) : (
                <>
                  <Download size={18} />
                  Réception / Expédition
                </>
              )}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
