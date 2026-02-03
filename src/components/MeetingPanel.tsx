/**
 * Meeting Panel Component
 * Professional UI for meeting transcription, Lia interaction, and PDF export
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MeetingManager, MeetingStatus, TranscriptSegmentLocal, MeetingCallbacks } from '../services/meeting-manager';
import { MeetingSession, TranscriptSegment } from '../services/meeting-storage';
import { PDFExportService } from '../services/pdf-export';
import { meetingStorage } from '../services/meeting-storage';
import { getApiKeyWithCache } from '../services/api-keys';
import { GOOGLE_API_KEY } from '../config';

interface MeetingPanelProps {
  userId: string;
  onClose?: () => void;
}

type SummaryType = 'short' | 'detailed' | 'action_items' | 'executive';

// Styles object using CSS variables
const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: 'var(--bg-dark-main)',
    color: 'var(--color-white)',
    fontFamily: 'Inter, sans-serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid var(--bg-dark-secondary)',
    background: 'linear-gradient(180deg, var(--bg-dark-secondary) 0%, var(--bg-dark-main) 100%)',
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  headerIcon: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    background: 'linear-gradient(135deg, var(--color-accent) 0%, #00a88e 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(0, 212, 179, 0.3)',
  },
  title: {
    fontSize: '16px',
    fontWeight: 600,
    margin: 0,
    letterSpacing: '-0.01em',
  },
  closeButton: {
    background: 'transparent',
    border: 'none',
    color: 'var(--color-gray-medium)',
    cursor: 'pointer',
    padding: '8px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 20px',
    backgroundColor: 'var(--bg-dark-secondary)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  },
  statusIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    animation: 'pulse 2s infinite',
  },
  statusText: {
    fontSize: '13px',
    fontWeight: 500,
  },
  platformBadge: {
    fontSize: '11px',
    fontWeight: 500,
    padding: '4px 10px',
    borderRadius: '12px',
    backgroundColor: 'var(--bg-dark-tertiary)',
    color: 'var(--color-gray-medium)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  errorBanner: {
    margin: '12px 20px 0',
    padding: '12px 16px',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: '13px',
    color: '#fca5a5',
  },
  mainContent: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  idleSection: {
    padding: '24px 20px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  },
  detectButton: {
    width: '100%',
    padding: '14px 20px',
    backgroundColor: 'var(--bg-dark-secondary)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '12px',
    color: 'var(--color-white)',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    transition: 'all 0.2s ease',
  },
  meetingCard: {
    padding: '20px',
    backgroundColor: 'var(--bg-dark-secondary)',
    borderRadius: '14px',
    border: '1px solid rgba(255, 255, 255, 0.06)',
  },
  meetingCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '16px',
  },
  liveDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: '#10b981',
    boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.2)',
    animation: 'pulse 2s infinite',
  },
  meetingPlatform: {
    fontSize: '15px',
    fontWeight: 600,
    color: 'var(--color-white)',
  },
  meetingTitle: {
    fontSize: '13px',
    color: 'var(--color-gray-medium)',
    marginBottom: '16px',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
    overflow: 'hidden',
  },
  startButton: {
    width: '100%',
    padding: '14px 20px',
    background: 'linear-gradient(135deg, var(--color-accent) 0%, #00a88e 100%)',
    border: 'none',
    borderRadius: '12px',
    color: '#000',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    boxShadow: '0 4px 12px rgba(0, 212, 179, 0.3)',
    transition: 'all 0.2s ease',
  },
  noMeetingText: {
    textAlign: 'center' as const,
    color: 'var(--color-gray-medium)',
    fontSize: '14px',
    lineHeight: 1.6,
    padding: '20px 0',
  },
  controlsBar: {
    padding: '16px 20px',
    borderBottom: '1px solid var(--bg-dark-secondary)',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backgroundColor: 'var(--bg-dark-main)',
  },
  iconButton: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  liaButton: {
    flex: 1,
    padding: '12px 20px',
    background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)',
    border: 'none',
    borderRadius: '12px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3)',
    transition: 'all 0.2s ease',
  },
  transcriptContainer: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '16px 20px',
  },
  transcriptSegment: {
    padding: '14px 16px',
    borderRadius: '12px',
    marginBottom: '10px',
    backgroundColor: 'var(--bg-dark-secondary)',
    border: '1px solid rgba(255, 255, 255, 0.04)',
  },
  transcriptSegmentLia: {
    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(124, 58, 237, 0.1) 100%)',
    border: '1px solid rgba(139, 92, 246, 0.2)',
  },
  segmentHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
  },
  speakerName: {
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  timestamp: {
    fontSize: '11px',
    color: 'var(--color-gray-medium)',
    fontWeight: 400,
  },
  segmentText: {
    fontSize: '14px',
    lineHeight: 1.6,
    color: 'rgba(255, 255, 255, 0.9)',
    margin: 0,
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 20px',
    textAlign: 'center' as const,
  },
  emptyIcon: {
    width: '64px',
    height: '64px',
    borderRadius: '16px',
    backgroundColor: 'var(--bg-dark-secondary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '16px',
  },
  emptyText: {
    fontSize: '14px',
    color: 'var(--color-gray-medium)',
    margin: 0,
  },
  endedSection: {
    padding: '20px',
    overflowY: 'auto' as const,
    flex: 1,
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--color-white)',
    marginBottom: '12px',
    marginTop: '20px',
  },
  summaryButtons: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '8px',
  },
  summaryButton: {
    padding: '10px 16px',
    backgroundColor: 'var(--bg-dark-secondary)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '10px',
    color: 'var(--color-white)',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  summaryCard: {
    padding: '16px',
    backgroundColor: 'var(--bg-dark-secondary)',
    borderRadius: '12px',
    border: '1px solid rgba(0, 212, 179, 0.2)',
    marginTop: '16px',
    maxHeight: '200px',
    overflowY: 'auto' as const,
  },
  summaryLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--color-accent)',
    marginBottom: '8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  summaryText: {
    fontSize: '14px',
    lineHeight: 1.6,
    color: 'rgba(255, 255, 255, 0.85)',
    whiteSpace: 'pre-wrap' as const,
    margin: 0,
  },
  exportButton: {
    width: '100%',
    padding: '14px 20px',
    background: 'linear-gradient(135deg, var(--color-accent) 0%, #00a88e 100%)',
    border: 'none',
    borderRadius: '12px',
    color: '#000',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    marginTop: '20px',
    boxShadow: '0 4px 12px rgba(0, 212, 179, 0.3)',
  },
  newMeetingButton: {
    width: '100%',
    padding: '14px 20px',
    backgroundColor: 'var(--bg-dark-secondary)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '12px',
    color: 'var(--color-white)',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    marginTop: '10px',
  },
};

// Status configurations with helpful descriptions
const statusConfig: Record<MeetingStatus | 'ready', { text: string; color: string; bgColor: string; description?: string }> = {
  idle: { text: 'Sin reunión', color: '#6b7280', bgColor: 'rgba(107, 114, 128, 0.2)' },
  ready: { text: 'Listo para iniciar', color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.2)' },
  connecting: { text: 'Conectando...', color: '#fbbf24', bgColor: 'rgba(251, 191, 36, 0.2)', description: 'Selecciona la pestaña de la reunión en el diálogo' },
  transcribing: { text: 'Transcribiendo', color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.2)', description: 'Capturando audio de la reunión' },
  lia_responding: { text: 'SOFLIA respondiendo', color: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.2)' },
  paused: { text: 'Pausado', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.2)' },
  reconnecting: { text: 'Reconectando...', color: '#fbbf24', bgColor: 'rgba(251, 191, 36, 0.2)', description: 'Reestableciendo conexión con Live API' },
  error: { text: 'Error de conexión', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.2)' },
  ended: { text: 'Finalizado', color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.2)' },
};

// Icons
const VideoIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 7l-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4.35-4.35" />
  </svg>
);

const PlayIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const MicIcon = ({ muted }: { muted: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {muted ? (
      <>
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </>
    ) : (
      <>
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </>
    )}
  </svg>
);

const StopIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const SparkleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const WaveIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4">
    <path d="M2 12h2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H2v-8z" />
    <path d="M8 8h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8V8z" />
    <path d="M14 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2V4z" />
    <path d="M20 10h2v4h-2a2 2 0 0 1 0-4z" />
  </svg>
);

export const MeetingPanel: React.FC<MeetingPanelProps> = ({ userId, onClose }) => {
  // State
  const [status, setStatus] = useState<MeetingStatus>('idle');
  const [isDetectingMeeting, setIsDetectingMeeting] = useState(false);
  const [detectedMeeting, setDetectedMeeting] = useState<{
    platform: 'google-meet' | 'zoom' | null;
    title?: string;
    canCapture: boolean;
  } | null>(null);
  const [session, setSession] = useState<MeetingSession | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegmentLocal[]>([]);
  const [summary, setSummary] = useState<string>('');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [error, setError] = useState<string>('');
  const [isMicMuted, setIsMicMuted] = useState(false);

  // Refs
  const meetingManagerRef = useRef<MeetingManager | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  // Helper to inject content script if not loaded
  const ensureContentScript = async (tabId: number): Promise<boolean> => {
    try {
      // Try to ping the content script
      const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      return response?.pong === true;
    } catch {
      // Content script not loaded, inject it
      console.log('Content script not loaded, injecting...');
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['assets/content.js'],
        });
        // Wait a bit for the script to initialize
        await new Promise((resolve) => setTimeout(resolve, 300));
        return true;
      } catch (injectErr) {
        console.error('Failed to inject content script:', injectErr);
        return false;
      }
    }
  };

  // Detect meeting on mount
  const detectMeeting = useCallback(async () => {
    setIsDetectingMeeting(true);
    setError('');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.id) {
        setDetectedMeeting(null);
        return;
      }

      // Ensure content script is loaded
      const scriptReady = await ensureContentScript(tab.id);
      if (!scriptReady) {
        setError('No se pudo cargar el script en la página');
        setDetectedMeeting(null);
        return;
      }

      // Now try to detect meeting
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'canCaptureMeeting' });

      if (response) {
        setDetectedMeeting({
          platform: response.meetingInfo?.platform || null,
          title: response.meetingInfo?.title,
          canCapture: response.canCapture || false,
        });
      } else {
        setDetectedMeeting(null);
      }
    } catch (err) {
      console.error('Error detecting meeting:', err);
      setError('Error al detectar reunión. Intenta recargar la página.');
      setDetectedMeeting(null);
    } finally {
      setIsDetectingMeeting(false);
    }
  }, []);

  useEffect(() => {
    detectMeeting();
  }, [detectMeeting]);

  // Meeting manager callbacks
  const meetingCallbacks: MeetingCallbacks = {
    onTranscriptUpdate: (segment) => {
      setTranscript((prev) => [...prev, segment]);
    },
    onLiaResponse: (text, _audioData) => {
      if (text) {
        setTranscript((prev) => [
          ...prev,
          {
            id: `lia_${Date.now()}`,
            timestamp: Date.now(),
            relativeTimeMs: Date.now() - (session?.start_time ? new Date(session.start_time).getTime() : Date.now()),
            text,
            isLiaResponse: true,
            isLiaInvocation: false,
          },
        ]);
      }
    },
    onStatusChange: (newStatus) => {
      setStatus(newStatus);
    },
    onError: (err) => {
      setError(err.message);
      console.error('Meeting error:', err);
    },
    onSessionEnd: (endedSession) => {
      setSession(endedSession);
    },
  };

  // Start meeting capture
  const startMeeting = async () => {
    if (!detectedMeeting?.platform || !detectedMeeting.canCapture) {
      setError('No se detectó una reunión activa');
      return;
    }

    setError('');
    setStatus('connecting');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.id) {
        throw new Error('No se pudo obtener la pestaña activa');
      }

      meetingManagerRef.current = new MeetingManager(meetingCallbacks);

      const newSession = await meetingManagerRef.current.startSession(
        tab.id,
        detectedMeeting.platform,
        userId,
        detectedMeeting.title,
        tab.url
      );

      setSession(newSession);
      setTranscript([]);
      setSummary('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar la reunión');
      setStatus('error');
    }
  };

  // End meeting
  const endMeeting = async () => {
    if (!meetingManagerRef.current) return;

    try {
      await meetingManagerRef.current.endSession(true);
      meetingManagerRef.current = null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al terminar la reunión');
    }
  };

  // Toggle microphone
  const toggleMic = () => {
    if (meetingManagerRef.current) {
      setIsMicMuted(!isMicMuted);
    }
  };

  // Invoke Lia
  const invokeLia = async (prompt?: string) => {
    if (!meetingManagerRef.current) return;

    try {
      await meetingManagerRef.current.invokeLia(prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al invocar a SOFLIA');
    }
  };

  // Generate summary
  const generateSummary = async (type: SummaryType) => {
    if (!meetingManagerRef.current && transcript.length === 0) {
      setError('No hay transcripción para resumir');
      return;
    }

    setIsGeneratingSummary(true);
    setError('');

    try {
      let summaryText: string;

      if (meetingManagerRef.current) {
        summaryText = await meetingManagerRef.current.generateSummary(type);
      } else {
        const transcriptText = transcript
          .map((s) => {
            const time = new Date(s.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            const speaker = s.isLiaResponse ? 'SOFLIA' : (s.speaker || 'Participante');
            return `[${time}] ${speaker}: ${s.text}`;
          })
          .join('\n');

        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        // Get API key from database or fallback to env
        let apiKey = await getApiKeyWithCache('google');
        if (!apiKey) {
          apiKey = GOOGLE_API_KEY;
        }
        if (!apiKey) {
          throw new Error('No API key configured');
        }
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const result = await model.generateContent(`Resume esta reunión (${type}):\n\n${transcriptText}`);
        summaryText = result.response.text();
      }

      setSummary(summaryText);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al generar resumen');
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  // Export to PDF
  const exportPDF = async () => {
    if (!session) {
      setError('No hay sesión para exportar');
      return;
    }

    try {
      const pdfService = new PDFExportService('es');

      let fullTranscript: TranscriptSegment[] = transcript.map((s) => ({
        id: s.id,
        session_id: session.id,
        timestamp: new Date(s.timestamp).toISOString(),
        relative_time_ms: s.relativeTimeMs,
        speaker: s.isLiaResponse ? 'SOFLIA' : (s.speaker || null),
        text: s.text,
        is_lia_response: s.isLiaResponse,
        is_lia_invocation: s.isLiaInvocation,
        language: 'es',
        confidence: null as number | null,
        created_at: new Date().toISOString(),
      }));

      if (status === 'ended') {
        try {
          const storedTranscript = await meetingStorage.getTranscript(session.id);
          if (storedTranscript.length > 0) {
            fullTranscript = storedTranscript;
          }
        } catch (e) {
          console.warn('Could not fetch stored transcript', e);
        }
      }

      const blob = await pdfService.generateMeetingPDF(
        {
          session: { ...session, summary: summary || session.summary || null },
          transcript: fullTranscript,
        },
        {
          includeTranscript: true,
          includeSummary: !!summary || !!session.summary,
          includeActionItems: false,
          language: 'es',
        }
      );

      PDFExportService.downloadPDF(blob, PDFExportService.generateFilename(session));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al exportar PDF');
    }
  };

  // Show "ready" status when meeting is detected but not started
  const displayStatus = status === 'idle' && detectedMeeting?.platform ? 'ready' : status;
  const currentStatus = statusConfig[displayStatus];
  const isActive = status === 'transcribing' || status === 'lia_responding' || status === 'paused';

  return (
    <div style={styles.container}>
      {/* CSS for animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerTitle}>
          <div style={styles.headerIcon}>
            <VideoIcon />
          </div>
          <h2 style={styles.title}>Agente de Reuniones</h2>
        </div>
        {onClose && (
          <button
            style={styles.closeButton}
            onClick={onClose}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-dark-secondary)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <CloseIcon />
          </button>
        )}
      </div>

      {/* Status Bar */}
      <div style={styles.statusBar}>
        <div style={{ ...styles.statusIndicator, flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                ...styles.statusDot,
                backgroundColor: currentStatus.color,
                boxShadow: `0 0 0 3px ${currentStatus.bgColor}`,
                animation: (status === 'transcribing' || status === 'reconnecting' || status === 'connecting') ? 'pulse 1.5s infinite' : 'none',
              }}
            />
            <span style={{ ...styles.statusText, color: currentStatus.color }}>{currentStatus.text}</span>
          </div>
          {currentStatus.description && (status === 'connecting' || status === 'reconnecting') && (
            <span style={{ fontSize: '11px', color: 'var(--color-gray-medium)', marginLeft: '16px' }}>
              {currentStatus.description}
            </span>
          )}
        </div>
        {session && <span style={styles.platformBadge}>{session.platform === 'google-meet' ? 'Meet' : 'Zoom'}</span>}
      </div>

      {/* Error Banner */}
      {error && (
        <div style={styles.errorBanner}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
            <span>{error}</span>
            {status === 'error' && (
              <button
                onClick={() => {
                  setError('');
                  setStatus('idle');
                  detectMeeting();
                }}
                style={{
                  background: 'rgba(239, 68, 68, 0.2)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  borderRadius: '6px',
                  color: '#fca5a5',
                  cursor: 'pointer',
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 500,
                  marginTop: '4px',
                  width: 'fit-content',
                }}
              >
                Reintentar
              </button>
            )}
          </div>
          <button
            onClick={() => setError('')}
            style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: '4px' }}
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {/* Main Content */}
      <div style={styles.mainContent}>
        {/* Idle State - Detection */}
        {status === 'idle' && (
          <div style={styles.idleSection}>
            <button
              style={styles.detectButton}
              onClick={detectMeeting}
              disabled={isDetectingMeeting}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
            >
              {isDetectingMeeting ? (
                <>
                  <div
                    style={{
                      width: '16px',
                      height: '16px',
                      border: '2px solid var(--color-accent)',
                      borderTopColor: 'transparent',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                    }}
                  />
                  Detectando...
                </>
              ) : (
                <>
                  <SearchIcon />
                  Detectar Reunión
                </>
              )}
            </button>

            {detectedMeeting && (
              <div style={styles.meetingCard}>
                {detectedMeeting.platform ? (
                  <>
                    <div style={styles.meetingCardHeader}>
                      <div style={styles.liveDot} />
                      <span style={styles.meetingPlatform}>
                        {detectedMeeting.platform === 'google-meet' ? 'Google Meet' : 'Zoom'} detectado
                      </span>
                    </div>
                    {detectedMeeting.title && <p style={styles.meetingTitle}>{detectedMeeting.title}</p>}
                    <button
                      style={{
                        ...styles.startButton,
                        opacity: detectedMeeting.canCapture ? 1 : 0.5,
                        cursor: detectedMeeting.canCapture ? 'pointer' : 'not-allowed',
                      }}
                      onClick={startMeeting}
                      disabled={!detectedMeeting.canCapture}
                    >
                      <PlayIcon />
                      Iniciar Transcripción
                    </button>
                  </>
                ) : (
                  <p style={styles.noMeetingText}>
                    No se detectó ninguna reunión activa.
                    <br />
                    Abre Google Meet o Zoom para comenzar.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Active Meeting Controls */}
        {isActive && (
          <div style={styles.controlsBar}>
            <button
              style={{
                ...styles.iconButton,
                backgroundColor: isMicMuted ? '#ef4444' : 'var(--bg-dark-secondary)',
                color: isMicMuted ? '#fff' : 'var(--color-white)',
              }}
              onClick={toggleMic}
              title={isMicMuted ? 'Activar micrófono' : 'Silenciar micrófono'}
            >
              <MicIcon muted={isMicMuted} />
            </button>

            <button
              style={{
                ...styles.liaButton,
                opacity: status === 'lia_responding' ? 0.7 : 1,
                cursor: status === 'lia_responding' ? 'not-allowed' : 'pointer',
              }}
              onClick={() => invokeLia()}
              disabled={status === 'lia_responding'}
            >
              <SparkleIcon />
              {status === 'lia_responding' ? 'SOFLIA respondiendo...' : 'Invocar a SOFLIA'}
            </button>

            <button
              style={{
                ...styles.iconButton,
                backgroundColor: '#ef4444',
                color: '#fff',
              }}
              onClick={endMeeting}
              title="Finalizar reunión"
            >
              <StopIcon />
            </button>
          </div>
        )}

        {/* Transcript View */}
        {transcript.length > 0 && (
          <div style={styles.transcriptContainer}>
            {transcript.map((segment) => (
              <div
                key={segment.id}
                style={{
                  ...styles.transcriptSegment,
                  ...(segment.isLiaResponse ? styles.transcriptSegmentLia : {}),
                }}
              >
                <div style={styles.segmentHeader}>
                  <span
                    style={{
                      ...styles.speakerName,
                      color: segment.isLiaResponse ? '#a78bfa' : 'var(--color-accent)',
                    }}
                  >
                    {segment.isLiaResponse ? 'SOFLIA' : (segment.speaker || 'Participante')}
                  </span>
                  <span style={styles.timestamp}>
                    {new Date(segment.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p style={styles.segmentText}>{segment.text}</p>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        )}

        {/* Empty State while transcribing */}
        {isActive && transcript.length === 0 && (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>
              <WaveIcon />
            </div>
            <p style={styles.emptyText}>Esperando audio...</p>
            <p style={{ ...styles.emptyText, fontSize: '12px', marginTop: '12px', maxWidth: '260px', lineHeight: '1.5' }}>
              <strong>Tip:</strong> Si no ves transcripción después de unos segundos, verifica que hayas compartido la pestaña correcta (Google Meet o Zoom) y que esté marcada la opción "Compartir audio".
            </p>
          </div>
        )}

        {/* Session Ended - Summary & Export */}
        {status === 'ended' && (
          <div style={styles.endedSection}>
            <h3 style={{ ...styles.sectionTitle, marginTop: 0 }}>Generar Resumen</h3>
            <div style={styles.summaryButtons}>
              {(['short', 'detailed', 'action_items', 'executive'] as SummaryType[]).map((type) => (
                <button
                  key={type}
                  style={{
                    ...styles.summaryButton,
                    opacity: isGeneratingSummary ? 0.6 : 1,
                    cursor: isGeneratingSummary ? 'not-allowed' : 'pointer',
                  }}
                  onClick={() => generateSummary(type)}
                  disabled={isGeneratingSummary}
                  onMouseEnter={(e) => {
                    if (!isGeneratingSummary) e.currentTarget.style.borderColor = 'var(--color-accent)';
                  }}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
                >
                  {type === 'short' && 'Corto'}
                  {type === 'detailed' && 'Detallado'}
                  {type === 'action_items' && 'Acciones'}
                  {type === 'executive' && 'Ejecutivo'}
                </button>
              ))}
            </div>

            {summary && (
              <div style={styles.summaryCard}>
                <div style={styles.summaryLabel}>Resumen</div>
                <p style={styles.summaryText}>{summary}</p>
              </div>
            )}

            <button style={styles.exportButton} onClick={exportPDF}>
              <DownloadIcon />
              Exportar PDF
            </button>

            <button
              style={styles.newMeetingButton}
              onClick={() => {
                setStatus('idle');
                setSession(null);
                setTranscript([]);
                setSummary('');
                detectMeeting();
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
            >
              Nueva Reunión
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default MeetingPanel;
