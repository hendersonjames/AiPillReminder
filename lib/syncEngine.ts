// lib/syncEngine.ts
// Merge-based sync engine: preserves local dirty changes, uses tombstones for deletes
// Prevents data loss from offline edits and stale-tab resurrection

import type { Pill, OutboxEntry } from '../types';
import { supabase } from './supabase';
import {
  loadOutboxFromStorage,
  saveOutboxToStorage,
  addToOutbox,
  removeFromOutbox,
} from './storage';

// ─── Conflict Resolution ──────────────────────────────────────────────────────

export interface MergeResult {
  pills: Pill[];
  hasLocalChanges: boolean;
}

export const mergePills = (
  localPills: Pill[],
  cloudPills: Pill[],
  outbox: OutboxEntry[]
): MergeResult => {
  const outboxIds = new Set(outbox.map(e => e.id));
  const outboxByPillId = new Map(outbox.map(e => [e.id, e]));
  const cloudById = new Map(cloudPills.map(p => [p.id, p]));
  const merged: Pill[] = [];
  const seenIds = new Set<string>();
  const idsToRemoveFromOutbox: { userId: string; id: string }[] = [];

  for (const localPill of localPills) {
    seenIds.add(localPill.id);
    const cloudPill = cloudById.get(localPill.id);
    const inOutbox = outboxIds.has(localPill.id);
    const outboxEntry = outboxByPillId.get(localPill.id);

    // TOMBSTONE-WINS RULE: If cloud has a tombstone for this pill,
    // it cannot be revived by local non-delete edits from stale clients.
    // Only a local delete (also a tombstone) can match it.
    if (cloudPill?.deleted) {
      // Cloud has tombstone - pill stays deleted regardless of local state
      // unless local also has a newer delete tombstone in outbox
      if (inOutbox && outboxEntry?.type === 'delete') {
        // Both deleted - keep the tombstone for sync
        merged.push(localPill.deleted ? localPill : cloudPill);
      }
      // Otherwise, do nothing - tombstone wins, pill is gone
      continue;
    }

    if (localPill.deleted) {
      if (inOutbox) {
        merged.push(localPill);
      }
      continue;
    }

    if (!cloudPill) {
      if (inOutbox) {
        merged.push(localPill);
      }
      continue;
    }

    if (inOutbox && outboxEntry) {
      // Treat non-finite updatedAt as 0 to handle NaN/undefined/Infinity
      const localTime = Number.isFinite(localPill.updatedAt) ? localPill.updatedAt! : 0;
      const cloudTime = Number.isFinite(cloudPill.updatedAt) ? cloudPill.updatedAt! : 0;
      if (localTime >= cloudTime) {
        merged.push(localPill);
      } else {
        merged.push(cloudPill);
        idsToRemoveFromOutbox.push({ userId: outboxEntry.userId, id: localPill.id });
      }
    } else {
      merged.push(cloudPill);
    }
  }

  for (const cloudPill of cloudPills) {
    // Skip tombstones and already-seen pills
    if (!seenIds.has(cloudPill.id) && !cloudPill.deleted) {
      merged.push(cloudPill);
    }
  }

  // Remove stale outbox entries (cloud had newer data)
  for (const { userId, id } of idsToRemoveFromOutbox) {
    removeFromOutbox(userId, id);
  }

  return {
    pills: merged.filter(p => !p.deleted),
    hasLocalChanges: outbox.length > idsToRemoveFromOutbox.length,
  };
};

// ─── Cloud Operations ─────────────────────────────────────────────────────────

export interface SyncResult {
  success: boolean;
  error?: string;
  aborted?: boolean;
}

const verifySessionUser = async (expectedUserId: string): Promise<boolean> => {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id === expectedUserId;
};

export interface UpsertResult extends SyncResult {
  tombstoned?: boolean; // True if the row was a tombstone and write was blocked
}

