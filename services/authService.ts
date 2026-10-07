// services/authService.ts
import { supabase, forceRemoveSession, hasSessionInStorage } from '../lib/supabase';
import { wipeLocalUserData } from '../lib/storage';
import { cancelAllScheduledNotifications } from './notificationService';
import type { User } from '../lib/supabase';

export type { User };

export interface SignOutResult {
  success: boolean;
  localOnly: boolean;
  error?: string;
  requiresReload?: boolean;
}

export const signUp = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
};

export const signIn = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
};

export const signInWithGoogle = async () => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
  return data;
};

// Flush pending sync before sign-out (optional callback from App)
// This must be called BEFORE signOut() to save the current user's edits
export type FlushCallback = () => Promise<void>;

// Sign out with guaranteed local session removal
// Even on network failure, the device WILL be signed out
export const signOut = async (
  userId?: string,
  flushPendingSync?: FlushCallback
): Promise<SignOutResult> => {
  // 1. Flush pending edits BEFORE anything else (while still authenticated)
  if (flushPendingSync) {
    try {
      await flushPendingSync();
    } catch (err) {
      console.warn('Failed to flush pending sync before sign-out:', err);
    }
  }

  // 2. Cancel native notifications
  await cancelAllScheduledNotifications();

  // 3. Try global sign-out (revokes all sessions on server)
  const { error: globalError } = await supabase.auth.signOut();
  
  if (globalError) {
    // Network failure or server error
    // signOut({scope:'local'}) also makes a network call in supabase-js 2.x
    // So we force-remove the session directly from storage
    forceRemoveSession();
    
    // Clear user data AFTER session is removed
    if (userId) {
      wipeLocalUserData(userId);
    }
    
    // Verify session is actually gone
    if (hasSessionInStorage()) {
      // Session still exists - this shouldn't happen but handle it
      return {
        success: false,
        localOnly: true,
        error: 'Could not sign out. Please try again.',
        requiresReload: true,
      };
    }
    
    return {
      success: true,
      localOnly: true,
      error: 'Signed out on this device; could not reach server to revoke other sessions.',
      requiresReload: true, // Hard reload ensures clean state
    };
  }
  
  // Global sign-out succeeded - clear user data
  if (userId) {
    wipeLocalUserData(userId);
  }
  
  return { success: true, localOnly: false };
};

// Wipe user data without signing out (for SIGNED_OUT events from other sources)
export const cleanupUserData = async (userId: string): Promise<void> => {
  await cancelAllScheduledNotifications();
  wipeLocalUserData(userId);
};

export const getCurrentUser = async (): Promise<User | null> => {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
};

export const onAuthStateChange = (callback: (user: User | null, event: string) => void) => {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(session?.user ?? null, event);
  });
};
