// services/pillsService.ts
// Syncs pills to Supabase cloud database - merge-based sync with offline support
// Uses per-pill upserts and explicit deletes (no bulk delete/reinsert)

import { supabase } from '../lib/supabase';
import type { Pill, OutboxEntry } from '../types';
import {
  loadOutboxFromStorage,
  removeFromOutbox,
  loadPillsFromStorage,
} from '../lib/storage';
import {
  mergePills,
  upsertPillToCloud,
  deletePillFromCloudById,
  flushOutbox,
  type SyncResult,
} from '../lib/syncEngine';

export type { SyncResult } from '../lib/syncEngine';

// Load all pills for the current user from Supabase
export const loadPillsFromCloud = async (): Promise<Pill[]> => {
  const { data, error } = await supabase
    .from('pills')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data || []).map(row => ({
    ...row.pill_data,
    id: row.id,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
  }));
};

// Load and merge: gets cloud pills and merges with local dirty changes
// This preserves offline edits instead of overwriting them
export const loadAndMergePills = async (userId: string): Promise<{
  pills: Pill[];
  hasLocalChanges: boolean;
}> => {
  const cloudPills = await loadPillsFromCloud();
  const localPills = loadPillsFromStorage(userId);
  const outbox = loadOutboxFromStorage(userId);

  return mergePills(localPills, cloudPills, outbox);
};

// Verify that the current session user matches the expected user
const verifySessionUser = async (expectedUserId: string): Promise<boolean> => {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id === expectedUserId;
};

// Sync a single pill change to cloud (upsert)
// Uses outbox for offline support
export const syncPillChange = async (
  pill: Pill,
  expectedUserId: string
): Promise<SyncResult> => {
  const result = await upsertPillToCloud(pill, expectedUserId);
  if (result.success) {
    removeFromOutbox(expectedUserId, pill.id);
  }
  return result;
};

// Delete a single pill from cloud
// Uses explicit delete by ID (not bulk delete)
export const syncPillDelete = async (
  pillId: string,
  expectedUserId: string
): Promise<SyncResult> => {
  const result = await deletePillFromCloudById(pillId, expectedUserId);
  if (result.success) {
    removeFromOutbox(expectedUserId, pillId);
  }
  return result;
};

// Flush all pending outbox entries to cloud
// Called on visibility change, sign-out, etc.
export const flushPendingChanges = async (userId: string): Promise<SyncResult> => {
  return flushOutbox(userId);
};

// Legacy API compatibility - sync all pills
// Now uses per-pill upserts and only deletes pills marked as deleted
export const syncPillsToCloud = async (
  expectedUserId: string,
  pills: Pill[],
  existingCloudIds: Set<string>
): Promise<SyncResult> => {
  if (!await verifySessionUser(expectedUserId)) {
    return { success: false, error: 'User changed during sync', aborted: true };
  }

  const errors: string[] = [];

  // Upsert all non-deleted pills
  for (const pill of pills) {
    if (pill.deleted) continue;
    
    if (!await verifySessionUser(expectedUserId)) {
      return { success: false, error: 'User changed during sync', aborted: true };
    }

    const result = await upsertPillToCloud(pill, expectedUserId);
    if (!result.success && !result.aborted) {
      errors.push(result.error || 'Unknown error');
    }
    if (result.aborted) {
      return result;
    }
  }

  // Delete pills that are in existingCloudIds but not in local pills
  // This handles pills deleted locally that need to be removed from cloud
  const localIds = new Set(pills.filter(p => !p.deleted).map(p => p.id));
  for (const id of existingCloudIds) {
    if (localIds.has(id)) continue;
    
    if (!await verifySessionUser(expectedUserId)) {
      return { success: false, error: 'User changed during sync', aborted: true };
    }

    const result = await deletePillFromCloudById(id, expectedUserId);
    if (!result.success && !result.aborted) {
      errors.push(result.error || 'Unknown error');
    }
    if (result.aborted) {
      return result;
    }
  }

  if (errors.length > 0) {
    return { success: false, error: errors.join('; ') };
  }

  return { success: true };
};

// Save a single pill (upsert) - legacy API
export const savePillToCloud = async (pill: Pill, expectedUserId: string): Promise<SyncResult> => {
  return upsertPillToCloud(pill, expectedUserId);
};

// Delete a pill from cloud - legacy API
export const deletePillFromCloud = async (pillId: string, expectedUserId: string): Promise<SyncResult> => {
  return deletePillFromCloudById(pillId, expectedUserId);
};