// Upsert pill to cloud with tombstone protection:
// - For existing rows: conditional update that only succeeds if NOT tombstoned
// - For new rows: insert only (never overwrite a tombstone with same id)
// This prevents stale browsers from resurrecting deleted pills
export const upsertPillToCloud = async (
  pill: Pill,
  expectedUserId: string
): Promise<UpsertResult> => {
  if (!await verifySessionUser(expectedUserId)) {
    return { success: false, error: 'User changed', aborted: true };
  }

  const updatedAt = pill.updatedAt 
    ? new Date(pill.updatedAt).toISOString() 
    : new Date().toISOString();

  // First, try to UPDATE existing row only if it's NOT tombstoned
  // This prevents stale browsers from resurrecting deleted pills
  const { data: updateData, error: updateError } = await supabase
    .from('pills')
    .update({
      pill_name: pill.name,
      pill_data: pill,
      updated_at: updatedAt,
    })
    .eq('id', pill.id)
    .eq('user_id', expectedUserId)
    .or('pill_data->>deleted.is.null,pill_data->>deleted.neq.true')
    .select('id');

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  // If update matched a row, we're done
  if (updateData && updateData.length > 0) {
    return { success: true };
  }

  // Update matched 0 rows - either row doesn't exist OR it's tombstoned
  // Check if row exists and is tombstoned
  const { data: existingRow } = await supabase
    .from('pills')
    .select('pill_data')
    .eq('id', pill.id)
    .eq('user_id', expectedUserId)
    .single();

  if (existingRow) {
    // Row exists but update didn't match - must be tombstoned
    // Return tombstoned=true so caller can drop the pill locally
    return { success: false, tombstoned: true, error: 'Pill was deleted' };
  }

  // Row doesn't exist - INSERT new row
  const { error: insertError } = await supabase
    .from('pills')
    .insert({
      id: pill.id,
      user_id: expectedUserId,
      pill_name: pill.name,
      pill_data: pill,
      updated_at: updatedAt,
    });

  if (insertError) {
    // Handle race condition: another client inserted between our check and insert
    if (insertError.code === '23505') { // unique_violation
      // Row was inserted by another client - check if it's tombstoned
      const { data: raceRow } = await supabase
        .from('pills')
        .select('pill_data')
        .eq('id', pill.id)
        .eq('user_id', expectedUserId)
        .single();
      
      if (raceRow?.pill_data?.deleted) {
        return { success: false, tombstoned: true, error: 'Pill was deleted' };
      }
      // Another client inserted a non-tombstone - that's fine, they win
      return { success: true };
    }
    return { success: false, error: insertError.message };
  }

  return { success: true };
};

// Create a minimal tombstone with NO health data (privacy)
// Only keeps: id, deleted, deletedAt, updatedAt
export const createTombstone = (pillId: string, now: number = Date.now()): Pill => ({
  id: pillId,
  name: '',
  dosage: '',
  reminders: [],
  deleted: true,
  deletedAt: now,
  updatedAt: now,
});

// Soft-delete: upsert with minimal tombstone instead of hard DELETE
// This prevents resurrection from stale browsers that still have the pill
// Tombstone-wins: a tombstoned row cannot be revived by a non-delete edit
// PRIVACY: Tombstone contains NO health data (name, dosage, history, notes stripped)
export const deletePillFromCloudById = async (
  pillId: string,
  expectedUserId: string,
  _pill?: Pill // Ignored - we never keep pill data in tombstones
): Promise<SyncResult> => {
  if (!await verifySessionUser(expectedUserId)) {
    return { success: false, error: 'User changed', aborted: true };
  }

  const now = Date.now();
  const tombstone = createTombstone(pillId, now);

  const { error } = await supabase.from('pills').upsert({
    id: pillId,
    user_id: expectedUserId,
    pill_name: '[deleted]',
    pill_data: tombstone,
    updated_at: new Date(now).toISOString(),
  }, {
    onConflict: 'id',
  });

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
};

// ─── Outbox Processing ────────────────────────────────────────────────────────

export interface FlushResult extends SyncResult {
  tombstonedIds?: string[]; // IDs that were tombstoned and should be dropped locally
}

export const flushOutbox = async (userId: string): Promise<FlushResult> => {
  const outbox = loadOutboxFromStorage(userId);
  if (outbox.length === 0) {
    return { success: true };
  }

  const errors: string[] = [];
  const tombstonedIds: string[] = [];

  for (const entry of outbox) {
    if (entry.userId !== userId) continue;

    let result: UpsertResult;
    if (entry.type === 'delete') {
      // No need to pass pill - tombstones are minimal (privacy)
      result = await deletePillFromCloudById(entry.id, userId);
    } else if (entry.pill) {
      result = await upsertPillToCloud(entry.pill, userId);
    } else {
      removeFromOutbox(userId, entry.id);
      continue;
    }

    if (result.aborted) {
      return { success: false, error: 'User changed during sync', aborted: true };
    }

    if (result.success) {
      removeFromOutbox(userId, entry.id);
    } else if (result.tombstoned) {
      // Row is tombstoned - remove from outbox and tell caller to drop locally
      removeFromOutbox(userId, entry.id);
      tombstonedIds.push(entry.id);
    } else {
      errors.push(result.error || 'Unknown error');
    }
  }

  if (errors.length > 0) {
    return { success: false, error: errors.join('; '), tombstonedIds };
  }
  return { success: true, tombstonedIds };
};

