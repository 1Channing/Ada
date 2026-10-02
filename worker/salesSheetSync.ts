/**
 * SYNCHRO TABLEUR DE VENTES (Google Sheets → ADA), sens unique.
 *
 * Structure PROUVÉE sur le classeur réel (McExport_Tab.xlsx, 27/07/2026) :
 *   - un onglet par MOIS (« AOUT 2025 » … « JUILLET 2026 ») ;
 *   - l'en-tête est la ligne contenant « REF » (ligne 2 en pratique) ;
 *   - les colonnes CHANGENT d'ordre et de nom selon les mois (DOUANE/DOUANES,
 *     ACOMPTE/RÉCUPERER apparaissent, « FACTURE » existe en double : n° FACxxx
 *     et case à cocher) → lecture par NOM d'en-tête, jamais par position ;
 *   - une ligne = une vente, identifiée par REF (YC575, BM191…).
 *
 * Règles anti-duplication (demande Channing) :
 *   - clé = REF ↔ transactions_admin.reference : une REF déjà présente dans
 *     ADA n'est JAMAIS réinsérée ni modifiée (le dossier ADA fait foi) ;
 *   - import « nouvelles lignes seulement », le tableur n'est jamais écrit.
 *
 * BRANCHEMENT (2 choses) :
 *   1. Railway `GOOGLE_SERVICE_ACCOUNT_JSON` = clé JSON d'un compte de
 *      service (API Sheets activée), tableur partagé avec son email en
 *      lecture.
 *   2. app_config 'gsheet_sales' :
 *      { "spreadsheetId": "…", "sinceMonth": "2026-07" }
 *      sinceMonth = premier onglet mensuel importé (évite de dupliquer les
 *      dossiers historiques déjà saisis dans ADA sans référence).
 */
import { createSign } from 'node:crypto';
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';
import { recordLearningCase, resolveLearningCase } from './learningBox';

const POLL_MS = 10 * 60 * 1000;

const MONTHS: Record<string, number> = {
  JANVIER: 1, FEVRIER: 2, FÉVRIER: 2, MARS: 3, AVRIL: 4, MAI: 5, JUIN: 6,
  JUILLET: 7, AOUT: 8, AOÛT: 8, SEPTEMBRE: 9, OCTOBRE: 10, NOVEMBRE: 11,
  DECEMBRE: 12, DÉCEMBRE: 12,
};

function monthOfTab(title: string): string | null {
  const m = title.trim().toUpperCase().match(/^([A-ZÉÛ]+)\s+(\d{4})$/);
  if (!m || !MONTHS[m[1]]) return null;
  return `${m[2]}-${String(MONTHS[m[1]]).padStart(2, '0')}`;
}

