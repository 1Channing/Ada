/**
 * ORGANISATIONS (12/10) : la liste de référence des sociétés qui utilisent
 * ADA (MC Export, Weecars Angers, Mon agence automobile…). Chaque compte
 * appartient à une organisation ; Open space et anti-collision ne se
 * partagent qu'en son sein. Lue par tous, gérée par les admins (page Équipe).
 * Fail-open : table absente (SQL du 12/10 pas collé) → liste réduite à ce que
 * les profils portent déjà, message explicite à l'écriture.
 */
import { supabase } from '../lib/supabase';

export const DEFAULT_ORG = 'MC Export';
const ORG_SQL_HINT = 'Organisations : SQL du 12/10 (organisations_encadrees) à coller.';
const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const missing = (m: string) => /does not exist|relation|schema cache/i.test(m);

export interface Organisation {
  name: string;
  /** Onglets reçus par tout NOUVEAU compte de l'organisation (null = tout) — « Weecars : prospection seule ». */
  default_tabs: string[] | null;
}
/** Compte de prospection (Weecars, 12/10) : Résultats (29/10 : les leads partagés par son manager), Négociations et Archives (de SON organisation), rien d'autre. */
export const PROSPECTING_TABS = ['wf:resultats', 'wf:negociations', 'wf:archives'];
const PROSPECTING_LEGACY = [...PROSPECTING_TABS, 'wf:leads'];
export const isProspectingOrg = (o: Organisation | undefined): boolean =>
  !!o?.default_tabs && o.default_tabs.length > 0 && o.default_tabs.includes('wf:negociations') && o.default_tabs.every((t) => PROSPECTING_LEGACY.includes(t));

export async function listOrganisations(): Promise<{ names: string[]; rows: Organisation[]; error: string | null }> {
  let { data, error } = await untyped.from('organisations').select('name, default_tabs').order('name');
  if (error && /default_tabs/.test(error.message)) ({ data, error } = await untyped.from('organisations').select('name').order('name'));
  if (error) return { names: [DEFAULT_ORG], rows: [{ name: DEFAULT_ORG, default_tabs: null }], error: missing(error.message) ? ORG_SQL_HINT : error.message };
  const rows = ((data ?? []) as Array<{ name: string; default_tabs?: string[] | null }>).map((r) => ({ name: r.name, default_tabs: r.default_tabs ?? null }));
  if (!rows.some((r) => r.name === DEFAULT_ORG)) rows.unshift({ name: DEFAULT_ORG, default_tabs: null });
  return { names: rows.map((r) => r.name), rows, error: null };
}

/** Onglets par défaut des nouveaux comptes d'une organisation (admin). */
export async function setOrganisationDefaultTabs(name: string, tabs: string[] | null): Promise<string | null> {
  const { error } = await untyped.from('organisations').update({ default_tabs: tabs }).eq('name', name);
  if (!error) return null;
  return /default_tabs|column/.test(error.message) ? 'Onglets par organisation : SQL du 12/10 (inscription_organisation) à coller.' : missing(error.message) ? ORG_SQL_HINT : error.message;
}

export async function addOrganisation(name: string): Promise<string | null> {
  const clean = name.trim();
  if (!clean) return 'Nom vide.';
  const { error } = await untyped.from('organisations').insert({ name: clean });
  if (!error) return null;
  if (/duplicate|unique/i.test(error.message)) return null; // déjà là : rien à faire
  return missing(error.message) ? ORG_SQL_HINT : error.message;
}

/** Suppression d'une organisation SANS membre (la liste reste cohérente avec les comptes). */
export async function removeOrganisation(name: string): Promise<string | null> {
  if (name === DEFAULT_ORG) return 'MC Export ne se supprime pas.';
  const { error } = await untyped.from('organisations').delete().eq('name', name);
  return error ? (missing(error.message) ? ORG_SQL_HINT : error.message) : null;
}

/** Organisations de départ (12/10) — affichées à l'inscription tant que la RPC n'est pas en place. */
export const SEED_ORGS = [DEFAULT_ORG, 'Weecars', 'Mon agence automobile'];

/** Liste lisible AVANT connexion (page d'inscription) — RPC publique, noms seulement. */
export async function listPublicOrganisations(): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('public_organisations');
  if (error || !Array.isArray(data) || data.length === 0) return SEED_ORGS;
  const names = (data as string[]).filter((n) => typeof n === 'string' && n.trim());
  return names.includes(DEFAULT_ORG) ? names : [DEFAULT_ORG, ...names];
}
