// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(supabaseUrl && supabaseKey);

// Graceful fallback — app renders even without env vars (shows config screen)
export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : createClient('https://placeholder.supabase.co', 'placeholder-key');

// Get the storage key used by Supabase auth
// Default format: sb-<project-ref>-auth-token
export const getSupabaseStorageKey = (): string => {
  // Extract project ref from URL (e.g., "qtnyrywhtashompuqqlf" from "https://qtnyrywhtashompuqqlf.supabase.co")
  const url = supabaseUrl || '';
  const match = url.match(/https:\/\/([^.]+)\.supabase/);
  const projectRef = match ? match[1] : 'placeholder';
  return `sb-${projectRef}-auth-token`;
};

// Force-remove Supabase session from device storage (no network call)
// Used when network sign-out fails to ensure device is signed out
export const forceRemoveSession = (): void => {
  const storageKey = getSupabaseStorageKey();
  const projectRef = storageKey.replace('sb-', '').replace('-auth-token', '');
  
  // Remove all Supabase auth-related keys
  const keysToRemove = [
    storageKey,                              // Main session token
    `sb-${projectRef}-auth-token-code-verifier`, // PKCE code verifier
    `sb-${projectRef}-user`,                 // Cached user (older versions)
  ];
  
  keysToRemove.forEach(key => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore errors
    }
  });
};

// Check if a Supabase session exists in storage
export const hasSessionInStorage = (): boolean => {
  try {
    const storageKey = getSupabaseStorageKey();
    return localStorage.getItem(storageKey) !== null;
  } catch {
    return false;
  }
};

export type { User, Session } from '@supabase/supabase-js';