// ── Auth Google (JWT RS256, zéro dépendance) ────────────────────────────────
let tokenCache: { at: number; token: string } | null = null;
async function accessToken(credsJson: string): Promise<string> {
  if (tokenCache && Date.now() - tokenCache.at < 45 * 60 * 1000) return tokenCache.token;
  const creds = JSON.parse(credsJson) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(creds.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sig}`,
  });
  const j = (await res.json()) as { access_token?: string; error_description?: string };
  if (!j.access_token) throw new Error(`token Google refusé: ${j.error_description ?? res.status}`);
  tokenCache = { at: Date.now(), token: j.access_token };
  return j.access_token;
}

async function sheetsGet(token: string, path: string): Promise<unknown> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ── Lecture d'un onglet mensuel ─────────────────────────────────────────────
interface SheetSale {
  ref: string; facture: string; vehicule: string; vin: string; ville: string;
  prixAchat: number | null; prixVente: number | null; commissions: number | null;
  commissionHt: number | null; fraisHt: number | null; modePaiement: string;
  dateAchat: string | null; dateLivraison: string | null; convoyeur: string;
  client: string; seller: string; paiement: boolean; livre: boolean;
  /** En-tête du bloc (noms de colonnes) : preuve à joindre quand une ligne est incohérente. */
  header: string[];
}

const truthy = (v: string) => /^(true|vrai|oui|1|x)$/i.test((v ?? '').trim());
const num = (v: string) => {
  const n = Number(String(v ?? '').replace(/[€\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n !== 0 ? Math.round(n) : null;
};
const frDate = (v: string) => {
  const m = String(v ?? '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

/** Marge : décimales conservées (1428,43 €), contrairement aux prix ronds. */
const numDec = (v: string) => {
  const n = Number(String(v ?? '').replace(/[€\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n !== 0 ? Math.round(n * 100) / 100 : null;
};

/**
 * Un onglet contient PLUSIEURS blocs vendeurs (prouvé JUILLET 2026 : bloc
 * « ANTOINE » puis, plus bas, bloc « CHANNING » avec son propre en-tête).
 * Chaque ligne REF est rattachée au bloc courant ; le COMMERCIAL du dossier
 * est le TITRE du bloc (une ligne texte sans chiffre au-dessus de l'en-tête),
 * jamais le convoyeur.
 */
export function parseTab(values: string[][]): SheetSale[] {
  const out: SheetSale[] = [];
  let cols: Record<string, number> | null = null;
  let factureNoCol = -1;
  let factureCols: number[] = [];
  let seller = '';
  let pendingTitle = '';
  let headerNames: string[] = [];
  const get = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');

  for (const row of values) {
    const cells = row.map((v) => String(v ?? '').trim());
    const isHeader = cells.some((v) => v.toUpperCase() === 'REF');
    if (isHeader) {
      const header = cells.map((v) => v.toUpperCase());
      const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
      cols = {
        ref: col('REF'), vehicule: col('VEHICULE', 'VÉHICULE'), vin: col('VIN'),
        ville: col('VILLE'), prixAchat: col('PRIX ACHAT'), prixVente: col('PRIX VENTE'),
        commissions: col('COMMISSIONS'), commissionHt: col('COMMISSIONS HT', 'COMMISSION HT'),
        fraisHt: col('FRAIS HT'),
        mode: col('MODE DE PAIMENT', 'MODE DE PAIEMENT'), dateAchat: col('DATE ACHAT'),
        dateLivraison: col('DATE LIVRAISON'), convoyeur: col('CONVOYEUR'),
        client: col('CLIENT', 'NOTES'), paiement: col('PAIEMENT'), livre: col('LIVRÉ', 'LIVRE'),
      };
      factureCols = header.map((h, i) => (h === 'FACTURE' ? i : -1)).filter((i) => i >= 0);
      headerNames = header.filter(Boolean);
      factureNoCol = -1; // désambiguïsé sur les premières lignes du bloc
      seller = pendingTitle;
      if (!seller) {
        // Bandeau posé en zone de texte flottante (pas une cellule) — l'API
        // ne le voit pas. Le nom doit être TAPÉ dans une cellule au-dessus
        // de l'en-tête du bloc (comme « ANTOINE » en A1).
        console.warn('[SHEET_SYNC] bloc sans titre vendeur détecté — commercial laissé vide (écrire le prénom dans une cellule au-dessus de l\'en-tête)');
      }
      pendingTitle = '';
      continue;
    }
    // Ligne titre de bloc (« ANTOINE », « CHANNING ») : du texte, aucun
    // chiffre, une seule cellule remplie — mémorisée pour le prochain en-tête.
    const filled = cells.filter(Boolean);
    if (filled.length === 1 && /^[A-ZÀ-Ü' -]{2,25}$/i.test(filled[0]) && !/\d/.test(filled[0])) {
      pendingTitle = filled[0].toUpperCase();
      continue;
    }
    if (!cols) continue;
    const ref = get(cells, cols.ref).toUpperCase();
    // Une vraie REF porte lettres ET chiffres (YC793) — écarte en-têtes
    // répétés (« REF ») et lignes à REF pas encore attribuée (« YC »).
    if (!ref || ref.length < 2 || !/[A-Z]/.test(ref) || !/\d/.test(ref)) continue;
    if (factureNoCol < 0 && factureCols.length > 0) {
      factureNoCol = factureCols.find((i) => /^FAC/i.test(get(cells, i))) ?? -1;
    }
    out.push({
      ref, facture: factureNoCol >= 0 ? get(cells, factureNoCol) : '',
      vehicule: get(cells, cols.vehicule), vin: get(cells, cols.vin), ville: get(cells, cols.ville),
      prixAchat: num(get(cells, cols.prixAchat)), prixVente: num(get(cells, cols.prixVente)),
      commissions: num(get(cells, cols.commissions)),
      commissionHt: numDec(get(cells, cols.commissionHt)),
      fraisHt: num(get(cells, cols.fraisHt)),
      modePaiement: get(cells, cols.mode), dateAchat: frDate(get(cells, cols.dateAchat)),
      dateLivraison: frDate(get(cells, cols.dateLivraison)),
      convoyeur: get(cells, cols.convoyeur), client: get(cells, cols.client),
      seller, header: headerNames,
      paiement: truthy(get(cells, cols.paiement)), livre: truthy(get(cells, cols.livre)),
    });
  }
  return out;
}

// ── Boucle ──────────────────────────────────────────────────────────────────
export function startSalesSheetSync(): void {
  const creds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!creds) {
    console.log('[SHEET_SYNC] en attente de GOOGLE_SERVICE_ACCOUNT_JSON — synchro tableur inactive');
    return;
  }
  setInterval(() => void syncOnce(creds).catch((e) => console.warn(`[SHEET_SYNC] échec: ${e instanceof Error ? e.message : e}`)), POLL_MS);
  setTimeout(() => void syncOnce(creds).catch((e) => console.warn(`[SHEET_SYNC] échec: ${e instanceof Error ? e.message : e}`)), 60_000);
  console.log('[SHEET_SYNC] synchro tableur active (poll 10 min)');
}

async function syncOnce(creds: string): Promise<void> {
  const { data } = await supabase.from('app_config').select('value').eq('key', 'gsheet_sales').maybeSingle();
  const cfg = (data?.value ?? null) as { spreadsheetId?: string; sinceMonth?: string } | null;
  if (!cfg?.spreadsheetId) {
    console.warn('[SHEET_SYNC] app_config.gsheet_sales absent (spreadsheetId requis) — rien à faire');
    return;
  }
  const since = cfg.sinceMonth ?? '2026-07';
  const token = await accessToken(creds);
  const meta = (await sheetsGet(token, `${cfg.spreadsheetId}?fields=sheets.properties.title`)) as
    { sheets?: Array<{ properties: { title: string } }> };
  const tabs = (meta.sheets ?? [])
    .map((s) => s.properties.title)
    .filter((t) => { const m = monthOfTab(t); return m != null && m >= since; });
  if (tabs.length === 0) { console.warn(`[SHEET_SYNC] aucun onglet mensuel ≥ ${since}`); return; }

  // Références déjà connues d'ADA — jamais dupliquées. Depuis le 18/09 une
  // vente poussée depuis une négociation porte sa REF (fenêtre « référence »)
  // : la ligne du tableur la RETROUVE et la COMPLÈTE (champs vides seulement,
  // le dossier ADA fait toujours foi) au lieu de créer un deuxième dossier.
  type Known = { id: string; reference: string | null; notes: string | null; purchase_price: number | null; sale_price: number | null; fees: number | null; commission_ht: number | null; commercial: string | null; buyer_contact_id: string | null; seller_contact_id: string | null; seller_contact_id_2: string | null; supplier_contact_id: string | null; client_contact_id: string | null; transaction_date: string | null; status: string | null; closed_at: string | null; transaction_type: string | null; vat_recoverable?: boolean | null };
  // TVA RÉCUPÉRABLE (30/09) : l'astérisque en fin de véhicule du tableur
  // devient une donnée du dossier, relue à CHAQUE passage (un « * » ajouté
  // après coup est pris). Colonne absente tant que le SQL n'est pas collé.
  const vatProbe = await supabase.from('transactions_admin').select('vat_recoverable').limit(1);
  const hasVat = !vatProbe.error;
  const { data: existing } = await supabase.from('transactions_admin')
    .select(`id, reference, notes, purchase_price, sale_price, fees, commission_ht, commercial, buyer_contact_id, seller_contact_id, seller_contact_id_2, supplier_contact_id, client_contact_id, transaction_date, status, closed_at, transaction_type${hasVat ? ', vat_recoverable' : ''}`)
    .not('reference', 'is', null).limit(10000);
  // Fiche MC Export : le côté qui change de rôle à la bascule achat → vente.
  const { data: mcRow } = await supabase.from('contacts').select('id').eq('siren', '93033811600013').order('created_at', { ascending: true }).limit(1).maybeSingle();
  const mcId = (mcRow as { id?: string } | null)?.id ?? null;
  const known = new Map<string, Known>();
  for (const r of ((existing ?? []) as unknown as Known[])) { const k = (r.reference ?? '').trim().toUpperCase(); if (k && !known.has(k)) known.set(k, r); }

  // Contacts ADA pour l'attribution automatique du client acheteur. Clé =
  // mots triés et canonisés : « AUTOGROEP OOSTENDORP » ↔ « OOSTENDORP
  // AUTOGROEP », « WILAR BV » ↔ « Wilar B.V. » — l'ordre et la ponctuation
  // ne comptent pas.
  const canonName = (v: string) => String(v ?? '')
    .normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).sort().join('');
  const { data: contactRows } = await supabase.from('contacts')
    .select('id, company_name, first_name, last_name').limit(5000);
  const contactByKey = new Map<string, string>();
  // RAPPROCHEMENT TOLÉRANT (02/10, boîte à apprendre : « VAN EKRIS MIJDRECHT »
  // vs « Automobielbedrijf van Ekris Mijdrecht B.V », « BELLON MOTORSPORT »
  // vs « BELLON MOTORSPORT DI GIACOMO BELLON », « LOUWMAN OCCASION CENTER »
  // vs « LOUWMAN OCCASION CENTER B.V »). Après l'égalité stricte : les
  // jetons du tableur (≥ 2, formes juridiques retirées) tous présents dans
  // UN SEUL contact → rattaché ; deux candidats ou plus → rien (jamais de
  // devinette sur un acheteur).
  const LEGAL = new Set(['BV', 'B', 'V', 'NV', 'N', 'GMBH', 'SARL', 'SAS', 'SA', 'SRL', 'LTD', 'LIMITED', 'AG', 'KG', 'CO', 'SPA', 'SL', 'SLU', 'EURL', 'SASU', 'DI', 'DE', 'VAN', 'DER', 'DEN', 'THE', 'AND', 'EN']);
  const tokensOf = (label: string) => new Set(label.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).filter((t) => t && !LEGAL.has(t)));
  const contactTokens: Array<{ id: string; tokens: Set<string> }> = [];
  for (const ct of (contactRows ?? []) as Array<{ id: string; company_name: string | null; first_name: string | null; last_name: string | null }>) {
    for (const label of [ct.company_name, `${ct.first_name ?? ''} ${ct.last_name ?? ''}`]) {
      const key = canonName(label ?? '');
      if (key && !contactByKey.has(key)) contactByKey.set(key, ct.id);
      const toks = tokensOf(label ?? '');
      if (toks.size > 0) contactTokens.push({ id: ct.id, tokens: toks });
    }
  }
  const resolveContact = (client: string | null | undefined): string | null => {
    if (!client) return null;
    const exact = contactByKey.get(canonName(client));
    if (exact) return exact;
    const want = tokensOf(client);
    if (want.size === 0) return null;
    // Un seul mot (« LOUWMAN », ligne RV464) : accepté s'il fait ≥ 5 lettres
    // et qu'UN SEUL contact le porte — sinon rien.
    if (want.size === 1 && [...want][0].length < 5) return null;
    const hits = new Set(contactTokens.filter((c) => [...want].every((t) => c.tokens.has(t))).map((c) => c.id));
    return hits.size === 1 ? [...hits][0] : null;
  };

  let inserted = 0, skipped = 0, matched = 0, completed = 0;
  for (const tab of tabs) {
    const res = (await sheetsGet(token, `${cfg.spreadsheetId}/values/${encodeURIComponent(`'${tab}'!A1:AH1050`)}`)) as { values?: string[][] };
    // LIGNE INCOHÉRENTE (02/10, onglet JANVIER 2026 : cellules décalées sur
    // un brouillon → « prix achat » 175 €, « véhicule » FILLINGE). Un achat
    // sous 20 % de la vente n'est pas un prix. Si la MÊME REF a aussi une
    // ligne cohérente dans l'onglet (brouillon laissé à côté de la ligne
    // corrigée, constat Channing 02/10 soir), le brouillon est ignoré et le
    // cas se ferme ; sinon rien n'est écrit (données fausses < zéro donnée),
    // la commission HT reste, et le cas va dans la boîte avec l'en-tête.
    const incoherent = (s: SheetSale) => s.prixAchat != null && s.prixVente != null && s.prixAchat < s.prixVente * 0.2;
    const parsed = parseTab(res.values ?? []);
    const okRefs = new Set(parsed.filter((s) => !incoherent(s)).map((s) => s.ref));
    const rows = parsed.filter((s) => {
      if (!incoherent(s) || !okRefs.has(s.ref)) return true;
      void resolveLearningCase('sheet_row_incoherent', `${tab}|${s.ref}`, 'ligne corrigée dans le tableur — brouillon ignoré');
      return false;
    });
    for (const s of rows) {
      if (incoherent(s)) {
        void recordLearningCase({ kind: 'sheet_row_incoherent', key: `${tab}|${s.ref}`, actor: 'dev', link: '/admin', title: `Tableur ${tab} : ligne ${s.ref} incohérente (achat ${s.prixAchat} €, vente ${s.prixVente} €) — colonnes du bloc à vérifier`, detail: { tab, ref: s.ref, header: s.header, vehicule: s.vehicule, prixAchat: s.prixAchat, prixVente: s.prixVente, fraisHt: s.fraisHt, commissionHt: s.commissionHt } });
        s.prixAchat = null; s.prixVente = null; s.fraisHt = null;
      }
      const closed = s.paiement && s.livre;
      const buyerId = resolveContact(s.client);
      const tableurNotes = [
        `[Tableur ${tab}]`,
        s.vehicule && `Véhicule : ${s.vehicule}`, s.vin && `VIN (fin) : ${s.vin}`,
        s.ville && `Ville : ${s.ville}`,
        s.client && `Client : ${s.client}${buyerId ? '' : ' (contact ADA introuvable)'}`,
        s.convoyeur && `Convoyeur : ${s.convoyeur}`,
        s.facture && `Facture : ${s.facture}`, s.modePaiement && `Paiement : ${s.modePaiement}`,
        s.commissions != null && `Commission : ${s.commissions} €`,
        s.commissionHt != null && `Commission HT (marge) : ${s.commissionHt} €`,
      ].filter(Boolean).join('\n');
      const prev = known.get(s.ref);
      // Boîte à apprendre (02/10) : client du tableur introuvable dans les
      // contacts → cas « equipe » (créer le contact ou corriger le nom) ;
      // retrouvé plus tard → le cas se ferme seul.
      if (s.client && s.ref) {
        if (!buyerId && !prev?.buyer_contact_id) {
          void recordLearningCase({ kind: 'sheet_row_unmatched', key: s.ref, title: `Tableur ${tab} : client « ${s.client} » introuvable dans les contacts (REF ${s.ref})`, actor: 'equipe', link: '/ventes', detail: { tab, client: s.client, vehicule: s.vehicule ?? null, seller: s.seller ?? null } });
        } else if (buyerId) {
          void resolveLearningCase('sheet_row_unmatched', s.ref, `client « ${s.client} » rattaché`);
        }
      }
      if (prev) {
        // COMPLÉTION sans écrasement : seuls les champs vides du dossier ADA
        // reçoivent la valeur du tableur ; le bloc « [Tableur] » n'est ajouté
        // aux notes qu'une fois ; un dossier « achat » (négociation) devient
        // une vente dès que le tableur donne un prix de vente.
        const patch: Record<string, unknown> = {};
        if (prev.sale_price == null && s.prixVente != null) patch.sale_price = s.prixVente;
        if (prev.purchase_price == null && s.prixAchat != null) patch.purchase_price = s.prixAchat;
        if (prev.fees == null && s.fraisHt != null) patch.fees = s.fraisHt;
        if (prev.commission_ht == null && s.commissionHt != null) patch.commission_ht = s.commissionHt;
        if (!prev.commercial && s.seller) patch.commercial = s.seller;
        if (hasVat) {
          const star = /\*\s*$/.test(s.vehicule ?? '');
          if (star && prev.vat_recoverable !== true) patch.vat_recoverable = true;
          else if (!star && prev.vat_recoverable == null) patch.vat_recoverable = false;
        }
        if (!prev.buyer_contact_id && buyerId) patch.buyer_contact_id = buyerId;
        if (!prev.transaction_date && s.dateAchat) patch.transaction_date = s.dateAchat;
        if (closed && prev.status !== 'cloturee') { patch.status = 'cloturee'; if (!prev.closed_at && s.dateLivraison) patch.closed_at = `${s.dateLivraison}T12:00:00Z`; }
        if (prev.transaction_type === 'purchase' && s.prixVente != null) {
          // BASCULE ACHAT → VENTE AVEC LES PARTIES (29/09, dossier I776 : le
          // type changeait seul, MC Export restait acheteur et le co-vendeur
          // du particulier suivait MC Export sur le certificat de revente).
          patch.transaction_type = 'sale';
          const prevSeller = prev.seller_contact_id && prev.seller_contact_id !== mcId ? prev.seller_contact_id : null;
          if (!prev.supplier_contact_id && prevSeller) patch.supplier_contact_id = prevSeller;
          if (mcId) patch.seller_contact_id = mcId;
          patch.seller_contact_id_2 = null;
          const client = buyerId ?? prev.client_contact_id ?? null;
          patch.buyer_contact_id = client && client !== mcId ? client : null;
          if (!prev.client_contact_id && client && client !== mcId) patch.client_contact_id = client;
        }
        if (!(prev.notes ?? '').includes('[Tableur')) patch.notes = [prev.notes, tableurNotes].filter(Boolean).join('\n');
        if (Object.keys(patch).length === 0) { skipped++; continue; }
        const { error } = await supabase.from('transactions_admin').update(patch as never).eq('id', prev.id);
        if (error) { console.warn(`[SHEET_SYNC] complétion ${s.ref} impossible: ${error.message}`); continue; }
        Object.assign(prev, patch);
        completed++;
        continue;
      }
      if (buyerId) matched++;
      const { data: ins, error } = await supabase.from('transactions_admin').insert({
        transaction_type: 'sale',
        reference: s.ref,
        status: closed ? 'cloturee' : 'en_cours',
        closed_at: closed && s.dateLivraison ? `${s.dateLivraison}T12:00:00Z` : null,
        purchase_price: s.prixAchat, sale_price: s.prixVente, fees: s.fraisHt,
        // Marge du dossier = COMMISSIONS HT du tableur (règle Channing 27/07).
        commission_ht: s.commissionHt,
        // Le commercial est le TITRE du bloc (ANTOINE, CHANNING…), jamais le
        // convoyeur — celui-ci reste tracé dans les notes.
        commercial: s.seller || null,
        ...(hasVat ? { vat_recoverable: /\*\s*$/.test(s.vehicule ?? '') } : {}),
        buyer_contact_id: buyerId,
        transaction_date: s.dateAchat,
        notes: tableurNotes,
      }).select('id').single();
      if (error) { console.warn(`[SHEET_SYNC] insert ${s.ref} impossible: ${error.message}`); continue; }
      known.set(s.ref, { id: (ins as { id: string }).id, reference: s.ref, notes: tableurNotes, purchase_price: s.prixAchat, sale_price: s.prixVente, fees: s.fraisHt, commission_ht: s.commissionHt, commercial: s.seller || null, buyer_contact_id: buyerId, transaction_date: s.dateAchat, status: closed ? 'cloturee' : 'en_cours', closed_at: null, transaction_type: 'sale' });
      inserted++;
    }
  }
  if (inserted > 0 || completed > 0 || skipped === 0) {
    console.warn(`[SHEET_SYNC] ${tabs.length} onglet(s) ≥ ${since} : ${inserted} vente(s) créée(s) (${matched} clients rattachés), ${completed} dossier(s) complété(s) par REF, ${skipped} déjà à jour (REF)`);
  }
}
