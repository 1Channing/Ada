/**
 * NOUVEAUTÉS OPEN SPACE — un seul compteur pour toute l'app (demande Channing
 * 21/09 : « une petite notif sur l'icône quand une annonce a été ajoutée »).
 * Le badge du bouton Open space existait mais ne vivait que sur l'onglet
 * Négociations : invisible depuis le reste d'ADA. Ce store module est lu par
 * le bandeau (entrée Workflow), l'onglet Négociations et le bouton ; il se
 * rafraîchit toutes les 60 s, au retour sur l'onglet du navigateur et à
 * chaque navigation interne, et se remet à zéro quand l'Open space s'ouvre.
 * Compte = annonces poussées ou notes écrites PAR LES AUTRES depuis ma
 * dernière visite (services/openSpace).
 */
import { useEffect, useSyncExternalStore } from 'react';
import { openSpaceUnseenCount, markOpenSpaceSeen } from '../services/openSpace';

let count = 0;
let started = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = (n: number) => { if (n !== count) { count = n; for (const fn of listeners) fn(); } };

export function refreshOpenSpaceUnseen(): Promise<void> {
  if (inflight) return inflight;
  inflight = openSpaceUnseenCount().then(emit).catch(() => undefined).finally(() => { inflight = null; });
  return inflight;
}

/** L'Open space vient d'être ouvert : plus rien de nouveau, et la base le sait. */
export function clearOpenSpaceUnseen(): void {
  emit(0);
  void markOpenSpaceSeen();
}

function start(): void {
  if (started) return;
  started = true;
  void refreshOpenSpaceUnseen();
  window.setInterval(() => void refreshOpenSpaceUnseen(), 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshOpenSpaceUnseen(); });
  window.addEventListener('locationchange', () => void refreshOpenSpaceUnseen());
}

export function useOpenSpaceUnseen(): number {
  useEffect(start, []);
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => count,
    () => 0,
  );
}
