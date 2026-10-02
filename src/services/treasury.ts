/**
 * TRÉSORERIE (02/10, demande Channing) : relevés de compte déposés en PDF,
 * lignes classées, rapprochées des dossiers de vente par la plaque / le VIN,
 * tableau de frais mensuel. Admin seulement (RLS).
 */
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';
import { pdfToLinesEx } from '../lib/pdfText';
import { recordLearningCaseFromApp } from './learningCases';
import { parseStatement, matchLine, matchComplements, repairShineKind, classify, extractPlate, extractVin, type BankCategory, type BankLine as ParsedLine, type BankAccount, type DealLite, type TextLine } from '../lib/bankStatements';
export { matchLine, type DealLite } from '../lib/bankStatements';

export interface BankStatementRow {
  id: string; account: BankAccount; account_ref?: string | null; account_name?: string | null; period_month: string; file_name: string | null; currency: string;
  opening_balance: number | null; closing_balance: number | null; line_count: number; warnings: string[] | null; created_at: string;
}
export interface BankLineRow extends Omit<ParsedLine, 'category'> {
  id: string; statement_id: string; account: BankAccount; category: BankCategory; category_auto: BankCategory | null;
  transaction_id: string | null; match_how: string | null;
}
const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const missing = (m: string) => /does not exist|relation|schema cache/i.test(m);
export const MISSING_MSG = 'SQL du 02/10 (bank_statements) à coller.';
/** Premier mois suivi : un relevé antérieur est refusé au dépôt. */
export const TREASURY_FROM = '2026-01';
const normPlate = (p: string | null | undefined) => (p ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null;

export async function listStatements(): Promise<{ rows: BankStatementRow[]; error: string | null }> {
  const { data, error } = await untyped.from('bank_statements').select('*').order('period_month', { ascending: false }).order('account');
  if (error) return { rows: [], error: missing(error.message) ? MISSING_MSG : error.message };
  return { rows: (data ?? []) as BankStatementRow[], error: null };
}

/** Supabase ne rend jamais plus de 1 000 lignes par requête (constat 02/10 :
 *  1 300 lignes de relevés, mai tronqué en silence) : lecture par pages. */
async function fetchAll(table: string, select: string, order: Array<[string, boolean]>): Promise<{ data: Array<Record<string, unknown>>; error: string | null }> {
  const out: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += 1000) {
    let q = untyped.from(table).select(select);
    for (const [col, asc] of order) q = q.order(col, { ascending: asc });
    const { data, error } = await q.range(from, from + 999);
    if (error) return { data: out, error: error.message };
    const batch = (data ?? []) as Array<Record<string, unknown>>;
    out.push(...batch);
    if (batch.length < 1000 || out.length >= 50_000) break;
  }
  return { data: out, error: null };
}

export async function listLines(): Promise<{ rows: BankLineRow[]; error: string | null }> {
  const { data, error } = await fetchAll('bank_lines', '*', [['booked_on', false], ['line_no', true]]);
  if (error) return { rows: [], error: missing(error) ? MISSING_MSG : error };
  return { rows: data.map((r) => ({ ...r, amount_out: numOrNull(r.amount_out), amount_in: numOrNull(r.amount_in), balance: numOrNull(r.balance) })) as BankLineRow[], error: null };
}
const numOrNull = (v: unknown) => (v == null || v === '' ? null : Number(v));

export async function deleteStatement(id: string): Promise<string | null> {
  const { error } = await untyped.from('bank_statements').delete().eq('id', id);
  return error ? error.message : null;
}

/**
 * Réparation des lignes Shine déjà en base dont le libellé est parti dans le
 * type (constat 03/10 : juillet → septembre, 198 lignes sans tiers ni
 * description, les remboursements DGFiP comptés comme des ventes). Idempotent,
 * lancé au chargement : tiers, description, plaque, VIN et catégorie auto
 * recalculés ; une catégorie choisie à la main est conservée.
 */
