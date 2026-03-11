// services/pillsService.ts
// Syncs pills to Supabase cloud database

import { supabase } from '../lib/supabase';
import type { Pill } from '../types';

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

// Save all pills (full sync) to Supabase
export const syncPillsToCloud = async (pills: Pill[]): Promise<void> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Delete all existing pills and re-insert
  // Simple approach — good for small datasets like pill lists
  await supabase.from('pills').delete().eq('user_id', user.id);

  if (pills.length === 0) return;

  const rows = pills.map(pill => ({
    id: pill.id,
    user_id: user.id,
    pill_name: pill.name,
    pill_data: pill, // Store full pill object as JSON
    created_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from('pills').insert(rows);
  if (error) throw error;
};

// Save a single new pill
export const savePillToCloud = async (pill: Pill): Promise<void> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase.from('pills').upsert({
    id: pill.id,
    user_id: user.id,
    pill_name: pill.name,
    pill_data: pill,
  });

  if (error) throw error;
};

// Delete a pill from cloud
export const deletePillFromCloud = async (pillId: string): Promise<void> => {
  const { error } = await supabase.from('pills').delete().eq('id', pillId);
  if (error) throw error;
};