// ─── Local Change Tracking ────────────────────────────────────────────────────

export const markPillDirty = (
  userId: string,
  pill: Pill,
  type: 'upsert' | 'delete'
): Pill => {
  const now = Date.now();
  
  // For delete: create minimal tombstone with NO health data (privacy)
  // For upsert: keep full pill data
  const updated: Pill = type === 'delete' 
    ? createTombstone(pill.id, now)
    : { ...pill, updatedAt: now };

  const entry: OutboxEntry = {
    id: pill.id,
    type,
    // For delete: minimal tombstone only (privacy)
    // For upsert: full pill data
    pill: updated,
    updatedAt: now,
    userId,
  };
  addToOutbox(userId, entry);

  return updated;
};

export const hasUnsyncedChanges = (userId: string): boolean => {
  const outbox = loadOutboxFromStorage(userId);
  return outbox.length > 0;
};

// ─── Multi-Tab Coordination ───────────────────────────────────────────────────

// Per-user channel name to prevent cross-user message leakage
export const getSyncChannelName = (userId: string): string => `remedi_sync_${userId}`;

// Message includes full pill data so tab B doesn't read stale storage
export interface SyncMessage {
  type: 'pill_changed' | 'pill_deleted' | 'pills_loaded';
  pillId?: string;
  pill?: Pill; // Full pill data for immediate apply
  userId: string;
  timestamp: number;
}

// Validate incoming message shape
export const isValidSyncMessage = (data: unknown): data is SyncMessage => {
  if (!data || typeof data !== 'object') return false;
  const msg = data as Record<string, unknown>;
  
  if (typeof msg.type !== 'string') return false;
  if (!['pill_changed', 'pill_deleted', 'pills_loaded'].includes(msg.type)) return false;
  if (typeof msg.userId !== 'string') return false;
  if (typeof msg.timestamp !== 'number') return false;
  if (msg.pillId !== undefined && typeof msg.pillId !== 'string') return false;
  // pill is optional object
  if (msg.pill !== undefined && (typeof msg.pill !== 'object' || msg.pill === null)) return false;
  
  return true;
};

// Create a SyncMessage object
export const createSyncMessage = (
  type: 'pill_changed' | 'pill_deleted' | 'pills_loaded',
  userId: string,
  pillId?: string,
  pill?: Pill
): SyncMessage => ({
  type,
  pillId,
  pill,
  userId,
  timestamp: Date.now(),
});

// ─── Web Locks for Single-Tab Flush ───────────────────────────────────────────

// Lock name per user to ensure only one tab flushes at a time
export const getFlushLockName = (userId: string): string => `remedi_flush_${userId}`;

// Check if Web Locks API is available
export const hasWebLocks = (): boolean => {
  return typeof navigator !== 'undefined' && 'locks' in navigator;
};

// Acquire a lock and run the callback. Returns false if lock couldn't be acquired.
// Uses ifAvailable mode: if another tab holds the lock, returns immediately with false.
export const withFlushLock = async <T>(
  userId: string,
  callback: () => Promise<T>
): Promise<{ acquired: boolean; result?: T }> => {
  if (!hasWebLocks()) {
    // Fallback: no locking, just run the callback
    const result = await callback();
    return { acquired: true, result };
  }
  
  try {
    let acquired = false;
    let result: T | undefined;
    
    await navigator.locks.request(
      getFlushLockName(userId),
      { ifAvailable: true },
      async (lock) => {
        if (lock) {
          acquired = true;
          result = await callback();
        }
        // If lock is null, another tab holds it - we skip
      }
    );
    
    return { acquired, result };
  } catch {
    // Lock API failed - fallback to running without lock
    const result = await callback();
    return { acquired: true, result };
  }
};
