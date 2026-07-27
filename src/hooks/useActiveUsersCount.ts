import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

const CHANNEL_NAME = 'presence:ada';
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const CHECK_INTERVAL = 30 * 1000; // Check every 30 seconds

export function useActiveUsersCount() {
  const { count } = useActiveUsers();
  return count;
}

/** Présence nominative : compteur + prénoms connectés (télémétrie admin). */
export function useActiveUsers(): { count: number | null; names: string[] } {
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const isTrackedRef = useRef<boolean>(false);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Create and subscribe to the presence channel
    const channel = supabase.channel(CHANNEL_NAME, {
      config: {
        presence: {
          key: crypto.randomUUID(), // Unique key for each session
        },
      },
    });

    channelRef.current = channel;

    // Subscribe to presence changes
    // Le prénom du compte est joint à la présence — la télémétrie affiche QUI
    // est connecté, pas juste combien. Import paresseux pour éviter un cycle.
    const presencePayload = async () => {
      const { useAuth } = await import('../services/auth');
      const { displayName, email } = useAuth.getState();
      return { online_at: new Date().toISOString(), name: displayName || email || 'inconnu' };
    };

    channel
      .on('presence', { event: 'sync' }, () => {
        const presenceState = channel.presenceState() as Record<string, Array<{ name?: string }>>;
        setActiveCount(Object.keys(presenceState).length);
        const seen = new Set<string>();
        for (const metas of Object.values(presenceState)) {
          for (const m of metas) if (m.name) seen.add(m.name);
        }
        setNames([...seen].sort((a, b) => a.localeCompare(b)));
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Track this user as active
          await channel.track(await presencePayload());
          isTrackedRef.current = true;
        }
      });

    // Activity event handlers
    const handleActivity = () => {
      lastActivityRef.current = Date.now();

      // If user was inactive (untracked), re-track them
      if (!isTrackedRef.current && channelRef.current) {
        void presencePayload().then((p) => channelRef.current?.track(p));
        isTrackedRef.current = true;
      }
    };

    // Register activity listeners (passive for performance)
    const eventOptions = { passive: true };
    window.addEventListener('mousemove', handleActivity, eventOptions);
    window.addEventListener('keydown', handleActivity, eventOptions);
    window.addEventListener('scroll', handleActivity, eventOptions);
    window.addEventListener('touchstart', handleActivity, eventOptions);

    // Check for inactivity periodically
    checkIntervalRef.current = setInterval(() => {
      const timeSinceLastActivity = Date.now() - lastActivityRef.current;

      if (timeSinceLastActivity > INACTIVITY_TIMEOUT && isTrackedRef.current) {
        // User is inactive, untrack them
        if (channelRef.current) {
          channelRef.current.untrack();
          isTrackedRef.current = false;
        }
      }
    }, CHECK_INTERVAL);

    // Cleanup on unmount
    return () => {
      // Clear interval
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }

      // Remove event listeners
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      window.removeEventListener('touchstart', handleActivity);

      // Untrack and unsubscribe
      if (channelRef.current) {
        channelRef.current.untrack();
        supabase.removeChannel(channelRef.current);
      }
    };
  }, []);

  return { count: activeCount, names };
}
