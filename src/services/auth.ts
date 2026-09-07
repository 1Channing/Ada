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
  isAdmin: boolean;
  /** Onglets autorisés pour CE compte (page Équipe) — null = tous. */
  allowedTabs: string[] | null;
  /** true = l'utilisateur arrive par un lien « mot de passe oublié » —
   *  l'app affiche l'écran de nouveau mot de passe avant tout le reste. */
  recovering: boolean;
  setSession: (userId: string | null, email: string | null) => void;
  setProfile: (name: string, isAdmin: boolean, allowedTabs?: string[] | null) => void;
  setReady: () => void;
  setRecovering: (v: boolean) => void;
}

export const useAuth = create<AuthState>((set) => ({
  ready: false,
  userId: null,
  email: null,
  displayName: '',
  isAdmin: false,
  allowedTabs: null,
  recovering: false,
  setSession: (userId, email) => set({ userId, email }),
  setProfile: (displayName, isAdmin, allowedTabs = null) => set({ displayName, isAdmin, allowedTabs }),
  setReady: () => set({ ready: true }),
  setRecovering: (recovering) => set({ recovering }),
}));

/**
 * Session EMPOISONNÉE : un jeton que le serveur refuse durablement — constat
 * 24/08, « JWT issued at future » (jeton émis pendant un décalage d'horloge
 * transitoire côté Supabase : son horodatage d'émission est « dans le futur »,
 * donc CHAQUE requête est refusée, Y COMPRIS le renouvellement — il ne se
 * répare jamais seul et survit aux redéploiements puisqu'il vit dans le
 * navigateur). Détectée au premier appel authentifié du boot (loadProfile) :
 * on purge la session locale et on repasse par l'écran de connexion, où un
 * jeton sain est réémis. Les erreurs non-JWT ne purgent jamais (fail-open).
 */
const POISONED_JWT = /invalid jwt|jwt is invalid|invalid claim|jwt expired/i;
// « JWT issued at future » N'EST PAS un jeton malade : mesuré le 24/08, un
// jeton à l'iat EXACT (écart 0,0 s) était refusé — c'est l'horloge du
// VALIDEUR (PostgREST) qui retarde, panne côté Supabase. Purger déconnectait
// l'utilisateur en boucle (chaque jeton frais naît « dans le futur »). On
// garde la session, on réessaie, et on affiche l'explication.
const SERVER_CLOCK_LAG = /jwt issued at future/i;

async function purgePoisonedSession(reason: string): Promise<void> {
  console.warn(`[AUTH] session invalide (${reason}) — purge locale et retour à la connexion`);
  await supabase.auth.signOut().catch(() => undefined);
  // Le signOut serveur peut être refusé pour la même raison que le reste :
  // on efface aussi le stockage local de supabase-js (clés sb-*).
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('sb-')) localStorage.removeItem(k);
  } catch { /* stockage inaccessible — le reload tentera sa chance */ }
  window.location.reload();
}

// Relances espacées le temps que l'horloge du serveur rattrape l'iat du
// jeton (ou que Supabase répare) — la session reste ouverte pendant ce temps.
const CLOCK_RETRY_DELAYS_MS = [10_000, 30_000, 60_000, 120_000, 300_000];
let clockRetryIdx = 0;

async function loadProfile(userId: string): Promise<void> {
  const { data, error } = await supabase.from('profiles').select('display_name, is_admin, allowed_tabs').eq('id', userId).maybeSingle();
  if (error && SERVER_CLOCK_LAG.test(error.message ?? '')) {
    const delay = CLOCK_RETRY_DELAYS_MS[Math.min(clockRetryIdx++, CLOCK_RETRY_DELAYS_MS.length - 1)];
    console.warn(`[AUTH] horloge du serveur de données en retard (« ${error.message} ») — nouvel essai dans ${Math.round(delay / 1000)} s ; si ça persiste : Supabase → Settings → General → Restart project`);
    setTimeout(() => { void loadProfile(userId); }, delay);
    return;
  }
  if (error && POISONED_JWT.test(error.message ?? '')) {
    await purgePoisonedSession(error.message);
    return;
  }
  clockRetryIdx = 0;
  useAuth.getState().setProfile(
    data?.display_name ?? '',
    data?.is_admin === true,
    (data as { allowed_tabs?: string[] | null } | null)?.allowed_tabs ?? null,
  );
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
  supabase.auth.onAuthStateChange((event, session) => {
    const u = session?.user ?? null;
    useAuth.getState().setSession(u?.id ?? null, u?.email ?? null);
    // Lien « mot de passe oublié » : Supabase ouvre une session de
    // récupération et émet PASSWORD_RECOVERY — on force l'écran nouveau MDP.
    if (event === 'PASSWORD_RECOVERY') useAuth.getState().setRecovering(true);
    if (u) void loadProfile(u.id);
    else useAuth.getState().setProfile('', false);
  });
}

/** UN compte par adresse : la même adresse tapée avec des espaces ou des
 *  majuscules doit toujours désigner LE même compte. */
const normalizeEmail = (e: string) => e.trim().toLowerCase();

/** Messages Supabase → français clair (les libellés bruts perdaient l'équipe). */
function frenchAuthError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'Email ou mot de passe incorrect.';
  if (/email not confirmed/i.test(msg)) return 'Adresse non confirmée : clique le lien reçu par email (regarde les spams), puis reconnecte-toi.';
  if (/user already registered|already been registered/i.test(msg)) return 'Un compte existe déjà avec cette adresse — connecte-toi, ou utilise « Mot de passe oublié ».';
  if (/rate limit|too many requests/i.test(msg)) return 'Trop de tentatives — réessaie dans quelques minutes.';
  if (/password should be at least|password.*short/i.test(msg)) return 'Mot de passe trop court.';
  if (/réservée à l'équipe|allowlist/i.test(msg)) return 'Inscription réservée à l’équipe MC Export — demande à un admin d’ajouter ton adresse.';
  return msg;
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email: normalizeEmail(email), password });
  return error ? frenchAuthError(error.message) : null;
}

