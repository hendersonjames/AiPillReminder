// services/authService.ts
import { supabase } from '../lib/supabase';
import { wipeLocalUserData } from '../lib/storage';
import { cancelAllScheduledNotifications } from './notificationService';
import type { User } from '../lib/supabase';

export type { User };

export interface SignOutResult {
  success: boolean;
  localOnly: boolean;
  error?: string;
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

// Sign out with retry on network failure
// Always clears local session and user data, even if server revocation fails
export const signOut = async (userId?: string): Promise<SignOutResult> => {
  // Cancel native notifications BEFORE anything else
  // This ensures A's medication names don't keep showing up
  await cancelAllScheduledNotifications();

  // Try global sign-out (revokes all sessions on server)
  const { error: globalError } = await supabase.auth.signOut();
  
  if (globalError) {
    // Network failure or server error - fall back to local-only sign-out
    // This removes the local session so the device is signed out
    const { error: localError } = await supabase.auth.signOut({ scope: 'local' });
    
    // Clear user data AFTER session is removed
    if (userId) {
      wipeLocalUserData(userId);
    }
    
    if (localError) {
      return {
        success: false,
        localOnly: true,
        error: 'Could not sign out. Please try again.',
      };
    }
    
    return {
      success: true,
      localOnly: true,
      error: 'Signed out on this device; could not reach server to revoke other sessions.',
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
