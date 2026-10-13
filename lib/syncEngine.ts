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

export const deletePillFromCloudById = async (
  pillId: string,
  expectedUserId: string
): Promise<SyncResult> => {
  if (!await verifySessionUser(expectedUserId)) {
    return { success: false, error: 'User changed', aborted: true };
  }

  const { error } = await supabase
    .from('pills')
    .delete()
    .eq('id', pillId)
    .eq('user_id', expectedUserId);

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
  };

  const entry: OutboxEntry = {
    id: pill.id,
    type,
    pill: type === 'upsert' ? updated : undefined,
    updatedAt: now,
    userId,
  };
  addToOutbox(userId, entry);

  return updated;
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
