/**
 * MeetingPanel Component
 * Shows meeting transcription UI with Lia voice interaction
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { LiveClient, AudioCapture } from '../services/live-api';
import {
  MeetingSession,
  CaptionEntry,
  getFromLocalStorage,
  finalizeMeeting,
} from '../services/meeting-storage';

interface MeetingPanelProps {
  onClose: () => void;
}

export function MeetingPanel({ onClose }: MeetingPanelProps) {
  // Meeting state
  const [meeting, setMeeting] = useState<MeetingSession | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'active' | 'ended'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Lia voice state
  const [isLiaActive, setIsLiaActive] = useState(false);
  const [isLiaConnecting, setIsLiaConnecting] = useState(false);
  const [isLiaMicActive, setIsLiaMicActive] = useState(false);
  const [liaResponse, setLiaResponse] = useState<string>('');
  const liveClientRef = useRef<LiveClient | null>(null);
  const audioCaptureRef = useRef<AudioCapture | null>(null);

  // UI state
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, _setAutoScroll] = useState(true);

  // Load meeting state from background
  useEffect(() => {
    const loadMeetingState = async () => {
      // First check local storage
      const localMeeting = await getFromLocalStorage();
      if (localMeeting) {
        setMeeting(localMeeting);
        setStatus('active');
        return;
      }

      // Then check background script
      chrome.runtime.sendMessage({ type: 'GET_MEETING_STATE' }, (response) => {
        console.log('MeetingPanel: Got state from background:', response);
        if (response?.isActive) {
          const meetingData: MeetingSession = {
            id: `meet_${response.startTime || Date.now()}`,
            platform: 'google-meet',
            title: response.title || 'Reunión de Google Meet',
            url: response.url || '',
            startTime: response.startTime || Date.now(),
            participants: (response.participants || []).map((p: any) => ({
              id: p.id || `p_${Date.now()}`,
              name: p.name || 'Participante',
              joinedAt: Date.now(),
            })),
            captions: (response.captions || []).map((c: any, i: number) => ({
              id: `cap_${i}`,
              speaker: c.speaker || 'Participante',
              text: c.text || '',
              timestamp: c.timestamp || Date.now(),
              relativeTimeMs: (c.timestamp || Date.now()) - (response.startTime || Date.now()),
            })),
          };
          setMeeting(meetingData);
          setStatus('active');
        } else {
          // No meeting state in background - try to trigger detection on the Meet tab
          console.log('MeetingPanel: No meeting state, requesting content script to start...');
          setStatus('connecting');
          chrome.runtime.sendMessage({ type: 'START_MEET_TRANSCRIPTION' }, (startResp) => {
            console.log('MeetingPanel: Start transcription response:', startResp);
            if (!startResp?.sent) {
              setStatus('idle');
            }
            // If sent, we'll get MEETING_STATE_CHANGED from background when content script detects the meeting
          });
        }
      });
    };

    loadMeetingState();

    // Listen for updates from background
    const messageListener = (message: any) => {
      if (message.type === 'MEETING_STATE_CHANGED') {
        console.log('MeetingPanel: Meeting state changed:', message.state);
        if (message.state?.isActive) {
          const meetingData: MeetingSession = {
            id: `meet_${message.state.startTime || Date.now()}`,
            platform: 'google-meet',
            title: message.state.title || 'Reunión de Google Meet',
            url: message.state.url || '',
            startTime: message.state.startTime || Date.now(),
            participants: [],
            captions: [],
          };
          setMeeting(meetingData);
          setStatus('active');
        } else {
          setStatus('ended');
        }
      } else if (message.type === 'MEETING_UPDATE') {
        setMeeting((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            captions: message.captions || prev.captions,
            participants: message.participants || prev.participants,
          };
        });
      } else if (message.type === 'CAPTION_RECEIVED') {
        setMeeting((prev) => {
          if (!prev) return prev;

          const newText = message.text || '';
          if (!newText || newText.length < 3) return prev;

          // Check if this caption is a duplicate or update
          const existingIndex = prev.captions.findIndex((c) => {
            // Exact match
            if (c.text === newText) return true;
            // New text contains old (update)
            if (newText.includes(c.text) && newText.length > c.text.length) return true;
            // Old contains new (duplicate/partial)
            if (c.text.includes(newText)) return true;
            return false;
          });

          if (existingIndex !== -1) {
            // Update existing caption if new is longer
            const existing = prev.captions[existingIndex];
            if (newText.length > existing.text.length) {
              const updatedCaptions = [...prev.captions];
              updatedCaptions[existingIndex] = {
                ...existing,
                text: newText,
              };
              return { ...prev, captions: updatedCaptions };
            }
            // Otherwise skip (duplicate)
            return prev;
          }

          // Truly new caption
          const newCaption: CaptionEntry = {
            id: `cap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            speaker: message.speaker || 'Participante',
            text: newText,
            timestamp: Date.now(),
            relativeTimeMs: Date.now() - prev.startTime,
          };
          return {
            ...prev,
            captions: [...prev.captions, newCaption],
          };
        });
      } else if (message.type === 'PARTICIPANTS_UPDATED') {
        setMeeting((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            participants: message.participants || [],
          };
        });
      } else if (message.type === 'MEETING_ENDED') {
        setStatus('ended');
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  // Auto scroll to bottom when new captions arrive
  useEffect(() => {
    if (autoScroll && transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [meeting?.captions.length, autoScroll]);

  // Connect to Lia voice
  const connectLia = useCallback(async () => {
    if (isLiaConnecting || isLiaActive) return;

    setIsLiaConnecting(true);
    setError(null);

    try {
      const client = new LiveClient({
        onTextResponse: (text) => {
          setLiaResponse((prev) => prev + text);
        },
        onAudioResponse: () => {
          // Audio is handled internally by LiveClient
        },
        onError: (err) => {
          console.error('Lia error:', err);
          setError(err.message);
          disconnectLia();
        },
        onClose: () => {
          setIsLiaActive(false);
          setIsLiaConnecting(false);
        },
        onReady: () => {
          setIsLiaActive(true);
          setIsLiaConnecting(false);
        },
      });

      await client.connect();
      liveClientRef.current = client;

      // Send context about the meeting
      if (meeting && meeting.captions.length > 0) {
        const recentTranscript = meeting.captions
          .slice(-20)
          .map((c) => `${c.speaker}: ${c.text}`)
          .join('\n');

        client.sendText(
          `Estás en una reunión de Google Meet. Aquí está el contexto reciente de la conversación:\n\n${recentTranscript}\n\nAhora el usuario te va a hablar. Responde de forma concisa y útil.`
        );
      }
    } catch (err: any) {
      console.error('Failed to connect Lia:', err);
      setError(err.message || 'Error al conectar con Lia');
      setIsLiaConnecting(false);
    }
  }, [isLiaConnecting, isLiaActive, meeting]);

  // Disconnect Lia
  const disconnectLia = useCallback(() => {
    if (audioCaptureRef.current) {
      audioCaptureRef.current.stop();
      audioCaptureRef.current = null;
    }

    if (liveClientRef.current) {
      liveClientRef.current.disconnect();
      liveClientRef.current = null;
    }

    setIsLiaActive(false);
    setIsLiaMicActive(false);
    setIsLiaConnecting(false);
  }, []);

  // Toggle Lia microphone
  const toggleLiaMic = useCallback(async () => {
    if (!isLiaActive || !liveClientRef.current) {
      await connectLia();
      return;
    }

    if (isLiaMicActive) {
      // Stop mic
      if (audioCaptureRef.current) {
        audioCaptureRef.current.stop();
        audioCaptureRef.current = null;
      }
      setIsLiaMicActive(false);
    } else {
      // Start mic
      try {
        const capture = new AudioCapture();
        await capture.start((base64Audio) => {
          if (liveClientRef.current?.isReady()) {
            liveClientRef.current.sendAudioChunk(base64Audio);
          }
        });
        audioCaptureRef.current = capture;
        setIsLiaMicActive(true);
        setLiaResponse(''); // Clear previous response
      } catch (err: any) {
        console.error('Failed to start mic:', err);
        setError('No se pudo acceder al micrófono');
      }
    }
  }, [isLiaActive, isLiaMicActive, connectLia]);

  // End meeting
  const handleEndMeeting = useCallback(async () => {
    if (meeting) {
      await finalizeMeeting(meeting);
    }

    // Notify background
    chrome.runtime.sendMessage({ type: 'CLEAR_MEETING_STATE' });

    // Notify content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'stopMeetTranscription' });
      }
    });

    disconnectLia();
    setStatus('ended');
  }, [meeting, disconnectLia]);

  // Export transcript
  const handleExport = useCallback(() => {
    if (!meeting) return;

    const lines = meeting.captions.map((c) => {
      const time = new Date(c.timestamp).toLocaleTimeString();
      return `[${time}] ${c.speaker}: ${c.text}`;
    });

    const content = `Transcripción de Reunión
========================
Título: ${meeting.title}
Fecha: ${new Date(meeting.startTime).toLocaleString()}
Participantes: ${meeting.participants.map((p) => p.name).join(', ') || 'N/A'}
========================

${lines.join('\n')}
`;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcripcion-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [meeting]);

  // Format relative time
  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  };

  // Styles
  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column' as const,
      height: '100%',
      background: 'var(--bg-dark-main)',
      color: 'var(--color-text-primary)',
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 16px',
      borderBottom: '1px solid var(--color-border)',
      background: 'var(--bg-dark-secondary)',
    },
    headerTitle: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '14px',
      fontWeight: 600,
    },
    statusBadge: {
      padding: '2px 8px',
      borderRadius: '12px',
      fontSize: '11px',
      fontWeight: 500,
      background: status === 'active' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(100, 100, 100, 0.2)',
      color: status === 'active' ? '#22c55e' : '#888',
    },
    closeButton: {
      background: 'transparent',
      border: 'none',
      color: 'var(--color-text-secondary)',
      cursor: 'pointer',
      padding: '4px',
      borderRadius: '4px',
    },
    content: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column' as const,
      overflow: 'hidden',
    },
    participantsBar: {
      display: 'flex',
      gap: '8px',
      padding: '8px 16px',
      borderBottom: '1px solid var(--color-border)',
      overflowX: 'auto' as const,
      fontSize: '12px',
    },
    participant: {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '4px 8px',
      background: 'var(--bg-dark-tertiary)',
      borderRadius: '12px',
      whiteSpace: 'nowrap' as const,
    },
    transcript: {
      flex: 1,
      overflowY: 'auto' as const,
      padding: '12px 16px',
    },
    caption: {
      marginBottom: '12px',
      padding: '8px 12px',
      background: 'var(--bg-dark-secondary)',
      borderRadius: '8px',
      borderLeft: '3px solid var(--color-accent)',
    },
    captionHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: '4px',
      fontSize: '11px',
      color: 'var(--color-text-secondary)',
    },
    captionSpeaker: {
      fontWeight: 600,
      color: 'var(--color-accent)',
    },
    captionText: {
      fontSize: '13px',
      lineHeight: 1.5,
    },
    liaSection: {
      padding: '12px 16px',
      borderTop: '1px solid var(--color-border)',
      background: 'var(--bg-dark-secondary)',
    },
    liaResponse: {
      padding: '8px 12px',
      marginBottom: '8px',
      background: 'rgba(99, 102, 241, 0.1)',
      borderRadius: '8px',
      fontSize: '13px',
      maxHeight: '100px',
      overflowY: 'auto' as const,
    },
    liaControls: {
      display: 'flex',
      gap: '8px',
      alignItems: 'center',
    },
    liaButton: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '8px 16px',
      background: isLiaMicActive
        ? 'var(--color-accent)'
        : isLiaActive
        ? 'rgba(99, 102, 241, 0.2)'
        : 'var(--bg-dark-tertiary)',
      border: 'none',
      borderRadius: '20px',
      color: 'var(--color-text-primary)',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: 500,
      transition: 'all 0.2s',
    },
    footer: {
      display: 'flex',
      gap: '8px',
      padding: '12px 16px',
      borderTop: '1px solid var(--color-border)',
    },
    footerButton: {
      flex: 1,
      padding: '8px 12px',
      background: 'var(--bg-dark-tertiary)',
      border: 'none',
      borderRadius: '8px',
      color: 'var(--color-text-primary)',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: 500,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
    },
    endButton: {
      background: 'rgba(239, 68, 68, 0.2)',
      color: '#ef4444',
    },
    emptyState: {
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      padding: '32px',
      textAlign: 'center' as const,
      color: 'var(--color-text-secondary)',
    },
    error: {
      padding: '8px 12px',
      margin: '8px 16px',
      background: 'rgba(239, 68, 68, 0.1)',
      borderRadius: '8px',
      color: '#ef4444',
      fontSize: '12px',
    },
  };

  // Render connecting state
  if (!meeting && status === 'connecting') {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.headerTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            Agente de Reuniones
          </div>
          <button style={styles.closeButton} onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div style={styles.emptyState}>
          <p style={{ marginBottom: '8px', fontWeight: 500 }}>Conectando con la reunión...</p>
          <p style={{ fontSize: '12px' }}>
            Detectando transcripción en Google Meet.
          </p>
        </div>
      </div>
    );
  }

  // Render empty state if no meeting
  if (!meeting && status === 'idle') {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.headerTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            Agente de Reuniones
          </div>
          <button style={styles.closeButton} onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div style={styles.emptyState}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: '16px', opacity: 0.5 }}>
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <p style={{ marginBottom: '8px', fontWeight: 500 }}>No hay reunión activa</p>
          <p style={{ fontSize: '12px' }}>
            Abre Google Meet y únete a una reunión.<br />
            La transcripción comenzará automáticamente.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerTitle}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          {meeting?.title || 'Reunión'}
          <span style={styles.statusBadge}>
            {status === 'active' ? 'En curso' : status === 'ended' ? 'Finalizada' : 'Conectando...'}
          </span>
        </div>
        <button style={styles.closeButton} onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Error */}
      {error && <div style={styles.error}>{error}</div>}

      {/* Content */}
      <div style={styles.content}>
        {/* Participants */}
        {meeting && meeting.participants.length > 0 && (
          <div style={styles.participantsBar}>
            {meeting.participants.map((p) => (
              <div key={p.id} style={styles.participant}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' }} />
                {p.name}
              </div>
            ))}
          </div>
        )}

        {/* Transcript */}
        <div style={styles.transcript}>
          {meeting?.captions.length === 0 ? (
            <div style={{ ...styles.emptyState, height: 'auto', padding: '24px' }}>
              <p style={{ fontSize: '13px' }}>Esperando transcripción...</p>
              <p style={{ fontSize: '11px', opacity: 0.7 }}>
                Asegúrate de que los subtítulos estén activados en Meet
              </p>
            </div>
          ) : (
            meeting?.captions.map((caption) => (
              <div key={caption.id} style={styles.caption}>
                <div style={styles.captionHeader}>
                  <span style={styles.captionSpeaker}>{caption.speaker}</span>
                  <span>{formatTime(caption.relativeTimeMs)}</span>
                </div>
                <div style={styles.captionText}>{caption.text}</div>
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>
      </div>

      {/* Lia Section */}
      <div style={styles.liaSection}>
        {liaResponse && <div style={styles.liaResponse}>{liaResponse}</div>}
        <div style={styles.liaControls}>
          <button
            style={styles.liaButton}
            onClick={toggleLiaMic}
            disabled={isLiaConnecting}
          >
            {isLiaConnecting ? (
              <>
                <span style={{ width: '14px', height: '14px', borderRadius: '50%', border: '2px solid currentColor', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
                Conectando...
              </>
            ) : isLiaMicActive ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
                Hablando con Lia...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
                Invocar a Lia
              </>
            )}
          </button>
          {isLiaActive && (
            <button
              style={{ ...styles.footerButton, flex: 'none', padding: '8px' }}
              onClick={disconnectLia}
              title="Desconectar Lia"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <button style={styles.footerButton} onClick={handleExport} disabled={!meeting || meeting.captions.length === 0}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Exportar
        </button>
        <button
          style={{ ...styles.footerButton, ...styles.endButton }}
          onClick={handleEndMeeting}
          disabled={status !== 'active'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          </svg>
          Finalizar
        </button>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
