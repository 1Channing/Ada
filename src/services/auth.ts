import { create } from 'zustand';
import { supabase } from '../lib/supabase';

/**
 * Comptes d'équipe (Supabase Auth, email + mot de passe).
 * Le prénom d'affichage vit dans public.profiles — c'est lui qui relie le
 * compte à l'historique « contributeur » (Antoine, Channing, …) et qui signe
 * les recherches quotidiennes / négociations personnelles.
 */

interface AuthState {
  ready: boolean;            // session initiale résolue (évite le flash login)
  userId: string | null;
  email: string | null;
  displayName: string;
  setSession: (userId: string | null, email: string | null) => void;
  setDisplayName: (name: string) => void;
  setReady: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  ready: false,
  userId: null,
  email: null,
  displayName: '',
  setSession: (userId, email) => set({ userId, email }),
  setDisplayName: (displayName) => set({ displayName }),
  setReady: () => set({ ready: true }),
}));

async function loadProfile(userId: string): Promise<void> {
  const { data } = await supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle();
  useAuth.getState().setDisplayName(data?.display_name ?? '');
}

let started = false;
/** À appeler une fois au boot (App) : hydrate la session et suit ses changements. */
export function startAuthWatcher(): void {
  if (started) return;
  started = true;
  void supabase.auth.getSession().then(({ data }) => {
    const u = data.session?.user ?? null;
    useAuth.getState().setSession(u?.id ?? null, u?.email ?? null);
    if (u) void loadProfile(u.id);
    useAuth.getState().setReady();
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    const u = session?.user ?? null;
    useAuth.getState().setSession(u?.id ?? null, u?.email ?? null);
    if (u) void loadProfile(u.id);
    else useAuth.getState().setDisplayName('');
  });
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}

export async function signUp(email: string, password: string, displayName: string): Promise<string | null> {
  const name = displayName.trim();
  if (!name) return 'Le prénom d’affichage est requis.';
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return error.message;
  const userId = data.user?.id;
  if (userId) {
    // Si la confirmation d'email est activée côté Supabase, la session n'existe
    // pas encore : l'insert profil réussit quand même après connexion (upsert
    // au premier login, voir ensureProfile).
    await supabase.from('profiles').upsert({ id: userId, display_name: name });
    localStorage.setItem('ada_pending_display_name', name);
  }
  return null;
}

/** Filet : crée le profil au premier login si l'inscription n'a pas pu l'écrire. */
export async function ensureProfile(): Promise<void> {
  const { userId, displayName } = useAuth.getState();
  if (!userId || displayName) return;
  const pending = localStorage.getItem('ada_pending_display_name') ?? '';
  const name = pending || (useAuth.getState().email ?? '').split('@')[0];
  if (!name) return;
  await supabase.from('profiles').upsert({ id: userId, display_name: name });
  localStorage.removeItem('ada_pending_display_name');
  useAuth.getState().setDisplayName(name);
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