export async function repairLines(lines: BankLineRow[]): Promise<{ repaired: number; error: string | null }> {
  let repaired = 0;
  for (const l of lines) {
    if (l.account !== 'shine' || l.counterparty || l.description) continue;
    const fix = repairShineKind(l.kind);
    if (!fix) continue;
    const full = `${fix.counterparty} ${fix.description}`;
    const flow = /^Carte/i.test(fix.kind) ? 'card' : l.amount_in != null ? 'transfer_in' : 'transfer_out';
    const auto = classify(flow, fix.counterparty, fix.description, l.amount_out, l.amount_in);
    const manual = l.category_auto != null && l.category !== l.category_auto;
    const patch = { kind: fix.kind, counterparty: fix.counterparty, description: fix.description, plate: l.plate ?? extractPlate(full), vin: l.vin ?? extractVin(full), category_auto: auto, category: manual ? l.category : auto };
    const { error } = await untyped.from('bank_lines').update(patch).eq('id', l.id);
    if (error) return { repaired, error: error.message };
    repaired++;
  }
  return { repaired, error: null };
}

export async function setLineCategory(id: string, category: BankCategory): Promise<string | null> {
  const { error } = await untyped.from('bank_lines').update({ category }).eq('id', id);
  return error ? error.message : null;
}

/** Dossiers de vente avec plaque / VIN / mois du tableur, pour le rapprochement. */
export async function loadDeals(): Promise<DealLite[]> {
  const { data } = await fetchAll('transactions_admin', 'id, reference, purchase_price, sale_price, fees, commission_ht, transaction_date, status, commercial, notes, vehicle:vehicles_admin!transactions_admin_vehicle_id_fkey(plate_number, vin, brand, model)', [['created_at', false]]);
  return data.map((r) => {
    const v = (r.vehicle ?? null) as { plate_number?: string | null; vin?: string | null; brand?: string | null; model?: string | null } | null;
    const notes = (r.notes as string | null) ?? null;
    const tab = notes?.match(/\[Tableur ([A-ZÉÛ]+) (\d{4})\]/);
    const label = notes?.match(/Véhicule : (.*)/)?.[1]?.trim() ?? null;
    return {
      id: String(r.id), reference: (r.reference as string | null) ?? null, purchase_price: numOrNull(r.purchase_price), sale_price: numOrNull(r.sale_price), fees: numOrNull(r.fees), commission_ht: numOrNull(r.commission_ht),
      transaction_date: (r.transaction_date as string | null) ?? null, status: (r.status as string | null) ?? null, commercial: (r.commercial as string | null) ?? null, notes,
      plate: normPlate(v?.plate_number), vin: v?.vin ? String(v.vin).toUpperCase() : null, brand: v?.brand ?? null, model: v?.model ?? null, vehicle_label: label,
      tab_month: tab ? tabMonth(tab[1], tab[2]) : null,
    };
  });
}
const FR_MONTHS: Record<string, number> = { JANVIER: 1, FEVRIER: 2, FÉVRIER: 2, MARS: 3, AVRIL: 4, MAI: 5, JUIN: 6, JUILLET: 7, AOUT: 8, AOÛT: 8, SEPTEMBRE: 9, OCTOBRE: 10, NOVEMBRE: 11, DECEMBRE: 12, DÉCEMBRE: 12 };
const tabMonth = (m: string, y: string) => (FR_MONTHS[m] ? `${y}-${String(FR_MONTHS[m]).padStart(2, '0')}` : null);
/** Mois d'un dossier pour les totaux : onglet du tableur, sinon date d'achat. */
export const dealMonth = (d: DealLite) => d.tab_month ?? d.transaction_date?.slice(0, 7) ?? null;

export interface UploadResult { file: string; account?: BankAccount; month?: string; lines?: number; matched?: number; replaced?: boolean; warnings?: string[]; error?: string }

/** Dépose un relevé PDF : lecture, classement, rapprochement, écriture (remplace le même compte × mois). */
/**
 * RELEVÉ MAL LU → BOÎTE À APPRENDRE (02/10 soir, « semble y avoir des
 * erreurs pourtant les relevés sont bien lisibles ») : l'erreur ou les
 * avertissements du parseur sont enregistrés avec, pour un format inconnu,
 * les premières lignes du PDF (montants masqués) — la preuve nécessaire
 * pour corriger la classe sans redemander le fichier.
 */
