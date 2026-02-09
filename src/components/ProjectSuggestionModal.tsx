/**
 * Project Suggestion Modal
 * Proactively suggests organizing chats into projects based on context.
 */

import React from 'react';

interface ProjectSuggestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  suggestionType: 'join_existing' | 'create_new';
  targetName: string; // Project name to join or new project name
  relatedChatsCount?: number; // For 'create_new', how many chats will be grouped
  reason: string; // "Detected similarity with..." or "You have 3 chats about..."
}

export function ProjectSuggestionModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  suggestionType, 
  targetName, 
  relatedChatsCount,
  reason 
}: ProjectSuggestionModalProps) {
  if (!isOpen) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal} className="slide-up-animation">
        {/* Decorative background blur/gradient */}
        <div style={styles.backgroundEffect} />
        
        <div style={styles.content}>
          <div style={styles.iconContainer}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2">
              <path d="M12 3V21M3 12H21" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 8L16 12L12 16" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="12" cy="12" r="10" strokeOpacity="0.2"/>
            </svg>
          </div>

          <div style={styles.textContainer}>
            <h3 style={styles.title}>
              {suggestionType === 'join_existing' 
                ? 'Sugerencia de Organización' 
                : 'Agrupar Conversaciones'}
            </h3>
            
            <p style={styles.description}>
              {suggestionType === 'join_existing' ? (
                <>
                  Parece que esta conversación está relacionada con tu proyecto <strong>{targetName}</strong>.
                  <br/>
                  <span style={styles.reason}>{reason}</span>
                </>
              ) : (
                <>
                  Tienes <strong>{relatedChatsCount} conversaciones</strong> sueltas sobre este tema. 
                  ¿Te gustaría crear el proyecto <strong>{targetName}</strong> para organizarlas?
                </>
              )}
            </p>
          </div>

          <div style={styles.actions}>
            <button onClick={onClose} style={styles.ghostBtn}>
              Ahora no
            </button>
            <button onClick={onConfirm} style={styles.primaryBtn}>
              {suggestionType === 'join_existing' 
                ? 'Mover al Proyecto' 
                : 'Crear y Agrupar'}
            </button>
          </div>
        </div>

        <button onClick={onClose} style={styles.closeX}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <style>{`
        .slide-up-animation {
          animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    zIndex: 10000,
    maxWidth: '400px',
    width: 'calc(100% - 48px)',
  },
  modal: {
    background: 'var(--bg-modal)',
    backdropFilter: 'blur(12px)',
    borderRadius: '16px',
    padding: '20px',
    border: '1px solid var(--border-modal)',
    boxShadow: 'var(--shadow-modal)',
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    color: 'var(--color-text-primary)'
  },
  backgroundEffect: {
    position: 'absolute',
    top: '-50%',
    left: '-50%',
    width: '200%',
    height: '200%',
    background: 'radial-gradient(circle at center, var(--color-accent-transparent, rgba(0, 212, 179, 0.05)), transparent 70%)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    position: 'relative',
    zIndex: 1,
  },
  iconContainer: {
    width: '40px',
    height: '40px',
    borderRadius: '12px',
    background: 'var(--bg-dark-tertiary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '4px',
    border: '1px solid var(--border-modal)'
  },
  textContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 600,
    color: 'var(--color-text-primary)',
  },
  description: {
    margin: 0,
    fontSize: '14px',
    color: 'var(--color-text-secondary)',
    lineHeight: '1.5',
  },
  reason: {
    fontSize: '12px',
    color: 'var(--color-gray-medium)',
    display: 'block',
    marginTop: '4px',
  },
  actions: {
    display: 'flex',
    gap: '12px',
    marginTop: '8px',
  },
  primaryBtn: {
    flex: 1,
    background: 'var(--color-accent)',
    color: 'var(--color-on-accent)',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  },
  ghostBtn: {
    flex: 1,
    background: 'transparent',
    color: 'var(--color-text-secondary)',
    border: '1px solid var(--border-modal)',
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  closeX: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    background: 'transparent',
    border: 'none',
    color: 'var(--color-gray-medium)',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    zIndex: 2
  },
};

export default ProjectSuggestionModal;
