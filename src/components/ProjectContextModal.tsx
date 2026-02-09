import React, { useMemo } from 'react';

interface ProjectContextModalProps {
  isOpen: boolean;
  onClose: () => void;
  folder: {
    id: string;
    name: string;
    description?: string;
    created_at?: string; // Folder viene de DB directo, suele ser snake_case
  };
  chats: any[]; 
}

export function ProjectContextModal({ isOpen, onClose, folder, chats }: ProjectContextModalProps) {
  if (!isOpen) return null;

  // Process chat data to extract insights, key topics, and summary
  const projectInsights = useMemo(() => {
    // 1. Sort chats by date
    const sortedChats = [...chats].sort((a, b) => {
      const dateA = new Date(a.createdAt || a.updatedAt || a.created_at || new Date()).getTime();
      const dateB = new Date(b.createdAt || b.updatedAt || b.created_at || new Date()).getTime();
      return dateB - dateA;
    });
    
    // 2. Extract sources and Domains
    const allSources = new Set<string>();
    const domainCounts: Record<string, number> = {};
    let totalSources = 0;

    // 3. Extract Keywords for Topics (Basic frequency analysis of titles)
    const topicFrequency: Record<string, number> = {};
    const stopWords = new Set(['de', 'la', 'el', 'en', 'y', 'a', 'que', 'los', 'del', 'las', 'un', 'una', 'para', 'por', 'sobre', 'con', 'me', 'mi', 'mis', 'sus', 'top', 'mejores', 'como', 'buscar', 'hacer']);

    const chatDetails = sortedChats.map(chat => {
      // Analyze Title for topics
      const words = (chat.title || '').toLowerCase().replace(/[^\w\sáéíóúñ]/g, '').split(/\s+/);
      words.forEach((w: string) => {
        if (w.length > 3 && !stopWords.has(w)) {
          topicFrequency[w] = (topicFrequency[w] || 0) + 1;
        }
      });

      // Find sources
      const sources = chat.messages?.reduce((acc: any[], msg: any) => {
        if (msg.sources && msg.sources.length > 0) {
          return [...acc, ...msg.sources];
        }
        return acc;
      }, []) || [];

      sources.forEach((s: any) => {
        allSources.add(s.uri);
        try {
          const domain = new URL(s.uri).hostname.replace('www.', '');
          domainCounts[domain] = (domainCounts[domain] || 0) + 1;
        } catch (e) {}
      });
      totalSources += sources.length;

      const purpose = chat.description || chat.messages?.find((m: any) => m.role === 'user')?.text || chat.title;
      const chatDate = new Date(chat.createdAt || chat.updatedAt || chat.created_at || Date.now());

      return {
        id: chat.id,
        title: chat.title,
        date: chatDate.toLocaleDateString(undefined, { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }),
        purpose: purpose?.slice(0, 150) + (purpose?.length > 150 ? '...' : ''),
        sources: sources,
        sourceCount: sources.length
      };
    });

    // 4. Determine Top Topics
    const topTopics = Object.entries(topicFrequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));

    // 5. Determine Top Domains
    const topDomains = Object.entries(domainCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([domain]) => domain);

    // 6. Generate Dynamic Description
    let dynamicDesc = folder.description || "";
    if (!dynamicDesc || dynamicDesc.startsWith("Proyecto automático")) {
      if (topTopics.length > 0) {
        dynamicDesc = `Espacio de trabajo enfocado en ${topTopics.slice(0, 3).join(", ")}. Contiene ${chats.length} conversaciones que analizan información de fuentes como ${topDomains.length > 0 ? topDomains.join(", ") : "diversos orígenes"}.`;
      } else {
        dynamicDesc = `Espacio de trabajo que agrupa ${chats.length} conversaciones y ${totalSources} fuentes de información.`;
      }
    }

    return {
      chats: chatDetails,
      totalSources,
      uniqueSourcesCount: allSources.size,
      topTopics,
      topDomains,
      dynamicDescription: dynamicDesc
    };
  }, [chats, folder.description]);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <div style={{ flex: 1, marginRight: '16px' }}>
            <div style={styles.subtitle}>CONTEXTO DEL PROYECTO</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h2 style={styles.title}>{folder.name}</h2>
            </div>
          </div>
          <button onClick={onClose} style={styles.closeBtn}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div style={styles.content}>
          {/* Project Summary Section - ENHANCED */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>
              Resumen Ejecutivo
            </h3>
            <div style={styles.card}>
              <p style={{ ...styles.description, marginBottom: '16px', fontSize: '15px', lineHeight: '1.6' }}>
                {projectInsights.dynamicDescription}
              </p>
              
              {/* Key Topics Badges */}
              {projectInsights.topTopics.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
                  {projectInsights.topTopics.map((topic, i) => (
                    <span key={i} style={{
                      background: 'rgba(0, 212, 179, 0.1)',
                      color: '#00d4b3',
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: 500
                    }}>
                      #{topic}
                    </span>
                  ))}
                </div>
              )}

              <div style={{ height: '1px', background: 'var(--bg-dark-secondary)', marginBottom: '16px' }}></div>

              <div style={styles.metaRow}>
                <div style={styles.metaItem}>
                  <span style={styles.metaLabel}>Creado</span>
                  <span style={styles.metaValue}>
                    {folder.created_at ? new Date(folder.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'Reciente'}
                  </span>
                </div>
                <div style={styles.metaItem}>
                  <span style={styles.metaLabel}>Actividad</span>
                  <span style={styles.metaValue}>{chats.length} chats</span>
                </div>
                <div style={styles.metaItem}>
                  <span style={styles.metaLabel}>Fuentes Clave</span>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                     {projectInsights.topDomains.length > 0 ? (
                        projectInsights.topDomains.map((d, i) => (
                          <div key={i} style={{ 
                            fontSize: '11px', 
                            background: 'var(--bg-dark-tertiary)', 
                            padding: '2px 6px', 
                            borderRadius: '4px',
                            color: 'var(--color-gray-medium)'
                          }}>
                            {d}
                          </div>
                        ))
                     ) : (
                       <span style={styles.metaValue}>{projectInsights.totalSources} enlaces</span>
                     )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Timeline / Chat History Section */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>
              Historial y Contexto
            </h3>
            
            {projectInsights.chats.length === 0 ? (
              <div style={styles.emptyState}>No hay conversaciones registradas en este proyecto.</div>
            ) : (
              <div style={styles.timeline}>
                {projectInsights.chats.map((chat, index) => (
                  <div key={chat.id} style={styles.timelineItem}>
                    <div style={styles.timelineLine}>
                      <div style={styles.timelineDot}></div>
                      {index !== projectInsights.chats.length - 1 && <div style={styles.timelineConnector}></div>}
                    </div>
                    <div style={styles.timelineContent}>
                      <div style={styles.chatDate}>{chat.date !== 'Invalid Date' ? chat.date : 'Fecha desconocida'}</div>
                      <h4 style={styles.chatTitle}>{chat.title}</h4>
                      
                      <div style={styles.chatPurpose}>
                        {chat.purpose}
                      </div>

                      {chat.sources && chat.sources.length > 0 && (
                        <div style={styles.sourcesContainer}>
                          <div style={styles.sourcesLabel}>Fuentes ({chat.sourceCount})</div>
                          <div style={styles.sourcesList}>

                            {chat.sources.slice(0, 3).map((source: any, i: number) => (
                              <a 
                                key={i} 
                                href={source.uri} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                style={styles.sourceLink}
                                title={source.title}
                              >
                                {source.title || new URL(source.uri).hostname}
                              </a>
                            ))}
                            {chat.sources.length > 3 && (
                                <span style={styles.moreSources}>+{chat.sources.length - 3}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Styles
const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.85)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
  },
  modal: {
    background: 'var(--bg-dark-main, #0f1115)',
    width: '90%',
    maxWidth: '700px',
    maxHeight: '85vh',
    borderRadius: '20px',
    border: '1px solid var(--border-modal, rgba(255,255,255,0.1))',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    padding: '24px 32px',
    borderBottom: '1px solid var(--border-modal, rgba(255,255,255,0.1))',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    background: 'var(--bg-dark-secondary, #1a1d23)',
  },
  subtitle: {
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    color: 'var(--color-accent, #00d4b3)',
    fontWeight: 600,
    marginBottom: '8px',
  },
  title: {
    margin: 0,
    fontSize: '22px',
    color: 'var(--color-white, #fff)',
    fontWeight: 700,
    lineHeight: '1.3',
  },
  editBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--color-gray-medium, #9ca3af)',
    cursor: 'pointer',
    padding: '4px',
    opacity: 0.7,
    transition: 'opacity 0.2s',
  },
  nameInput: {
    fontSize: '22px',
    fontWeight: 700,
    color: 'var(--color-white, #fff)',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid var(--color-accent, #00d4b3)',
    outline: 'none',
    padding: '0 0 4px 0',
    width: '100%',
    fontFamily: 'inherit',
  },
  saveBtn: {
    fontSize: '12px',
    padding: '6px 12px',
    background: 'var(--color-accent, #00d4b3)',
    color: 'var(--color-on-accent, #000)',
    border: 'none',
    borderRadius: '6px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  cancelBtn: {
    fontSize: '14px',
    padding: '6px',
    background: 'transparent',
    color: 'var(--color-gray-medium, #9ca3af)',
    border: 'none',
    cursor: 'pointer',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--color-gray-medium, #9ca3af)',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    transition: 'color 0.2s',
  },
  content: {
    padding: '32px',
    overflowY: 'auto',
    flex: 1,
  },
  section: {
    marginBottom: '32px',
  },
  sectionTitle: {
    fontSize: '16px',
    color: 'var(--color-white, #fff)',
    marginBottom: '16px',
    fontWeight: 600,
  },
  card: {
    background: 'var(--bg-dark-secondary, #1a1d23)',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid var(--border-modal, rgba(255,255,255,0.05))',
  },
  description: {
    color: 'var(--color-gray-light, #e5e7eb)',
    lineHeight: '1.6',
    fontSize: '14px',
    marginBottom: '20px',
  },
  metaRow: {
    display: 'flex',
    gap: '32px',
    borderTop: '1px solid var(--border-modal, rgba(255,255,255,0.1))',
    paddingTop: '16px',
    flexWrap: 'wrap',
  },
  metaItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  metaLabel: {
    fontSize: '11px',
    color: 'var(--color-gray-medium, #9ca3af)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    fontWeight: 600,
  },
  metaValue: {
    fontSize: '13px',
    color: 'var(--color-white, #fff)',
    fontWeight: 600,
  },
  timeline: {
    paddingLeft: '8px',
  },
  timelineItem: {
    display: 'flex',
    gap: '20px',
    marginBottom: '24px',
    position: 'relative',
  },
  timelineLine: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    minWidth: '16px',
  },
  timelineDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background: 'var(--bg-dark-secondary, #1a1d23)',
    border: '2px solid var(--color-accent, #00d4b3)',
    marginTop: '6px',
    zIndex: 1,
  },
  timelineConnector: {
    width: '1px',
    background: 'var(--border-modal, rgba(255,255,255,0.1))',
    flex: 1,
    marginTop: '4px',
    marginBottom: '4px',
  },
  timelineContent: {
    flex: 1,
    background: 'transparent',
    paddingTop: '0',
  },
  chatDate: {
    fontSize: '11px',
    color: 'var(--color-gray-medium, #9ca3af)',
    marginBottom: '4px',
    fontWeight: 500,
  },
  chatTitle: {
    margin: '0 0 8px 0',
    fontSize: '15px',
    color: 'var(--color-white, #fff)',
    fontWeight: 600,
  },
  chatPurpose: {
    fontSize: '13px',
    color: 'var(--color-gray-light, #d1d5db)',
    lineHeight: '1.5',
    marginBottom: '12px',
  },
  sourcesContainer: {
    marginTop: '8px',
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    flexWrap: 'wrap',
  },
  sourcesLabel: {
    fontSize: '11px',
    color: 'var(--color-gray-medium, #9ca3af)',
    fontWeight: 600,
  },
  sourcesList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  sourceLink: {
    fontSize: '11px',
    color: 'var(--color-accent, #00d4b3)',
    textDecoration: 'none',
    background: 'var(--bg-dark-tertiary, rgba(255,255,255,0.05))',
    padding: '2px 8px',
    borderRadius: '4px',
    transition: 'background 0.2s',
    maxWidth: '150px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    border: '1px solid var(--border-modal, rgba(255,255,255,0.1))',
  },
  moreSources: {
    fontSize: '11px',
    color: 'var(--color-gray-medium, #9ca3af)',
    padding: '2px 4px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '32px',
    color: 'var(--color-gray-medium, #9ca3af)',
    fontSize: '13px',
    background: 'var(--bg-dark-secondary, #1a1d23)',
    borderRadius: '12px',
    border: '1px dashed var(--border-modal, rgba(255,255,255,0.1))',
  },
};

export default ProjectContextModal;
