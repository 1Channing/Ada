import { useState, useEffect, useCallback } from 'react';
import { Search, Plus, X, UserPlus, FileText, Download, History, Trash2, Pencil } from 'lucide-react';
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
  purchase_price: string;
  sale_price: string;
  fees: string;
  reference: string;
  commercial: string;
  notes: string;
  transaction_date: string;
  transaction_time: string;
  pickup_location: string;
  pickup_contact: string;
  pickup_datetime: string;
  destination: string;
  transporter: string;
};

// A deal row for the list view (transaction + joined vehicle/parties).
type DealRow = {
  id: string;
  transaction_type: string | null;
  status: string | null;
  reference: string | null;
  commercial: string | null;
  transaction_price: number | null;
  purchase_price: number | null;
  sale_price: number | null;
  fees: number | null;
  transaction_date: string | null;
  created_at: string;
  closed_at: string | null;
  vehicle: { brand: string | null; model: string | null; plate_number: string | null } | null;
  seller: { company_name: string | null; first_name: string | null; last_name: string | null } | null;
  buyer: { company_name: string | null; first_name: string | null; last_name: string | null } | null;
};

const contactLabel = (c?: { company_name?: string | null; first_name?: string | null; last_name?: string | null } | null): string =>
  c ? (c.company_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '—') : '—';

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

const EMPTY_CONTACT_FORM: ContactForm = {
  company_name: '', first_name: '', last_name: '', birth_date: '', birth_place: '',
  address_line1: '', address_line2: '', postal_code: '', city: '', country: 'FR', siren: '',
};

/**
 * Champ vide → NULL avant toute écriture d'un contact.
 *
 * OBLIGATOIRE : `birth_date` est une colonne `date`, et PostgreSQL refuse la
 * chaîne vide (`22007 invalid input syntax for type date: ""`). Un formulaire
 * de contact laisse toujours des champs vides — une société n'a pas de date de
 * naissance — donc sans ce passage, l'insertion est rejetée en bloc. C'est
 * exactement ce qui rendait le panneau « Ajouter un contact » inopérant depuis
 * toujours (constat 30/07) alors que les formulaires de dossier, eux,
 * nettoyaient déjà. Une seule implémentation pour les deux chemins.
 */
function nullifyBlanks(form: ContactForm): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]),
  );
}

