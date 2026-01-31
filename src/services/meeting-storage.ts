/**
 * Meeting Storage Service
 * Handles all Supabase operations for meeting sessions and transcripts
 */

import { supabase } from '../lib/supabase';

// Type definitions matching Supabase schema
export interface MeetingSession {
  id: string;
  user_id: string;
  platform: 'google-meet' | 'zoom';
  title: string | null;
  meeting_url: string | null;
  start_time: string;
  end_time: string | null;
  duration_seconds: number | null;
  participants: string[];
  participant_count: number;
  summary: string | null;
  summary_type: 'short' | 'detailed' | 'action_items' | 'executive' | null;
  detected_language: 'es' | 'en' | 'pt';
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface TranscriptSegment {
  id: string;
  session_id: string;
  timestamp: string;
  relative_time_ms: number;
  speaker: string | null;
  text: string;
  is_lia_response: boolean;
  is_lia_invocation: boolean;
  language: string;
  confidence: number | null;
  created_at: string;
}

export interface MeetingActionItem {
  id: string;
  session_id: string;
  description: string;
  assignee: string | null;
  due_date: string | null;
  status: 'pending' | 'in_progress' | 'completed';
  source_segment_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MeetingExport {
  id: string;
  session_id: string;
  export_type: 'pdf' | 'txt' | 'docx';
  include_transcript: boolean;
  include_summary: boolean;
  include_action_items: boolean;
  file_url: string | null;
  file_size_bytes: number | null;
  created_at: string;
}

export interface UserMeetingStats {
  total_meetings: number;
  total_duration_hours: number;
  avg_duration_minutes: number;
  meetings_this_month: number;
  most_used_platform: string | null;
}

// Input types for creating records
export type CreateMeetingSessionInput = Omit<MeetingSession, 'id' | 'created_at' | 'updated_at' | 'duration_seconds'>;
export type CreateTranscriptSegmentInput = Omit<TranscriptSegment, 'id' | 'created_at'>;
export type CreateActionItemInput = Omit<MeetingActionItem, 'id' | 'created_at' | 'updated_at'>;

class MeetingStorageService {
  // ==================== SESSION OPERATIONS ====================

  /**
   * Create a new meeting session
   */
  async createSession(data: Partial<CreateMeetingSessionInput>): Promise<MeetingSession> {
    const sessionData = {
      user_id: data.user_id,
      platform: data.platform || 'google-meet',
      title: data.title || null,
      meeting_url: data.meeting_url || null,
      start_time: data.start_time || new Date().toISOString(),
      participants: data.participants || [],
      participant_count: data.participant_count || 1,
      detected_language: data.detected_language || 'es',
      metadata: data.metadata || {}
    };

    const { data: session, error } = await supabase
      .from('meeting_sessions')
      .insert(sessionData)
      .select()
      .single();

    if (error) {
      console.error('MeetingStorage: Error creating session', error);
      throw new Error(`Failed to create meeting session: ${error.message}`);
    }

    return session;
  }

  /**
   * Update an existing meeting session
   */
  async updateSession(id: string, data: Partial<MeetingSession>): Promise<void> {
    const { error } = await supabase
      .from('meeting_sessions')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.error('MeetingStorage: Error updating session', error);
      throw new Error(`Failed to update meeting session: ${error.message}`);
    }
  }

  /**
   * End a meeting session (set end_time and optionally summary)
   */
  async endSession(id: string, summary?: string, summaryType?: MeetingSession['summary_type']): Promise<void> {
    const updateData: Partial<MeetingSession> = {
      end_time: new Date().toISOString()
    };

    if (summary) {
      updateData.summary = summary;
      updateData.summary_type = summaryType || 'detailed';
    }

    await this.updateSession(id, updateData);
  }

