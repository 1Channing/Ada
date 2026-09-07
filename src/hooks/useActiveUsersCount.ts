/**
 * Présence temps réel (Supabase Realtime presence) — UN SEUL canal pour toute
 * l'app, partagé par le bandeau (compteur) et la télémétrie (prénoms).
 *
 * Constat Channing 07/09 (« les gens connectés ne s'affichent pas ») : deux
 * composants montaient chacun le canal « presence:ada » sur le même client ;
 * realtime-js renvoie alors le canal DÉJÀ abonné, le second `subscribe`
 * n'aboutit jamais (compteur « … », aucun prénom) et son démontage fermait
 * le canal du premier. Désormais : un singleton module (canal ouvert une
 * fois, jamais fermé — le bandeau vit tant qu'ADA est ouvert) et les hooks
 * lisent un petit store.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

const CHANNEL_NAME = 'presence:ada';
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes sans interaction → retiré
const CHECK_INTERVAL = 30 * 1000;

interface PresenceState { count: number | null; names: string[] }
let state: PresenceState = { count: null, names: [] };
const listeners = new Set<() => void>();
let channel: RealtimeChannel | null = null;
let tracked = false;
let lastActivity = Date.now();
let trackedName = '';

function emit(next: PresenceState) {
  state = next;
  for (const fn of listeners) fn();
}

async function presencePayload() {
  // Import paresseux pour éviter un cycle hooks ↔ services/auth.
  const { useAuth } = await import('../services/auth');
  const { displayName, email } = useAuth.getState();
  const name = displayName || email || 'inconnu';
  trackedName = name;
  return { online_at: new Date().toISOString(), name };
}

function readState(ch: RealtimeChannel) {
  const ps = ch.presenceState() as Record<string, Array<{ name?: string }>>;
  const seen = new Set<string>();
  for (const metas of Object.values(ps)) for (const m of metas) if (m.name) seen.add(m.name);
  emit({ count: Object.keys(ps).length, names: [...seen].sort((a, b) => a.localeCompare(b)) });
}

function ensurePresence() {
  if (channel || typeof window === 'undefined') return;
  const ch = supabase.channel(CHANNEL_NAME, { config: { presence: { key: crypto.randomUUID() } } });
  channel = ch;
  ch.on('presence', { event: 'sync' }, () => readState(ch))
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track(await presencePayload());
        tracked = true;
        readState(ch);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(`[PRESENCE] canal ${status}`);
      }
    });

  const handleActivity = () => {
    lastActivity = Date.now();
    if (!tracked && channel) {
      tracked = true;
      void presencePayload().then((p) => channel?.track(p));
    }
  };
  const opts = { passive: true };
  window.addEventListener('mousemove', handleActivity, opts);
  window.addEventListener('keydown', handleActivity, opts);
  window.addEventListener('scroll', handleActivity, opts);
  window.addEventListener('touchstart', handleActivity, opts);

  window.setInterval(() => {
    if (Date.now() - lastActivity > INACTIVITY_TIMEOUT && tracked && channel) {
      void channel.untrack();
      tracked = false;
    }
  }, CHECK_INTERVAL);

  // Le prénom arrive APRÈS le montage (profil chargé en asynchrone) : on
  // re-présente la personne sous son vrai nom dès qu'il est connu.
  void import('../services/auth').then(({ useAuth }) => {
    useAuth.subscribe((s) => {
      const name = s.displayName || s.email || 'inconnu';
      if (tracked && channel && name !== trackedName) void presencePayload().then((p) => channel?.track(p));
    });
  });
}

/** Présence nominative : compteur + prénoms connectés (télémétrie admin). */
export function useActiveUsers(): PresenceState {
  const [snap, setSnap] = useState<PresenceState>(state);
  useEffect(() => {
    ensurePresence();
    const fn = () => setSnap(state);
    listeners.add(fn);
    fn();
    return () => { listeners.delete(fn); };
  }, []);
  return snap;
}

export function useActiveUsersCount() {
  return useActiveUsers().count;
}
