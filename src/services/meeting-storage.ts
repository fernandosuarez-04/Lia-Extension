/**
 * Meeting Storage Service
 * Handles dual storage: Chrome local storage + Supabase sync
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';

// Types
export interface MeetingParticipant {
  id: string;
  name: string;
  joinedAt: number;
}

export interface CaptionEntry {
  id: string;
  speaker: string;
  text: string;
  timestamp: number;
  relativeTimeMs: number;
}

export interface MeetingSession {
  id: string;
  userId?: string;
  platform: 'google-meet' | 'zoom' | 'teams';
  title: string;
  url: string;
  startTime: number;
  endTime?: number;
  participants: MeetingParticipant[];
  captions: CaptionEntry[];
  summary?: string;
  actionItems?: string[];
}

// Chrome Storage Keys
const STORAGE_KEYS = {
  ACTIVE_MEETING: 'lia_active_meeting',
  MEETING_HISTORY: 'lia_meeting_history',
  MEETING_SETTINGS: 'lia_meeting_settings',
};

// Maximum meetings to keep in local history
const MAX_LOCAL_HISTORY = 50;

/**
 * Save meeting to Chrome local storage
 */
export async function saveToLocalStorage(meeting: MeetingSession): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      console.warn('Chrome storage not available');
      resolve();
      return;
    }

    chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_MEETING]: meeting }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Get active meeting from Chrome local storage
 */
export async function getFromLocalStorage(): Promise<MeetingSession | null> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve(null);
      return;
    }

    chrome.storage.local.get([STORAGE_KEYS.ACTIVE_MEETING], (result) => {
      resolve(result[STORAGE_KEYS.ACTIVE_MEETING] || null);
    });
  });
}

/**
 * Clear active meeting from Chrome local storage
 */
export async function clearLocalStorage(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve();
      return;
    }

    chrome.storage.local.remove([STORAGE_KEYS.ACTIVE_MEETING], () => {
      resolve();
    });
  });
}

/**
 * Add meeting to local history
 */
export async function addToLocalHistory(meeting: MeetingSession): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve();
      return;
    }

    chrome.storage.local.get([STORAGE_KEYS.MEETING_HISTORY], (result) => {
      const history: MeetingSession[] = result[STORAGE_KEYS.MEETING_HISTORY] || [];

      // Add to beginning of array
      history.unshift(meeting);

      // Limit history size
      const trimmedHistory = history.slice(0, MAX_LOCAL_HISTORY);

      chrome.storage.local.set({ [STORAGE_KEYS.MEETING_HISTORY]: trimmedHistory }, () => {
        resolve();
      });
    });
  });
}

/**
 * Get meeting history from local storage
 */
export async function getLocalHistory(): Promise<MeetingSession[]> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve([]);
      return;
    }

    chrome.storage.local.get([STORAGE_KEYS.MEETING_HISTORY], (result) => {
      resolve(result[STORAGE_KEYS.MEETING_HISTORY] || []);
    });
  });
}

// ============ Supabase Functions ============

/**
 * Save meeting session to Supabase
 */
export async function saveToSupabase(meeting: MeetingSession): Promise<string | null> {
  if (!isSupabaseConfigured()) {
    console.warn('Supabase not configured, skipping cloud sync');
    return null;
  }

  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      console.warn('No authenticated user, skipping Supabase sync');
      return null;
    }

    // Insert meeting session
    const { data: sessionData, error: sessionError } = await supabase
      .from('meeting_sessions')
      .insert({
        id: meeting.id,
        user_id: userData.user.id,
        platform: meeting.platform,
        title: meeting.title,
        start_time: new Date(meeting.startTime).toISOString(),
        end_time: meeting.endTime ? new Date(meeting.endTime).toISOString() : null,
        participants: meeting.participants,
        metadata: { url: meeting.url },
        summary: meeting.summary,
        action_items: meeting.actionItems,
      })
      .select('id')
      .single();

    if (sessionError) {
      console.error('Error saving meeting session to Supabase:', sessionError);
      return null;
    }

    // Insert transcripts in batches
    if (meeting.captions.length > 0) {
      const transcripts = meeting.captions.map((caption) => ({
        session_id: sessionData.id,
        speaker: caption.speaker,
        text: caption.text,
        timestamp: new Date(caption.timestamp).toISOString(),
        relative_time_ms: caption.relativeTimeMs,
      }));

      // Insert in batches of 100
      const batchSize = 100;
      for (let i = 0; i < transcripts.length; i += batchSize) {
        const batch = transcripts.slice(i, i + batchSize);
        const { error: transcriptError } = await supabase
          .from('meeting_transcripts')
          .insert(batch);

        if (transcriptError) {
          console.error('Error saving transcripts batch to Supabase:', transcriptError);
        }
      }
    }

    console.log('Meeting saved to Supabase:', sessionData.id);
    return sessionData.id;
  } catch (error) {
    console.error('Error syncing to Supabase:', error);
    return null;
  }
}