async function reportStatementIssue(file: File, lines: Array<{ text: string }>, st: { account?: string; period_month?: string } | null, error: string | null, warnings: string[]): Promise<void> {
  const mask = (t: string) => t.replace(/\d[\d\s\u00a0.,]*\d/g, (m) => (m.replace(/\D/g, '').length >= 3 ? '###' : m)).slice(0, 160);
  // Premières lignes (montants masqués) pour TOUTE erreur : « mois introuvable »
  // sur Revolut mai / juin (02/10 soir) n'en avait pas, impossible de voir pourquoi.
  const head = error ? lines.slice(0, 80).map((l) => mask(l.text)) : undefined;
  await recordLearningCaseFromApp({
    kind: 'bank_statement_issue', key: `${file.name}`, actor: 'dev', link: '/tresorerie',
    title: `Relevé « ${file.name} »${st?.account ? ` (${st.account} ${st.period_month ?? ''})` : ''} : ${error ?? `${warnings.length} avertissement(s)`}`,
    detail: { file: file.name, size: file.size, account: st?.account ?? null, month: st?.period_month ?? null, error, warnings, pages_text_lines: lines.length, head },
  });
}

export async function uploadStatement(file: File, deals: DealLite[]): Promise<UploadResult> {
  const res: UploadResult = { file: file.name };
  let lines: TextLine[] = [];
  let parsed: { account: string; period_month: string } | null = null;
  try {
    const read = await pdfToLinesEx(file);
    lines = read.lines;
    const st = parseStatement(lines);
    if (read.ocr) st.warnings.unshift('PDF sans texte : lu par reconnaissance de caractères (chiffres à vérifier, le contrôle du solde ci-dessous fait foi)');
    parsed = st;
    if (st.warnings.length > 0) void reportStatementIssue(file, lines, st, null, st.warnings);
    if (!st.period_month) throw new Error('mois du relevé introuvable dans le PDF');
    // Avant janvier 2026 : refusé (décision Channing 02/10 soir, la trésorerie suivie démarre au 1er janvier 2026).
    if (st.period_month.slice(0, 7) < TREASURY_FROM) throw new Error(`relevé de ${st.period_month.slice(0, 7)} : la trésorerie démarre en ${TREASURY_FROM}, les relevés antérieurs ne sont pas intégrés`);
    res.account = st.account; res.month = st.period_month; res.warnings = st.warnings;
    // Catégories corrigées à la main sur la version précédente : conservées.
    // Un relevé = (banque, numéro de compte, mois) : le même relevé redéposé
    // (même sous un autre nom de fichier) REMPLACE, jamais de doublon ; deux
    // comptes d'une même banque (Shine principal / secondaire) cohabitent.
    // Colonne account_ref absente (SQL du 02/10 soir pas collé) : clé (banque, mois).
    // Relevés précédents du même compte × mois : celui qui porte le même
    // numéro de compte, ET ceux déposés avant le SQL du 02/10 soir (numéro
    // vide — « ça sent le doublon », constat Channing) : tous remplacés.
    let hasRef = true;
    let prevRows: Array<{ id: string }> = [];
    {
      const r = await untyped.from('bank_statements').select('id').eq('account', st.account).eq('period_month', st.period_month).in('account_ref', [st.account_ref ?? '', '']);
      if (r.error && /account_ref/.test(r.error.message)) { hasRef = false; const r2 = await untyped.from('bank_statements').select('id').eq('account', st.account).eq('period_month', st.period_month); prevRows = (r2.data ?? []) as Array<{ id: string }>; }
      else if (r.error) throw new Error(r.error.message);
      else prevRows = (r.data ?? []) as Array<{ id: string }>;
    }
    const manual = new Map<string, string>();
    for (const prev of prevRows) {
      const { data: old } = await untyped.from('bank_lines').select('booked_on, amount_out, amount_in, description, category, category_auto').eq('statement_id', prev.id);
      for (const o of (old ?? []) as Array<Record<string, unknown>>) if (o.category !== o.category_auto) manual.set(lineKey(o), String(o.category));
      const { error: delErr } = await untyped.from('bank_statements').delete().eq('id', prev.id);
      if (delErr) throw new Error(delErr.message);
      res.replaced = true;
    }
    const uid = useAuth.getState().userId;
    const { data: ins, error: insErr } = await untyped.from('bank_statements').insert({
      account: st.account, period_month: st.period_month, file_name: file.name, uploaded_by: uid, currency: st.currency,
      ...(hasRef ? { account_ref: st.account_ref ?? '', account_name: st.account_name ?? null } : {}),
      opening_balance: st.opening_balance, closing_balance: st.closing_balance, line_count: st.lines.length, warnings: st.warnings,
    }).select('id').single();
    if (insErr) throw new Error(missing(insErr.message) ? MISSING_MSG : insErr.message);
    let matched = 0;
    const rows = st.lines.map((l) => {
      const m = matchLine(l, deals);
      if (m) matched++;
      const key = lineKey({ booked_on: l.booked_on, amount_out: l.amount_out, amount_in: l.amount_in, description: l.description });
      return { ...l, statement_id: ins.id, account: st.account, category_auto: l.category, category: manual.get(key) ?? l.category, transaction_id: m?.id ?? null, match_how: m?.how ?? null };
    });
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await untyped.from('bank_lines').insert(rows.slice(i, i + 200));
      if (error) throw new Error(error.message);
    }
    res.lines = rows.length; res.matched = matched;
    // Second passage (acomptes sans plaque qui comblent l'écart d'un dossier) sur tout le compte.
    try { const all = await listLines(); await applyComplements(all.rows, deals); } catch { /* fail-open */ }
    return res;
  } catch (e) {
    res.error = e instanceof Error ? e.message : String(e);
    void reportStatementIssue(file, lines, parsed, res.error, []);
    return res;
  }
}
const lineKey = (o: { booked_on?: unknown; amount_out?: unknown; amount_in?: unknown; description?: unknown }) =>
  `${o.booked_on}|${Number(o.amount_out ?? 0)}|${Number(o.amount_in ?? 0)}|${String(o.description ?? '').slice(0, 60)}`;