  /**
   * Get a meeting session by ID
   */
  async getSession(id: string): Promise<MeetingSession | null> {
    const { data, error } = await supabase
      .from('meeting_sessions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      console.error('MeetingStorage: Error fetching session', error);
      throw new Error(`Failed to fetch meeting session: ${error.message}`);
    }

    return data;
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userId: string, limit: number = 50): Promise<MeetingSession[]> {
    const { data, error } = await supabase
      .from('meeting_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('start_time', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('MeetingStorage: Error fetching user sessions', error);
      throw new Error(`Failed to fetch user sessions: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Delete a meeting session (cascades to transcripts and action items)
   */
  async deleteSession(id: string): Promise<void> {
    const { error } = await supabase
      .from('meeting_sessions')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('MeetingStorage: Error deleting session', error);
      throw new Error(`Failed to delete meeting session: ${error.message}`);
    }
  }

  // ==================== TRANSCRIPT OPERATIONS ====================

  /**
   * Add a single transcript segment
   */
  async addTranscriptSegment(segment: Partial<CreateTranscriptSegmentInput>): Promise<TranscriptSegment> {
    const segmentData = {
      session_id: segment.session_id,
      timestamp: segment.timestamp || new Date().toISOString(),
      relative_time_ms: segment.relative_time_ms || 0,
      speaker: segment.speaker || null,
      text: segment.text || '',
      is_lia_response: segment.is_lia_response || false,
      is_lia_invocation: segment.is_lia_invocation || false,
      language: segment.language || 'es',
      confidence: segment.confidence || null
    };

    const { data, error } = await supabase
      .from('transcript_segments')
      .insert(segmentData)
      .select()
      .single();

    if (error) {
      console.error('MeetingStorage: Error adding transcript segment', error);
      throw new Error(`Failed to add transcript segment: ${error.message}`);
    }

    return data;
  }

  /**
   * Add multiple transcript segments in batch
   */
  async addTranscriptBatch(segments: Partial<CreateTranscriptSegmentInput>[]): Promise<void> {
    if (segments.length === 0) return;

    const segmentsData = segments.map(segment => ({
      session_id: segment.session_id,
      timestamp: segment.timestamp || new Date().toISOString(),
      relative_time_ms: segment.relative_time_ms || 0,
      speaker: segment.speaker || null,
      text: segment.text || '',
      is_lia_response: segment.is_lia_response || false,
      is_lia_invocation: segment.is_lia_invocation || false,
      language: segment.language || 'es',
      confidence: segment.confidence || null
    }));

    const { error } = await supabase
      .from('transcript_segments')
      .insert(segmentsData);

    if (error) {
      console.error('MeetingStorage: Error adding transcript batch', error);
      throw new Error(`Failed to add transcript batch: ${error.message}`);
    }
  }

  /**
   * Get all transcript segments for a session
   */
  async getTranscript(sessionId: string): Promise<TranscriptSegment[]> {
    const { data, error } = await supabase
      .from('transcript_segments')
      .select('*')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: true });

    if (error) {
      console.error('MeetingStorage: Error fetching transcript', error);
      throw new Error(`Failed to fetch transcript: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get transcript as plain text
   */
  async getTranscriptAsText(sessionId: string): Promise<string> {
    const segments = await this.getTranscript(sessionId);

    return segments.map(segment => {
      const time = new Date(segment.timestamp).toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit'
      });
      const speaker = segment.speaker || (segment.is_lia_response ? 'Lia' : 'Participante');
      return `[${time}] ${speaker}: ${segment.text}`;
    }).join('\n');
  }

  // ==================== ACTION ITEMS OPERATIONS ====================

  /**
   * Add an action item
   */
  async addActionItem(item: Partial<CreateActionItemInput>): Promise<MeetingActionItem> {
    const itemData = {
      session_id: item.session_id,
      description: item.description || '',
      assignee: item.assignee || null,
      due_date: item.due_date || null,
      status: item.status || 'pending',
      source_segment_id: item.source_segment_id || null
    };

    const { data, error } = await supabase
      .from('meeting_action_items')
      .insert(itemData)
      .select()
      .single();

    if (error) {
      console.error('MeetingStorage: Error adding action item', error);
      throw new Error(`Failed to add action item: ${error.message}`);
    }

    return data;
  }

  /**
   * Get action items for a session
   */
  async getActionItems(sessionId: string): Promise<MeetingActionItem[]> {
    const { data, error } = await supabase
      .from('meeting_action_items')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('MeetingStorage: Error fetching action items', error);
      throw new Error(`Failed to fetch action items: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Update action item status
   */
  async updateActionItemStatus(id: string, status: MeetingActionItem['status']): Promise<void> {
    const { error } = await supabase
      .from('meeting_action_items')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.error('MeetingStorage: Error updating action item status', error);
      throw new Error(`Failed to update action item status: ${error.message}`);
    }
  }

  // ==================== EXPORT OPERATIONS ====================

  /**
   * Record a PDF export
   */
  async recordExport(sessionId: string, options: Partial<MeetingExport>): Promise<MeetingExport> {
    const exportData = {
      session_id: sessionId,
      export_type: options.export_type || 'pdf',
      include_transcript: options.include_transcript ?? true,
      include_summary: options.include_summary ?? true,
      include_action_items: options.include_action_items ?? true,
      file_url: options.file_url || null,
      file_size_bytes: options.file_size_bytes || null
    };

    const { data, error } = await supabase
      .from('meeting_exports')
      .insert(exportData)
      .select()
      .single();

    if (error) {
      console.error('MeetingStorage: Error recording export', error);
      throw new Error(`Failed to record export: ${error.message}`);
    }

    return data;
  }

  // ==================== STATISTICS ====================

  /**
   * Get user meeting statistics
   */
  async getUserStats(userId: string): Promise<UserMeetingStats> {
    const { data, error } = await supabase
      .rpc('get_user_meeting_stats', { p_user_id: userId });

    if (error) {
      console.error('MeetingStorage: Error fetching user stats', error);
      // Return default stats if function doesn't exist yet
      return {
        total_meetings: 0,
        total_duration_hours: 0,
        avg_duration_minutes: 0,
        meetings_this_month: 0,
        most_used_platform: null
      };
    }

    return data?.[0] || {
      total_meetings: 0,
      total_duration_hours: 0,
      avg_duration_minutes: 0,
      meetings_this_month: 0,
      most_used_platform: null
    };
  }
}

// Export singleton instance
export const meetingStorage = new MeetingStorageService();
export default meetingStorage;
