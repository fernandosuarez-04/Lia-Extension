/**
 * Tool Library Component - Professional Design
 * Following SOFIA_DESIGN_SYSTEM.md with custom dropdown and SVG icons
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Tool,
  UserTool,
  ToolCategory,
  TOOL_CATEGORIES,
  getPublicTools,
  getUserTools,
  getUserFavoritePublicTools,
  addToolToFavorites,
  removeToolFromFavorites,
  deleteUserTool,
  toggleUserToolFavorite,
} from '../services/tools';

// ==== DESIGN SYSTEM COLORS ====
const COLORS = {
  deepBlue: '#0A2540',
  aqua: '#00D4B3',
  white: '#FFFFFF',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  grayLight: '#E9ECEF',
  grayMid: '#6C757D',
  bgPrimary: '#0F1419',
  bgSecondary: '#1E2329',
  bgTertiary: '#0A0D12',
  borderLight: 'rgba(255,255,255,0.08)',
  borderMid: 'rgba(255,255,255,0.15)',
};

// ==== CATEGORY ICONS (SVG) ====
const CategoryIcons: Record<string, React.ReactNode> = {
  desarrollo: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
    </svg>
  ),
  marketing: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
  ),
  educacion: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
    </svg>
  ),
  productividad: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
    </svg>
  ),
  creatividad: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
  ),
  analisis: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>
    </svg>
  ),
};

const DefaultToolIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
);

const FolderIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={COLORS.grayMid} strokeWidth="1.5">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
);

type TabType = 'public' | 'mine' | 'favorites';

interface ToolLibraryProps {
  onSelectTool: (tool: Tool | UserTool) => void;
  onClose: () => void;
  onCreateTool?: () => void;
  onEditTool?: (tool: UserTool) => void;
}

export function ToolLibrary({ onSelectTool, onClose, onCreateTool, onEditTool }: ToolLibraryProps) {
  const [activeTab, setActiveTab] = useState<TabType>('public');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ToolCategory | 'all'>('all');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const [publicTools, setPublicTools] = useState<Tool[]>([]);
  const [userTools, setUserTools] = useState<UserTool[]>([]);
  const [favoriteTools, setFavoriteTools] = useState<Tool[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const results = await Promise.allSettled([
        getPublicTools(),
        getUserTools(),
        getUserFavoritePublicTools(),
      ]);
      
      if (results[0].status === 'fulfilled') setPublicTools(results[0].value);
      if (results[1].status === 'fulfilled') setUserTools(results[1].value);
      if (results[2].status === 'fulfilled') {
        setFavoriteTools(results[2].value);
        setFavoriteIds(new Set(results[2].value.map(t => t.id)));
      }
      
      const allFailed = results.every(r => r.status === 'rejected');
      if (allFailed) {
        throw new Error((results[0] as PromiseRejectedResult).reason?.message || 'Error de conexión');
      }
    } catch (err: any) {
      setError(err?.message || 'No se pudieron cargar las herramientas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData, retryCount]);

  const handleRetry = () => setRetryCount(c => c + 1);

  // Filter tools
  const filteredTools = useMemo(() => {
    let tools: (Tool | UserTool)[] = [];
    switch (activeTab) {
      case 'public': tools = publicTools; break;
      case 'mine': tools = userTools; break;
      case 'favorites': tools = favoriteTools; break;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      tools = tools.filter(t => t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q));
    }
    if (selectedCategory !== 'all') {
      tools = tools.filter(t => t.category === selectedCategory);
    }
    return tools;
  }, [activeTab, publicTools, userTools, favoriteTools, searchQuery, selectedCategory]);

  const handleToggleFavorite = async (toolId: string, isPublic: boolean) => {
    try {
      if (isPublic) {
        if (favoriteIds.has(toolId)) {
          await removeToolFromFavorites(toolId);
          setFavoriteIds(prev => { const n = new Set(prev); n.delete(toolId); return n; });
          setFavoriteTools(prev => prev.filter(t => t.id !== toolId));
        } else {
          await addToolToFavorites(toolId);
          setFavoriteIds(prev => new Set(prev).add(toolId));
          const tool = publicTools.find(t => t.id === toolId);
          if (tool) setFavoriteTools(prev => [...prev, tool]);
        }
      } else {
        const newVal = await toggleUserToolFavorite(toolId);
        setUserTools(prev => prev.map(t => t.id === toolId ? { ...t, is_favorite: newVal } : t));
      }
    } catch (err) { console.error('Error toggling favorite:', err); }
  };

  const handleDelete = async (toolId: string) => {
    if (!confirm('¿Eliminar esta herramienta?')) return;
    try {
      await deleteUserTool(toolId);
      setUserTools(prev => prev.filter(t => t.id !== toolId));
    } catch (err) { console.error('Error deleting:', err); }
  };

  const selectedCategoryLabel = selectedCategory === 'all'
    ? 'Todas las categorías'
    : TOOL_CATEGORIES.find(c => c.value === selectedCategory)?.label || '';

  return (
    <div className="tl-overlay" onClick={onClose}>
      <style>{cssStyles}</style>
      <div className="tl-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <header className="tl-header">
          <div className="tl-header-left">
            <div className="tl-logo">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
              </svg>
            </div>
            <h2 className="tl-title">Biblioteca de Prompts</h2>
          </div>
          <button className="tl-close" onClick={onClose} aria-label="Cerrar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </header>

        {/* Tabs */}
        <nav className="tl-tabs">
          <button className={`tl-tab ${activeTab === 'public' ? 'active' : ''}`} onClick={() => setActiveTab('public')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            <span>Públicas</span>
          </button>
          <button className={`tl-tab ${activeTab === 'mine' ? 'active' : ''}`} onClick={() => setActiveTab('mine')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
            <span>Mis Prompts</span>
          </button>
          <button className={`tl-tab ${activeTab === 'favorites' ? 'active' : ''}`} onClick={() => setActiveTab('favorites')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill={activeTab === 'favorites' ? COLORS.warning : 'none'} stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            <span>Favoritas</span>
          </button>
        </nav>

        {/* Filters */}
        <div className="tl-filters">
          <div className="tl-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input type="text" placeholder="Buscar..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>

          {/* Custom Dropdown */}
          <div className="tl-dropdown" ref={dropdownRef}>
            <button
              className={`tl-dropdown-trigger ${isDropdownOpen ? 'open' : ''} ${selectedCategory !== 'all' ? 'has-value' : ''}`}
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            >
              {selectedCategory !== 'all' && CategoryIcons[selectedCategory]}
              <span>{selectedCategoryLabel}</span>
              <svg className="tl-dropdown-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>

            {isDropdownOpen && (
              <div className="tl-dropdown-menu">
                <button
                  className={`tl-dropdown-item ${selectedCategory === 'all' ? 'active' : ''}`}
                  onClick={() => { setSelectedCategory('all'); setIsDropdownOpen(false); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                  </svg>
                  <span>Todas las categorías</span>
                </button>
                {TOOL_CATEGORIES.map(cat => (
                  <button
                    key={cat.value}
                    className={`tl-dropdown-item ${selectedCategory === cat.value ? 'active' : ''}`}
                    onClick={() => { setSelectedCategory(cat.value); setIsDropdownOpen(false); }}
                  >
                    {CategoryIcons[cat.value]}
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {activeTab === 'mine' && onCreateTool && (
            <button className="tl-btn-create" onClick={onCreateTool}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span>Nueva</span>
            </button>
          )}
        </div>

        {/* Content */}
        <main className="tl-content">
          {loading ? (
            <div className="tl-state">
              <div className="tl-spinner" />
              <p>Cargando prompts...</p>
            </div>
          ) : error ? (
            <div className="tl-state tl-state-error">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={COLORS.error} strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
              </svg>
              <h3>Error de conexión</h3>
              <p>{error}</p>
              <button className="tl-btn-retry" onClick={handleRetry}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
                </svg>
                Reintentar
              </button>
            </div>
          ) : filteredTools.length === 0 ? (
            <div className="tl-state tl-state-empty">
              <FolderIcon />
              <h3>{activeTab === 'mine' ? 'Sin prompts' : 'No hay resultados'}</h3>
              <p>{activeTab === 'mine' ? 'Crea tu primer prompt personalizado' : 'Intenta con otros filtros'}</p>
              {activeTab === 'mine' && onCreateTool && (
                <button className="tl-btn-create-empty" onClick={onCreateTool}>Crear prompt</button>
              )}
            </div>
          ) : (
            <div className="tl-grid">
              {filteredTools.map(tool => {
                const isPublicTool = 'status' in tool;
                const isFav = isPublicTool ? favoriteIds.has(tool.id) : (tool as UserTool).is_favorite;
                const cat = TOOL_CATEGORIES.find(c => c.value === tool.category);
                
                return (
                  <article key={tool.id} className="tl-card">
                    <div className="tl-card-top">
                      <div className="tl-card-icon">
                        <DefaultToolIcon />
                      </div>
                      <button
                        className={`tl-card-fav ${isFav ? 'active' : ''}`}
                        onClick={() => handleToggleFavorite(tool.id, isPublicTool)}
                        aria-label={isFav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill={isFav ? COLORS.warning : 'none'} stroke={isFav ? COLORS.warning : 'currentColor'} strokeWidth="2">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                      </button>
                    </div>

                    <h3 className="tl-card-name">{tool.name}</h3>
                    {cat && (
                      <span className="tl-card-cat">
                        {CategoryIcons[cat.value]}
                        {cat.label}
                      </span>
                    )}
                    <p className="tl-card-desc">{tool.description?.slice(0, 80)}{(tool.description?.length || 0) > 80 && '...'}</p>

                    <div className="tl-card-actions">
                      <button className="tl-btn-use" onClick={() => onSelectTool(tool)}>Usar</button>
                      {!isPublicTool && (
                        <>
                          {onEditTool && (
                            <button className="tl-btn-icon" onClick={() => onEditTool(tool as UserTool)} aria-label="Editar">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                              </svg>
                            </button>
                          )}
                          <button className="tl-btn-icon tl-btn-delete" onClick={() => handleDelete(tool.id)} aria-label="Eliminar">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ==== CSS STYLES ====
const cssStyles = `
.tl-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 16px;
}
.tl-modal {
  background: var(--bg-dark-secondary);
  border: 1px solid var(--border-modal, rgba(255,255,255,0.1));
  border-radius: 20px;
  width: 100%;
  max-width: 720px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow-modal);
}
.tl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-modal, rgba(255,255,255,0.08));
  background: var(--bg-dark-tertiary);
}
.tl-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.tl-logo {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--color-accent), var(--color-success));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-on-accent);
  flex-shrink: 0;
}
.tl-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-white);
}
.tl-close {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--color-gray-medium);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.tl-close:hover {
  background: var(--bg-dark-tertiary);
  color: var(--color-white);
}
.tl-tabs {
  display: flex;
  gap: 4px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-modal, rgba(255,255,255,0.08));
  overflow-x: auto;
}
.tl-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-gray-medium);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
}
.tl-tab:hover { background: var(--bg-dark-tertiary); color: var(--color-white); }
.tl-tab.active {
  background: rgba(0, 212, 179, 0.12);
  border-color: rgba(0, 212, 179, 0.3);
  color: var(--color-accent);
}
.tl-filters {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  flex-wrap: wrap;
  align-items: center;
  border-bottom: 1px solid var(--border-modal, rgba(255,255,255,0.08));
}
.tl-search {
  flex: 1;
  min-width: 140px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-dark-tertiary);
  border: 1px solid var(--border-modal, rgba(255,255,255,0.08));
  border-radius: 8px;
  padding: 8px 12px;
  color: var(--color-gray-medium);
}
.tl-search input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  font-size: 13px;
  color: var(--color-white);
  min-width: 0;
}
.tl-search input::placeholder { color: var(--color-gray-medium); }

/* Custom Dropdown */
.tl-dropdown {
  position: relative;
  flex-shrink: 0;
}
.tl-dropdown-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-modal, rgba(255,255,255,0.08));
  background: var(--bg-dark-tertiary);
  color: var(--color-gray-medium);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 44px;
  max-width: 180px;
}
.tl-dropdown-trigger:hover {
  border-color: var(--color-gray-medium);
  color: var(--color-white);
}
.tl-dropdown-trigger.open,
.tl-dropdown-trigger.has-value {
  border-color: var(--color-accent);
  color: var(--color-white);
}
.tl-dropdown-trigger span {
  flex: 1;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tl-dropdown-chevron {
  transition: transform 0.2s;
  flex-shrink: 0;
}
.tl-dropdown-trigger.open .tl-dropdown-chevron {
  transform: rotate(180deg);
}
.tl-dropdown-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 200px;
  width: max-content;
  max-height: calc(100vh - 280px);
  overflow-y: auto;
  background: var(--bg-dark-secondary);
  border: 1px solid var(--border-modal, rgba(255,255,255,0.1));
  border-radius: 10px;
  padding: 6px;
  z-index: 100;
  box-shadow: var(--shadow-modal);
  animation: dropdownFadeIn 0.15s ease;
}
.tl-dropdown-menu::-webkit-scrollbar {
  width: 6px;
}
.tl-dropdown-menu::-webkit-scrollbar-track {
  background: transparent;
}
.tl-dropdown-menu::-webkit-scrollbar-thumb {
  background: var(--color-gray-medium);
  border-radius: 3px;
  opacity: 0.5;
}
.tl-dropdown-menu::-webkit-scrollbar-thumb:hover {
  opacity: 0.8;
}
@keyframes dropdownFadeIn {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}
.tl-dropdown-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-gray-medium);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.tl-dropdown-item:hover {
  background: var(--bg-dark-tertiary);
  color: var(--color-white);
}
.tl-dropdown-item.active {
  background: rgba(0, 212, 179, 0.15);
  color: var(--color-accent);
}
.tl-dropdown-item svg {
  flex-shrink: 0;
}

.tl-btn-create {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  border: none;
  background: var(--color-accent);
  color: var(--color-on-accent);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
}
.tl-btn-create:hover { filter: brightness(1.1); }
.tl-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.tl-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  color: var(--color-gray-medium);
}
.tl-state h3 { margin: 16px 0 8px; font-size: 16px; color: var(--color-white); }
.tl-state p { margin: 0; font-size: 13px; max-width: 280px; }
.tl-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--bg-dark-tertiary);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.tl-btn-retry {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
  padding: 10px 20px;
  border-radius: 8px;
  border: 1px solid ${COLORS.error};
  background: rgba(239, 68, 68, 0.1);
  color: ${COLORS.error};
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.tl-btn-retry:hover { background: rgba(239, 68, 68, 0.2); }
.tl-btn-create-empty {
  margin-top: 16px;
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  background: var(--color-accent);
  color: var(--color-on-accent);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.tl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.tl-card {
  background: var(--bg-dark-tertiary);
  border: 1px solid var(--border-modal, rgba(255,255,255,0.08));
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: all 0.2s;
}
.tl-card:hover {
  border-color: var(--color-gray-medium);
  transform: translateY(-2px);
  box-shadow: var(--shadow-modal);
}
.tl-card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.tl-card-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(0,212,179,0.15), rgba(16,185,129,0.1));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-accent);
}
.tl-card-fav {
  background: none;
  border: none;
  color: var(--color-gray-medium);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  transition: all 0.2s;
}
.tl-card-fav:hover { background: var(--bg-dark-secondary); }
.tl-card-fav.active { color: var(--color-warning); }
.tl-card-name {
  margin: 4px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-white);
  line-height: 1.3;
}
.tl-card-cat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--color-gray-medium);
  background: var(--bg-dark-secondary);
  padding: 4px 8px;
  border-radius: 4px;
  align-self: flex-start;
}
.tl-card-desc {
  margin: 0;
  font-size: 12px;
  color: var(--color-gray-medium);
  line-height: 1.4;
  flex: 1;
}
.tl-card-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.tl-btn-use {
  flex: 1;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-accent);
  background: rgba(0, 212, 179, 0.1);
  color: var(--color-accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.tl-btn-use:hover {
  background: var(--color-accent);
  color: var(--color-on-accent);
}
.tl-btn-icon {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid var(--border-modal, rgba(255,255,255,0.08));
  background: transparent;
  color: var(--color-gray-medium);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}
.tl-btn-icon:hover {
  background: var(--bg-dark-tertiary);
  color: var(--color-white);
}
.tl-btn-delete:hover {
  background: rgba(239, 68, 68, 0.15);
  color: ${COLORS.error};
  border-color: ${COLORS.error};
}
@media (max-width: 480px) {
  .tl-modal { max-height: 95vh; border-radius: 16px; }
  .tl-tabs { padding: 8px 12px; }
  .tl-tab span { display: none; }
  .tl-tab { padding: 10px 12px; }
  .tl-filters { padding: 10px 12px; }
  .tl-btn-create span { display: none; }
  .tl-dropdown-trigger { min-width: 44px; }
  .tl-dropdown-trigger span { display: none; }
  .tl-grid { grid-template-columns: 1fr; }
  .tl-content { padding: 12px; }
}
`;

export default ToolLibrary;