/**
 * Update meeting session in Supabase
 */
export async function updateInSupabase(
  meetingId: string,
  updates: Partial<MeetingSession>
): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }

  try {
    const updateData: Record<string, unknown> = {};

    if (updates.endTime) {
      updateData.end_time = new Date(updates.endTime).toISOString();
    }
    if (updates.summary) {
      updateData.summary = updates.summary;
    }
    if (updates.actionItems) {
      updateData.action_items = updates.actionItems;
    }
    if (updates.participants) {
      updateData.participants = updates.participants;
    }

    const { error } = await supabase
      .from('meeting_sessions')
      .update(updateData)
      .eq('id', meetingId);

    if (error) {
      console.error('Error updating meeting in Supabase:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error updating in Supabase:', error);
    return false;
  }
}

/**
 * Get meeting sessions from Supabase
 */
export async function getMeetingsFromSupabase(limit = 20): Promise<MeetingSession[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return [];
    }

    const { data, error } = await supabase
      .from('meeting_sessions')
      .select('*')
      .eq('user_id', userData.user.id)
      .order('start_time', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching meetings from Supabase:', error);
      return [];
    }

    return data.map((session) => ({
      id: session.id,
      userId: session.user_id,
      platform: session.platform,
      title: session.title,
      url: session.metadata?.url || '',
      startTime: new Date(session.start_time).getTime(),
      endTime: session.end_time ? new Date(session.end_time).getTime() : undefined,
      participants: session.participants || [],
      captions: [],
      summary: session.summary,
      actionItems: session.action_items,
    }));
  } catch (error) {
    console.error('Error getting meetings from Supabase:', error);
    return [];
  }
}

/**
 * Get transcripts for a meeting from Supabase
 */
export async function getTranscriptsFromSupabase(sessionId: string): Promise<CaptionEntry[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('meeting_transcripts')
      .select('*')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: true });

    if (error) {
      console.error('Error fetching transcripts from Supabase:', error);
      return [];
    }

    return data.map((transcript) => ({
      id: transcript.id,
      speaker: transcript.speaker,
      text: transcript.text,
      timestamp: new Date(transcript.timestamp).getTime(),
      relativeTimeMs: transcript.relative_time_ms,
    }));
  } catch (error) {
    console.error('Error getting transcripts from Supabase:', error);
    return [];
  }
}

// ============ Combined Storage Functions ============

/**
 * Save meeting to both local storage and Supabase
 */
export async function saveMeeting(meeting: MeetingSession): Promise<void> {
  // Save locally first (fast, always works)
  await saveToLocalStorage(meeting);

  // Sync to Supabase in background (may fail, that's ok)
  saveToSupabase(meeting).catch((err) => {
    console.warn('Failed to sync meeting to Supabase:', err);
  });
}

/**
 * Finalize and archive a completed meeting
 */
export async function finalizeMeeting(meeting: MeetingSession): Promise<void> {
  // Set end time if not set
  if (!meeting.endTime) {
    meeting.endTime = Date.now();
  }

  // Add to local history
  await addToLocalHistory(meeting);

  // Clear active meeting from local storage
  await clearLocalStorage();

  // Save final state to Supabase
  await saveToSupabase(meeting);
}

/**
 * Add a caption to the current meeting
 */
export async function addCaption(caption: CaptionEntry): Promise<void> {
  const meeting = await getFromLocalStorage();
  if (!meeting) {
    console.warn('No active meeting to add caption to');
    return;
  }

  meeting.captions.push(caption);

  // Save updated meeting locally
  await saveToLocalStorage(meeting);
}

/**
 * Update participants in the current meeting
 */
export async function updateParticipants(participants: MeetingParticipant[]): Promise<void> {
  const meeting = await getFromLocalStorage();
  if (!meeting) {
    return;
  }

  meeting.participants = participants;
  await saveToLocalStorage(meeting);
}

/**
 * Generate a unique meeting ID
 */
export function generateMeetingId(): string {
  return `meet_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a new meeting session
 */
export function createMeetingSession(
  title: string,
  url: string,
  platform: 'google-meet' | 'zoom' | 'teams' = 'google-meet'
): MeetingSession {
  return {
    id: generateMeetingId(),
    platform,
    title,
    url,
    startTime: Date.now(),
    participants: [],
    captions: [],
  };
}
