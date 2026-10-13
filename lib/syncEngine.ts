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
  loadPillsFromStorage,
  savePillsToStorage,
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
      const localTime = localPill.updatedAt ?? 0;
      const cloudTime = cloudPill.updatedAt ?? 0;
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

export const upsertPillToCloud = async (
  pill: Pill,
  expectedUserId: string
): Promise<SyncResult> => {
  if (!await verifySessionUser(expectedUserId)) {
    return { success: false, error: 'User changed', aborted: true };
  }

  const { error } = await supabase.from('pills').upsert({
    id: pill.id,
    user_id: expectedUserId,
    pill_name: pill.name,
    pill_data: pill,
    updated_at: pill.updatedAt ? new Date(pill.updatedAt).toISOString() : new Date().toISOString(),
  }, {
    onConflict: 'id',
  });

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
};

// Soft-delete: upsert with deleted tombstone instead of hard DELETE
// This prevents resurrection from stale browsers that still have the pill
// Tombstone-wins: a tombstoned row cannot be revived by a non-delete edit
export const deletePillFromCloudById = async (
  pillId: string,
  expectedUserId: string,
  pill?: Pill
): Promise<SyncResult> => {
  if (!await verifySessionUser(expectedUserId)) {
    return { success: false, error: 'User changed', aborted: true };
  }

  const now = Date.now();
  const tombstone: Pill = pill ? {
    ...pill,
    deleted: true,
    deletedAt: now,
    updatedAt: now,
  } : {
    id: pillId,
    name: '',
    dosage: '',
    reminders: [],
    deleted: true,
    deletedAt: now,
    updatedAt: now,
  };

  const { error } = await supabase.from('pills').upsert({
    id: pillId,
    user_id: expectedUserId,
    pill_name: tombstone.name || '[deleted]',
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

export const flushOutbox = async (userId: string): Promise<SyncResult> => {
  const outbox = loadOutboxFromStorage(userId);
  if (outbox.length === 0) {
    return { success: true };
  }

  const errors: string[] = [];

  for (const entry of outbox) {
    if (entry.userId !== userId) continue;

    let result: SyncResult;
    if (entry.type === 'delete') {
      // Pass pill for full tombstone data (preserves history, etc.)
      result = await deletePillFromCloudById(entry.id, userId, entry.pill);
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
    } else {
      errors.push(result.error || 'Unknown error');
    }
  }

  if (errors.length > 0) {
    return { success: false, error: errors.join('; ') };
  }
  return { success: true };
};

// ─── Local Change Tracking ────────────────────────────────────────────────────

export const markPillDirty = (
  userId: string,
  pill: Pill,
  type: 'upsert' | 'delete'
): Pill => {
  const now = Date.now();
  const updated: Pill = {
    ...pill,
    updatedAt: now,
    deleted: type === 'delete' ? true : undefined,
    deletedAt: type === 'delete' ? now : undefined,
  };

  const entry: OutboxEntry = {
    id: pill.id,
    type,
    // Include pill for both upsert and delete (delete needs it for full tombstone)
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

const SYNC_CHANNEL_NAME = 'remedi_sync_channel';

export interface SyncMessage {
  type: 'pill_changed' | 'pill_deleted' | 'pills_loaded';
  pillId?: string;
  pill?: Pill;
  userId: string;
  timestamp: number;
}

let broadcastChannel: BroadcastChannel | null = null;

export const initBroadcastChannel = (
  onMessage: (msg: SyncMessage) => void
): (() => void) => {
  if (typeof BroadcastChannel === 'undefined') {
    return () => {};
  }

  broadcastChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
  broadcastChannel.onmessage = (event) => {
    if (event.data && typeof event.data === 'object') {
      onMessage(event.data as SyncMessage);
    }
  };

  return () => {
    if (broadcastChannel) {
      broadcastChannel.close();
      broadcastChannel = null;
    }
  };
};

export const broadcastPillChange = (
  type: 'pill_changed' | 'pill_deleted',
  userId: string,
  pillId: string,
  pill?: Pill
): void => {
  if (!broadcastChannel) return;
  
  const msg: SyncMessage = {
    type,
    pillId,
    pill,
    userId,
    timestamp: Date.now(),
  };
  
  try {
    broadcastChannel.postMessage(msg);
  } catch {
    // Ignore errors (e.g., channel closed)
  }
};

export const broadcastPillsLoaded = (userId: string): void => {
  if (!broadcastChannel) return;
  
  const msg: SyncMessage = {
    type: 'pills_loaded',
    userId,
    timestamp: Date.now(),
  };
  
  try {
    broadcastChannel.postMessage(msg);
  } catch {
    // Ignore
  }
};
