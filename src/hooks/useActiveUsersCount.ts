import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

const CHANNEL_NAME = 'presence:ada';
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const CHECK_INTERVAL = 30 * 1000; // Check every 30 seconds

export function useActiveUsersCount() {
  const [activeCount, setActiveCount] = useState<number | null>(null);
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
    channel
      .on('presence', { event: 'sync' }, () => {
        const presenceState = channel.presenceState();
        const count = Object.keys(presenceState).length;
        setActiveCount(count);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Track this user as active
          await channel.track({ online_at: new Date().toISOString() });
          isTrackedRef.current = true;
        }
      });

    // Activity event handlers
    const handleActivity = () => {
      lastActivityRef.current = Date.now();

      // If user was inactive (untracked), re-track them
      if (!isTrackedRef.current && channelRef.current) {
        channelRef.current.track({ online_at: new Date().toISOString() });
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

  return activeCount;
}