/** Re-rapproche toutes les lignes (nouveaux dossiers, plaques complétées). */
export async function rematchAll(lines: BankLineRow[], deals: DealLite[]): Promise<{ changed: number; error: string | null }> {
  let changed = 0;
  for (const l of lines) {
    if (l.match_how === 'manuel') continue; // un lien posé à la main n'est jamais défait par l'automate
    const m = matchLine(l, deals);
    const id = m?.id ?? null, how = m?.how ?? null;
    if (id === l.transaction_id && how === l.match_how) { continue; }
    if (!m && l.match_how === 'tiers + complément') continue; // posé par le second passage, revérifié ci-dessous
    const { error } = await untyped.from('bank_lines').update({ transaction_id: id, match_how: how }).eq('id', l.id);
    if (error) return { changed, error: error.message };
    l.transaction_id = id; l.match_how = how; changed++;
  }
  const c = await applyComplements(lines, deals);
  return { changed: changed + c, error: null };
}

async function applyComplements(lines: BankLineRow[], deals: DealLite[]): Promise<number> {
  const found = matchComplements(lines, deals);
  let n = 0;
  for (const [lineId, m] of found) {
    const { error } = await untyped.from('bank_lines').update({ transaction_id: m.id, match_how: m.how }).eq('id', lineId);
    if (!error) { n++; const l = lines.find((x) => x.id === lineId); if (l) { l.transaction_id = m.id; l.match_how = m.how; } }
  }
  return n;
}

/** Lien posé à la main : REF du dossier (vide = retirer le lien). */
export async function setLineMatch(lineId: string, reference: string, deals: DealLite[]): Promise<{ error: string | null; deal: DealLite | null }> {
  const ref = reference.trim().toUpperCase();
  if (!ref) {
    const { error } = await untyped.from('bank_lines').update({ transaction_id: null, match_how: null }).eq('id', lineId);
    return { error: error ? error.message : null, deal: null };
  }
  const cands = deals.filter((d) => (d.reference ?? '').toUpperCase() === ref);
  if (cands.length === 0) return { error: `aucun dossier avec la REF ${ref}`, deal: null };
  const deal = cands.find((d) => d.plate && d.purchase_price != null) ?? cands.find((d) => d.purchase_price != null) ?? cands[0];
  const { error } = await untyped.from('bank_lines').update({ transaction_id: deal.id, match_how: 'manuel' }).eq('id', lineId);
  return { error: error ? error.message : null, deal };
}
