// services/pillsService.ts
// Syncs pills to Supabase cloud database - non-destructive sync with error handling

import { supabase } from '../lib/supabase';
import type { Pill } from '../types';

export interface SyncResult {
  success: boolean;
  error?: string;
  aborted?: boolean;
}

// Load all pills for the current user from Supabase
export const loadPillsFromCloud = async (): Promise<Pill[]> => {
  const { data, error } = await supabase
    .from('pills')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw error;

  // Parse reminders and history JSON from DB
  return (data || []).map(row => ({
    ...row.pill_data,
    id: row.id,
  }));
};

// Verify that the current session user matches the expected user
// Returns the verified user or null if mismatch/no session
const verifySessionUser = async (expectedUserId: string): Promise<boolean> => {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id === expectedUserId;
};

// Sync pills to cloud using per-record upsert/delete (non-destructive)
// Only syncs the delta - inserts new, updates changed, deletes removed
// Aborts if the session user doesn't match expectedUserId
export const syncPillsToCloud = async (
  expectedUserId: string,
  pills: Pill[],
  existingCloudIds: Set<string>
): Promise<SyncResult> => {
  // Verify user before starting
  if (!await verifySessionUser(expectedUserId)) {
    return { success: false, error: 'User changed during sync', aborted: true };
  }

  const localIds = new Set(pills.map(p => p.id));
  const errors: string[] = [];

  // Upsert all local pills (insert or update)
  for (const pill of pills) {
    // Re-verify user before each operation to catch mid-sync changes
    if (!await verifySessionUser(expectedUserId)) {
      return { success: false, error: 'User changed during sync', aborted: true };
    }

    const { error } = await supabase.from('pills').upsert({
      id: pill.id,
      user_id: expectedUserId,
      pill_name: pill.name,
      pill_data: pill,
    }, {
      onConflict: 'id',
    });

    if (error) {
      errors.push(`Failed to save ${pill.name}: ${error.message}`);
    }
  }

  // Delete pills that exist in cloud but not locally (user deleted them)
  const idsToDelete = [...existingCloudIds].filter(id => !localIds.has(id));
  for (const id of idsToDelete) {
    // Re-verify user before delete
    if (!await verifySessionUser(expectedUserId)) {
      return { success: false, error: 'User changed during sync', aborted: true };
    }

    const { error } = await supabase.from('pills').delete().eq('id', id);
    if (error) {
      errors.push(`Failed to delete pill ${id}: ${error.message}`);
    }
  }

  if (errors.length > 0) {
    return { success: false, error: errors.join('; ') };
  }

  return { success: true };
};

// Save a single pill (upsert)
export const savePillToCloud = async (pill: Pill, expectedUserId: string): Promise<SyncResult> => {
  if (!await verifySessionUser(expectedUserId)) {
    return { success: false, error: 'User changed', aborted: true };
  }

  const { error } = await supabase.from('pills').upsert({
    id: pill.id,
    user_id: expectedUserId,
    pill_name: pill.name,
    pill_data: pill,
  }, {
    onConflict: 'id',
  });

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
};

// Delete a pill from cloud
export const deletePillFromCloud = async (pillId: string, expectedUserId: string): Promise<SyncResult> => {
  if (!await verifySessionUser(expectedUserId)) {
    return { success: false, error: 'User changed', aborted: true };
  }

  const { error } = await supabase.from('pills').delete().eq('id', pillId);
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
};
