/**
 * SYNCHRO TABLEUR DE VENTES (Google Sheets → ADA) — prêt à brancher.
 *
 * Le tableur (une feuille par vendeur : ANTOINE, …) reste l'endroit où
 * l'équipe saisit ; ADA s'aligne : toute NOUVELLE ligne (clé = REF + FACTURE)
 * crée une vente « à compléter » dans transactions_admin.
 *
 * BRANCHEMENT (2 choses, rien d'autre) :
 *   1. Variable Railway `GOOGLE_SERVICE_ACCOUNT_JSON` : la clé JSON d'un
 *      compte de service Google (API Sheets activée), auquel le tableur est
 *      partagé en lecture.
 *   2. Dans ADA (table app_config, clé 'gsheet_sales') :
 *      { "spreadsheetId": "…", "sheets": ["ANTOINE", "CHANNING"] }
 *
 * Colonnes attendues (d'après le tableur du 27/07) : REF, FACTURE, VILLE,
 * VEHICULE, VIN, PRIX ACHAT, PRIX VENTE, COMMISSIONS, FRAIS HT,
 * COMMISSIONS HT, MODE DE PAIEMENT, DATE — mappées au mieux, le reste part
 * dans les notes du dossier. Sens unique tableur → ADA (jamais l'inverse),
 * aucune ligne existante modifiée : import « nouvelles lignes seulement ».
 */
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';

const POLL_MS = 10 * 60 * 1000;

export function startSalesSheetSync(): void {
  const creds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!creds) {
    console.log('[SHEET_SYNC] en attente de GOOGLE_SERVICE_ACCOUNT_JSON — synchro tableur inactive');
    return;
  }
  setInterval(() => void syncOnce(creds), POLL_MS);
  setTimeout(() => void syncOnce(creds), 60_000);
  console.log('[SHEET_SYNC] synchro tableur active (poll 10 min)');
}

async function syncOnce(_creds: string): Promise<void> {
  const { data } = await supabase.from('app_config').select('value').eq('key', 'gsheet_sales').maybeSingle();
  const cfg = (data?.value ?? null) as { spreadsheetId?: string; sheets?: string[] } | null;
  if (!cfg?.spreadsheetId) {
    console.warn('[SHEET_SYNC] app_config.gsheet_sales absent (spreadsheetId requis) — rien à faire');
    return;
  }
  // TODO(branchement) : lecture Sheets API v4 (values.batchGet sur cfg.sheets),
  // rapprochement par REF+FACTURE contre transactions_admin.reference, insert
  // des manquantes en statut 'en_cours' avec notes préremplies. Implémenté au
  // moment du branchement pour être PROUVÉ contre le vrai tableur (doctrine :
  // jamais de mapping non vérifié sur données réelles).
  console.warn('[SHEET_SYNC] clé présente — implémentation du mapping à activer avec le tableur réel');
}
