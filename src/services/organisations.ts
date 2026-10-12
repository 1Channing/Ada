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

export async function listOrganisations(): Promise<{ names: string[]; error: string | null }> {
  const { data, error } = await untyped.from('organisations').select('name').order('name');
  if (error) return { names: [DEFAULT_ORG], error: missing(error.message) ? ORG_SQL_HINT : error.message };
  const names = ((data ?? []) as Array<{ name: string }>).map((r) => r.name);
  return { names: names.includes(DEFAULT_ORG) ? names : [DEFAULT_ORG, ...names], error: null };
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
