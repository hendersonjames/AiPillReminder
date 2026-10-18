// services/pillsService.ts
// Cloud load for pills - all syncing is done via the outbox in syncEngine.ts

import { supabase } from '../lib/supabase';
import type { Pill } from '../types';

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
    // Use client updatedAt from pill_data, not server's updated_at (avoids clock skew)
    updatedAt: row.pill_data?.updatedAt ?? (row.updated_at ? new Date(row.updated_at).getTime() : undefined),
  }));
};
