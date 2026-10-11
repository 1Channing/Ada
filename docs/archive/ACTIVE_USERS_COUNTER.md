# Active Users Counter Implementation

## Overview
Added a real-time Active Users counter in the top-right header using Supabase Realtime Presence. Replaces the version display ("v1.2.4") with "Active users: N".

## Changes Made

### 1. New Hook: `src/hooks/useActiveUsersCount.ts`
- Custom React hook that manages Supabase Realtime Presence
- Uses channel name: `presence:ada`
- Tracks active users across all browser sessions
- Features:
  - Immediate presence tracking on mount
  - Activity detection via window events (mousemove, keydown, scroll, touchstart)
  - 5-minute inactivity timeout
  - Periodic inactivity checks (every 30 seconds)
  - Automatic re-tracking when inactive user becomes active again
  - Complete cleanup on unmount

### 2. Updated Component: `src/components/Layout.tsx`
- Replaced version display with Active Users counter
- Added small badge styling with muted background
- Shows "Active users: —" when loading/disconnected
- Shows "Active users: N" once presence is synced

## Implementation Details

### Activity Detection
- Listens to: `mousemove`, `keydown`, `scroll`, `touchstart`
- All listeners are passive for performance
- Updates `lastActivityAt` timestamp on any activity

### Inactivity Management
- Checks every 30 seconds for user inactivity
- If no activity for 5+ minutes: calls `channel.untrack()`
- User is automatically removed from the presence count
- Re-tracks immediately when user becomes active again

### Resource Management
- Removes all event listeners on cleanup
- Clears interval timer
- Untracks presence
- Unsubscribes from channel
- No memory leaks or lingering subscriptions

## Verification Steps

### Manual Testing

1. **Single User Test**
   - Open Ada in a browser
   - Header should show: "Active users: 1"

2. **Multiple Users Test**
   - Open Ada in 2 different browsers (or tabs)
   - Both should show: "Active users: 2"

3. **Inactivity Test**
   - Open Ada in 2 browsers
   - Counter shows: "Active users: 2"
   - In one tab, stop all activity (don't move mouse, don't scroll)
   - Wait 5+ minutes
   - Counter should drop to: "Active users: 1"
   - Move mouse in the inactive tab
   - Counter should return to: "Active users: 2"

4. **Close Tab Test**
   - Open Ada in 2 browsers
   - Counter shows: "Active users: 2"
   - Close one browser/tab
   - Counter should drop to: "Active users: 1"

## Technical Notes

- **No database changes**: Uses only Supabase Realtime Presence (client-side)
- **No schema migrations**: Zero backend modifications
- **Unique session IDs**: Each tab gets a unique presence key via `crypto.randomUUID()`
- **Build verified**: `npm run build` completes successfully
- **Zero breaking changes**: Only header display modified

## Dependencies Used
- `@supabase/supabase-js` (already installed)
- Supabase Realtime Presence feature
- React hooks (useState, useEffect, useRef)

## Files Modified
1. `src/hooks/useActiveUsersCount.ts` (new)
2. `src/components/Layout.tsx` (updated)
