import React, { useState, useRef } from 'react';

interface ProjectHubProps {
  folder: { 
    id: string; 
    name: string; 
    description?: string;
    created_at?: string;
  };
  chats: any[];
  onNewChat: () => void; // Kept for fallback or specific button
  onOpenChat: (chatId: string) => void;
  onDeleteChat: (chatId: string, e: React.MouseEvent) => void;
  onStartChatWithContext: (text: string, files?: FileList | null) => void;
  // New props for enhanced functionality
  isRecording: boolean;
  onToggleRecording: () => void;
  onToolSelect: (tool: 'deep_research' | 'image_gen' | 'prompt_optimizer' | 'live_api' | 'web_agent') => void;
}

export const ProjectHub: React.FC<ProjectHubProps> = ({ 
  folder, 
  chats, 
  onNewChat: _onNewChat, 
  onOpenChat, 
  onDeleteChat,
  onStartChatWithContext,
  isRecording,
  onToggleRecording,
  onToolSelect
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputValue.trim()) {
        onStartChatWithContext(inputValue);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    // Future: Handle files dropped here
    // const files = e.dataTransfer.files;
  };

  return (
    <div 
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflowY: 'auto',
        position: 'relative',
        background: 'var(--bg-dark-main)',
        color: 'var(--color-white)'
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Background Ambience - Simplified/Removed for cleaner theme switching, or used with opacity */}
      <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '300px',
          background: 'radial-gradient(ellipse at top, var(--color-accent), transparent 70%)',
          opacity: 0.08,
          pointerEvents: 'none'
      }} />

      <div style={{ padding: '40px', zIndex: 1, maxWidth: '1000px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        
        {/* Header Section */}
        <div style={{ marginBottom: '50px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '20px',
            background: 'var(--bg-dark-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid var(--border-modal)',
            boxShadow: 'var(--shadow-modal)',
            backdropFilter: 'blur(4px)'
          }}>
             <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="1.5">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
             </svg>
          </div>
          <div>
            <div style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--color-accent)', fontWeight: 600, marginBottom: '4px' }}>
              Workspace
            </div>
            <h1 style={{ fontSize: '32px', fontWeight: 700, margin: 0, color: 'var(--color-white)', letterSpacing: '-0.5px' }}>
              {folder.name}
            </h1>
            <div style={{ fontSize: '14px', color: 'var(--color-gray-medium)', marginTop: '4px' }}>
              {folder.description || 'Espacio de trabajo dedicado'}
            </div>
          </div>
        </div>

        {/* Input Hero Section */}
        <div style={{ marginBottom: '60px', position: 'relative' }}>
            <div style={{
                background: 'var(--bg-dark-secondary)',
                border: '1px solid var(--border-modal)',
                borderRadius: '24px',
                padding: '20px',
                boxShadow: isDragging ? '0 0 0 2px var(--color-accent), 0 20px 50px rgba(0,0,0,0.1)' : '0 20px 50px rgba(0,0,0,0.1)',
                transition: 'all 0.3s ease',
                backdropFilter: 'blur(10px)',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
            }}>
                <textarea
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={`¿Qué quieres crear en ${folder.name} hoy?`}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--color-white)',
                        fontSize: '18px',
                        outline: 'none',
                        resize: 'none',
                        minHeight: '28px',
                        fontFamily: 'Inter, sans-serif',
                        lineHeight: '1.5'
                    }}
                    rows={1}
                />
                
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid var(--border-modal)' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                         {/* Tools Menu */}
                        <div style={{ position: 'relative' }}>
                            <button
                                onClick={() => setIsToolsOpen(!isToolsOpen)}
                                style={{
                                    padding: '8px',
                                    borderRadius: '50%',
                                    // Match App.tsx: background changes on open, otherwise none
                                    background: isToolsOpen ? 'rgba(0, 212, 179, 0.2)' : 'none',
                                    border: 'none',
                                    color: isToolsOpen ? '#00d4b3' : 'var(--color-gray-medium)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.2s',
                                    width: '32px',
                                    height: '32px'
                                }}
                                title="Más opciones"
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="12" y1="5" x2="12" y2="19"></line>
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                </svg>
                            </button>
                             {isToolsOpen && (
                                <div style={{
                                    position: 'absolute',
                                    top: '120%',
                                    left: 0,
                                    background: 'var(--bg-modal)',
                                    border: '1px solid var(--border-modal)',
                                    borderRadius: '12px',
                                    padding: '8px',
                                    minWidth: '200px',
                                    boxShadow: 'var(--shadow-modal)',
                                    zIndex: 100
                                }}>
                                    {/* Live API */}
                                    <button
                                      onClick={() => {
                                        onToolSelect('live_api');
                                        setIsToolsOpen(false);
                                      }}
                                      style={{
                                        width: '100%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        padding: '10px 12px',
                                        background: 'transparent',
                                        border: 'none',
                                        borderRadius: '8px',
                                        color: 'var(--color-white)',
                                        cursor: 'pointer',
                                        fontSize: '13px',
                                        textAlign: 'left'
                                      }}
                                      onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-dark-secondary)'}
                                      onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                                    >
                                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                                        <line x1="12" y1="19" x2="12" y2="23"></line>
                                        <line x1="8" y1="23" x2="16" y2="23"></line>
                                      </svg>
                                      <div>
                                        <div style={{ fontWeight: 500 }}>Conversación en Vivo</div>
                                        <div style={{ fontSize: '11px', color: 'var(--color-gray-medium)' }}>Audio en tiempo real</div>
                                      </div>
                                    </button>

                                    {/* Image Generation */}
                                    <button
                                      onClick={() => {
                                        onToolSelect('image_gen');
                                        setIsToolsOpen(false);
                                      }}
                                      style={{
                                        width: '100%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        padding: '10px 12px',
                                        background: 'transparent',
                                        border: 'none',
                                        borderRadius: '8px',
                                        color: 'var(--color-white)',
                                        cursor: 'pointer',
                                        fontSize: '13px',
                                        textAlign: 'left'
                                      }}
                                      onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-dark-secondary)'}
                                      onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                                    >
                                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                        <circle cx="8.5" cy="8.5" r="1.5"></circle>
                                        <polyline points="21 15 16 10 5 21"></polyline>
                                      </svg>
                                      <div>
                                        <div style={{ fontWeight: 500 }}>Generar Imagen</div>
                                        <div style={{ fontSize: '11px', color: 'var(--color-gray-medium)' }}>Crea imágenes con IA</div>
                                      </div>
                                    </button>

                                    {/* Prompt Optimizer */}
                                    <button
                                      onClick={() => {
                                        onToolSelect('prompt_optimizer');
                                        setIsToolsOpen(false);
                                      }}
                                      style={{
                                        width: '100%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        padding: '10px 12px',
                                        background: 'transparent',
                                        border: 'none',
                                        borderRadius: '8px',
                                        color: 'var(--color-white)',
                                        cursor: 'pointer',
                                        fontSize: '13px',
                                        textAlign: 'left'
                                      }}
                                      onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-dark-secondary)'}
                                      onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                                    >
                                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M12 20h9"></path>
                                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                                      </svg>
                                      <div>
                                        <div style={{ fontWeight: 500 }}>Mejorar Prompt</div>
                                        <div style={{ fontSize: '11px', color: 'var(--color-gray-medium)' }}>Optimiza para otra IA</div>
                                      </div>
                                    </button>

                                    <div style={{ height: '1px', background: 'var(--border-modal)', margin: '8px 0' }}></div>
                                    
                                    {/* Attach File inside Dropdown (to match App.tsx) */}
                                    <button
                                      onClick={() => {
                                        fileInputRef.current?.click();
                                        setIsToolsOpen(false);
                                      }}
                                      style={{
                                        width: '100%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        padding: '10px 12px',
                                        background: 'transparent',
                                        border: 'none',
                                        borderRadius: '8px',
                                        color: 'var(--color-white)',
                                        cursor: 'pointer',
                                        fontSize: '13px',
                                        textAlign: 'left'
                                      }}
                                      onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-dark-secondary)'}
                                      onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                                    >
                                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                                      </svg>
                                      <div>
                                        <div style={{ fontWeight: 500 }}>Adjuntar Archivo</div>
                                        <div style={{ fontSize: '11px', color: 'var(--color-gray-medium)' }}>Sube imágenes</div>
                                      </div>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                        {/* Mic Button - Matched to App.tsx styling if possible, but keeping consistent square-rounded for now to fit bar */}
                        {/* In App.tsx the mic is separate. Here it is inside the input bar. We keep it inside but style it nicely. */}
                        <button
                            onClick={onToggleRecording}
                            style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '50%',
                                background: isRecording ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
                                border: 'none',
                                color: isRecording ? '#ef4444' : 'var(--color-gray-medium)', 
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                            title={isRecording ? "Detener grabación" : "Dictar"}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                                <line x1="12" y1="19" x2="12" y2="23"></line>
                                <line x1="8" y1="23" x2="16" y2="23"></line>
                            </svg>
                        </button>

                        <button
                            onClick={() => inputValue.trim() && onStartChatWithContext(inputValue)}
                            disabled={!inputValue.trim()}
                            style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '8px',
                                background: 'transparent',
                                border: 'none',
                                color: inputValue.trim() ? 'var(--color-white)' : 'var(--color-gray-medium)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: inputValue.trim() ? 'pointer' : 'default',
                                transition: 'all 0.2s',
                                transform: inputValue.trim() ? 'scale(1)' : 'scale(0.95)',
                                opacity: inputValue.trim() ? 1 : 0.5
                            }}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="22" y1="2" x2="11" y2="13" />
                                <polygon points="22 2 15 22 11 13 2 9 22 2" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
            <input type="file" ref={fileInputRef} style={{ display: 'none' }} multiple />
        </div>

        {/* Project Memory / History Grid */}
        <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-white)', margin: 0 }}>Memoria del Proyecto</h3>
                <span style={{ fontSize: '12px', color: 'var(--color-gray-medium)' }}>{chats.length} conversaciones</span>
            </div>

            <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', 
                gap: '16px' 
            }}>
                {chats.length === 0 ? (
                    <div style={{ 
                        gridColumn: '1 / -1', 
                        padding: '40px', 
                        textAlign: 'center', 
                        border: '2px dashed var(--border-modal)', 
                        borderRadius: '16px',
                        color: 'var(--color-gray-medium)'
                    }}>
                        <p style={{ margin: 0 }}>No hay actividad reciente.</p>
                        <p style={{ fontSize: '13px', marginTop: '8px' }}>Comienza escribiendo arriba para iniciar la primera conversación.</p>
                    </div>
                ) : (
                    chats.map(chat => (
                        <div 
                            key={chat.id}
                            onClick={() => onOpenChat(chat.id)}
                            style={{
                                background: 'var(--bg-dark-secondary)',
                                border: '1px solid var(--border-modal)',
                                borderRadius: '16px',
                                padding: '20px',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                position: 'relative',
                                display: 'flex',
                                flexDirection: 'column',
                                height: '140px'
                            }}
                            onMouseOver={(e) => {
                                e.currentTarget.style.transform = 'translateY(-4px)';
                                e.currentTarget.style.background = 'var(--bg-dark-tertiary)';
                                e.currentTarget.style.boxShadow = '0 10px 20px rgba(0,0,0,0.1)';
                                e.currentTarget.style.borderColor = 'var(--color-accent)';
                            }}
                            onMouseOut={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.background = 'var(--bg-dark-secondary)';
                                e.currentTarget.style.boxShadow = 'none';
                                e.currentTarget.style.borderColor = 'var(--border-modal)';
                            }}
                        >
                            <div style={{ flex: 1 }}>
                                <div style={{ 
                                    fontSize: '15px', 
                                    fontWeight: 600, 
                                    color: 'var(--color-white)', 
                                    marginBottom: '8px',
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden'
                                }}>
                                    {chat.title}
                                </div>
                                <div style={{ fontSize: '13px', color: 'var(--color-gray-medium)' }}>
                                    Editado {new Date(chat.updatedAt).toLocaleDateString()}
                                </div>
                            </div>

                            <button 
                                onClick={(e) => onDeleteChat(chat.id, e)}
                                style={{
                                    position: 'absolute',
                                    bottom: '16px',
                                    right: '16px',
                                    background: 'transparent',
                                    border: 'none',
                                    padding: '6px',
                                    cursor: 'pointer',
                                    color: 'var(--color-gray-medium)',
                                    opacity: 0.6,
                                    transition: 'all 0.2s',
                                    zIndex: 2
                                }}
                                onMouseOver={(e) => {
                                    e.currentTarget.style.color = '#ef4444';
                                    e.currentTarget.style.opacity = '1';
                                }}
                                onMouseOut={(e) => {
                                    e.currentTarget.style.color = 'var(--color-gray-medium)';
                                    e.currentTarget.style.opacity = '0.6';
                                }}
                                title="Eliminar"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
      </div>
    </div>
  );
};
