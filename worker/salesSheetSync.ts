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
      seller,
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

  // Références déjà connues d'ADA — jamais dupliquées.
  const { data: existing } = await supabase.from('transactions_admin').select('reference').not('reference', 'is', null).limit(10000);
  const known = new Set(((existing ?? []) as Array<{ reference: string | null }>).map((r) => (r.reference ?? '').trim().toUpperCase()).filter(Boolean));

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
  for (const ct of (contactRows ?? []) as Array<{ id: string; company_name: string | null; first_name: string | null; last_name: string | null }>) {
    for (const label of [ct.company_name, `${ct.first_name ?? ''} ${ct.last_name ?? ''}`]) {
      const key = canonName(label ?? '');
      if (key && !contactByKey.has(key)) contactByKey.set(key, ct.id);
    }
  }

  let inserted = 0, skipped = 0, matched = 0;
  for (const tab of tabs) {
    const res = (await sheetsGet(token, `${cfg.spreadsheetId}/values/${encodeURIComponent(`'${tab}'!A1:AH1050`)}`)) as { values?: string[][] };
    for (const s of parseTab(res.values ?? [])) {
      if (known.has(s.ref)) { skipped++; continue; }
      const closed = s.paiement && s.livre;
      const buyerId = contactByKey.get(canonName(s.client)) ?? null;
      if (buyerId) matched++;
      const { error } = await supabase.from('transactions_admin').insert({
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
        buyer_contact_id: buyerId,
        transaction_date: s.dateAchat,
        notes: [
          `[Tableur ${tab}]`,
          s.vehicule && `Véhicule : ${s.vehicule}`, s.vin && `VIN (fin) : ${s.vin}`,
          s.ville && `Ville : ${s.ville}`,
          s.client && `Client : ${s.client}${buyerId ? '' : ' (contact ADA introuvable)'}`,
          s.convoyeur && `Convoyeur : ${s.convoyeur}`,
          s.facture && `Facture : ${s.facture}`, s.modePaiement && `Paiement : ${s.modePaiement}`,
          s.commissions != null && `Commission : ${s.commissions} €`,
          s.commissionHt != null && `Commission HT (marge) : ${s.commissionHt} €`,
        ].filter(Boolean).join('\n'),
      });
      if (error) { console.warn(`[SHEET_SYNC] insert ${s.ref} impossible: ${error.message}`); continue; }
      known.add(s.ref);
      inserted++;
    }
  }
  if (inserted > 0 || skipped === 0) {
    console.warn(`[SHEET_SYNC] ${tabs.length} onglet(s) ≥ ${since} : ${inserted} vente(s) créée(s) (${matched} clients rattachés), ${skipped} déjà connues (REF)`);
  }
}