// Un dossier = une voiture = deux contreparties externes qui ne changent pas
// quand on bascule d'un côté à l'autre : le fournisseur (MC Export lui achète)
// et le client (MC Export lui vend). MC Export est toujours au milieu.
type Party = { form: ContactForm; selected: Contact | null };
const emptyParty = (): Party => ({ form: { ...EMPTY_CONTACT_FORM }, selected: null });

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
    purchase_price: '',
    sale_price: '',
    fees: '',
    reference: '',
    commercial: '',
    notes: '',
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

  // Les deux contreparties externes du dossier, conservées quand on bascule
  // achat↔vente : fournisseur (MC achète) et client (MC vend). Le côté actif
  // est édité via sellerForm/buyerForm ; l'autre reste stocké ici.
  const [supplier, setSupplier] = useState<Party>(emptyParty());
  const [client, setClient] = useState<Party>(emptyParty());

  const [, setSaving] = useState(false);
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

  // Deals list workflow: land on the list, open a deal into the editor.
  const [mode, setMode] = useState<'list' | 'editor'>('list');
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [dealsLoading, setDealsLoading] = useState(false);
  const [dealStatus, setDealStatus] = useState<'en_cours' | 'cloturee'>('en_cours');
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  // A deal is one car with two counterparties: a supplier (MC buys from) and a
  // client (MC sells to). Quick-create captures both + the reference.
  const [quick, setQuick] = useState({
    supplierName: '', supplierContactId: '',
    clientName: '', clientContactId: '',
    reference: '', commercial: '',
  });
  const [quickSaving, setQuickSaving] = useState(false);

  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      setTransactionType(draft.transactionType);
      setVehicleForm(draft.vehicleForm);
      setSellerForm(draft.sellerForm);
      setSellerForm2(draft.sellerForm2);
      setBuyerForm(draft.buyerForm);
      setBuyerForm2(draft.buyerForm2);
      setTransactionForm({ reference: '', commercial: '', notes: '', purchase_price: '', sale_price: '', fees: '', ...draft.transactionForm });
      setShowSecondSeller(draft.showSecondSeller);
      setShowSecondBuyer(draft.showSecondBuyer);
      setLastSavedTransactionId(draft.lastSavedTransactionId);

      // Les CONTACTS SÉLECTIONNÉS aussi (constat Louwman 31/08) : le brouillon
      // stockait les ids mais la restauration ne les relisait jamais — au
      // retour sur la page, l'encart « contact existant » disparaissait et le
      // save suivant CRÉAIT UN DOUBLON au lieu de relier la fiche (origine du
      // doublon MC Export du 30/07). On re-résout chaque id en base.
      const reselect = async (id: string | null, set: (c: Contact) => void) => {
        if (!id) return;
        const { data } = await supabase.from('contacts').select('*').eq('id', id).maybeSingle();
        if (data) set(data as Contact);
      };
      void reselect(draft.selectedSellerContactId, setSelectedSellerContact);
      void reselect(draft.selectedSeller2ContactId, setSelectedSeller2Contact);
      void reselect(draft.selectedBuyerContactId, setSelectedBuyerContact);
      void reselect(draft.selectedBuyer2ContactId, setSelectedBuyer2Contact);

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
      // `order` OBLIGATOIRE : tant que deux fiches portent ce SIREN (doublon
      // constaté le 30/07), un `limit(1)` sans tri renvoie l'une OU l'autre
      // selon le plan d'exécution — MC Export changeait donc d'identité d'une
      // session à l'autre. On élit toujours la PLUS ANCIENNE, celle que les
      // dossiers historiques référencent.
      const { data: found } = await supabase
        .from('contacts')
        .select('*')
        .eq('siren', MC_EXPORT_SIREN)
        .order('created_at', { ascending: true })
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

  // The external contreparty of the ACTIVE side: purchase → the seller is the
  // supplier, sale → the buyer is the client. MC Export sits on the other side.
  const currentExternalParty = (): Party =>
    transactionType === 'purchase'
      ? { form: sellerForm, selected: selectedSellerContact }
      : { form: buyerForm, selected: selectedBuyerContact };

  // Seat seller/buyer forms for a direction from the two persistent parties
  // (supplier / client) + MC Export, without losing either counterparty.
  const seatDirection = (
    type: 'purchase' | 'sale', sup: Party, cli: Party, mc: Contact | null,
  ) => {
    if (type === 'purchase') {
      setSellerForm(sup.form); setSelectedSellerContact(sup.selected);
      if (mc) { setBuyerForm(contactToForm(mc)); setSelectedBuyerContact(mc); }
      else { setBuyerForm({ ...EMPTY_CONTACT_FORM }); setSelectedBuyerContact(null); }
    } else {
      if (mc) { setSellerForm(contactToForm(mc)); setSelectedSellerContact(mc); }
      else { setSellerForm({ ...EMPTY_CONTACT_FORM }); setSelectedSellerContact(null); }
      setBuyerForm(cli.form); setSelectedBuyerContact(cli.selected);
    }
  };

  // Switch which side of the SAME deal is active (achat ↔ vente). Both external
  // counterparties are kept: we snapshot the current external edits into its
  // slot, then re-seat the target side. One dossier serves both directions.
  const updateTransactionType = (type: 'purchase' | 'sale') => {
    if (type === transactionType) return;
    const ext = currentExternalParty();
    let sup = supplier, cli = client;
    if (transactionType === 'purchase') { sup = ext; setSupplier(ext); }
    else { cli = ext; setClient(ext); }
    setTransactionType(type);
    seatDirection(type, sup, cli, mcExport);
    // Co-parties are per-side extras; reset them on switch.
    setSellerForm2(EMPTY_CONTACT); setSelectedSeller2Contact(null); setShowSecondSeller(false);
    setBuyerForm2(EMPTY_CONTACT); setSelectedBuyer2Contact(null); setShowSecondBuyer(false);
    markDirty();
  };

  // Persist form edits back onto the chosen contact (or create it) so the
  // document always reflects exactly what the operator sees on screen. Selecting
  // an existing contact then editing its address used to be silently dropped.
  const persistContactSlot = async (
    selected: Contact | null, form: ContactForm, type: string,
  ): Promise<string | null> => {
    const hasName = form.first_name || form.last_name || form.company_name;
    const clean = nullifyBlanks(form);
    if (selected) {
      await supabase.from('contacts').update(clean).eq('id', selected.id);
      return selected.id;
    }
    // Filet anti-doublon par SIREN (classe du doublon MC Export 30/07 et du
    // Louwman non relié 31/08) : quand la sélection s'est perdue (brouillon
    // d'une autre machine, session nettoyée) mais que le formulaire porte un
    // SIREN déjà connu, on RELIE la fiche existante au lieu d'en créer une
    // deuxième. La plus ancienne fait foi (celle que l'historique référence).
    if (form.siren?.trim()) {
      const { data: bySiren } = await supabase
        .from('contacts').select('id').eq('siren', form.siren.trim())
        .order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (bySiren) {
        await supabase.from('contacts').update(clean).eq('id', bySiren.id);
        return bySiren.id;
      }
    }
    if (hasName) {
      const { data, error } = await supabase
        .from('contacts').insert({ type, ...clean }).select('id').single();
      if (error) throw error;
      return data.id;
    }
    return null;
  };

  // Resolve the two external parties + active-direction seller/buyer for save.
  // Captures the currently-edited external side into its slot first.
  const resolveDealContacts = async (): Promise<{
    supplierId: string | null; clientId: string | null;
    sellerId: string | null; buyerId: string | null;
  }> => {
    const ext = currentExternalParty();
    const sup = transactionType === 'purchase' ? ext : supplier;
    const cli = transactionType === 'sale' ? ext : client;
    const supplierId = await persistContactSlot(sup.selected, sup.form, 'seller');
    const clientId = await persistContactSlot(cli.selected, cli.form, 'buyer');
    const mcId = mcExport?.id ?? null;
    const sellerId = transactionType === 'purchase' ? supplierId : mcId;
    const buyerId = transactionType === 'purchase' ? mcId : clientId;
    return { supplierId, clientId, sellerId, buyerId };
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

  // ─── Deals list ───────────────────────────────────────────────────────────
  const loadDeals = async () => {
    setDealsLoading(true);
    const { data } = await supabase
      .from('transactions_admin')
      .select(`
        id, transaction_type, status, reference, commercial, transaction_price,
        purchase_price, sale_price, fees, transaction_date, created_at, closed_at,
        vehicle:vehicles_admin!transactions_admin_vehicle_id_fkey(brand, model, plate_number),
        seller:contacts!transactions_admin_seller_contact_id_fkey(company_name, first_name, last_name),
        buyer:contacts!transactions_admin_buyer_contact_id_fkey(company_name, first_name, last_name)
      `)
      .order('created_at', { ascending: false })
      .limit(500);
    setDeals((data ?? []) as unknown as DealRow[]);
    setDealsLoading(false);
  };

  useEffect(() => { loadDeals(); }, []);

  // Distinct salespeople already used — populates the commercial datalist.
  const commercialNames = Array.from(
    new Set(deals.map((d) => (d.commercial ?? '').trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const backToList = () => {
    setMode('list');
    setLastSavedTransactionId(null);
    loadDeals();
  };

  const closeDeal = async (id: string, close: boolean) => {
    await supabase
      .from('transactions_admin')
      .update({ status: close ? 'cloturee' : 'en_cours', closed_at: close ? new Date().toISOString() : null })
      .eq('id', id);
    if (id === lastSavedTransactionId) setDealStatus(close ? 'cloturee' : 'en_cours');
    await loadDeals();
  };

  const deleteDeal = async (id: string) => {
    if (!window.confirm('Supprimer définitivement cette vente ? (le véhicule associé est supprimé, les contacts sont conservés)')) return;
    // Fetch the vehicle to clean it up too; contacts are shared, kept.
    const { data: tx } = await supabase.from('transactions_admin').select('vehicle_id').eq('id', id).maybeSingle();
    const { error } = await supabase.from('transactions_admin').delete().eq('id', id); // cascades documents_admin_history
    if (error) {
      setSaveMessage({ type: 'error', text: `Suppression impossible : ${error.message}` });
      return;
    }
    if (tx?.vehicle_id) await supabase.from('vehicles_admin').delete().eq('id', tx.vehicle_id);
    if (id === lastSavedTransactionId) backToList();
    else await loadDeals();
  };

  // Add a contact from the settings panel (light: name + address).
  const [newContact, setNewContact] = useState<ContactForm>(EMPTY_CONTACT);
  const [addingContact, setAddingContact] = useState(false);
  // Retour d'écriture : l'ancienne version ignorait le résultat de l'insertion
  // ET vidait le formulaire quoi qu'il arrive — un échec était donc
  // indiscernable d'un succès, et la saisie perdue (constat 30/07).
  const [contactNotice, setContactNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // Édition en place : id du contact en cours de modification (null = ajout).
  const [editingContactId, setEditingContactId] = useState<string | null>(null);

  const startEditContact = (c: Contact) => {
    setEditingContactId(c.id);
    setNewContact(contactToForm(c));
    setContactNotice(null);
  };
  const cancelEditContact = () => {
    setEditingContactId(null);
    setNewContact(EMPTY_CONTACT);
    setContactNotice(null);
  };

  const addContact = async () => {
    if (!newContact.company_name && !newContact.first_name && !newContact.last_name) return;
    setAddingContact(true);
    setContactNotice(null);
    try {
      const clean = nullifyBlanks(newContact);
      const label = newContact.company_name
        || `${newContact.first_name} ${newContact.last_name}`.trim()
        || 'Contact';
      if (editingContactId) {
        const { error } = await supabase.from('contacts').update(clean).eq('id', editingContactId);
        if (error) throw new Error(error.message);
        setContactNotice({ ok: true, text: `« ${label} » mis à jour.` });
        setEditingContactId(null);
      } else {
        const { error } = await supabase.from('contacts').insert({ type: 'client', ...clean });
        if (error) throw new Error(error.message);
        setContactNotice({ ok: true, text: `« ${label} » ajouté.` });
      }
      // Formulaire vidé UNIQUEMENT après une écriture réussie.
      setNewContact(EMPTY_CONTACT);
      await loadContacts();
    } catch (e) {
      setContactNotice({
        ok: false,
        text: `Enregistrement refusé : ${e instanceof Error ? e.message : String(e)} — votre saisie est conservée.`,
      });
    } finally { setAddingContact(false); }
  };

  // Load a full deal into the editor forms.
  const openDeal = async (id: string) => {
    const { data: tx } = await supabase
      .from('transactions_admin')
      .select(`
        *,
        vehicle:vehicles_admin!transactions_admin_vehicle_id_fkey(*),
        seller:contacts!transactions_admin_seller_contact_id_fkey(*),
        seller2:contacts!transactions_admin_seller_contact_id_2_fkey(*),
        buyer:contacts!transactions_admin_buyer_contact_id_fkey(*),
        buyer2:contacts!transactions_admin_buyer_contact_id_2_fkey(*),
        supplier:contacts!transactions_admin_supplier_contact_id_fkey(*),
        client:contacts!transactions_admin_client_contact_id_fkey(*)
      `)
      .eq('id', id)
      .single();
    if (!tx) return;

    const dir = (tx.transaction_type as 'purchase' | 'sale') ?? 'purchase';
    setTransactionType(dir);
    setDealStatus((tx.status as 'en_cours' | 'cloturee') ?? 'en_cours');

    // The two persistent counterparties. Legacy deals (no columns) fall back to
    // whichever external party the active direction carried.
    const supplierC = (tx.supplier as unknown as Contact | null)
      ?? (dir === 'purchase' ? (tx.seller as unknown as Contact | null) : null);
    const clientC = (tx.client as unknown as Contact | null)
      ?? (dir === 'sale' ? (tx.buyer as unknown as Contact | null) : null);
    setSupplier(supplierC ? { form: contactToForm(supplierC), selected: supplierC } : emptyParty());
    setClient(clientC ? { form: contactToForm(clientC), selected: clientC } : emptyParty());

    const v = tx.vehicle as Record<string, unknown> | null;
    setVehicleForm({
      plate_number: (v?.plate_number as string) ?? '', vin: (v?.vin as string) ?? '',
      brand: (v?.brand as string) ?? '', model: (v?.model as string) ?? '',
      commercial_name: (v?.commercial_name as string) ?? '', type_variant_version: (v?.type_variant_version as string) ?? '',
      national_type: (v?.national_type as string) ?? '', first_registration_date: (v?.first_registration_date as string) ?? '',
      mileage: v?.mileage != null ? String(v.mileage) : '',
      registration_certificate_present: Boolean(v?.registration_certificate_present),
      registration_certificate_number: (v?.registration_certificate_number as string) ?? '',
      known_defects: (v?.known_defects as string) ?? '',
    });

    const seat = (c: Record<string, unknown> | null, setForm: (f: ContactForm) => void, setSel: (c: Contact | null) => void) => {
      if (c) { setForm(contactToForm(c as Contact)); setSel(c as Contact); }
      else { setForm(EMPTY_CONTACT); setSel(null); }
    };
    seat(tx.seller as Record<string, unknown> | null, setSellerForm, setSelectedSellerContact);
    seat(tx.buyer as Record<string, unknown> | null, setBuyerForm, setSelectedBuyerContact);
    seat(tx.seller2 as Record<string, unknown> | null, setSellerForm2, setSelectedSeller2Contact);
    seat(tx.buyer2 as Record<string, unknown> | null, setBuyerForm2, setSelectedBuyer2Contact);
    setShowSecondSeller(Boolean(tx.seller2));
    setShowSecondBuyer(Boolean(tx.buyer2));

    setTransactionForm({
      transaction_price: tx.transaction_price != null ? String(tx.transaction_price) : '',
      purchase_price: tx.purchase_price != null ? String(tx.purchase_price) : '',
      sale_price: tx.sale_price != null ? String(tx.sale_price) : '',
      fees: tx.fees != null ? String(tx.fees) : '',
      reference: tx.reference ?? '', commercial: tx.commercial ?? '', notes: tx.notes ?? '',
      transaction_date: tx.transaction_date ?? '', transaction_time: tx.transaction_time ?? '',
      pickup_location: tx.pickup_location ?? '', pickup_contact: tx.pickup_contact ?? '',
      pickup_datetime: tx.pickup_datetime ?? '', destination: tx.destination ?? '', transporter: tx.transporter ?? '',
    });

    setLastSavedTransactionId(id);
    setIsDirty(false);
    setMode('editor');
    window.scrollTo(0, 0);
  };

  // Quick create: one car = a supplier (MC buys from) + a client (MC sells to)
  // + a reference. The deal opens on the achat side; the vente side is ready to
  // switch to. No need to create two dossiers for the same car.
  const handleQuickCreate = async () => {
    if (!mcExport) return;
    setQuickSaving(true);
    try {
      const resolveParty = async (contactId: string, name: string, type: string): Promise<string | null> => {
        if (contactId) return contactId;
        if (name.trim()) {
          const { data: c } = await supabase
            .from('contacts')
            .insert({ type, company_name: name.trim(), country: 'FR' })
            .select('id').single();
          return c?.id ?? null;
        }
        return null;
      };
      const supplierId = await resolveParty(quick.supplierContactId, quick.supplierName, 'seller');
      const clientId = await resolveParty(quick.clientContactId, quick.clientName, 'buyer');
      // Active side = achat by default: seller = supplier, buyer = MC Export.
      const { data: tx, error } = await supabase
        .from('transactions_admin')
        .insert({
          transaction_type: 'purchase', status: 'en_cours',
          supplier_contact_id: supplierId, client_contact_id: clientId,
          seller_contact_id: supplierId, buyer_contact_id: mcExport.id,
          reference: quick.reference || null, commercial: quick.commercial || null,
        })
        .select('id').single();
      if (error || !tx) throw error ?? new Error('insert failed');
      setShowQuickCreate(false);
      setQuick({ supplierName: '', supplierContactId: '', clientName: '', clientContactId: '', reference: '', commercial: '' });
      await openDeal(tx.id);
    } catch (e) {
      setSaveMessage({ type: 'error', text: `Création impossible : ${getErrorMessage(e)}` });
    } finally {
      setQuickSaving(false);
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
      purchase_price: '',
      sale_price: '',
      fees: '',
      reference: '',
      commercial: '',
      notes: '',
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

      // Both external counterparties + active-direction seller/buyer, with
      // current form edits persisted onto the contacts (WYSIWYG in the docs).
      const { supplierId, clientId, sellerId, buyerId } = await resolveDealContacts();

      // Co-parties (rare) stay attached to the active-direction slots.
      let sellerContactId2: string | null = null;
      let buyerContactId2: string | null = null;
      if (showSecondSeller) {
        sellerContactId2 = await persistContactSlot(
          selectedSeller2Contact, sellerForm2, transactionType === 'purchase' ? 'seller' : 'buyer');
      }
      if (showSecondBuyer) {
        buyerContactId2 = await persistContactSlot(
          selectedBuyer2Contact, buyerForm2, transactionType === 'sale' ? 'buyer' : 'seller');
      }

      const { data: transactionData, error: transactionError } = await supabase
        .from('transactions_admin')
        .insert({
          transaction_type: transactionType,
          vehicle_id: vehicleData.id,
          seller_contact_id: sellerId,
          seller_contact_id_2: sellerContactId2,
          buyer_contact_id: buyerId,
          buyer_contact_id_2: buyerContactId2,
          supplier_contact_id: supplierId,
          client_contact_id: clientId,
          transaction_price: transactionForm.transaction_price ? parsePriceInput(transactionForm.transaction_price) : null,
          reference: transactionForm.reference || null,
          commercial: transactionForm.commercial || null,
          notes: transactionForm.notes || null,
          purchase_price: transactionForm.purchase_price ? parsePriceInput(transactionForm.purchase_price) : null,
          sale_price: transactionForm.sale_price ? parsePriceInput(transactionForm.sale_price) : null,
          fees: transactionForm.fees ? parsePriceInput(transactionForm.fees) : null,
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

      const vehiclePayload = {
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
      };

      // A quick-created deal has no vehicle yet — create one and link it.
      let linkedVehicleId = existingTransaction.vehicle_id as string | null;
      if (!linkedVehicleId) {
        const { data: newVehicle, error: newVehErr } = await supabase
          .from('vehicles_admin').insert(vehiclePayload).select('id').single();
        if (newVehErr) throw newVehErr;
        linkedVehicleId = newVehicle.id;
        await supabase.from('transactions_admin').update({ vehicle_id: linkedVehicleId }).eq('id', lastSavedTransactionId);
      } else {
        const { error: vehicleError } = await supabase
          .from('vehicles_admin').update(vehiclePayload).eq('id', linkedVehicleId);
        if (vehicleError) throw vehicleError;
      }

      // Both external counterparties + active-direction seller/buyer, with
      // current form edits persisted onto the contacts (WYSIWYG in the docs).
      const { supplierId, clientId, sellerId, buyerId } = await resolveDealContacts();

      let sellerContactId2: string | null = null;
      let buyerContactId2: string | null = null;
      if (showSecondSeller) {
        sellerContactId2 = await persistContactSlot(
          selectedSeller2Contact, sellerForm2, transactionType === 'purchase' ? 'seller' : 'buyer');
      }
      if (showSecondBuyer) {
        buyerContactId2 = await persistContactSlot(
          selectedBuyer2Contact, buyerForm2, transactionType === 'sale' ? 'buyer' : 'seller');
      }

      const { error: transactionError } = await supabase
        .from('transactions_admin')
        .update({
          transaction_type: transactionType,
          seller_contact_id: sellerId,
          seller_contact_id_2: sellerContactId2,
          buyer_contact_id: buyerId,
          buyer_contact_id_2: buyerContactId2,
          supplier_contact_id: supplierId,
          client_contact_id: clientId,
          transaction_price: transactionForm.transaction_price ? parsePriceInput(transactionForm.transaction_price) : null,
          reference: transactionForm.reference || null,
          commercial: transactionForm.commercial || null,
          notes: transactionForm.notes || null,
          purchase_price: transactionForm.purchase_price ? parsePriceInput(transactionForm.purchase_price) : null,
          sale_price: transactionForm.sale_price ? parsePriceInput(transactionForm.sale_price) : null,
          fees: transactionForm.fees ? parsePriceInput(transactionForm.fees) : null,
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

  // Un montant saisi à la française (« 12 500 », « 12500,50 ») passait par
  // parseFloat nu : l'espace coupait à 12, la virgule à 12500 — des montants
  // FAUX selon l'habitude de frappe de l'utilisateur (signalement Antoine
  // 21/08, famille « bug d'une machine à l'autre »). Espaces (insécables
  // compris) retirés, virgule décimale acceptée ; « 12500 » inchangé.
  const parsePriceInput = (raw: string): number | null => {
    const s = raw.replace(/[\s  ]/g, '').replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
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
    } else {
      // TOUJOURS resynchroniser avant de générer — plus de condition isDirty.
      // Signalement Antoine 21/08 (« montant total : € » vide) : la
      // restauration du BROUILLON local remettait isDirty à false — l'écran
      // montrait le prix (brouillon localStorage), la base ne l'avait pas,
      // et l'aperçu « sans mise à jour nécessaire » sortait un document vide.
      // Bug par machine puisque le brouillon vit dans le navigateur. Le
      // document doit refléter CE QUE L'OPÉRATEUR VOIT : l'update WYSIWYG
      // est idempotent, son coût est un écrire redondant au pire.
      console.log('[ADMIN_GEN] Syncing form → transaction before generation, id=', transactionId);
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
          <div className="mt-2 border border-slate-300 rounded-lg bg-white p-4">
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                placeholder="Search by name, company, or SIREN..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 px-3 py-2 bg-slate-200 border border-slate-300 rounded text-sm focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => {
                  setShow(false);
                  setSearchQuery('');
                }}
                className="p-2 hover:bg-slate-200 rounded transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-2">
              {filteredContacts.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">No contacts found</p>
              ) : (
                filteredContacts.map((contact) => (
                  <button
                    key={contact.id}
                    onClick={() => onSelect(contact)}
                    className="w-full text-left px-3 py-2 bg-slate-200 hover:bg-slate-300 rounded transition-colors"
                  >
                    <div className="text-sm font-medium">
                      {contact.company_name || `${contact.first_name} ${contact.last_name}`}
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5">
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
    _label: string,
    savingState: boolean,
    setSavingState: (val: boolean) => void,
    role: 'seller' | 'buyer',
    // Co-titulaire carte grise : l'adresse est CELLE du titulaire principal
    // (même carte grise) — seule l'identité est demandée (Channing 28/08).
    compact = false
  ) => {
    return (
      <div className="space-y-4">
        {selectedContact && (
          <div className="px-3 py-2 bg-blue-50 border border-blue-300 rounded text-sm">
            Using existing contact: <span className="font-medium">
              {selectedContact.company_name || `${selectedContact.first_name} ${selectedContact.last_name}`}
            </span>
          </div>
        )}

        {compact && (
          <p className="text-xs text-slate-500">
            Même adresse que le titulaire principal (carte grise) — seule l'identité est nécessaire.
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        <div>
          <label className="block text-sm font-medium mb-1 text-slate-700">Company Name</label>
          <input
            type="text"
            value={form.company_name}
            onChange={(e) => setForm({ ...form, company_name: e.target.value })}
            className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        {!compact && <div>
          <label className="block text-sm font-medium mb-1 text-slate-700">SIREN</label>
          <input
            type="text"
            value={form.siren}
            onChange={(e) => setForm({ ...form, siren: e.target.value })}
            className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
          />
        </div>}

        <div>
          <label className="block text-sm font-medium mb-1 text-slate-700">First Name</label>
          <input
            type="text"
            value={form.first_name}
            onChange={(e) => setForm({ ...form, first_name: e.target.value })}
            className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-slate-700">Last Name</label>
          <input
            type="text"
            value={form.last_name}
            onChange={(e) => setForm({ ...form, last_name: e.target.value })}
            className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        {!compact && <><div>
          <label className="block text-sm font-medium mb-1 text-slate-700">Birth Date</label>
          <input
            type="date"
            value={form.birth_date}
            onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
            className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-slate-700">Birth Place</label>
          <input
            type="text"
            value={form.birth_place}
            onChange={(e) => setForm({ ...form, birth_place: e.target.value })}
            className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1 text-slate-700">Address Line 1</label>
          <input
            type="text"
            value={form.address_line1}
            onChange={(e) => setForm({ ...form, address_line1: e.target.value })}
            className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1 text-slate-700">Address Line 2</label>
          <input
            type="text"
            value={form.address_line2}
            onChange={(e) => setForm({ ...form, address_line2: e.target.value })}
            className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-slate-700">Postal Code</label>
          <input
            type="text"
            value={form.postal_code}
            onChange={(e) => setForm({ ...form, postal_code: e.target.value })}
            className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-slate-700">City</label>
          <input
            type="text"
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
            className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-slate-700">Country</label>
          <input
            type="text"
            value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })}
            className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
          />
        </div></>}
        </div>

        <button
          onClick={() => saveContactAs(form, selectedContact, setSavingState, role)}
          disabled={savingState}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 rounded-lg transition-colors text-sm font-medium"
        >
          <UserPlus size={16} />
          {savingState ? 'Saving...' : selectedContact ? 'Update Contact' : 'Save as Contact'}
        </button>
      </div>
    );
  };

  // Read-only card for MC Export's own side — it's us, never retyped.
  const renderMcCard = (role: 'acheteur' | 'vendeur') => (
    <div className="rounded-lg border border-blue-300 bg-blue-50 p-4">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-blue-800">{MC_EXPORT_FORM.company_name}</span>
        <span className="text-[11px] uppercase tracking-wide text-blue-600/80">{role} · vous</span>
      </div>
      <div className="mt-1 text-sm text-slate-600 space-y-0.5">
        <div>{MC_EXPORT_FORM.address_line1}</div>
        <div>{MC_EXPORT_FORM.postal_code} {MC_EXPORT_FORM.city} · {MC_EXPORT_FORM.country}</div>
        <div className="text-slate-500">SIREN {MC_EXPORT_FORM.siren}</div>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Pré-rempli automatiquement dans les documents.</p>
    </div>
  );

  // ─── Deals list view ──────────────────────────────────────────────────────
  const dealClient = (d: DealRow) =>
    d.transaction_type === 'purchase' ? contactLabel(d.seller) : contactLabel(d.buyer);
  const eur = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('fr-FR')} €`);

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const enCours = deals.filter((d) => d.status !== 'cloturee');
  const cloturees = deals.filter((d) => d.status === 'cloturee');

  const dealMargin = (d: DealRow) => (d.sale_price ?? 0) - (d.purchase_price ?? 0) - (d.fees ?? 0);
  const sum = (arr: DealRow[], f: (d: DealRow) => number) => arr.reduce((s, d) => s + (f(d) || 0), 0);

  // KPIs
  const caEnCours = sum(enCours, (d) => d.sale_price ?? 0);
  const margeEnCours = sum(enCours, dealMargin);
  const closedThisMonth = cloturees.filter((d) => d.closed_at && new Date(d.closed_at).getTime() >= startOfMonth);
  const caMois = sum(closedThisMonth, (d) => d.sale_price ?? 0);
  const margeMois = sum(closedThisMonth, dealMargin);

  // Closed deals grouped by month label (Décembre 2026…), most recent first.
  const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
  const historique = new Map<string, DealRow[]>();
  for (const d of cloturees) {
    const dt = d.closed_at ? new Date(d.closed_at) : new Date(d.created_at);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    (historique.get(key) ?? historique.set(key, []).get(key)!).push(d);
  }
  const historiqueMonths = [...historique.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  const renderDealRow = (d: DealRow) => {
    const veh = d.vehicle ? [d.vehicle.brand, d.vehicle.model].filter(Boolean).join(' ') || d.vehicle.plate_number || '—' : '—';
    const closed = d.status === 'cloturee';
    return (
      <tr key={d.id} className="border-t border-slate-200 hover:bg-slate-100">
        <td className="px-3 py-2.5">
          <button onClick={() => openDeal(d.id)} className="text-blue-600 hover:text-blue-700 font-medium">
            {d.reference || '—'}
          </button>
        </td>
        <td className="px-3 py-2.5 text-slate-600">
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${d.transaction_type === 'purchase' ? 'bg-emerald-50 text-emerald-700' : 'bg-violet-50 text-violet-700'}`}>
            {d.transaction_type === 'purchase' ? 'Achat' : 'Vente'}
          </span>
        </td>
        <td className="px-3 py-2.5 text-slate-800 truncate max-w-[180px]">{dealClient(d)}</td>
        <td className="px-3 py-2.5 text-slate-600 truncate max-w-[160px]">{veh}</td>
        <td className="px-3 py-2.5 text-slate-700">{eur(d.transaction_price)}</td>
        <td className="px-3 py-2.5 text-slate-600">{d.commercial || '—'}</td>
        <td className="px-3 py-2.5 text-slate-500 text-xs">{(d.transaction_date || d.created_at || '').slice(0, 10)}</td>
        <td className="px-3 py-2.5 text-right">
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => openDeal(d.id)} className="text-xs text-slate-700 hover:text-slate-900">Ouvrir</button>
            <button
              onClick={() => closeDeal(d.id, !closed)}
              className={`text-xs ${closed ? 'text-amber-600 hover:text-amber-700' : 'text-emerald-600 hover:text-emerald-700'}`}
            >
              {closed ? 'Rouvrir' : 'Clôturer'}
            </button>
            <button
              onClick={() => deleteDeal(d.id)}
              className="text-xs text-slate-400 hover:text-red-600"
              title="Supprimer la vente"
            >
              Suppr.
            </button>
          </div>
        </td>
      </tr>
    );
  };

  const renderDealsTable = (title: string, rows: DealRow[], accent: string) => (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {title && (
        <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-200">
          <span className={`w-2 h-2 rounded-full ${accent}`} />
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <span className="text-xs text-slate-500">· {rows.length}</span>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-400">Aucune vente.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-medium">Réf.</th>
                <th className="px-3 py-2 font-medium">Sens</th>
                <th className="px-3 py-2 font-medium">Client</th>
                <th className="px-3 py-2 font-medium">Véhicule</th>
                <th className="px-3 py-2 font-medium">Prix</th>
                <th className="px-3 py-2 font-medium">Commercial</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>{rows.map(renderDealRow)}</tbody>
          </table>
        </div>
      )}
    </section>
  );

  const kpi = (label: string, value: string, sub?: string, accent = 'text-slate-900') => (
    <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${accent}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );

  const renderDealsList = () => (
    <div className="space-y-6">
      {/* Tableau de bord */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpi("Chiffre d'affaires en cours", eur(caEnCours), `${enCours.length} vente${enCours.length > 1 ? 's' : ''} en cours`, 'text-blue-700')}
        {kpi('Marge en cours (est.)', eur(margeEnCours), 'vente − achat − frais')}
        {kpi("CA du mois", eur(caMois), `${closedThisMonth.length} vente${closedThisMonth.length > 1 ? 's' : ''} clôturée${closedThisMonth.length > 1 ? 's' : ''}`, 'text-emerald-700')}
        {kpi('Marge du mois', eur(margeMois), monthFmt.format(now))}
      </div>

      {dealsLoading && <p className="text-sm text-slate-500">Chargement…</p>}

      {renderDealsTable('Ventes en cours', enCours, 'bg-blue-400')}

      {/* Historique mensuel */}
      {historiqueMonths.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xs uppercase tracking-wide text-slate-500 pt-2">Historique</h2>
          {historiqueMonths.map(([key, rows]) => {
            const [y, m] = key.split('-').map(Number);
            const label = monthFmt.format(new Date(y, m - 1, 1));
            const caMonth = sum(rows, (d) => d.sale_price ?? 0);
            return (
              <div key={key} className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-sm font-medium text-slate-700 capitalize">{label}</span>
                  <span className="text-xs text-slate-500">CA {eur(caMonth)} · {rows.length} vente{rows.length > 1 ? 's' : ''}</span>
                </div>
                {renderDealsTable('', rows, 'bg-slate-400')}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const quickPartyPicker = (
    label: string, hint: string, contactId: string, name: string,
    onPick: (id: string) => void, onName: (n: string) => void,
  ) => (
    <div>
      <label className="block text-xs text-slate-600 mb-1">{label} <span className="text-slate-400">· {hint}</span></label>
      <select
        value={contactId}
        onChange={(e) => { onPick(e.target.value); onName(''); }}
        className="w-full mb-2 px-3 py-2 bg-slate-200 border border-slate-300 rounded text-sm"
      >
        <option value="">— nouveau contact (saisir le nom) —</option>
        {contacts.filter((c) => c.id !== mcExport?.id).map((c) => (
          <option key={c.id} value={c.id}>{c.company_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()}</option>
        ))}
      </select>
      {!contactId && (
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Nom / société"
          className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded text-sm"
        />
      )}
    </div>
  );

  const renderQuickCreate = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowQuickCreate(false)}>
      <div className="bg-white border border-slate-300 rounded-xl p-6 w-full max-w-lg space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Nouveau dossier</h2>
          <p className="text-xs text-slate-500 mt-0.5">Une voiture, deux contreparties. MC Export achète au fournisseur puis revend au client — un seul dossier pour les deux côtés.</p>
        </div>
        {quickPartyPicker(
          'Fournisseur (vendeur)', 'MC Export lui achète',
          quick.supplierContactId, quick.supplierName,
          (id) => setQuick((q) => ({ ...q, supplierContactId: id })),
          (n) => setQuick((q) => ({ ...q, supplierName: n })),
        )}
        {quickPartyPicker(
          'Client (acheteur)', 'MC Export lui revend',
          quick.clientContactId, quick.clientName,
          (id) => setQuick((q) => ({ ...q, clientContactId: id })),
          (n) => setQuick((q) => ({ ...q, clientName: n })),
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-600 mb-1">Référence</label>
            <input value={quick.reference} onChange={(e) => setQuick((q) => ({ ...q, reference: e.target.value }))} placeholder="I63" className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Commercial</label>
            <input value={quick.commercial} onChange={(e) => setQuick((q) => ({ ...q, commercial: e.target.value }))} list="commercial-list" className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded text-sm" />
            <datalist id="commercial-list">{commercialNames.map((n) => <option key={n} value={n} />)}</datalist>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button onClick={() => setShowQuickCreate(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Annuler</button>
          <button
            onClick={handleQuickCreate}
            disabled={quickSaving || (!quick.supplierContactId && !quick.supplierName.trim() && !quick.clientContactId && !quick.clientName.trim() && !quick.reference.trim())}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white"
          >
            {quickSaving ? 'Création…' : 'Créer et ouvrir'}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          {mode === 'editor' && (
            <button onClick={backToList} className="text-slate-600 hover:text-slate-900 text-sm flex items-center gap-1">
              ← Ventes
            </button>
          )}
          <h1 className="text-3xl font-bold">{mode === 'list' ? 'Ventes' : 'Fiche vente'}</h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setSettingsOpen((v) => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors font-medium ${
              settingsOpen ? 'bg-slate-300 text-white' : 'bg-slate-200 hover:bg-slate-300'
            }`}
          >
            <UserPlus size={18} />
            Contacts
          </button>
          {mode === 'list' ? (
            <button
              onClick={() => { setShowQuickCreate(true); setQuick({ supplierName: '', supplierContactId: '', clientName: '', clientContactId: '', reference: '', commercial: '' }); }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors font-medium"
            >
              <Plus size={18} />
              Nouvelle vente
            </button>
          ) : (
            <button
              onClick={handleClearForm}
              className="flex items-center gap-2 px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg transition-colors font-medium"
            >
              <Trash2 size={18} />
              Vider
            </button>
          )}
          <button
            onClick={() => { window.history.pushState({}, '', '/admin/history'); }}
            className="flex items-center gap-2 px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg transition-colors font-medium"
          >
            <History size={18} />
            Historique
          </button>
        </div>
      </div>

      {settingsOpen && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Contacts enregistrés</h2>
              <p className="text-sm text-slate-500">Faites le propre : supprimez les doublons. MC Export ne peut pas être supprimé.</p>
            </div>
            <span className="text-sm text-slate-500">{contacts.length} contact(s)</span>
          </div>

          {/* Ajout / modification d'un contact */}
          <div className={`mb-5 p-4 border rounded-lg space-y-3 ${editingContactId ? 'bg-blue-50 border-blue-300' : 'bg-slate-100 border-slate-200'}`}>
            <p className="text-sm font-medium text-slate-700">
              {editingContactId ? 'Modifier le contact' : 'Ajouter un contact'}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                value={newContact.company_name}
                onChange={(e) => setNewContact((c) => ({ ...c, company_name: e.target.value }))}
                placeholder="Société"
                className="px-3 py-2 bg-white border border-slate-300 rounded text-sm"
              />
              <input
                value={newContact.first_name}
                onChange={(e) => setNewContact((c) => ({ ...c, first_name: e.target.value }))}
                placeholder="Prénom"
                className="px-3 py-2 bg-white border border-slate-300 rounded text-sm"
              />
              <input
                value={newContact.last_name}
                onChange={(e) => setNewContact((c) => ({ ...c, last_name: e.target.value }))}
                placeholder="Nom"
                className="px-3 py-2 bg-white border border-slate-300 rounded text-sm"
              />
              <input
                value={newContact.address_line1}
                onChange={(e) => setNewContact((c) => ({ ...c, address_line1: e.target.value }))}
                placeholder="Adresse"
                className="px-3 py-2 bg-white border border-slate-300 rounded text-sm md:col-span-3"
              />
              <input
                value={newContact.postal_code}
                onChange={(e) => setNewContact((c) => ({ ...c, postal_code: e.target.value }))}
                placeholder="Code postal"
                className="px-3 py-2 bg-white border border-slate-300 rounded text-sm"
              />
              <input
                value={newContact.city}
                onChange={(e) => setNewContact((c) => ({ ...c, city: e.target.value }))}
                placeholder="Ville"
                className="px-3 py-2 bg-white border border-slate-300 rounded text-sm"
              />
              <input
                value={newContact.siren}
                onChange={(e) => setNewContact((c) => ({ ...c, siren: e.target.value }))}
                placeholder="SIREN (optionnel)"
                className="px-3 py-2 bg-white border border-slate-300 rounded text-sm"
              />
            </div>
            {/* Retour d'écriture explicite : succès confirmé, échec expliqué et
                saisie conservée — plus de clic dans le vide. */}
            {contactNotice && (
              <p className={`text-sm ${contactNotice.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                {contactNotice.text}
              </p>
            )}
            <div className="flex items-center justify-end gap-3">
              {/* La condition du bouton est ÉCRITE, plus seulement subie. */}
              {!newContact.company_name && !newContact.first_name && !newContact.last_name && (
                <span className="text-xs text-slate-500">Renseignez au moins une Société, un Prénom ou un Nom.</span>
              )}
              {editingContactId && (
                <button onClick={cancelEditContact} className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900">
                  Annuler
                </button>
              )}
              <button
                onClick={addContact}
                disabled={addingContact || (!newContact.company_name && !newContact.first_name && !newContact.last_name)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg text-sm font-medium text-white"
              >
                <Plus size={16} />
                {addingContact ? 'Enregistrement…' : editingContactId ? 'Enregistrer' : 'Ajouter'}
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-slate-200">
            {contacts.length === 0 && <p className="text-sm text-slate-500 py-4">Aucun contact pour l'instant.</p>}
            {contacts.map((c) => {
              const isMc = c.id === mcExport?.id || c.siren === MC_EXPORT_SIREN;
              const name = c.company_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '(sans nom)';
              const loc = [c.postal_code, c.city].filter(Boolean).join(' ');
              return (
                <div key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm text-slate-800 truncate flex items-center gap-2">
                      {name}
                      {isMc && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">MC Export</span>}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {[c.address_line1, loc, c.siren && `SIREN ${c.siren}`].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-4">
                    {/* Modifiable même pour MC Export : corriger une adresse ou
                        un SIREN est légitime, seule la SUPPRESSION reste
                        interdite pour lui. */}
                    <button
                      onClick={() => startEditContact(c)}
                      className={`flex items-center gap-1 text-xs ${
                        editingContactId === c.id ? 'text-blue-700 font-medium' : 'text-blue-600 hover:text-blue-700'
                      }`}
                    >
                      <Pencil size={14} /> {editingContactId === c.id ? 'En cours…' : 'Modifier'}
                    </button>
                    {!isMc && (
                      <button
                        onClick={() => deleteContact(c.id)}
                        disabled={deletingContactId === c.id}
                        className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        <Trash2 size={14} /> Supprimer
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {saveMessage && (
        <div className={`mb-6 px-4 py-3 rounded-lg ${
          saveMessage.type === 'success'
            ? 'bg-green-50 border border-green-300 text-green-800'
            : saveMessage.type === 'info'
            ? 'bg-blue-50 border border-blue-300 text-blue-800'
            : 'bg-red-50 border border-red-300 text-red-800'
        }`}>
          {saveMessage.text}
        </div>
      )}

      {mode === 'list' && renderDealsList()}
      {showQuickCreate && renderQuickCreate()}

      {mode === 'editor' && (
      <>
      {/* Bandeau suivi de la vente : réf, statut, commercial, notes */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 mb-8 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${dealStatus === 'cloturee' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
            {dealStatus === 'cloturee' ? 'Clôturée' : 'En cours'}
          </span>
          {transactionForm.reference && <span className="text-sm text-slate-700 font-medium">Réf. {transactionForm.reference}</span>}
          <span className="flex-1" />
          {lastSavedTransactionId && (
            <button
              onClick={() => closeDeal(lastSavedTransactionId, dealStatus !== 'cloturee')}
              className={`text-sm px-3 py-1.5 rounded-lg ${dealStatus === 'cloturee' ? 'bg-slate-200 hover:bg-slate-300 text-amber-700' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}
            >
              {dealStatus === 'cloturee' ? 'Rouvrir la vente' : 'Clôturer la vente'}
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700">Commercial</label>
            <input
              value={transactionForm.commercial}
              onChange={(e) => updateTransactionForm({ commercial: e.target.value })}
              list="commercial-list-editor"
              className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
            />
            <datalist id="commercial-list-editor">{commercialNames.map((n) => <option key={n} value={n} />)}</datalist>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1 text-slate-700">Notes</label>
            <textarea
              value={transactionForm.notes}
              onChange={(e) => updateTransactionForm({ notes: e.target.value })}
              rows={2}
              placeholder="Notes internes sur la vente…"
              className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </section>

      <div className="space-y-8">
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4 text-slate-900">Vehicle Information</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Plate Number</label>
              <input
                type="text"
                value={vehicleForm.plate_number}
                onChange={(e) => updateVehicleForm({ plate_number: e.target.value })}
                className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">VIN</label>
              <input
                type="text"
                value={vehicleForm.vin}
                onChange={(e) => updateVehicleForm({ vin: e.target.value })}
                className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Brand</label>
              <input
                type="text"
                value={vehicleForm.brand}
                onChange={(e) => updateVehicleForm({ brand: e.target.value })}
                className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Model</label>
              <input
                type="text"
                value={vehicleForm.model}
                onChange={(e) => updateVehicleForm({ model: e.target.value })}
                className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Commercial Name</label>
              <input
                type="text"
                value={vehicleForm.commercial_name}
                onChange={(e) => updateVehicleForm({ commercial_name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Type / Variant / Version</label>
              <input
                type="text"
                value={vehicleForm.type_variant_version}
                onChange={(e) => updateVehicleForm({ type_variant_version: e.target.value })}
                className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">National Type</label>
              <input
                type="text"
                value={vehicleForm.national_type}
                onChange={(e) => updateVehicleForm({ national_type: e.target.value })}
                className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">First Registration Date</label>
              <input
                type="date"
                value={vehicleForm.first_registration_date}
                onChange={(e) => updateVehicleForm({ first_registration_date: e.target.value })}
                className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Mileage</label>
              <input
                type="number"
                value={vehicleForm.mileage}
                onChange={(e) => updateVehicleForm({ mileage: e.target.value })}
                className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center gap-3 pt-7">
              <input
                type="checkbox"
                id="registration-cert"
                checked={vehicleForm.registration_certificate_present}
                onChange={(e) => updateVehicleForm({ registration_certificate_present: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 bg-slate-200 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="registration-cert" className="text-sm font-medium text-slate-700">
                Registration Certificate Present
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Registration Certificate Number</label>
              <input
                type="text"
                value={vehicleForm.registration_certificate_number}
                onChange={(e) => updateVehicleForm({ registration_certificate_number: e.target.value })}
                className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1 text-slate-700">Known Defects</label>
              <textarea
                value={vehicleForm.known_defects}
                onChange={(e) => updateVehicleForm({ known_defects: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-1 text-slate-900">Le dossier</h2>
          <p className="text-sm text-slate-500 mb-4">Une voiture, deux côtés. Basculez entre l'achat (au fournisseur) et la vente (au client) — les deux contreparties sont conservées et les documents suivent.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => updateTransactionType('purchase')}
              className={`text-left px-5 py-4 rounded-xl border transition-colors ${
                transactionType === 'purchase'
                  ? 'bg-blue-100 border-blue-500 text-white'
                  : 'bg-slate-100 border-slate-300 text-slate-600 hover:border-slate-300'
              }`}
            >
              <div className="font-semibold flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${transactionType === 'purchase' ? 'bg-blue-400' : 'bg-slate-400'}`} />
                Côté achat — MC Export achète
              </div>
              <div className="text-xs mt-1 text-slate-500">Au fournisseur{supplier.selected || supplier.form.company_name ? ` · ${supplier.selected ? contactLabel(supplier.selected) : supplier.form.company_name}` : ''} · Cession, Bon d'achat, Enlèvement, Déclaration d'achat</div>
            </button>
            <button
              onClick={() => updateTransactionType('sale')}
              className={`text-left px-5 py-4 rounded-xl border transition-colors ${
                transactionType === 'sale'
                  ? 'bg-blue-100 border-blue-500 text-white'
                  : 'bg-slate-100 border-slate-300 text-slate-600 hover:border-slate-300'
              }`}
            >
              <div className="font-semibold flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${transactionType === 'sale' ? 'bg-blue-400' : 'bg-slate-400'}`} />
                Côté vente — MC Export vend
              </div>
              <div className="text-xs mt-1 text-slate-500">Au client{client.selected || client.form.company_name ? ` · ${client.selected ? contactLabel(client.selected) : client.form.company_name}` : ''} · Cession, Réception / Expédition</div>
            </button>
          </div>

          {/* Prix du document + Référence */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Prix du document (€)</label>
              <input
                type="number"
                step="0.01"
                value={transactionForm.transaction_price}
                onChange={(e) => updateTransactionForm({ transaction_price: e.target.value })}
                placeholder="9 500"
                className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-slate-500">Montant reporté sur les documents (cession, bon d'achat…). Laissé vide, le prix d'achat ou de vente des Tarifs est utilisé selon le sens du deal.</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Référence <span className="text-slate-500 font-normal">(votre code, ex. I63, TGE789)</span></label>
              <input
                type="text"
                value={transactionForm.reference}
                onChange={(e) => updateTransactionForm({ reference: e.target.value })}
                placeholder="I63"
                className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Tarifs — achat / vente / frais / marge */}
          {(() => {
            const p = parseFloat(transactionForm.purchase_price) || 0;
            const s = parseFloat(transactionForm.sale_price) || 0;
            const f = parseFloat(transactionForm.fees) || 0;
            const marge = s - p - f;
            const hasAny = transactionForm.purchase_price || transactionForm.sale_price || transactionForm.fees;
            return (
              <div className="mt-6 pt-5 border-t border-slate-200">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Tarifs</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1 text-slate-700">Prix d'achat (€)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={transactionForm.purchase_price}
                      onChange={(e) => updateTransactionForm({ purchase_price: e.target.value })}
                      placeholder="8 000"
                      className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 text-slate-700">Prix de vente (€)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={transactionForm.sale_price}
                      onChange={(e) => updateTransactionForm({ sale_price: e.target.value })}
                      placeholder="9 500"
                      className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 text-slate-700">Frais (€)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={transactionForm.fees}
                      onChange={(e) => updateTransactionForm({ fees: e.target.value })}
                      placeholder="300"
                      className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                {hasAny && (
                  <div className={`mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${marge >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    Marge : {marge.toLocaleString('fr-FR')} €
                    <span className="text-xs font-normal text-slate-600">(vente − achat − frais)</span>
                  </div>
                )}
              </div>
            );
          })()}
        </section>

        {/* ─── Vendeur ─────────────────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4 text-slate-900">
            {transactionType === 'sale' ? 'Vendeur — MC Export (vous)' : 'Vendeur — le fournisseur (vous lui achetez)'}
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
                    className="flex items-center gap-2 px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg transition-colors text-sm"
                  >
                    <Plus size={16} /> Ajouter un co-vendeur
                  </button>
                ) : (
                  <div className="border-t border-slate-200 pt-4 mt-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-medium text-slate-800">Co-vendeur</h3>
                      <button
                        onClick={() => { toggleShowSecondSeller(false); setSelectedSeller2Contact(null); setSellerForm2(EMPTY_CONTACT); }}
                        className="p-1 hover:bg-slate-200 rounded transition-colors"
                      >
                        <X size={18} />
                      </button>
                    </div>
                    {renderContactSearch(showSeller2Search, setShowSeller2Search, (contact) => selectContact(contact, 'seller2'), 'Rechercher un contact existant')}
                    {renderContactFields(sellerForm2, setSellerForm2, selectedSeller2Contact, 'Co-vendeur', savingSeller2Contact, setSavingSeller2Contact, 'seller', true)}
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        {/* ─── Acheteur ────────────────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4 text-slate-900">
            {transactionType === 'purchase' ? 'Acheteur — MC Export (vous)' : 'Acheteur — le client (vous lui vendez)'}
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
                    className="flex items-center gap-2 px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg transition-colors text-sm"
                  >
                    <Plus size={16} /> Ajouter un co-acheteur
                  </button>
                ) : (
                  <div className="border-t border-slate-200 pt-4 mt-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-medium text-slate-800">Co-acheteur</h3>
                      <button
                        onClick={() => { toggleShowSecondBuyer(false); setSelectedBuyer2Contact(null); setBuyerForm2(EMPTY_CONTACT); }}
                        className="p-1 hover:bg-slate-200 rounded transition-colors"
                      >
                        <X size={18} />
                      </button>
                    </div>
                    {renderContactSearch(showBuyer2Search, setShowBuyer2Search, (contact) => selectContact(contact, 'buyer2'), 'Rechercher un contact existant')}
                    {renderContactFields(buyerForm2, setBuyerForm2, selectedBuyer2Contact, 'Co-acheteur', savingBuyer2Contact, setSavingBuyer2Contact, 'buyer', true)}
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4 text-slate-900">Date de la transaction</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Transaction Date</label>
              <input
                type="date"
                value={transactionForm.transaction_date}
                onChange={(e) => updateTransactionForm({ transaction_date: e.target.value })}
                className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Transaction Time</label>
              <input
                type="time"
                value={transactionForm.transaction_time}
                onChange={(e) => updateTransactionForm({ transaction_time: e.target.value })}
                className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </section>

        {transactionType === 'purchase' && (
          <section className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4 text-slate-900">Pickup</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700">Pickup Location</label>
                <input
                  type="text"
                  value={transactionForm.pickup_location}
                  onChange={(e) => updateTransactionForm({ pickup_location: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700">Pickup Contact <span className="text-slate-500 font-normal">(nom, prénom, téléphone)</span></label>
                <input
                  type="text"
                  value={transactionForm.pickup_contact}
                  onChange={(e) => updateTransactionForm({ pickup_contact: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 text-slate-700">Pickup Date & Time</label>
                <input
                  type="datetime-local"
                  value={transactionForm.pickup_datetime}
                  onChange={(e) => updateTransactionForm({ pickup_datetime: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </section>
        )}

        {transactionType === 'sale' && (
          <section className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4 text-slate-900">Delivery</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Lieu de la vente → « Fait à » du certificat de cession. Même
                  champ de données que le lieu de signature côté achat
                  (pickup_location), qui n'était saisissable QUE côté achat —
                  une vente laissait le « Fait à » vide (signalement 21/07). */}
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 text-slate-700">
                  Lieu de la vente <span className="text-slate-500">(« Fait à » du certificat de cession)</span>
                </label>
                <input
                  type="text"
                  value={transactionForm.pickup_location}
                  onChange={(e) => updateTransactionForm({ pickup_location: e.target.value })}
                  placeholder="ANGERS"
                  className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700">Destination</label>
                <input
                  type="text"
                  value={transactionForm.destination}
                  onChange={(e) => updateTransactionForm({ destination: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700">Transporter</label>
                <input
                  type="text"
                  value={transactionForm.transporter}
                  onChange={(e) => updateTransactionForm({ transporter: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-200 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </section>
        )}

        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-1">
            <FileText className="text-blue-500" size={24} />
            <h2 className="text-xl font-semibold text-slate-900">Documents</h2>
          </div>
          <p className="text-sm text-slate-500 mb-6">
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
                className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-200 hover:bg-slate-300 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed rounded-lg transition-colors font-medium border border-slate-300"
              >
                {generatingDoc === doc ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-slate-400 border-t-transparent rounded-full"></div>
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
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">
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
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  Fermer
                </button>
              </div>
            </div>
            {docPreview.missing.length > 0 ? (
              <div className="text-xs space-y-1.5">
                <p className="text-amber-600 font-medium">
                  {docPreview.missing.length} champ(s) vide(s) sur ce document — complétez le formulaire puis régénérez :
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {docPreview.missing.map((m) => (
                    <span key={m} className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">{m}</span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-emerald-600">Toutes les données attendues étaient présentes.</p>
            )}
            <iframe
              src={docPreview.url}
              title={`Aperçu ${docPreview.docType}`}
              className="w-full rounded-lg border border-slate-200 bg-white"
              style={{ height: 560 }}
            />
          </section>
        )}
      </div>
      </>
      )}
    </div>
  );
}