export interface SignUpDetails {
  firstName: string;
  lastName: string;
  phone: string;
}

/** Règle de robustesse : 8 caractères minimum, au moins une lettre ET un
 *  chiffre — vérifiée ici (source de vérité) ET affichée par le formulaire. */
export function passwordWeakness(pw: string): string | null {
  if (pw.length < 8) return 'Au moins 8 caractères.';
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return 'Au moins une lettre et un chiffre.';
  return null;
}

export async function signUp(email: string, password: string, details: SignUpDetails): Promise<string | null> {
  const firstName = details.firstName.trim();
  const lastName = details.lastName.trim();
  const phone = details.phone.trim();
  if (!firstName) return 'Le prénom est requis.';
  if (!lastName) return 'Le nom est requis.';
  const weak = passwordWeakness(password);
  if (weak) return `Mot de passe trop faible : ${weak}`;
  const cleanEmail = normalizeEmail(email);
  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
    options: { data: { first_name: firstName, last_name: lastName, phone } },
  });
  if (error) return frenchAuthError(error.message);
  // COMPTE DÉJÀ EXISTANT, détection : quand la confirmation email est activée,
  // Supabase répond « succès » avec un utilisateur FANTÔME (anti-énumération)
  // au lieu d'une erreur — identities est alors VIDE. C'est ce silence qui
  // faisait croire à un « 2e compte » : on le dit franchement à la place.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return 'Un compte existe déjà avec cette adresse — connecte-toi, ou utilise « Mot de passe oublié ».';
  }
  const userId = data.user?.id;
  if (userId) {
    // Si la confirmation d'email est activée côté Supabase, la session n'existe
    // pas encore : l'insert profil réussit quand même après connexion (upsert
    // au premier login, voir ensureProfile).
    await supabase.from('profiles').upsert({
      id: userId, display_name: firstName,
      first_name: firstName, last_name: lastName, phone,
    });
    localStorage.setItem('ada_pending_display_name', firstName);
  }
  return null;
}

/** Envoie l'email « mot de passe oublié » — le lien ramène sur ADA, qui
 *  affiche l'écran de nouveau mot de passe (PASSWORD_RECOVERY). */
export async function requestPasswordReset(email: string): Promise<string | null> {
  const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
    redirectTo: window.location.origin,
  });
  return error ? frenchAuthError(error.message) : null;
}

export async function updatePassword(newPassword: string): Promise<string | null> {
  const weak = passwordWeakness(newPassword);
  if (weak) return `Mot de passe trop faible : ${weak}`;
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return frenchAuthError(error.message);
  useAuth.getState().setRecovering(false);
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
  useAuth.getState().setProfile(name, useAuth.getState().isAdmin);
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// ── Création de compte PAR UN ADMIN (page Équipe, demande Channing 07/09) ──
// Sans clé service côté navigateur (jamais), on passe par l'inscription
// publique sur un SECOND client Supabase sans persistance : la session de
// l'admin reste intacte. Le trigger de liste d'inscription s'applique : la
// page ajoute l'adresse à la liste avant. Si la confirmation d'email est
// activée côté Supabase, la personne reçoit le mail de confirmation et le
// mot de passe choisi fonctionne après le clic.
export interface AdminCreateInput { email: string; password: string; firstName: string; lastName: string; phone: string }
export async function adminCreateAccount(input: AdminCreateInput): Promise<{ error: string | null; needsConfirmation: boolean }> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const phone = input.phone.trim();
  if (!firstName) return { error: 'Le prénom est requis.', needsConfirmation: false };
  if (!lastName) return { error: 'Le nom est requis.', needsConfirmation: false };
  const weak = passwordWeakness(input.password);
  if (weak) return { error: `Mot de passe trop faible : ${weak}`, needsConfirmation: false };
  const cleanEmail = normalizeEmail(input.email);
  const { createClient } = await import('@supabase/supabase-js');
  const side = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await side.auth.signUp({
    email: cleanEmail, password: input.password,
    options: { data: { first_name: firstName, last_name: lastName, phone } },
  });
  if (error) return { error: frenchAuthError(error.message), needsConfirmation: false };
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { error: 'Un compte existe déjà avec cette adresse.', needsConfirmation: false };
  }
  const userId = data.user?.id;
  if (userId) {
    // Profil posé par l'ADMIN (sa session, ses droits) — le compte est
    // complet avant même la première connexion de la personne.
    await supabase.from('profiles').upsert({
      id: userId, display_name: firstName, first_name: firstName, last_name: lastName, phone,
    });
  }
  // Session absente = confirmation d'email requise côté Supabase.
  return { error: null, needsConfirmation: !data.session };
}

/** Mot de passe lisible et solide : 3 mots courts + 2 chiffres (ex. « rive-clef-pont-47 »). */
export function suggestPassword(): string {
  const words = ['rive', 'clef', 'pont', 'lune', 'sable', 'cime', 'nord', 'plage', 'roche', 'fleur', 'orage', 'tigre', 'ombre', 'vague', 'perle', 'cuivre', 'jade', 'forge', 'delta', 'astre'];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  const n = 10 + Math.floor(Math.random() * 90);
  return `${pick()}-${pick()}-${pick()}-${n}`;
}
