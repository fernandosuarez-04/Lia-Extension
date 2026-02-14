import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { LiveClient, AudioCapture } from '../services/live-api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../contexts/AuthContext';
import Auth from '../components/Auth';
import { supabase } from '../lib/supabase';
import { SettingsModal } from './SettingsModal';
import { FeedbackModal as _FeedbackModal } from './FeedbackModal';
import { MapViewer } from '../components/MapViewer';
import { ProjectHub } from '../components/ProjectHub';
import { MeetingPanel } from '../components/MeetingPanel';
import { ToolLibrary } from '../components/ToolLibrary';
import { ToolEditorModal } from '../components/ToolEditorModal';
import { ProjectSuggestionModal } from '../components/ProjectSuggestionModal';
import type { Tool, UserTool } from '../services/tools';

interface GroundingSource {
  uri: string;
  title: string;
  snippet?: string;
}

interface MapPlace {
  placeId?: string;
  name: string;
  location?: { lat: number; lng: number };
  address?: string;
  rating?: number;
  uri?: string;
}

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  reactions?: string[];
  images?: string[];
  sources?: GroundingSource[];
  places?: MapPlace[];
  contextData?: { text: string; action: string; url?: string; pageTitle?: string } | null;
}

interface Folder {
  id: string;
  name: string;
  description?: string;
  user_id: string;
  created_at?: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  folderId?: string | null;
}

interface UserSettings {
  nickname?: string;
  occupation?: string;
  tone_style?: string;
  about_user?: string;
  custom_instructions?: string;
}

function App() {
  // Auth
  const { loading: authLoading, signOut, user } = useAuth();

  // Loading screen while checking auth
  if (authLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--bg-dark-main)', color: 'var(--color-text-primary)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '24px', height: '24px', borderRadius: '50%', border: '2px solid var(--color-accent)', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: '13px', opacity: 0.8 }}>Iniciando Soflia...</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // Show login if not authenticated
  // Usamos 'user' en lugar de 'session' porque SOFIA no usa sessions de Supabase
  if (!user) {
    return <Auth />;
  }

  // Static Model List with Rich Metadata for UI
  // Thinking Options - Different for Gemini 3 (thinkingLevel) vs Gemini 2.5 (thinkingBudget)
  // According to docs:
  // - Gemini 3 Pro: only supports "low" and "high" (NOT minimal, NOT medium)
  // - Gemini 3 Flash: supports "minimal", "low", "medium", "high"
  // - Gemini 2.5: uses thinkingBudget (0-24576 tokens)

  // Gemini 3 Flash - supports all levels
  const THINKING_OPTIONS_GEMINI3_FLASH = [
    { id: 'minimal', name: 'Rápido', desc: 'Responde rápidamente', level: 'minimal' },
    { id: 'low', name: 'Pensar', desc: 'Razonamiento básico', level: 'low' },
    { id: 'medium', name: 'Medio', desc: 'Razonamiento balanceado', level: 'medium' },
    { id: 'high', name: 'Alto', desc: 'Máximo razonamiento', level: 'high' },
  ];

  // Gemini 3 Pro - only supports low and high
  const THINKING_OPTIONS_GEMINI3_PRO = [
    { id: 'low', name: 'Pensar', desc: 'Razonamiento básico', level: 'low' },
    { id: 'high', name: 'Pro', desc: 'Máximo razonamiento', level: 'high' },
  ];

  // Gemini 2.5 - uses token budget
  const THINKING_OPTIONS_GEMINI25 = [
    { id: 'off', name: 'Rápido', desc: 'Sin pensamiento', budget: 0 },
    { id: 'low', name: 'Pensar', desc: 'Pensamiento ligero', budget: 1024 },
    { id: 'medium', name: 'Medio', desc: 'Pensamiento moderado', budget: 8192 },
    { id: 'high', name: 'Alto', desc: 'Pensamiento profundo', budget: 24576 },
  ];

  const MODEL_OPTIONS = [
      {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3.0 Flash',
        desc: 'Equilibrio perfecto entre velocidad y calidad.',
        icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>,
        badge: 'Recomendado',
        color: '#00D4B3',
        thinkingType: 'level' as const,
        thinkingOptions: THINKING_OPTIONS_GEMINI3_FLASH
      },
      {
        id: 'gemini-3-pro-preview',
        name: 'Gemini 3 Pro',
        desc: 'Mayor capacidad de razonamiento lógico.',
        icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"></path><path d="M8.5 8.5v.01"></path><path d="M16 12v.01"></path><path d="M12 16v.01"></path></svg>,
        badge: 'Pro',
        color: '#A855F7',
        thinkingType: 'level' as const,
        thinkingOptions: THINKING_OPTIONS_GEMINI3_PRO
      },
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        desc: 'Ultra rápido y ligero para tareas simples.',
        icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="M12 15l-3-3a22 22 0 0 1 2-12 22 22 0 0 1 12 2 22 22 0 0 1-11 13z"></path><path d="M9 9l3 3"></path></svg>,
        badge: 'Nuevo',
        color: '#3B82F6',
        thinkingType: 'budget' as const,
        thinkingOptions: THINKING_OPTIONS_GEMINI25
      },
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        desc: 'Modelo de máxima inteligencia.',
        icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"></path></svg>,
        badge: 'Experimental',
        color: '#F59E0B',
        thinkingType: 'budget' as const,
        thinkingOptions: THINKING_OPTIONS_GEMINI25
      },
      {
        id: 'gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash Lite',
        desc: 'Versión estable anterior.',
        icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>,
        badge: null,
        color: '#10B981',
        thinkingType: 'budget' as const,
        thinkingOptions: THINKING_OPTIONS_GEMINI25
      }
  ];

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Live API States
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [isLiveConnecting, setIsLiveConnecting] = useState(false);
  const [isLiveMicActive, setIsLiveMicActive] = useState(false);
  const [isLiveComputerUseEnabled, setIsLiveComputerUseEnabled] = useState(false);
  const liveClientRef = useRef<LiveClient | null>(null);
  const audioCapturRef = useRef<AudioCapture | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Model States
  const [preferredPrimaryModel, setPreferredPrimaryModel] = useState<string>('gemini-3-flash-preview');
  const [_preferredFallbackModel, setPreferredFallbackModel] = useState<string>('gemini-2.5-flash');
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);

  // Thinking Mode State
  // Gemini 3: 'minimal', 'low', 'medium', 'high'
  // Gemini 2.5: 'off', 'low', 'medium', 'high'
  const [thinkingMode, setThinkingMode] = useState<string>('minimal');
  const [isThinkingDropdownOpen, setIsThinkingDropdownOpen] = useState(false);

  // Tool Library State
  const [activeTool, setActiveTool] = useState<Tool | UserTool | null>(null);
  const [isToolLibraryOpen, setIsToolLibraryOpen] = useState(false);
  const [isToolEditorOpen, setIsToolEditorOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<UserTool | null>(null);
  const [pendingPromptText, setPendingPromptText] = useState<string>(''); // Text to save as new prompt

  // Handler for model change
  const handleModelChange = async (type: 'primary' | 'fallback', modelId: string) => {
      // Optimistic update
      if (type === 'primary') {
        setPreferredPrimaryModel(modelId);
        // Adapt thinking mode when switching models
        const newModel = MODEL_OPTIONS.find(m => m.id === modelId);
        if (newModel) {
          const isGemini3 = newModel.thinkingType === 'level';
          const availableOptions = newModel.thinkingOptions.map((o: any) => o.id);

          // If current mode is not available in new model, adapt it
          if (!availableOptions.includes(thinkingMode)) {
            // For Gemini 3 Pro (only low/high): map minimal->low, medium->low
            if (modelId === 'gemini-3-pro-preview') {
              setThinkingMode('low');
            }
            // For Gemini 2.5: map minimal->off
            else if (!isGemini3 && thinkingMode === 'minimal') {
              setThinkingMode('off');
            }
            // For Gemini 3 Flash: map off->minimal
            else if (isGemini3 && thinkingMode === 'off') {
              setThinkingMode('minimal');
            }
          }
        }
      } else {
        setPreferredFallbackModel(modelId);
      }

      if (user) {
          const updateData = {
              user_id: user.id,
              [type === 'primary' ? 'primary_model' : 'fallback_model']: modelId
          };

          await supabase.from('user_ai_settings').upsert(updateData, { onConflict: 'user_id' });
      }
  };

  // Handler for thinking mode change
  const handleThinkingChange = async (mode: string) => {
      setThinkingMode(mode);

      if (user) {
          await supabase.from('user_ai_settings').upsert({
              user_id: user.id,
              thinking_mode: mode
          }, { onConflict: 'user_id' });
      }
  };

  // Plus Menu States
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const [isDeepResearch, setIsDeepResearch] = useState(false);
  const [isImageGenMode, setIsImageGenMode] = useState(false);
  const [isPromptOptimizerMode, setIsPromptOptimizerMode] = useState(false);
  const [isWebAgentMode, setIsWebAgentMode] = useState(false);
  const [targetAI, setTargetAI] = useState<'chatgpt' | 'claude' | 'gemini' | null>(null);
  const [researchStep, setResearchStep] = useState<string>('Iniciando...');

  // Maps Mode States
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  // Settings Menu States
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('lia_theme') as 'light' | 'dark' | 'system') || 'dark';
    }
    return 'dark';
  });

  // Image Zoom State
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  // Copy Feedback State
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Sidebar & History States
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);

  // Folders State
  const [folders, setFolders] = useState<Folder[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [movingChatId, setMovingChatId] = useState<string | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);

  // Project Suggestion State
  const [suggestionData, setSuggestionData] = useState<{
    isOpen: boolean;
    type: 'join_existing' | 'create_new';
    targetName: string;
    targetId?: string; // ID of existing project if applicable
    reason: string;
    relatedChatsCount?: number;
    chatIdsToGroup?: string[];
  } | null>(null);

  // Handle Suggestion Confirmation
  const handleSuggestionConfirm = async () => {
    if (!suggestionData || !user || !currentChatId) return;

    try {
      if (suggestionData.type === 'join_existing' && suggestionData.targetId) {
        // Move current chat to existing project
        const { error } = await supabase
          .from('conversations')
          .update({ folder_id: suggestionData.targetId })
          .eq('id', currentChatId)
          .eq('user_id', user.id);

        if (error) throw error;

        // Update local state
        setCurrentFolderId(suggestionData.targetId);
        setChatHistory(prev => prev.map(c => 
          c.id === currentChatId ? { ...c, folderId: suggestionData.targetId } : c
        ));
      } 
      else if (suggestionData.type === 'create_new' && suggestionData.chatIdsToGroup) {
        // Create new project
        const { data: newFolder, error: folderError } = await supabase
          .from('folders')
          .insert({
            name: suggestionData.targetName.trim().substring(0, 50),
            user_id: user.id,
            description: `Carpeta automática para agrupar conversaciones sobre ${suggestionData.targetName.substring(0, 30)}.`
          })
          .select()
          .single();

        if (folderError || !newFolder) {
          console.error('Project creation failed:', JSON.stringify(folderError, null, 2));
          throw folderError;
        }

        // Move all related chats to new project
        const { error: moveError } = await supabase
          .from('conversations')
          .update({ folder_id: newFolder.id })
          .in('id', suggestionData.chatIdsToGroup)
          .eq('user_id', user.id);

        if (moveError) {
          console.error('Chat migration failed:', JSON.stringify(moveError, null, 2));
          throw moveError;
        }

        // Update local state
        setFolders(prev => [...prev, newFolder]);
        setChatHistory(prev => prev.map(c => 
          suggestionData.chatIdsToGroup?.includes(c.id) ? { ...c, folderId: newFolder.id } : c
        ));
        setCurrentFolderId(newFolder.id);
      }

      setSuggestionData(null);
    } catch (err) {
      console.error('Error applying suggestion:', JSON.stringify(err, null, 2));
      // Show user feedback if possible, or just log for now
    }

  };

  // Handle Renaming Project
  const handleRenameProject = async (newName: string) => {
    if (!currentFolderId || !user) return;
    
    // Update in DB
    const { error } = await supabase
      .from('folders')
      .update({ name: newName })
      .eq('id', currentFolderId)
      .eq('user_id', user.id);

    if (error) {
      console.error('Error renaming project:', JSON.stringify(error, null, 2));
      return;
    }

    // Update local state
    setFolders(prev => prev.map(f => 
      f.id === currentFolderId ? { ...f, name: newName } : f
    ));
  };

  // Suggestion Intelligence Logic
  useEffect(() => {
    // Requirements: Active chat, not in folder, sufficient content
    if (currentFolderId || !currentChatId || messages.length < 4 || !user) return;
    
    // Only analyze after model response
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== 'model') return;

    // Prevent annoyance: Don't show if already showing
    if (suggestionData?.isOpen) return;

    const timer = setTimeout(() => {
        const chatContent = messages.map(m => m.text).join(' ').toLowerCase();
        // Remove common stop words for better precision (simplified list)
        const stopWords = ['para', 'como', 'cuando', 'donde', 'porque', 'pero', 'sobre', 'este', 'esta', 'esto'];
        const meaningfulConfirm = chatContent.split(/\s+/).filter(w => w.length > 3 && !stopWords.includes(w));
        const uniqueChatWords = new Set(meaningfulConfirm);
        
        // 1. Check Existing Projects with Deep Context
        let bestMatch: Folder | null = null;
        let maxScore = 0;
        let secondBestScore = 0; // To detect ambiguity

        // Pre-calculate project "fingerprints" from chat history to understand what belongs where
        const projectFingerprints = new Map<string, string>();
        chatHistory.forEach(c => {
            if (c.folderId) {
                const existing = projectFingerprints.get(c.folderId) || '';
                // Add title to fingerprint
                projectFingerprints.set(c.folderId, existing + ' ' + c.title.toLowerCase());
            }
        });

        folders.forEach(folder => {
            let score = 0;
            // Context includes: Name (High weight), Description (Medium), Existing Chats (Low but cumulative)
            const nameKeywords = folder.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            const descKeywords = (folder.description || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
            const historyContext = projectFingerprints.get(folder.id) || '';

            uniqueChatWords.forEach(word => {
                // Critical: Name Match (+3)
                if (nameKeywords.some(kw => kw === word || kw.includes(word) || word.includes(kw))) {
                    score += 3;
                }
                // Strong: Description Match (+2)
                if (descKeywords.includes(word)) {
                    score += 2;
                }
                // Contextual: History Match (+1) - Helps distinguish similar projects like "Marketing Client A" vs "Marketing Client B"
                if (historyContext.includes(word)) {
                    score += 1;
                }
            });
            
            if (score > maxScore) {
                secondBestScore = maxScore;
                maxScore = score;
                bestMatch = folder;
            } else if (score > secondBestScore) {
                secondBestScore = score;
            }
        });

        // Precision Logic:
        // 1. Score must be significant (> 4)
        // 2. Winner must be clearly better than runner-up (avoid ambiguity between similar projects)
        if (bestMatch && maxScore > 4 && maxScore > (secondBestScore * 1.3)) {
            setSuggestionData({
                isOpen: true,
                type: 'join_existing',
                targetName: (bestMatch as Folder).name,
                targetId: (bestMatch as Folder).id,
                reason: `El contenido coincide fuertemente con el contexto de "${(bestMatch as Folder).name}"`
            });
            return;
        }

        // 2. Check for grouping (New Project)
        // Only if we have a title for current chat
        const currentChatSession = chatHistory.find(c => c.id === currentChatId);
        if (!currentChatSession || !currentChatSession.title || currentChatSession.title === 'Nuevo Chat') return;

        const currentTitleKeywords = currentChatSession.title.toLowerCase().split(' ').filter(w => w.length > 4);
        if (currentTitleKeywords.length === 0) return;

        const strayChats = chatHistory.filter(c => !c.folderId && c.id !== currentChatId);
        const similarChats = strayChats.filter(c => {
            return currentTitleKeywords.some(kw => c.title.toLowerCase().includes(kw));
        });

        if (similarChats.length >= 2) {
             setSuggestionData({
                isOpen: true,
                type: 'create_new',
                targetName: currentChatSession.title.split(' ').slice(0, 3).join(' '),
                reason: 'Tema recurrente en chats sueltos',
                relatedChatsCount: similarChats.length + 1,
                chatIdsToGroup: [currentChatId, ...similarChats.map(c => c.id)]
            });
        }
    }, 2000); // Wait 2s after response to be less intrusive

    return () => clearTimeout(timer);
  }, [messages, currentFolderId, currentChatId, folders, chatHistory, suggestionData]);

  // Settings & Feedback Modals
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [_isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);

  // Meeting Panel
  const [isMeetingPanelOpen, setIsMeetingPanelOpen] = useState(false);
  const [_feedbackType, setFeedbackType] = useState<'positive' | 'negative' | null>(null);
  const [_feedbackMessageContent, setFeedbackMessageContent] = useState('');

  // Personalization Settings
  const [_userSettings, setUserSettings] = useState<UserSettings | null>(null);

  // Debounce ref for saving
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Apply Theme & Persist
  useLayoutEffect(() => {
    localStorage.setItem('lia_theme', theme);
    const root = document.documentElement;
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.setAttribute('data-theme', systemTheme);
    } else {
      root.setAttribute('data-theme', theme);
    }
  }, [theme]);

  // Avatar URL for extension
  const liaAvatar = chrome.runtime.getURL('assets/lia-avatar.png');

  // Auto-resize textarea
  useLayoutEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'; // Reset height
      const newHeight = Math.min(textareaRef.current.scrollHeight, 150);
      textareaRef.current.style.height = `${Math.max(newHeight, 24)}px`;
    }
  }, [inputValue]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    return () => {
      stopLiveSession();
    };
  }, []);

  // Close thinking dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setIsThinkingDropdownOpen(false);
    if (isThinkingDropdownOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [isThinkingDropdownOpen]);

  // ========== SUPABASE DATA LOADING ==========

  // Load user settings
  const loadUserSettings = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase
        .from('user_ai_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();
      if (data) {
        setUserSettings({
          nickname: data.nickname,
          occupation: data.occupation,
          tone_style: data.tone_style,
          about_user: data.about_user,
          custom_instructions: data.custom_instructions
        });
        // Load model preferences
        const loadedModel = data.primary_model || 'gemini-3-flash-preview';
        if (data.primary_model) setPreferredPrimaryModel(data.primary_model);
        if (data.fallback_model) setPreferredFallbackModel(data.fallback_model);
        // Load thinking mode - adapt based on model type
        if (data.thinking_mode) {
          const modelConfig = MODEL_OPTIONS.find(m => m.id === loadedModel);
          const isGemini3 = modelConfig?.thinkingType === 'level';
          let mode = data.thinking_mode;
          // Adapt mode if incompatible with model
          if (isGemini3 && mode === 'off') mode = 'minimal';
          if (!isGemini3 && mode === 'minimal') mode = 'off';
          setThinkingMode(mode);
        }
      }
    } catch (err) {
      console.log('No user settings found');
    }
  }, [user?.id]);

  // Load folders
  const loadFolders = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase
        .from('folders')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      if (data) setFolders(data);
    } catch (err) {
      console.error('Error loading folders:', err);
    }
  }, [user?.id]);

  // Load chat history
  const loadChatHistory = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data: conversations } = await supabase
        .from('conversations')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(50);

      if (conversations && conversations.length > 0) {
        const sessionsPromises = conversations.map(async (conv: { id: string; title: string; created_at: string; updated_at: string; folder_id?: string | null }) => {
          const { data: msgs } = await supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: true });

          const formattedMessages: Message[] = (msgs || []).map((m: { id: string; role: string; content: string; created_at: string; metadata?: { sources?: GroundingSource[]; places?: MapPlace[]; images?: string[] } }) => ({
            id: m.id,
            role: m.role as 'user' | 'model',
            text: m.content,
            timestamp: new Date(m.created_at).getTime(),
            sources: m.metadata?.sources,
            places: m.metadata?.places,
            images: m.metadata?.images
          }));

          return {
            id: conv.id,
            title: conv.title,
            messages: formattedMessages,
            createdAt: new Date(conv.created_at).getTime(),
            updatedAt: new Date(conv.updated_at).getTime(),
            folderId: conv.folder_id
          } as ChatSession;
        });

        const sessions = (await Promise.all(sessionsPromises)).filter(Boolean) as ChatSession[];
        setChatHistory(sessions);

        // Restore last chat
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.get(['lia_current_chat_id'], (result) => {
            if (result.lia_current_chat_id) {
              const currentChat = sessions.find(c => c.id === result.lia_current_chat_id);
              if (currentChat) {
                setCurrentChatId(currentChat.id);
                setMessages(currentChat.messages);
              }
            }
          });
        }
      }
    } catch (err) {
      console.error('Error loading chat history:', err);
    }
  }, [user?.id]);

  // Generate chat title
  const generateChatTitle = (msgs: Message[]): string => {
    const firstUserMsg = msgs.find(m => m.role === 'user');
    if (firstUserMsg) {
      const text = firstUserMsg.text.slice(0, 40);
      return text.length < firstUserMsg.text.length ? text + '...' : text;
    }
    return 'Nueva conversación';
  };

  // Save current chat
  const saveCurrentChat = useCallback(async () => {
    if (messages.length === 0 || !user?.id) {
      console.log('saveCurrentChat: Skipped - no messages or no user', { messagesCount: messages.length, userId: user?.id });
      return;
    }

    console.log('saveCurrentChat: Starting with user.id =', user.id);

    try {
      let chatId = currentChatId;
      const title = generateChatTitle(messages);

      if (!chatId) {
        console.log('saveCurrentChat: Creating new conversation...');
        const { data: newConv, error } = await supabase
          .from('conversations')
          .insert({
            user_id: user.id,
            title,
            folder_id: targetFolderId // Use target folder if set
          })
          .select()
          .single();

        if (error) {
          console.error('saveCurrentChat: Error creating conversation:', JSON.stringify(error, null, 2));
          console.error('Error details:', { message: error.message, code: error.code, details: error.details, hint: error.hint });
          throw error;
        }
        console.log('saveCurrentChat: Conversation created:', newConv);
        chatId = newConv.id;
        setCurrentChatId(chatId);

        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.set({ lia_current_chat_id: chatId });
        }
      } else {
        await supabase.from('conversations').update({ title }).eq('id', chatId);
      }

      const { data: existingMsgs } = await supabase
        .from('messages')
        .select('id, content')
        .eq('conversation_id', chatId);

      const existingMsgsMap = new Map((existingMsgs || []).map((m: { id: string; content: string }) => [m.id, m.content]));

      // Filter out transient messages
      const validMessages = messages.filter(m =>
        m.id !== 'live-connecting' &&
        !m.id.startsWith('error-') &&
        m.text && m.text.trim().length > 0 // Only save messages with actual content
      );

      // Separate into new messages and messages that need updating
      const newMessages = validMessages.filter(m => !existingMsgsMap.has(m.id));
      const messagesToUpdate = validMessages.filter(m => {
        const existingContent = existingMsgsMap.get(m.id);
        // Update if exists but content is different (and new content is not empty)
        return existingContent !== undefined &&
               existingContent !== m.text &&
               m.text && m.text.trim().length > 0;
      });

      // Insert new messages
      if (newMessages.length > 0) {
        const messagesToInsert = newMessages.map(m => ({
          id: m.id,
          conversation_id: chatId,
          user_id: user.id,
          role: m.role,
          content: m.text,
          metadata: { sources: m.sources, places: m.places, images: m.images }
        }));

        console.log('Inserting new messages:', messagesToInsert.length);

        const { error: insertError } = await supabase
          .from('messages')
          .insert(messagesToInsert);

        if (insertError) {
          console.error('Error inserting messages:', insertError);
        } else {
          console.log('Messages inserted successfully:', newMessages.length);
        }
      }

      // Update existing messages with new content
      if (messagesToUpdate.length > 0) {
        console.log('Updating messages with new content:', messagesToUpdate.length);

        for (const m of messagesToUpdate) {
          const { error: updateError } = await supabase
            .from('messages')
            .update({
              content: m.text,
              metadata: { sources: m.sources, places: m.places, images: m.images }
            })
            .eq('id', m.id);

          if (updateError) {
            console.error('Error updating message:', m.id, updateError);
          }
        }
        console.log('Messages updated successfully');
      }

      // Update local history
      setChatHistory(prev => {
        const existingIndex = prev.findIndex(c => c.id === chatId);
        const updatedChat: ChatSession = {
          id: chatId!,
          title,
          messages,
          createdAt: prev.find(c => c.id === chatId)?.createdAt || Date.now(),
          updatedAt: Date.now(),
          folderId: prev.find(c => c.id === chatId)?.folderId || targetFolderId
        };

        if (existingIndex >= 0) {
          const newHistory = [...prev];
          newHistory[existingIndex] = updatedChat;
          return newHistory;
        }
        return [updatedChat, ...prev];
      });
    } catch (err) {
      console.error('Error saving chat:', err);
    }
  }, [messages, currentChatId, user?.id, targetFolderId]);

  // Create new chat
  const createNewChat = useCallback(() => {
    setMessages([]);
    setCurrentChatId(null);
    setSelectedContext(null);
    setIsSidebarOpen(false);
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.remove('lia_current_chat_id');
    }
    setCurrentFolderId(null);
    setTargetFolderId(null);
    // Reset Gemini session to avoid mixing histories
    import('../services/gemini').then(m => m.resetChatSession());
  }, []);

  const handleOpenProject = (folderId: string) => {
    setCurrentFolderId(folderId);
    setTargetFolderId(folderId);
    setCurrentChatId(null);
    setMessages([]);
    setIsSidebarOpen(false);
  };

  // Load a chat
  const loadChat = useCallback((chat: ChatSession) => {
    setMessages(chat.messages);
    setCurrentChatId(chat.id);
    setCurrentFolderId(null); // Exit hub view
    setIsSidebarOpen(false);
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ lia_current_chat_id: chat.id });
    }
    // Reset Gemini session so next message uses loaded chat history
    import('../services/gemini').then(m => m.resetChatSession());
  }, []);

  // Delete a chat
  const deleteChat = useCallback(async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await supabase.from('conversations').delete().eq('id', chatId);
      setChatHistory(prev => prev.filter(c => c.id !== chatId));
      if (chatId === currentChatId) {
        setMessages([]);
        setCurrentChatId(null);
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.remove('lia_current_chat_id');
        }
      }
    } catch (err) {
      console.error('Error deleting chat:', err);
    }
  }, [currentChatId]);

  // Create folder
  const createFolder = async () => {
    if (!newFolderName.trim() || !user?.id) return;
    try {
      const { data, error } = await supabase
        .from('folders')
        .insert({ user_id: user.id, name: newFolderName.trim() })
        .select()
        .single();

      if (!error && data) {
        setFolders(prev => [...prev, data]);
        setNewFolderName('');
        setIsFolderModalOpen(false);
      }
    } catch (err) {
      console.error('Error creating folder:', err);
    }
  };

  // Move chat to folder (reserved for future drag-drop feature)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const moveChatToFolder = async (chatId: string, folderId: string | null) => {
    try {
      await supabase
        .from('conversations')
        .update({ folder_id: folderId })
        .eq('id', chatId);

      setChatHistory(prev =>
        prev.map(c => c.id === chatId ? { ...c, folderId } : c)
      );
    } catch (err) {
      console.error('Error moving chat:', err);
    }
  };
  void moveChatToFolder; // Suppress unused warning - reserved for future use

  // Format relative time
  const formatRelativeTime = (timestamp: number): string => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Ahora';
    if (minutes < 60) return `Hace ${minutes}m`;
    if (hours < 24) return `Hace ${hours}h`;
    if (days < 7) return `Hace ${days}d`;
    return new Date(timestamp).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  };

  // Load data on mount
  useEffect(() => {
    if (user?.id) {
      loadUserSettings();
      loadFolders();
      loadChatHistory();
    }
  }, [user?.id, loadUserSettings, loadFolders, loadChatHistory]);

  // Auto-save chat (debounced)
  useEffect(() => {
    if (messages.length > 0 && user?.id) {
      console.log('Auto-save triggered: user.id =', user.id, 'messages count =', messages.length);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        // Verificar sesión antes de guardar
        supabase.auth.getSession().then(({ data }: { data: { session: { user: { id: string } } | null } }) => {
          console.log('Current Lia session before save:', data.session ? `User: ${data.session.user.id}` : 'No session');
        });
        saveCurrentChat();
      }, 1000);
    }
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [messages, user?.id, saveCurrentChat]);

  // ========== END SUPABASE ==========

  // Context from selected text (shown as attachment, not auto-sent)
  const [selectedContext, setSelectedContext] = useState<{ text: string; action: string; url?: string; pageTitle?: string } | null>(null);
  
  // Function to check for pending selection
  const checkPendingSelection = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_PENDING_SELECTION' });
      console.log('Checking pending selection:', response);
      if (response && response.text) {
        console.log('Found pending context:', response.text.substring(0, 50));
        // Get URL of the active tab for reference navigation
        let sourceUrl = '';
        let sourceTitle = '';
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          sourceUrl = tab?.url || '';
          sourceTitle = tab?.title || '';
        } catch { /* ignore */ }
        // Set as context, don't auto-send
        setSelectedContext({
          text: response.text,
          action: response.action,
          url: sourceUrl,
          pageTitle: sourceTitle
        });
      }
    } catch (err) {
      console.log('No pending selection:', err);
    }
  };
  
  useEffect(() => {
    // Check immediately
    checkPendingSelection();
    
    // Also check when panel becomes visible (for when it was already open)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkPendingSelection();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Listen for messages from background
    const handleMessage = (message: any) => {
      if (message.type === 'PENDING_SELECTION_AVAILABLE') {
        checkPendingSelection();
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);
  
  // Clear context helper
  const clearSelectedContext = () => {
    setSelectedContext(null);
  };

  // Navigate to source and highlight text (Smart References)
  const navigateToSource = (source: { uri: string; title?: string; snippet?: string }) => {
    if (source.snippet) {
      chrome.runtime.sendMessage({
        type: 'NAVIGATE_AND_HIGHLIGHT',
        url: source.uri,
        searchText: source.snippet
      });
    } else {
      chrome.tabs.create({ url: source.uri });
    }
  };

  // Voice Recording
  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      
      const audioChunks: Blob[] = [];
      
      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        console.log('Audio recorded:', audioBlob);
        stream.getTracks().forEach(track => track.stop());
        
        // Transcribe audio using Gemini
        try {
          setIsLoading(true);
          
          // Convert blob to base64
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve, reject) => {
            reader.onloadend = () => {
              const base64 = (reader.result as string).split(',')[1];
              resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(audioBlob);
          });
          
          const base64Audio = await base64Promise;
          
          // Use Gemini to transcribe the audio
          const { GoogleGenerativeAI } = await import('@google/generative-ai');
          const { getApiKeyWithCache } = await import('../services/api-keys');
          const { GOOGLE_API_KEY, MODELS } = await import('../config');
          
          let apiKey = await getApiKeyWithCache('google');
          if (!apiKey) apiKey = GOOGLE_API_KEY;
          
          if (!apiKey) {
            throw new Error('API key no configurada');
          }
          
          const genAI = new GoogleGenerativeAI(apiKey);
          const model = genAI.getGenerativeModel({ model: MODELS.PRIMARY });
          
          // Send audio with transcription prompt
          const result = await model.generateContent([
            {
              inlineData: {
                mimeType: 'audio/webm',
                data: base64Audio
              }
            },
            { text: 'Transcribe este audio exactamente como se dice, sin añadir comentarios ni explicaciones. Solo devuelve el texto transcrito.' }
          ]);
          
          const transcribedText = result.response.text().trim();

          if (transcribedText) {
            console.log('Audio transcribed:', transcribedText);

            // Clear input field and send message automatically
            setInputValue('');

            // Send the transcribed message
            await handleSendMessage(transcribedText);
          } else {
            console.warn('No transcription returned');
            setMessages(prev => [...prev, {
              id: crypto.randomUUID(),
              role: 'model',
              text: 'No se pudo transcribir el audio. Por favor, intenta de nuevo hablando más claro.',
              timestamp: Date.now()
            }]);
          }
        } catch (err: any) {
          console.error('Transcription error:', err);
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            role: 'model',
            text: `**Error de transcripción**\n\n${err.message || 'No se pudo transcribir el audio.'}`,
            timestamp: Date.now()
          }]);
        } finally {
          setIsLoading(false);
        }
      };
      
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err: any) {
      console.error('Error accessing microphone:', err);
      // Open permission page if access denied or generic error in extension popup context
      chrome.tabs.create({ url: chrome.runtime.getURL('permissions.html') });
      
      // Optionally notify user
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'model',
        text: '**Permiso de micrófono requerido**\n\nSe ha abierto una nueva pestaña para autorizar el acceso al micrófono. Por favor, acepta el permiso y vuelve a intentar.',
        timestamp: Date.now()
      }]);
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // Image Upload
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result) {
            setSelectedImages(prev => [...prev, event.target!.result as string]);
          }
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const removeImage = (index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };

  // Handle Paste (Images)
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64 = event.target?.result as string;
            setSelectedImages(prev => [...prev, base64]);
          };
          reader.readAsDataURL(blob);
        }
      }
    }
  };

  // Copy to Clipboard with visual feedback
  const copyToClipboard = (text: string, id?: string) => {
    navigator.clipboard.writeText(text);
    if (id) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  // Reactions
  const addReaction = (messageId: string, emoji: string) => {
    setMessages(prev => prev.map(msg => {
      if (msg.id === messageId) {
        const reactions = msg.reactions || [];
        if (reactions.includes(emoji)) {
          return { ...msg, reactions: reactions.filter(r => r !== emoji) };
        }
        return { ...msg, reactions: [...reactions, emoji] };
      }
      return msg;
    }));
  };

  // Code Block Component with Copy Button - ChatGPT-like design
  // Using 'any' for props to avoid react-markdown type conflicts
  const CodeBlock = (props: any) => {
    const { children, className } = props;
    const [copied, setCopied] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const codeString = String(children || '').replace(/\n$/, '');
    const language = className?.replace('language-', '') || '';

    const handleCopy = () => {
      navigator.clipboard.writeText(codeString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    // Inline code (no language class)
    if (!className) {
      return (
        <code style={{
          backgroundColor: 'rgba(142, 150, 170, 0.14)',
          color: '#c9d1d9',
          padding: '2px 6px',
          borderRadius: '6px',
          fontSize: '0.875em',
          fontFamily: "'SF Mono', 'Fira Code', 'Consolas', 'Monaco', monospace",
          fontWeight: 500,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}>
          {children}
        </code>
      );
    }

    // Code block - ChatGPT style
    return (
      <div
        style={{
          position: 'relative',
          marginTop: '16px',
          marginBottom: '16px',
          borderRadius: '12px',
          overflow: 'hidden',
          backgroundColor: '#0d0d0d',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Header with language badge and copy button */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 16px',
          backgroundColor: '#2f2f2f',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
        }}>
          <span style={{
            fontSize: '12px',
            color: '#b4b4b4',
            fontWeight: 500,
            letterSpacing: '0.3px'
          }}>
            {language || 'plaintext'}
          </span>
          <button
            onClick={handleCopy}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'transparent',
              border: 'none',
              padding: '6px 10px',
              cursor: 'pointer',
              color: copied ? '#10a37f' : '#b4b4b4',
              fontSize: '12px',
              borderRadius: '6px',
              transition: 'all 0.15s ease',
              opacity: isHovered || copied ? 1 : 0.7,
              backgroundColor: isHovered ? 'rgba(255, 255, 255, 0.08)' : 'transparent'
            }}
          >
            {copied ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Copiado</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>Copiar código</span>
              </>
            )}
          </button>
        </div>
        {/* Code content area */}
        <div style={{
          overflow: 'auto',
          maxHeight: '450px'
        }}>
          <pre style={{
            margin: 0,
            padding: '16px',
            fontSize: '13px',
            lineHeight: '1.6',
            backgroundColor: '#0d0d0d'
          }}>
            <code className={className} style={{
              fontFamily: "'SF Mono', 'Fira Code', 'Consolas', 'Monaco', monospace",
              color: '#e6e6e6',
              display: 'block',
              tabSize: 2
            }}>
              {children}
            </code>
          </pre>
        </div>
      </div>
    );
  };

  // Markdown components configuration
  const markdownComponents: any = {
    code: CodeBlock,
    pre: (props: any) => <>{props.children}</> // Remove default pre wrapper
  };

  // Execute function calls from Live API (Computer Use)
  const executeLiveFunctionCall = async (functionCall: { name: string; args: any }): Promise<string> => {
    try {
      console.log("Executing Live API function call:", functionCall);

      // Get current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        return JSON.stringify({ error: "No active tab found" });
      }

      const tabId = tab.id;

      // Handle different function calls
      switch (functionCall.name) {
        case 'click_element':
        case 'type_text':
        case 'press_key':
        case 'scroll_page':
        case 'select_option':
        case 'hover_element': {
          // Execute action via content script
          const response = await chrome.tabs.sendMessage(tabId, {
            type: 'EXECUTE_ACTION',
            action: functionCall.name.replace('_element', '').replace('_', ''),
            args: functionCall.args
          });
          return JSON.stringify(response);
        }

        case 'navigate': {
          await chrome.tabs.update(tabId, { url: functionCall.args.url });
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for navigation
          return JSON.stringify({ result: `Navegado a ${functionCall.args.url}` });
        }

        case 'go_back': {
          await chrome.tabs.goBack(tabId);
          await new Promise(resolve => setTimeout(resolve, 1500));
          return JSON.stringify({ result: "Navegación hacia atrás exitosa" });
        }

        case 'wait_and_observe': {
          const waitMs = functionCall.args.wait_ms || 1500;
          await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 5000)));

          // Get updated page context after waiting
          if (liveClientRef.current && isLiveComputerUseEnabled) {
            await sendPageContextToLive();
          }

          return JSON.stringify({ result: `Esperado ${waitMs}ms, página actualizada` });
        }

        case 'task_complete': {
          return JSON.stringify({
            result: "Tarea completada",
            summary: functionCall.args.summary
          });
        }

        case 'task_failed': {
          return JSON.stringify({
            result: "Tarea fallida",
            reason: functionCall.args.reason
          });
        }

        default:
          return JSON.stringify({ error: `Función desconocida: ${functionCall.name}` });
      }
    } catch (error: any) {
      console.error("Error executing Live API function call:", error);
      return JSON.stringify({ error: error.message || "Error ejecutando función" });
    }
  };

  // Get page context and send to Live API
  const sendPageContextToLive = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        console.warn("No active tab for page context");
        return;
      }

      const tabId = tab.id;

      // Get accessibility tree
      const treeResponse = await chrome.tabs.sendMessage(tabId, {
        type: 'GET_ACCESSIBILITY_TREE'
      });

      // Get screenshot
      const screenshotResponse = await chrome.runtime.sendMessage({
        type: 'CAPTURE_SCREENSHOT',
        tabId: tabId
      });

      if (treeResponse?.tree && screenshotResponse?.screenshot) {
        const pageContext = {
          accessibilityTree: treeResponse.tree,
          screenshot: screenshotResponse.screenshot.split(',')[1], // Remove data:image/jpeg;base64,
          url: tab.url || '',
          title: tab.title || ''
        };

        // Send context to Live API
        if (liveClientRef.current) {
          liveClientRef.current.updatePageContext(pageContext);
          liveClientRef.current.sendPageContext();
        }
      }
    } catch (error) {
      console.error("Error getting page context for Live API:", error);
    }
  };

  const handleLiveToggle = async () => {
    // Prevent double-clicks while connecting
    if (isLiveConnecting) {
      console.log("Already connecting to Live API...");
      return;
    }

    if (isLiveActive) {
      stopLiveSession();
    } else {
      await startLiveSession();
    }
  };

  const startLiveSession = async () => {
    try {
      setIsLiveConnecting(true);

      // Show connecting message
      setMessages(prev => [...prev, {
        id: 'live-connecting',
        role: 'model',
        text: '**Conectando a Live API...**\n\nEstableciendo conexión de audio en tiempo real.',
        timestamp: Date.now()
      }]);

      // Reset any existing client
      if (liveClientRef.current) {
        liveClientRef.current.disconnect();
        liveClientRef.current = null;
      }

      // Create client with new callback interface
      liveClientRef.current = new LiveClient({
        onTextResponse: (text: string) => {
          // Handle text responses (if any)
          console.log("Live API: Text response:", text);
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            role: 'model',
            text: text,
            timestamp: Date.now()
          }]);
        },
        onAudioResponse: (_audioData: string) => {
          // Audio playback is handled internally by LiveClient
          console.log("Live API: Audio response received");
        },
        onError: (error: Error) => {
          console.error("Live Client Error:", error);
          const errorMsg = error?.message || 'Error de conexión con Live API';
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            role: 'model',
            text: `**Error de conversación en vivo**\n\n${errorMsg}`,
            timestamp: Date.now()
          }]);
          stopLiveSession();
        },
        onClose: () => {
          console.log("Live session closed");
          setIsLiveActive(false);
          setIsLiveMicActive(false);
        },
        onReady: async () => {
          console.log("Live API: Ready for audio");

          // If Computer Use is enabled, send page context immediately
          if (isLiveComputerUseEnabled) {
            console.log("Live API: Computer Use enabled, sending page context...");
            await sendPageContextToLive();
          }
        },
        onFunctionCall: isLiveComputerUseEnabled ? executeLiveFunctionCall : undefined
      }, isLiveComputerUseEnabled);

      console.log("Connecting to Live API...");
      await liveClientRef.current.connect();

      // Remove connecting message and show success
      setMessages(prev => prev.filter(m => m.id !== 'live-connecting').concat({
        id: crypto.randomUUID(),
        role: 'model',
        text: '**Conversación en vivo activada**\n\nAhora puedes hablar en tiempo real. Presiona el botón de micrófono para comenzar.',
        timestamp: Date.now()
      }));

      setIsLiveActive(true);
      setIsLiveConnecting(false);

    } catch (e: any) {
      console.error("Failed to start live session:", e);
      const errorMsg = e?.message || 'No se pudo iniciar la sesión en vivo';

      // Detect if it's a permission/API key issue
      const isPermissionError = errorMsg.includes('API key') || errorMsg.includes('permisos') || errorMsg.includes('Live API');

      // Remove connecting message and show error
      setMessages(prev => prev.filter(m => m.id !== 'live-connecting').concat({
        id: crypto.randomUUID(),
        role: 'model',
        text: isPermissionError
          ? `⚠️ **Error de Permisos de Live API**\n\n${errorMsg}\n\n**Para solucionarlo:**\n1. Ve a [Google AI Studio](https://aistudio.google.com/)\n2. Crea una nueva API key o verifica que tu key tenga acceso a modelos Live\n3. Asegúrate de que "Generative Language API" esté habilitado en tu proyecto de Google Cloud\n\n*Nota: La Live API requiere permisos especiales que no todas las API keys tienen por defecto.*`
          : `⚠️ **No se pudo conectar**\n\n${errorMsg}\n\nSugerencias:\n• Verifica tu conexión a internet\n• Recarga la extensión\n• Intenta de nuevo en unos segundos`,
        timestamp: Date.now()
      }));

      setIsLiveConnecting(false);
      stopLiveSession();
    }
  };

  const stopLiveSession = () => {
    // Stop audio capture
    if (audioCapturRef.current) {
      audioCapturRef.current.stop();
      audioCapturRef.current = null;
    }
    // Disconnect live client
    if (liveClientRef.current) {
      liveClientRef.current.disconnect();
      liveClientRef.current = null;
    }
    setIsLiveActive(false);
    setIsLiveConnecting(false);
    setIsLiveMicActive(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
  };

  // Toggle live microphone for voice input
  const toggleLiveMicrophone = async () => {
    if (!isLiveActive || !liveClientRef.current) {
      console.warn("Live session not active");
      return;
    }

    if (isLiveMicActive) {
      // Stop microphone
      if (audioCapturRef.current) {
        audioCapturRef.current.stop();
        audioCapturRef.current = null;
      }
      // Signal end of audio turn so model responds
      if (liveClientRef.current) {
        liveClientRef.current.endAudioTurn();
      }
      setIsLiveMicActive(false);
      console.log("Live microphone stopped, signaled end of turn");
    } else {
      // Start microphone capture
      try {
        // If Computer Use is enabled, send updated page context before starting mic
        if (isLiveComputerUseEnabled) {
          console.log("Live API: Updating page context before starting mic...");
          await sendPageContextToLive();
        }

        audioCapturRef.current = new AudioCapture();
        await audioCapturRef.current.start((base64Audio: string) => {
          // Send audio chunks to Live API
          if (liveClientRef.current?.isReady()) {
            liveClientRef.current.sendAudioChunk(base64Audio);
          }
        });
        setIsLiveMicActive(true);
        console.log("Live microphone started");
      } catch (e: any) {
        console.error("Failed to start microphone:", e);

        // Open permissions page
        chrome.tabs.create({ url: chrome.runtime.getURL('permissions.html') });

        // Use the detailed error message from AudioCapture if available
        const errorMessage = e?.message || 'No se pudo acceder al micrófono. Asegúrate de dar permisos.';
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'model',
          text: `**Error de micrófono**\n\n${errorMessage}\n\n**Solución:**\nSe ha abierto una nueva pestaña para autorizar el acceso al micrófono. Acepta el permiso y vuelve a intentar.`,
          timestamp: Date.now()
        }]);
      }
    }
  };

  const handleSendMessage = async (text: string = inputValue, overrideImages: string[] | null = null, skipUserLog: boolean = false) => {
    // Build messages - separate display from API
    const imagesToUse = overrideImages || selectedImages;
    let displayMessage = text.trim(); // What user sees in chat
    let apiMessage = text.trim(); // What gets sent to API
    let contextDataForMessage: Message['contextData'] = null;

    if (selectedContext) {
      // Context goes to API but NOT displayed in chat
      const contextForAPI = `[CONTEXTO - Texto seleccionado de la página que el usuario quiere que analices]:\n"${selectedContext.text}"\n\n[INSTRUCCIÓN DEL USUARIO]:`;

      if (displayMessage) {
        // User typed something - that's what we show
        apiMessage = contextForAPI + '\n' + displayMessage;
      } else {
        // No user input, use default based on action
        switch (selectedContext.action) {
          case 'ask':
            displayMessage = 'Tengo una pregunta sobre el texto señalado';
            break;
          case 'explain':
            displayMessage = 'Explícame el texto señalado';
            break;
          case 'summarize':
            displayMessage = 'Resume el texto señalado';
            break;
          case 'translate':
            displayMessage = 'Traduce el texto señalado al inglés';
            break;
          default:
            displayMessage = 'Analiza el texto señalado';
        }
        apiMessage = contextForAPI + '\n' + displayMessage;
      }
      // Save reference data for "go to source" navigation
      contextDataForMessage = {
        text: selectedContext.text,
        action: selectedContext.action,
        url: selectedContext.url,
        pageTitle: selectedContext.pageTitle
      };
      // Clear context after using it
      setSelectedContext(null);
    }
    
    // PROJECT MEMORY INJECTION
    // If we are in a project (targetFolderId is set) and this is a new chat (no currentChatId),
    // inject recent context from the project history.
    if (targetFolderId && !currentChatId) {
        const projectChats = chatHistory.filter(c => c.folderId === targetFolderId);
        if (projectChats.length > 0) {
            // Get last 3 relevant interactions from recent chats to provide context
            const recentContext = projectChats
                .sort((a, b) => b.updatedAt - a.updatedAt) // Sort by most recent
                .slice(0, 3) // Take top 3 chats
                .map(chat => {
                    // Extract last exchange
                    const lastMsg = chat.messages[chat.messages.length - 1];
                    const prevMsg = chat.messages[chat.messages.length - 2];
                    if (lastMsg && prevMsg && prevMsg.role === 'user') {
                        return `Tema: ${chat.title}\nUsuario: ${prevMsg.text.substring(0, 100)}...\nSoflia: ${lastMsg.text?.substring(0, 100)}...`;
                    }
                    return null;
                })
                .filter(Boolean)
                .join('\n---\n');

            if (recentContext) {
                const projectContextPrompt = `[MEMORIA DEL PROYECTO: Estás trabajando en el proyecto. Aquí tienes contexto reciente de otras conversaciones en este proyecto para que tus respuestas sean coherentes y conectadas:\n${recentContext}\n]\n\n`;
                apiMessage = projectContextPrompt + apiMessage;
                console.log("Project Memory Injected:", projectContextPrompt);
            }
        }
    }
    
    if (!displayMessage && selectedImages.length === 0) return;

    if (isLiveActive && liveClientRef.current) {
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        text: displayMessage,
        timestamp: Date.now(),
        images: selectedImages.length > 0 ? [...selectedImages] : undefined,
        contextData: contextDataForMessage
      };
      setMessages(prev => [...prev, userMessage]);
      setInputValue('');
      setSelectedImages([]);

      liveClientRef.current.send({
        clientContent: {
          turns: [{
            role: "user",
            parts: [{ text: apiMessage }]
          }],
          turnComplete: true
        }
      });
      return;
    }

    if (!skipUserLog) {
        const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        text: displayMessage,
        timestamp: Date.now(),
        images: imagesToUse.length > 0 ? [...imagesToUse] : undefined,
        contextData: contextDataForMessage
        };

        setMessages((prev) => [...prev, userMessage]);
        setInputValue('');
        setSelectedImages([]);
    } else {
        // If skipping user log (regeneration), ensure we don't clear the input if it's being typed
        // But usually regeneration happens when input is empty or unrelated.
    }
    
    setIsLoading(true);

    const aiMessageId = crypto.randomUUID();
    const aiMessagePlaceholder: Message = {
      id: aiMessageId,
      role: 'model',
      text: '',
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, aiMessagePlaceholder]);

    try {
      let pageContext = '';

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (tab?.url?.startsWith('chrome://') || tab?.url?.startsWith('edge://') || tab?.url?.startsWith('about:')) {
          pageContext = '[ERROR: Esta es una página protegida del navegador. Soflia no puede acceder al contenido de páginas chrome://, edge:// o about:. Por favor navega a una página web normal para que pueda analizarla.]';
        } else if (tab?.id) {
          const response = await chrome.tabs.sendMessage(tab.id, { action: "GET_DOM_CONTEXT" });
          if (response?.context) {
            pageContext = response.context;
          } else {
            pageContext = '[INFO: No se pudo obtener información de la página. Puede que el content script no esté cargado. Intenta recargar la página.]';
          }
        }
      } catch (err) {
        console.log('No se pudo obtener el contexto de la página:', err);
        pageContext = '[ERROR: No se pudo conectar con el content script. Esto puede ocurrir en páginas protegidas o si necesitas recargar la página después de instalar la extensión.]';
      }

      // If in Image Generation mode, use image generation flow
      if (isImageGenMode) {
        try {
          const { generateImage } = await import('../services/gemini');
          const result = await generateImage(apiMessage);
          
          setMessages((prev) =>
            prev.map(msg =>
              msg.id === aiMessageId
                ? { 
                    ...msg, 
                    text: result.text,
                    images: result.imageData ? [result.imageData] : undefined
                  }
                : msg
            )
          );
        } catch (error) {
          console.error('Image generation error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
          setMessages((prev) =>
            prev.map(msg =>
              msg.id === aiMessageId
                ? { ...msg, text: `Error generando imagen: ${errorMessage}` }
                : msg
            )
          );
        } finally {
          setIsLoading(false);
        }
        return;
      }

      // If in Prompt Optimizer mode
      if (isPromptOptimizerMode && targetAI) {
        try {
          const { optimizePrompt } = await import('../services/gemini');
          const optimizedPrompt = await optimizePrompt(apiMessage, targetAI);

          setMessages((prev) =>
            prev.map(msg =>
              msg.id === aiMessageId
                ? {
                    ...msg,
                    text: `**Prompt optimizado para ${targetAI === 'chatgpt' ? 'ChatGPT' : targetAI === 'claude' ? 'Claude' : 'Gemini'}:**\n\n\`\`\`\n${optimizedPrompt}\n\`\`\`\n\n*Copia este prompt y úsalo en ${targetAI === 'chatgpt' ? 'ChatGPT' : targetAI === 'claude' ? 'Claude' : 'Gemini'} para mejores resultados.*`
                  }
                : msg
            )
          );
        } catch (error) {
          console.error('Prompt optimization error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
          setMessages((prev) =>
            prev.map(msg =>
              msg.id === aiMessageId
                ? { ...msg, text: `Error optimizando prompt: ${errorMessage}` }
                : msg
            )
          );
        } finally {
          setIsLoading(false);
        }
        return;
      }

      // Check for Maps/Location Intent automatically
      const { runMapsQuery, needsMapsGrounding } = await import('../services/gemini');
      
      if (needsMapsGrounding(apiMessage) && !isImageGenMode && !isDeepResearch) {
         try {
             // 1. Try to get user location on the fly
             let locationToUse = userLocation;

             if (!locationToUse) {
                 try {
                     const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                     if (tab?.id) {
                         const response = await chrome.tabs.sendMessage(tab.id, { action: 'getGeolocation' });
                         if (response?.success && response.location) {
                             locationToUse = response.location;
                             setUserLocation(locationToUse);
                         }
                     }
                 } catch (e) {
                     console.warn("Could not auto-fetch location:", e);
                 }
             }

             // 2. Determine location (User's or Default CDMX)
             const finalLocation = locationToUse || { latitude: 19.4326, longitude: -99.1332 };

             const result = await runMapsQuery(apiMessage, finalLocation);

             setMessages((prev) =>
             prev.map(msg =>
               msg.id === aiMessageId
                 ? {
                     ...msg,
                     text: result.text,
                     places: result.places
                   }
                 : msg
             )
           );
         } catch (error) {
           console.error('Maps query error:', error);
           // Fallback to normal chat if fails
           const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
           setMessages((prev) =>
            prev.map(msg =>
                msg.id === aiMessageId
                ? { ...msg, text: `Error intentando buscar lugares: ${errorMessage}` }
                : msg
            )
            );
         } finally {
            setIsLoading(false);
         }
         return;
      }

      // If in Deep Research mode - Uses Interactions API (asynchronous polling)
      if (isDeepResearch) {
        try {
          const { runDeepResearch } = await import('../services/gemini');
          const result = await runDeepResearch(apiMessage);

          let fullText = '';

          
          setResearchStep('Buscando información relevante...');
          // Stream yields text updates from polling the research agent
          for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            
            // Simple heuristic to update progress text based on content
            if (chunkText.includes('Reading') || chunkText.includes('Leyendo')) {
                 setResearchStep('Leyendo fuentes y extrayendo datos...');
            } else if (chunkText.includes('Thinking') || chunkText.includes('Analizando')) {
                 setResearchStep('Analizando información...');
            } else if (fullText.length > 500 && researchStep !== 'Generando respuesta...') {
                 setResearchStep('Generando respuesta final...');
            }

            fullText += chunkText;

            setMessages((prev) =>
              prev.map(msg =>
                msg.id === aiMessageId
                  ? { ...msg, text: fullText }
                  : msg
              )
            );
          }

          // Grounding metadata handled internally by Interactions API
          // Sources are included in the final response text

        } catch (error) {
          console.error('Deep Research error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
          setMessages((prev) =>
            prev.map(msg =>
              msg.id === aiMessageId
                ? { ...msg, text: `Error en investigación profunda: ${errorMessage}` }
                : msg
            )
          );
        } finally {
          setIsLoading(false);
        }
        return;
      }

      // Web Agent mode - autonomous browser control
      // Triggers either by explicit mode toggle OR by auto-detecting browser action intent
      const { needsWebAgent } = await import('../prompts');
      const shouldUseWebAgent = isWebAgentMode || needsWebAgent(apiMessage);

      if (shouldUseWebAgent) {
        console.log('🤖 Web Agent activated:', isWebAgentMode ? 'manual mode' : 'auto-detected intent');
        try {
          const { runWebAgent } = await import('../services/web-agent');

          await runWebAgent(apiMessage, {
            onMessage: (text) => {
              setMessages((prev) =>
                prev.map(msg =>
                  msg.id === aiMessageId
                    ? { ...msg, text: (msg.text ? msg.text + '\n' : '') + text }
                    : msg
                )
              );
            },
            onActionStart: (description) => {
              setMessages((prev) =>
                prev.map(msg =>
                  msg.id === aiMessageId
                    ? { ...msg, text: (msg.text ? msg.text + '\n' : '') + `*${description}...*` }
                    : msg
                )
              );
            },
            onComplete: (summary) => {
              setMessages((prev) =>
                prev.map(msg =>
                  msg.id === aiMessageId
                    ? { ...msg, text: (msg.text ? msg.text + '\n\n' : '') + summary }
                    : msg
                )
              );
            },
            onError: (error) => {
              setMessages((prev) =>
                prev.map(msg =>
                  msg.id === aiMessageId
                    ? { ...msg, text: `Error del agente web: ${error}` }
                    : msg
                )
              );
            }
          });
        } catch (error) {
          console.error('Web Agent error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
          setMessages((prev) =>
            prev.map(msg =>
              msg.id === aiMessageId
                ? { ...msg, text: `Error del agente web: ${errorMessage}` }
                : msg
            )
          );
        } finally {
          setIsLoading(false);
        }
        return;
      }

      // Determine thinking type based on model (Gemini 3 uses 'level', Gemini 2.5 uses 'budget')
      const currentModelConfig = MODEL_OPTIONS.find(m => m.id === preferredPrimaryModel);
      const thinkingType = currentModelConfig?.thinkingType || 'level';

      // Build conversation history for Gemini context persistence
      const conversationHistory = messages
        .filter(m =>
          m.id !== 'live-connecting' &&
          !m.id.startsWith('error-') &&
          m.text && m.text.trim().length > 0
        )
        .map(m => ({
          role: m.role as 'user' | 'model',
          text: m.text
        }));

      const result = await import('../services/gemini').then(m => m.sendMessageStream(
        apiMessage,
        pageContext,
        { primary: preferredPrimaryModel },
        undefined, // personalization
        undefined, // projectContext
        { mode: thinkingMode as 'off' | 'minimal' | 'low' | 'medium' | 'high', type: thinkingType },
        imagesToUse.length > 0 ? imagesToUse : undefined, // images
        activeTool?.system_prompt, // toolPrompt
        conversationHistory // conversation history for context persistence
      ));

      let fullText = '';

      for await (const chunk of result.stream) {
        let chunkText = '';
        try {
          chunkText = chunk.text();
        } catch (e) {
          // Might be a function call only
        }
        
        fullText += chunkText;

        // Check for function calls (e.g. Navigation)
        const functionCalls = chunk.functionCalls ? chunk.functionCalls() : [];
        if (functionCalls) {
          for (const call of functionCalls) {
            if (call.name === 'open_url') {
              const url = (call.args as any).url as string;
              if (url) {
                if (window.chrome && chrome.tabs && chrome.tabs.create) {
                  chrome.tabs.create({ url });
                } else {
                  window.open(url, '_blank');
                }
              }
            }
          }
        }

        setMessages((prev) =>
          prev.map(msg =>
            msg.id === aiMessageId
              ? { ...msg, text: fullText }
              : msg
          )
        );
      }
      
      // Get grounding metadata (sources + snippets for smart references)
      const groundingMeta = await result.getGroundingMetadata();
      if (groundingMeta?.groundingChunks) {
        const sources: GroundingSource[] = groundingMeta.groundingChunks
          .filter((chunk: any) => chunk.web)
          .map((chunk: any, i: number) => {
            // Find snippet from groundingSupports that references this chunk
            let snippet = '';
            if (groundingMeta.groundingSupports) {
              const support = (groundingMeta.groundingSupports as any[]).find(
                (s: any) => s.groundingChunkIndices?.includes(i)
              );
              if (support?.segment?.text) {
                snippet = support.segment.text;
              }
            }
            return {
              uri: chunk.web.uri,
              title: chunk.web.title,
              snippet
            };
          });

        if (sources.length > 0) {
          setMessages((prev) =>
            prev.map(msg =>
              msg.id === aiMessageId
                ? { ...msg, sources }
                : msg
            )
          );
        }
      }


    } catch (error) {
      console.error('Error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      setMessages((prev) =>
        prev.map(msg =>
          msg.id === aiMessageId
            ? { ...msg, text: `Lo siento, hubo un error: ${errorMessage}. Verifica tu API Key en src/config.ts` }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const hasInput = inputValue.trim().length > 0 || selectedImages.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: 'var(--bg-dark-main)' }}>
      {/* Compact Header */}
      <header 
        className="compact-header-gap" 
        style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--bg-dark-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: isLiveActive ? 'rgba(16, 185, 129, 0.05)' : 'var(--bg-dark-main)',
        transition: 'background-color 0.3s',
        gap: '8px'
      }}>
        {/* Left: Menu + Avatar + Name/Model inline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
          {/* Hamburger - smaller */}
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            style={{
              background: isSidebarOpen ? 'var(--bg-dark-tertiary)' : 'transparent',
              border: 'none',
              borderRadius: '6px',
              padding: '6px',
              cursor: 'pointer',
              color: isSidebarOpen ? 'var(--color-accent)' : 'var(--color-gray-medium)',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
            title="Menú"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>

          {/* Avatar - smaller */}
          <img
            src={liaAvatar}
            alt="Soflia"
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              objectFit: 'cover',
              border: `2px solid ${isLiveActive ? 'var(--color-success)' : 'var(--color-accent)'}`,
              flexShrink: 0
            }}
          />

          {/* Name + Model in single row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
            <span style={{
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--color-white)',
              flexShrink: 0
            }}>
              Soflia
            </span>

            {isLiveActive && (
              <span style={{
                fontSize: '9px',
                padding: '2px 5px',
                backgroundColor: 'var(--color-success)',
                borderRadius: '4px',
                color: 'white',
                fontWeight: 600,
                flexShrink: 0
              }}>LIVE</span>
            )}

            {/* Model Selector - compact inline pill */}
            <button
              onClick={() => setIsModelSelectorOpen(true)}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '10px',
                color: 'var(--color-accent)',
                fontSize: '10px',
                fontWeight: 500,
                padding: '3px 8px',
                cursor: 'pointer',
                outline: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.2s',
                flexShrink: 0
              }}
              onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
              onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
            >
              {(() => {
                const current = MODEL_OPTIONS.find(m => m.id === preferredPrimaryModel);
                return (
                  <>
                    <span>{current?.icon || '⚡'}</span>
                    <span className="hide-text-on-compact">{current?.name || 'Gemini 3 Pro'}</span>
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ opacity: 0.6 }}>
                      <path d="M6 9l6 6 6-6"/>
                    </svg>
                  </>
                );
              })()}
            </button>
          </div>
        </div>

        {/* Right: Mode badge + Settings - all inline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Active Mode Indicator - compact pill */}
          {(isDeepResearch || isImageGenMode || isPromptOptimizerMode || isWebAgentMode) && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              background: isDeepResearch ? 'rgba(0, 212, 179, 0.12)' :
                         isImageGenMode ? 'rgba(168, 85, 247, 0.12)' :
                         isPromptOptimizerMode ? 'rgba(251, 191, 36, 0.12)' :
                         isWebAgentMode ? 'rgba(59, 130, 246, 0.12)' :
                         'rgba(59, 130, 246, 0.12)',
              borderRadius: '8px',
              fontSize: '10px',
              color: isDeepResearch ? '#00d4b3' :
                     isImageGenMode ? '#a855f7' :
                     isPromptOptimizerMode ? '#fbbf24' :
                     isWebAgentMode ? '#3b82f6' :
                     '#3b82f6',
              fontWeight: 500
            }}>
              {isDeepResearch && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              )}
              {isImageGenMode && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
              )}
              {isPromptOptimizerMode && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 20h9"></path>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                </svg>
              )}
              {isWebAgentMode && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                  <line x1="8" y1="21" x2="16" y2="21"></line>
                  <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
              )}
              <span className="hide-text-on-compact" style={{ maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {isDeepResearch ? 'Research' :
                 isImageGenMode ? 'Imagen' :
                 isPromptOptimizerMode ? 'Optimizar' :
                 isWebAgentMode ? 'Web Agent' :
                 ''}
              </span>
              <button
                onClick={() => {
                  setIsDeepResearch(false);
                  setIsImageGenMode(false);
                  setIsPromptOptimizerMode(false);
                  setIsWebAgentMode(false);
                  setTargetAI(null);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '0',
                  marginLeft: '1px',
                  cursor: 'pointer',
                  color: 'inherit',
                  display: 'flex',
                  opacity: 0.6
                }}
                title="Desactivar modo"
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          )}

          {/* Active Tool Indicator */}
          {activeTool && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              background: 'rgba(168, 85, 247, 0.12)',
              borderRadius: '8px',
              fontSize: '10px',
              color: '#a855f7',
              fontWeight: 500
            }}>
              <span>{activeTool.icon}</span>
              <span className="hide-text-on-compact" style={{ maxWidth: '60px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeTool.name}
              </span>
              <button
                onClick={() => setActiveTool(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '0',
                  marginLeft: '1px',
                  cursor: 'pointer',
                  color: 'inherit',
                  display: 'flex',
                  opacity: 0.6
                }}
                title="Desactivar herramienta"
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          )}

          {/* Tool Library button */}
          <button
            onClick={() => setIsToolLibraryOpen(true)}
            style={{
              background: isToolLibraryOpen ? 'var(--bg-dark-tertiary)' : 'var(--bg-dark-secondary)',
              border: `1px solid ${isToolLibraryOpen || activeTool ? 'var(--color-accent)' : 'transparent'}`,
              borderRadius: '6px',
              padding: '6px',
              cursor: 'pointer',
              color: isToolLibraryOpen || activeTool ? 'var(--color-accent)' : 'var(--color-gray-medium)',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Biblioteca de Prompts"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg>
          </button>

          {/* Meeting button */}
          <button
            onClick={() => setIsMeetingPanelOpen(true)}
            style={{
              background: isMeetingPanelOpen ? 'var(--bg-dark-tertiary)' : 'var(--bg-dark-secondary)',
              border: `1px solid ${isMeetingPanelOpen ? 'var(--color-accent)' : 'transparent'}`,
              borderRadius: '6px',
              padding: '6px',
              cursor: 'pointer',
              color: isMeetingPanelOpen ? 'var(--color-accent)' : 'var(--color-gray-medium)',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Agente de Reuniones"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </button>

          {/* Settings button */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setIsSettingsMenuOpen(!isSettingsMenuOpen)}
              style={{
                background: isSettingsMenuOpen ? 'var(--bg-dark-tertiary)' : 'var(--bg-dark-secondary)',
                border: `1px solid ${isSettingsMenuOpen ? 'var(--color-accent)' : 'transparent'}`,
                borderRadius: '6px',
                padding: '6px',
                cursor: 'pointer',
                color: isSettingsMenuOpen ? 'var(--color-accent)' : 'var(--color-gray-medium)',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Configuración"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>

            {/* Settings Dropdown */}
            {isSettingsMenuOpen && (
              <div style={{
                position: 'absolute',
                top: '100%',
                right: '0',
                marginTop: '6px',
                background: 'var(--bg-modal)',
                border: '1px solid var(--border-modal)',
                borderRadius: '10px',
                padding: '6px',
                minWidth: '180px',
                boxShadow: 'var(--shadow-modal)',
                zIndex: 1000
              }}>
                {/* Theme Selector */}
                <div style={{ padding: '6px', marginBottom: '6px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--color-gray-medium)', marginBottom: '6px' }}>
                    Tema
                  </div>
                  <div style={{ display: 'flex', background: 'var(--bg-dark-secondary)', borderRadius: '6px', padding: '2px' }}>
                    {(['light', 'dark', 'system'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTheme(t)}
                        style={{
                          flex: 1,
                          background: theme === t ? 'var(--color-accent)' : 'transparent',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '5px',
                          cursor: 'pointer',
                          color: theme === t ? (theme === 'light' ? '#fff' : '#000') : 'var(--color-gray-medium)',
                          fontSize: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title={t === 'light' ? 'Claro' : t === 'dark' ? 'Oscuro' : 'Sistema'}
                      >
                        {t === 'light' && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="5" />
                            <line x1="12" y1="1" x2="12" y2="3" />
                            <line x1="12" y1="21" x2="12" y2="23" />
                            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                            <line x1="1" y1="12" x2="3" y2="12" />
                            <line x1="21" y1="12" x2="23" y2="12" />
                            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                          </svg>
                        )}
                        {t === 'dark' && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                          </svg>
                        )}
                        {t === 'system' && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                            <line x1="8" y1="21" x2="16" y2="21" />
                            <line x1="12" y1="17" x2="12" y2="21" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ height: '1px', background: 'var(--border-modal)', margin: '4px 0 6px 0' }}></div>

                {/* Clear Chat */}
                <button
                  onClick={() => {
                    setMessages([]);
                    setIsSettingsMenuOpen(false);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 10px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#ef4444',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                  Borrar Chat
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Project Hub - Shows when folder is selected and no active chat */}
      {currentFolderId && !currentChatId && (
        <ProjectHub
          folder={folders.find(f => f.id === currentFolderId)!}
          chats={chatHistory.filter(c => c.folderId === currentFolderId)}
          onRenameProject={handleRenameProject}
          onNewChat={() => {
              // Fallback or secondary action if needed, currently main action is input
          }}
          onOpenChat={(chatId) => {
             const chat = chatHistory.find(c => c.id === chatId);
             if (chat) loadChat(chat);
          }}
          onStartChatWithContext={(text, _files) => {
              // Priority: set target folder so database saves it correctly
              const folderId = currentFolderId;
              setTargetFolderId(folderId);
              
              // Clear current view states to prepare for chat
              setCurrentFolderId(null); 
              setMessages([]);
              setCurrentChatId(null);

              // Trigger send message immediately
              setTimeout(() => {
                  handleSendMessage(text, null, false);
              }, 50);
          }}
          onDeleteChat={deleteChat}
          isRecording={isRecording}
          onToggleRecording={isRecording ? stopVoiceRecording : startVoiceRecording}
          onToolSelect={(tool) => {
             // Handle tool selection activation, then potentially auto-open chat in that mode
             if (tool === 'deep_research') setIsDeepResearch(true);
             if (tool === 'image_gen') setIsImageGenMode(true);
             if (tool === 'prompt_optimizer') {
                 setIsPromptOptimizerMode(true);
                 setTargetAI('chatgpt');
             }
             if (tool === 'web_agent') setIsWebAgentMode(true);
             if (tool === 'live_api') {
                 handleLiveToggle();
                 return; // Live API usually takes over full screen or panel
             }
          }}
          onOpenToolLibrary={() => setIsToolLibraryOpen(true)}
        />
      )}

      {/* Main Chat Area - Hidden when Project Hub is active */}
      {(!currentFolderId || currentChatId) && (
      <main style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        {/* Welcome */}
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <img
              src={liaAvatar}
              alt="Soflia"
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                objectFit: 'cover',
                border: '3px solid var(--color-accent)',
                marginBottom: '16px'
              }}
            />
            <h2 style={{ fontSize: '20px', margin: '0 0 8px 0', fontWeight: 600, color: 'var(--color-white)' }}>
              Hola, soy Soflia
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--color-gray-medium)', lineHeight: '1.5', margin: '0 0 24px 0' }}>
              Tu agente inteligente del ecosistema Soflia. ¿En qué puedo ayudarte?
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
              {['Analizar página', 'Resumir contenido', 'Ayuda con tareas'].map((action) => (
                <button
                  key={action}
                  onClick={() => handleSendMessage(action)}
                  style={{
                    background: 'var(--bg-dark-secondary)',
                    border: '1px solid transparent',
                    borderRadius: '20px',
                    padding: '8px 16px',
                    color: 'var(--color-white)',
                    fontSize: '13px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--color-accent)'}
                  onMouseOut={(e) => e.currentTarget.style.borderColor = 'transparent'}
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.filter(msg => !(msg.role === 'model' && !msg.text)).map((msg, index) => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
              gap: '8px',
              alignItems: 'flex-start'
            }}
          >
            {msg.role === 'model' && (
              <img
                src={liaAvatar}
                alt="Soflia"
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  flexShrink: 0
                }}
              />
            )}

            <div style={{ maxWidth: msg.role === 'model' ? '95%' : '85%', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div
                className={msg.role === 'model' ? 'markdown-content' : ''}
                style={{
                  backgroundColor: msg.role === 'user' ? 'var(--color-accent)' : 'var(--bg-dark-secondary)',
                  color: msg.role === 'user' ? 'var(--color-on-accent)' : 'var(--color-white)',
                  padding: '10px 14px',
                  borderRadius: '16px',
                  borderBottomRightRadius: msg.role === 'user' ? '4px' : '16px',
                  borderBottomLeftRadius: msg.role === 'model' ? '4px' : '16px',
                  fontSize: '14px',
                  lineHeight: '1.5',
                }}
              >
                {msg.images && msg.images.length > 0 && (
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                    {msg.images.map((img, i) => (
                      <div 
                        key={i}
                        className="image-container"
                        style={{ position: 'relative', cursor: 'pointer', maxWidth: '200px' }}
                        onClick={() => setZoomedImage(img)}
                      >
                        <img 
                          src={img} 
                          alt="Generada por IA" 
                          style={{ 
                            width: '100%', 
                            borderRadius: '12px',
                            display: 'block',
                            border: '1px solid rgba(255,255,255,0.1)'
                          }} 
                        />
                        {/* Hover Overlay */}
                        <div className="zoom-overlay" style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          background: 'rgba(0,0,0,0.3)',
                          borderRadius: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: 0,
                          transition: 'opacity 0.2s',
                        }}>
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }}>
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                            <line x1="11" y1="8" x2="11" y2="14"></line>
                            <line x1="8" y1="11" x2="14" y2="11"></line>
                          </svg>
                        </div>
                        <style>{`
                          .image-container:hover .zoom-overlay {
                            opacity: 1 !important;
                          }
                        `}</style>
                      </div>
                    ))}
                  </div>
                )}
                {msg.role === 'model' ? (
                  isLoading && index === messages.length - 1 ? (
                    <div className="markdown-content typing-cursor">
                         <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{msg.text}</ReactMarkdown>
                    </div>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{msg.text}</ReactMarkdown>
                  )
                ) : (
                  msg.text
                )}
              </div>

              {/* Go to reference button for user messages with saved context */}
              {msg.role === 'user' && msg.contextData?.url && (
                <div
                  onClick={() => navigateToSource({
                    uri: msg.contextData!.url!,
                    title: msg.contextData!.pageTitle || '',
                    snippet: msg.contextData!.text
                  })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    background: 'rgba(0, 212, 179, 0.1)',
                    border: '1px solid rgba(0, 212, 179, 0.3)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    alignSelf: 'flex-end'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 212, 179, 0.2)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 212, 179, 0.1)';
                  }}
                  title={`Ir a: ${msg.contextData.pageTitle || msg.contextData.url}`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <span style={{ fontSize: '11px', color: 'var(--color-accent)', fontWeight: 500 }}>
                    Ir a referencia
                  </span>
                </div>
              )}

              {/* Sources - Elegant Design */}
              {msg.role === 'model' && msg.sources && msg.sources.length > 0 && (
                <div style={{
                  marginTop: '12px',
                  background: 'var(--bg-dark-tertiary)',
                  borderRadius: '12px',
                  border: '1px solid var(--border-modal)',
                  overflow: 'hidden'
                }}>
                  {/* ... (Sources Header and List existing code) ... */}
                  {/* Header with Google branding */}
                  <div style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border-modal)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <div style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '4px',
                      background: 'linear-gradient(135deg, #4285f4, #34a853, #fbbc05, #ea4335)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                    </div>
                    <span style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--color-text-primary)'
                    }}>
                      Fuentes
                    </span>
                    <span style={{
                      fontSize: '11px',
                      color: 'var(--color-gray-medium)',
                      marginLeft: 'auto'
                    }}>
                      {msg.sources.length} {msg.sources.length === 1 ? 'resultado' : 'resultados'}
                    </span>
                  </div>

                  {/* Sources List */}
                  <div style={{ padding: '8px' }}>
                    {msg.sources.slice(0, 6).map((source, i) => {
                       let domain = '';
                       try {
                         domain = new URL(source.uri).hostname.replace('www.', '');
                       } catch {
                         domain = source.uri;
                       }

                       return (
                         <div
                           key={i}
                           onClick={() => navigateToSource(source)}
                           style={{
                             display: 'flex',
                             alignItems: 'center',
                             gap: '10px',
                             padding: '10px 12px',
                             borderRadius: '8px',
                             cursor: 'pointer',
                             transition: 'background 0.2s',
                             marginBottom: i < Math.min(msg.sources!.length, 6) - 1 ? '4px' : '0'
                           }}
                           onMouseOver={(e) => {
                             e.currentTarget.style.background = 'var(--bg-dark-secondary)';
                           }}
                           onMouseOut={(e) => {
                             e.currentTarget.style.background = 'transparent';
                           }}
                         >
                            <div style={{
                             width: '32px',
                             height: '32px',
                             borderRadius: '8px',
                             background: 'var(--bg-dark-secondary)',
                             display: 'flex',
                             alignItems: 'center',
                             justifyContent: 'center',
                             flexShrink: 0,
                             border: '1px solid var(--border-modal)'
                           }}>
                             <img
                               src={`https://www.google.com/s2/favicons?domain=${source.uri}&sz=32`}
                               alt=""
                               style={{ width: '18px', height: '18px', borderRadius: '4px' }}
                               onError={(e) => {
                                 const target = e.currentTarget;
                                 target.style.display = 'none';
                               }}
                             />
                           </div>
                           <div style={{ flex: 1, minWidth: 0 }}>
                             <div style={{
                               fontSize: '13px',
                               fontWeight: 500,
                               color: 'var(--color-text-primary)',
                               overflow: 'hidden',
                               textOverflow: 'ellipsis',
                               whiteSpace: 'nowrap',
                               marginBottom: '2px'
                             }}>
                               {source.title || domain}
                             </div>
                             <div style={{
                               fontSize: '11px',
                               color: 'var(--color-gray-medium)',
                               display: 'flex',
                               alignItems: 'center',
                               gap: '4px'
                             }}>
                                <span style={{
                                 display: 'inline-flex',
                                 alignItems: 'center',
                                 justifyContent: 'center',
                                 width: '16px',
                                 height: '16px',
                                 borderRadius: '4px',
                                 background: 'rgba(66, 133, 244, 0.15)',
                                 color: '#4285f4',
                                 fontSize: '10px',
                                 fontWeight: 600
                               }}>
                                 {i + 1}
                               </span>
                               {domain}
                               {source.snippet && (
                                 <span style={{
                                   marginLeft: '4px',
                                   color: 'var(--color-accent)',
                                   fontSize: '10px'
                                 }} title="Click para ir al texto exacto">
                                   — ir al texto
                                 </span>
                               )}
                             </div>
                           </div>
                           <svg
                             width="16"
                             height="16"
                             viewBox="0 0 24 24"
                             fill="none"
                             stroke={source.snippet ? 'var(--color-accent)' : 'var(--color-gray-medium)'}
                             strokeWidth="2"
                             style={{ flexShrink: 0, opacity: source.snippet ? 0.8 : 0.5 }}
                           >
                             {source.snippet ? (
                               <>
                                 <circle cx="11" cy="11" r="8"></circle>
                                 <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                               </>
                             ) : (
                               <>
                                 <line x1="7" y1="17" x2="17" y2="7"></line>
                                 <polyline points="7 7 17 7 17 17"></polyline>
                               </>
                             )}
                           </svg>
                         </div>
                       );
                    })}
                     {msg.sources.length > 6 && (
                       <div style={{
                         textAlign: 'center',
                         padding: '8px',
                         fontSize: '12px',
                         color: 'var(--color-gray-medium)'
                       }}>
                         +{msg.sources.length - 6} fuentes más
                       </div>
                     )}
                   </div>
                </div>
              )}

              {/* Maps Viewer */}
              {msg.role === 'model' && msg.places && msg.places.length > 0 && (
                 <div style={{ marginTop: '12px' }}>
                    <MapViewer 
                        center={(() => {
                            // First, try connection with first result
                            if (msg.places[0].location) return msg.places[0].location;
                            // Fallback to user location if available in state scope
                            if (userLocation) return { lat: userLocation.latitude, lng: userLocation.longitude };
                            // Default to CDMX as fallback
                            return { lat: 19.4326, lng: -99.1332 };
                        })()}
                        places={msg.places.filter(p => p.location) as any}
                    />
                 </div>
              )}

              {/* Actions */}
              {msg.role === 'model' && msg.text && (
                <div style={{ display: 'flex', gap: '4px', marginLeft: '4px' }}>
                  <button
                    onClick={() => copyToClipboard(msg.text, msg.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '4px',
                      cursor: 'pointer',
                      color: copiedId === msg.id ? 'var(--color-accent)' : 'var(--color-gray-medium)',
                      borderRadius: '4px',
                      transition: 'color 0.2s'
                    }}
                    title={copiedId === msg.id ? "¡Copiado!" : "Copiar"}
                  >
                    {copiedId === msg.id ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    )}
                  </button>
                  {/* Like Button */}
                  <button
                    onClick={() => {
                        const isLiked = msg.reactions?.includes('like');
                        addReaction(msg.id, 'like');
                        if (!isLiked) {
                            setFeedbackType('positive');
                            setFeedbackMessageContent(msg.text);
                            setIsFeedbackModalOpen(true);
                        }
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '4px',
                      cursor: 'pointer',
                      color: msg.reactions?.includes('like') ? 'var(--color-accent)' : 'var(--color-gray-medium)',
                      borderRadius: '4px'
                    }}
                    title="Me gusta"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={msg.reactions?.includes('like') ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
                    </svg>
                  </button>

                  {/* Dislike Button */}
                  <button
                    onClick={() => {
                        const isDisliked = msg.reactions?.includes('dislike');
                        addReaction(msg.id, 'dislike');
                        if (!isDisliked) {
                            setFeedbackType('negative');
                            setFeedbackMessageContent(msg.text);
                            setIsFeedbackModalOpen(true);
                        }
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '4px',
                      cursor: 'pointer',
                      color: msg.reactions?.includes('dislike') ? '#ef4444' : 'var(--color-gray-medium)',
                      borderRadius: '4px'
                    }}
                    title="No me gusta"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={msg.reactions?.includes('dislike') ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path>
                    </svg>
                  </button>

                  {/* Regenerate Button */}
                  <button
                    onClick={() => {
                      const msgIndex = messages.findIndex(m => m.id === msg.id);
                      if (msgIndex > 0) {
                          const previousMsg = messages[msgIndex - 1];
                          if (previousMsg && previousMsg.role === 'user') {
                              // 1. Remove ONLY the current AI message we want to regenerate
                              setMessages(prev => prev.filter(m => m.id !== msg.id));
                              
                              // 2. Trigger send with previous content, skipping the user log
                              // Pass the previous message's images if any
                              handleSendMessage(previousMsg.text, previousMsg.images || null, true);
                          }
                      }
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '4px',
                      cursor: 'pointer',
                      color: 'var(--color-gray-medium)',
                      borderRadius: '4px'
                    }}
                    title="Regenerar respuesta"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="23 4 23 10 17 10"></polyline>
                      <polyline points="1 20 1 14 7 14"></polyline>
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && !(messages[messages.length - 1]?.role === 'model' && messages[messages.length - 1]?.text) && (
          isDeepResearch ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              padding: '16px',
              background: 'transparent',
              maxWidth: '95%',
              marginLeft: '36px'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
                    <div className="research-spinner" style={{
                        width: '20px', 
                        height: '20px', 
                        borderRadius: '50%',
                        border: '2px solid var(--color-accent)',
                        borderTopColor: 'transparent',
                    }}></div>
                    <span style={{ fontSize: '15px', fontWeight: 600, color: '#fff' }}>Investigando</span>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '32px' }}>
                    <div style={{ fontSize: '14px', color: 'var(--color-gray-medium)' }}>
                        {researchStep}
                    </div>
                    {/* Step Indicators */}
                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                        {['Buscando', 'Leyendo', 'Analizando', 'Escribiendo'].map((step, i) => {
                             const currentStepIndex = 
                                researchStep.includes('Buscando') || researchStep.includes('Iniciando') ? 0 : 
                                researchStep.includes('Leyendo') ? 1 : 
                                researchStep.includes('Analizando') ? 2 : 3;
                             
                             const isActive = i === currentStepIndex;
                             const isCompleted = i < currentStepIndex;

                             return (
                                 <div key={step} style={{ 
                                     height: '4px', 
                                     flex: 1, 
                                     background: isCompleted ? 'var(--color-accent)' : isActive ? 'rgba(0, 212, 179, 0.3)' : 'rgba(255,255,255,0.1)',
                                     borderRadius: '2px',
                                     position: 'relative',
                                     overflow: 'hidden'
                                 }}>
                                    {isActive && (
                                        <div style={{
                                            position: 'absolute',
                                            top: 0, left: 0, bottom: 0,
                                            width: '50%',
                                            background: 'var(--color-accent)',
                                            animation: 'indeterminate 1s infinite linear'
                                        }}/>
                                    )}
                                 </div>
                             )
                        })}
                    </div>
                </div>
                <style>{`
                    @keyframes spin { 100% { transform: rotate(360deg); } }
                    .research-spinner { animation: spin 1s linear infinite; }
                    @keyframes indeterminate {
                            0% { left: -50%; }
                            100% { left: 100%; }
                    }
                `}</style>
            </div>
          ) : (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <img
              src={liaAvatar}
              alt="Soflia"
              style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }}
            />
            <div style={{
              backgroundColor: 'var(--bg-dark-secondary)',
              padding: '12px 16px',
              borderRadius: '16px',
              borderBottomLeftRadius: '4px'
            }}>
              <div style={{ display: 'flex', gap: '4px' }}>
                <span className="typing-dot" style={{ animationDelay: '0ms' }}>•</span>
                <span className="typing-dot" style={{ animationDelay: '150ms' }}>•</span>
                <span className="typing-dot" style={{ animationDelay: '300ms' }}>•</span>
              </div>
            </div>
          </div>
          )
        )}

        <div ref={messagesEndRef} />
      </main>
      )}

      {/* Input Area - Hidden when in Project Hub */}
      {(!currentFolderId || currentChatId) && (
      <footer style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--bg-dark-secondary)',
        background: 'var(--bg-dark-main)'
      }}>
        {/* Selected Images Preview */}
        {selectedImages.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
            {selectedImages.map((img, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img src={img} alt="" style={{ width: '60px', height: '60px', borderRadius: '8px', objectFit: 'cover' }} />
                <button
                  onClick={() => removeImage(i)}
                  style={{
                    position: 'absolute',
                    top: '-6px',
                    right: '-6px',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: '#ef4444',
                    border: 'none',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Target AI Selector for Prompt Optimizer */}
        {isPromptOptimizerMode && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '10px',
            padding: '10px 12px',
            background: 'rgba(251, 191, 36, 0.1)',
            borderRadius: '10px',
            border: '1px solid rgba(251, 191, 36, 0.3)'
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
            <span style={{ fontSize: '12px', color: '#fbbf24', fontWeight: 500 }}>Optimizar para:</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['chatgpt', 'claude', 'gemini'] as const).map((ai) => (
                <button
                  key={ai}
                  onClick={() => setTargetAI(ai)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: targetAI === ai ? '1px solid #fbbf24' : '1px solid var(--border-modal)',
                    background: targetAI === ai ? 'rgba(251, 191, 36, 0.2)' : 'transparent',
                    color: targetAI === ai ? '#fbbf24' : 'var(--color-gray-medium)',
                    fontSize: '11px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {ai === 'chatgpt' ? 'ChatGPT' : ai === 'claude' ? 'Claude' : 'Gemini'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Selected Context from Page */}
        {selectedContext && (
          <div style={{
            background: 'var(--bg-dark-tertiary)',
            border: '1px solid var(--color-accent)',
            borderRadius: '12px',
            padding: '12px',
            marginBottom: '10px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px'
            }}>
              <svg 
                width="18" 
                height="18" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="var(--color-accent)" 
                strokeWidth="2"
                style={{ flexShrink: 0, marginTop: '2px' }}
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
              </svg>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ 
                  fontSize: '12px', 
                  color: 'var(--color-accent)', 
                  fontWeight: 600,
                  marginBottom: '6px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  Texto seleccionado
                </div>
                <div style={{
                  fontSize: '14px',
                  color: 'var(--color-white)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  lineHeight: '1.5',
                  fontStyle: 'italic',
                  opacity: 0.9
                }}>
                  "{selectedContext.text.length > 200 
                    ? selectedContext.text.substring(0, 200) + '...' 
                    : selectedContext.text}"
                </div>
              </div>
              <button
                onClick={clearSelectedContext}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '24px',
                  height: '24px',
                  cursor: 'pointer',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
                title="Quitar contexto"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>
        )}

        <div style={{
          background: 'var(--bg-dark-secondary)',
          borderRadius: '24px',
          padding: '6px 6px 6px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          border: isRecording ? '2px solid #ef4444' : '1px solid transparent'
        }}>
          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageUpload}
            accept="image/*"
            multiple
            style={{ display: 'none' }}
          />
          
          {/* Plus Menu Button */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setIsPlusMenuOpen(!isPlusMenuOpen)}
              style={{
                background: isPlusMenuOpen ? 'rgba(0, 212, 179, 0.2)' : 'none',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                cursor: 'pointer',
                color: isPlusMenuOpen ? '#00d4b3' : 'var(--color-gray-medium)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s'
              }}
              title="Más opciones"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            
            {/* Dropdown Menu */}
            {isPlusMenuOpen && (
              <div style={{
                position: 'absolute',
                bottom: '100%',
                left: '0',
                marginBottom: '8px',
                background: 'var(--bg-modal)',
                border: '1px solid var(--border-modal)',
                borderRadius: '12px',
                padding: '8px',
                minWidth: '200px',
                boxShadow: 'var(--shadow-modal)',
                zIndex: 1000
              }}>
                {/* Deep Research - TEMPORALMENTE OCULTO
                <button
                  onClick={() => {
                    setIsDeepResearch(!isDeepResearch);
                    setIsImageGenMode(false);
                    setIsPromptOptimizerMode(false);
                    setIsPlusMenuOpen(false);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 12px',
                    background: isDeepResearch ? 'rgba(0, 212, 179, 0.15)' : 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    color: isDeepResearch ? '#00d4b3' : 'var(--color-white)',
                    cursor: 'pointer',
                    fontSize: '13px',
                    textAlign: 'left'
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    <line x1="11" y1="8" x2="11" y2="14"></line>
                    <line x1="8" y1="11" x2="14" y2="11"></line>
                  </svg>
                  <div>
                    <div style={{ fontWeight: 500 }}>Deep Research</div>
                    <div style={{ fontSize: '11px', color: 'var(--color-gray-medium)' }}>Investigación profunda</div>
                  </div>
                  {isDeepResearch && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#00d4b3" style={{ marginLeft: 'auto' }}>
                      <polyline points="20 6 9 17 4 12" stroke="#00d4b3" strokeWidth="2" fill="none"></polyline>
                    </svg>
                  )}
                </button>
                */}

                {/* Live API */}
                <button
                  onClick={() => {
                    handleLiveToggle();
                    setIsPlusMenuOpen(false);
                  }}
                  disabled={isLiveConnecting}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 12px',
                    background: isLiveActive ? 'rgba(239, 68, 68, 0.15)' : isLiveConnecting ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    color: isLiveActive ? '#ef4444' : isLiveConnecting ? '#3B82F6' : 'var(--color-white)',
                    cursor: isLiveConnecting ? 'wait' : 'pointer',
                    fontSize: '13px',
                    textAlign: 'left',
                    opacity: isLiveConnecting ? 0.7 : 1
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={isLiveConnecting ? { animation: 'spin 1s linear infinite' } : {}}>
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                  </svg>
                  <div>
                    <div style={{ fontWeight: 500 }}>
                      {isLiveConnecting ? 'Conectando...' : isLiveActive ? 'Desconectar' : 'Conversación en Vivo'}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-gray-medium)' }}>
                      {isLiveConnecting ? 'Estableciendo conexión' : isLiveActive ? 'Click para detener' : 'Audio en tiempo real'}
                    </div>
                  </div>
                  {isLiveActive && (
                    <div style={{
                      marginLeft: 'auto',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#ef4444',
                      animation: 'pulse 1s infinite'
                    }}></div>
                  )}
                  {isLiveConnecting && (
                    <div style={{
                      marginLeft: 'auto',
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      border: '2px solid #3B82F6',
                      borderTopColor: 'transparent',
                      animation: 'spin 1s linear infinite'
                    }}></div>
                  )}
                </button>

                {/* Computer Use for Live API */}
                <button
                  onClick={() => {
                    setIsLiveComputerUseEnabled(!isLiveComputerUseEnabled);
                    setIsPlusMenuOpen(false);
                  }}
                  disabled={isLiveActive}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 12px',
                    background: isLiveComputerUseEnabled ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    color: isLiveComputerUseEnabled ? '#10b981' : 'var(--color-white)',
                    cursor: isLiveActive ? 'not-allowed' : 'pointer',
                    fontSize: '13px',
                    textAlign: 'left',
                    opacity: isLiveActive ? 0.5 : 1
                  }}
                  title={isLiveActive ? 'Desconecta Live API para cambiar' : ''}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                    <line x1="8" y1="21" x2="16" y2="21"></line>
                    <line x1="12" y1="17" x2="12" y2="21"></line>
                  </svg>
                  <div>
                    <div style={{ fontWeight: 500 }}>Control de Página</div>
                    <div style={{ fontSize: '11px', color: 'var(--color-gray-medium)' }}>
                      {isLiveComputerUseEnabled ? 'Activado para Live API' : 'Habilita interacción'}
                    </div>
                  </div>
                  {isLiveComputerUseEnabled && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#10b981" style={{ marginLeft: 'auto' }}>
                      <polyline points="20 6 9 17 4 12" stroke="#10b981" strokeWidth="2" fill="none"></polyline>
                    </svg>
                  )}
                </button>

                {/* Image Generation */}
                <button
                  onClick={() => {
                    setIsImageGenMode(!isImageGenMode);
                    setIsDeepResearch(false);
                    setIsPromptOptimizerMode(false);
                    setIsWebAgentMode(false);
                    setIsPlusMenuOpen(false);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 12px',
                    background: isImageGenMode ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    color: isImageGenMode ? '#a855f7' : 'var(--color-white)',
                    cursor: 'pointer',
                    fontSize: '13px',
                    textAlign: 'left'
                  }}
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
                  {isImageGenMode && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#a855f7" style={{ marginLeft: 'auto' }}>
                      <polyline points="20 6 9 17 4 12" stroke="#a855f7" strokeWidth="2" fill="none"></polyline>
                    </svg>
                  )}
                </button>

                {/* Prompt Optimizer */}
                <button
                  onClick={() => {
                    if (!isPromptOptimizerMode) {
                      setIsPromptOptimizerMode(true);
                      setTargetAI('chatgpt'); // Default
                    } else {
                      setIsPromptOptimizerMode(false);
                      setTargetAI(null);
                    }
                    setIsDeepResearch(false);
                    setIsImageGenMode(false);
                    setIsWebAgentMode(false);
                    setIsPlusMenuOpen(false);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 12px',
                    background: isPromptOptimizerMode ? 'rgba(251, 191, 36, 0.15)' : 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    color: isPromptOptimizerMode ? '#fbbf24' : 'var(--color-white)',
                    cursor: 'pointer',
                    fontSize: '13px',
                    textAlign: 'left'
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 20h9"></path>
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                  </svg>
                  <div>
                    <div style={{ fontWeight: 500 }}>Mejorar Prompt</div>
                    <div style={{ fontSize: '11px', color: 'var(--color-gray-medium)' }}>Optimiza para otra IA</div>
                  </div>
                  {isPromptOptimizerMode && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#fbbf24" style={{ marginLeft: 'auto' }}>
                      <polyline points="20 6 9 17 4 12" stroke="#fbbf24" strokeWidth="2" fill="none"></polyline>
                    </svg>
                  )}
                </button>

                {/* Web Agent */}
                <button
                  onClick={() => {
                    setIsWebAgentMode(!isWebAgentMode);
                    setIsDeepResearch(false);
                    setIsImageGenMode(false);
                    setIsPromptOptimizerMode(false);
                    setIsPlusMenuOpen(false);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 12px',
                    background: isWebAgentMode ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    color: isWebAgentMode ? '#3b82f6' : 'var(--color-white)',
                    cursor: 'pointer',
                    fontSize: '13px',
                    textAlign: 'left'
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                    <line x1="8" y1="21" x2="16" y2="21"></line>
                    <line x1="12" y1="17" x2="12" y2="21"></line>
                  </svg>
                  <div>
                    <div style={{ fontWeight: 500 }}>Agente Web</div>
                    <div style={{ fontSize: '11px', color: 'var(--color-gray-medium)' }}>Controla el navegador</div>
                  </div>
                  {isWebAgentMode && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#3b82f6" style={{ marginLeft: 'auto' }}>
                      <polyline points="20 6 9 17 4 12" stroke="#3b82f6" strokeWidth="2" fill="none"></polyline>
                    </svg>
                  )}
                </button>

                <div style={{ height: '1px', background: 'var(--border-modal)', margin: '8px 0' }}></div>

                {/* Save as Prompt */}
                <button
                  onClick={() => {
                    const textToSave = inputValue.trim();
                    if (textToSave) {
                      setPendingPromptText(textToSave);
                      setEditingTool(null);
                      setIsToolEditorOpen(true);
                    } else {
                      // Open library to create from scratch
                      setIsToolLibraryOpen(true);
                    }
                    setIsPlusMenuOpen(false);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 12px',
                    background: inputValue.trim() ? 'rgba(168, 85, 247, 0.1)' : 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    color: inputValue.trim() ? '#a855f7' : 'var(--color-white)',
                    cursor: 'pointer',
                    fontSize: '13px',
                    textAlign: 'left'
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                  </svg>
                  <div>
                    <div style={{ fontWeight: 500 }}>
                      {inputValue.trim() ? 'Guardar como Prompt' : 'Crear Prompt'}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-gray-medium)' }}>
                      {inputValue.trim() 
                        ? `Guardar: "${inputValue.slice(0, 20)}${inputValue.length > 20 ? '...' : ''}"` 
                        : 'Guarda para reusar'}
                    </div>
                  </div>
                  {inputValue.trim() && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2" style={{ marginLeft: 'auto' }}>
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="8" x2="12" y2="16"></line>
                      <line x1="8" y1="12" x2="16" y2="12"></line>
                    </svg>
                  )}
                </button>

                {/* Attach File */}
                <button
                  onClick={() => {
                    fileInputRef.current?.click();
                    setIsPlusMenuOpen(false);
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

          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={isLoading || isRecording}
            placeholder={isRecording ? "Escuchando..." : "Escribe un mensaje..."}
            rows={1}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-white)',
              flex: 1,
              outline: 'none',
              fontSize: '14px',
              fontFamily: 'Inter, sans-serif',
              resize: 'none',
              minHeight: '24px',
              maxHeight: '150px',
              padding: '0',
              lineHeight: '1.5',
              overflowY: 'auto'
            }}
          />

          {/* Thinking Mode Dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsThinkingDropdownOpen(!isThinkingDropdownOpen);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 10px',
                background: 'var(--bg-dark-tertiary)',
                border: '1px solid var(--border-modal)',
                borderRadius: '18px',
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 500,
                transition: 'all 0.2s'
              }}
            >
              {(() => {
                const currentModel = MODEL_OPTIONS.find(m => m.id === preferredPrimaryModel);
                const options = currentModel?.thinkingOptions || [];
                const currentOption = options.find((o: any) => o.id === thinkingMode);
                return currentOption?.name || 'Rápido';
              })()}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>

            {/* Thinking Dropdown Menu */}
            {isThinkingDropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  right: 0,
                  marginBottom: '8px',
                  background: 'var(--bg-dark-secondary)',
                  border: '1px solid var(--border-modal)',
                  borderRadius: '12px',
                  padding: '8px',
                  minWidth: '180px',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                  zIndex: 100
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Model indicator */}
                <div style={{
                  padding: '6px 10px',
                  marginBottom: '6px',
                  fontSize: '11px',
                  color: 'var(--color-gray-medium)',
                  borderBottom: '1px solid var(--border-modal)'
                }}>
                  {preferredPrimaryModel.includes('gemini-3') ? 'Gemini 3' : 'Gemini 2.5'}
                </div>

                {(() => {
                  const currentModel = MODEL_OPTIONS.find(m => m.id === preferredPrimaryModel);
                  const options = currentModel?.thinkingOptions || [];
                  return options.map((opt: any) => {
                    const isActive = thinkingMode === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => {
                          handleThinkingChange(opt.id);
                          setIsThinkingDropdownOpen(false);
                        }}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '10px 12px',
                          background: isActive ? 'rgba(0, 212, 179, 0.1)' : 'transparent',
                          border: 'none',
                          borderRadius: '8px',
                          color: isActive ? 'var(--color-accent)' : 'var(--color-white)',
                          cursor: 'pointer',
                          fontSize: '13px',
                          textAlign: 'left',
                          transition: 'background 0.2s'
                        }}
                      >
                        {/* Icon based on thinking level */}
                        {opt.id === 'minimal' || opt.id === 'off' ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                          </svg>
                        ) : opt.id === 'low' ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
                            <line x1="9" y1="9" x2="9.01" y2="9"></line>
                            <line x1="15" y1="9" x2="15.01" y2="9"></line>
                          </svg>
                        ) : opt.id === 'medium' ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 2a8 8 0 0 0-8 8c0 3.5 2 6 4 8h8c2-2 4-4.5 4-8a8 8 0 0 0-8-8z"></path>
                            <path d="M9 22h6"></path>
                            <path d="M9 18h6"></path>
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
                          </svg>
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500 }}>{opt.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--color-gray-medium)' }}>{opt.desc}</div>
                        </div>
                        {isActive && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2.5">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        )}
                      </button>
                    );
                  });
                })()}
              </div>
            )}
          </div>

          {/* Mic / Send Button */}
          {hasInput ? (
            <button
              onClick={() => handleSendMessage()}
              disabled={isLoading}
              style={{
                background: 'var(--color-accent)',
                border: 'none',
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'transform 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
              onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-on-accent)" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          ) : isLiveActive ? (
            /* Live Audio Mic Button */
            <button
              onClick={toggleLiveMicrophone}
              style={{
                background: isLiveMicActive ? '#10B981' : 'var(--bg-dark-tertiary)',
                border: isLiveMicActive ? '2px solid #10B981' : 'none',
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s',
                animation: isLiveMicActive ? 'pulse 1.5s infinite' : 'none'
              }}
              title={isLiveMicActive ? 'Detener micrófono' : 'Hablar en vivo'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill={isLiveMicActive ? 'white' : 'none'} stroke={isLiveMicActive ? 'white' : 'var(--color-gray-medium)'} strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
          ) : (
            /* Regular Voice Recording Button */
            <button
              onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
              style={{
                background: isRecording ? '#ef4444' : 'var(--bg-dark-tertiary)',
                border: 'none',
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isRecording ? 'white' : 'var(--color-gray-medium)'} strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
          )}
        </div>
      </footer>
      )}

      {/* Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          onClick={() => setIsSidebarOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 9998,
            backdropFilter: 'blur(2px)'
          }}
        />
      )}

      {/* Sidebar Panel */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: isSidebarOpen ? 0 : '-300px',
        width: '300px',
        height: '100vh',
        backgroundColor: 'var(--bg-dark-secondary)',
        borderRight: '1px solid var(--border-modal)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        transition: 'left 0.3s ease',
        boxShadow: isSidebarOpen ? '4px 0 20px rgba(0,0,0,0.3)' : 'none'
      }}>
        {/* Sidebar Header */}
        <div style={{
          padding: '16px',
          borderBottom: '1px solid var(--border-modal)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src={liaAvatar} alt="Soflia" style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
            <span style={{ fontWeight: 600, color: 'var(--color-white)', fontSize: '15px' }}>Soflia</span>
          </div>
          <button
            onClick={() => setIsSidebarOpen(false)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-gray-medium)',
              padding: '4px'
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* New Chat Button */}
        <div style={{ padding: '12px 16px' }}>
          <button
            onClick={createNewChat}
            style={{
              width: '100%',
              padding: '12px 16px',
              background: 'var(--color-accent)',
              border: 'none',
              borderRadius: '10px',
              color: 'var(--color-on-accent)',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Nueva Conversación
          </button>
        </div>

        {/* Folders Section */}
        <div style={{ padding: '0 16px', marginBottom: '8px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px'
          }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-gray-medium)', textTransform: 'uppercase' }}>Carpetas</span>
            <button
              onClick={() => setIsFolderModalOpen(true)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-accent)',
                padding: '4px',
                display: 'flex',
                alignItems: 'center'
              }}
              title="Crear carpeta"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </div>

          {/* Folder List */}
          {folders.map(folder => (
            <div key={folder.id} style={{ marginBottom: '4px' }}>
              <button
                onClick={() => {
                  const newExpanded = new Set(expandedFolders);
                  if (newExpanded.has(folder.id)) {
                    newExpanded.delete(folder.id);
                  } else {
                    newExpanded.add(folder.id);
                  }
                  setExpandedFolders(newExpanded);
                }}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'var(--color-white)',
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  textAlign: 'left'
                }}
                onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-dark-tertiary)'}
                onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <div 
                   onClick={(e) => {
                     e.stopPropagation();
                     handleOpenProject(folder.id);
                   }}
                   style={{ 
                     flex: 1, 
                     display: 'flex', 
                     alignItems: 'center', 
                     gap: '8px',
                     cursor: 'pointer' 
                   }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>
                  <span>{folder.name}</span>
                </div>
                
                <div
                   onClick={(e) => {
                     e.stopPropagation();
                     const newExpanded = new Set(expandedFolders);
                     if (newExpanded.has(folder.id)) {
                       newExpanded.delete(folder.id);
                     } else {
                       newExpanded.add(folder.id);
                     }
                     setExpandedFolders(newExpanded);
                   }}
                   style={{ padding: '4px', cursor: 'pointer' }}
                >
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    style={{ transform: expandedFolders.has(folder.id) ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                  >
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>
              </button>

              {/* Folder Chats */}
              {expandedFolders.has(folder.id) && (
                <div style={{ paddingLeft: '24px' }}>
                  {chatHistory.filter(c => c.folderId === folder.id).map(chat => (
                    <button
                      key={chat.id}
                      onClick={() => loadChat(chat)}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        background: currentChatId === chat.id ? 'rgba(0, 212, 179, 0.15)' : 'transparent',
                        border: 'none',
                        borderRadius: '8px',
                        color: currentChatId === chat.id ? 'var(--color-accent)' : 'var(--color-white)',
                        fontSize: '12px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}
                      onMouseOver={(e) => { if (currentChatId !== chat.id) e.currentTarget.style.background = 'var(--bg-dark-tertiary)'; }}
                      onMouseOut={(e) => { if (currentChatId !== chat.id) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chat.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Chat History Section */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-gray-medium)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
            Historial
          </span>

          {chatHistory.filter(c => !c.folderId).map(chat => (
            <div
              key={chat.id}
              onClick={() => loadChat(chat)}
              style={{
                padding: '10px 12px',
                background: currentChatId === chat.id ? 'rgba(0, 212, 179, 0.15)' : 'transparent',
                borderRadius: '8px',
                cursor: 'pointer',
                marginBottom: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'background 0.2s'
              }}
              onMouseOver={(e) => { if (currentChatId !== chat.id) e.currentTarget.style.background = 'var(--bg-dark-tertiary)'; }}
              onMouseOut={(e) => { if (currentChatId !== chat.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '13px',
                  fontWeight: 500,
                  color: currentChatId === chat.id ? 'var(--color-accent)' : 'var(--color-white)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {chat.title}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-gray-medium)', marginTop: '2px' }}>
                  {formatRelativeTime(chat.updatedAt)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                    onClick={(e) => { e.stopPropagation(); setMovingChatId(chat.id); }}
                    style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-gray-medium)',
                    padding: '4px',
                    opacity: 0.6,
                    transition: 'opacity 0.2s'
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--color-accent)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.color = 'var(--color-gray-medium)'; }}
                    title="Mover a carpeta"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    {chat.folderId ? <line x1="12" y1="11" x2="12" y2="17"></line> : <line x1="12" y1="11" x2="12" y2="17"></line>}
                    {chat.folderId ? <line x1="9" y1="14" x2="15" y2="14"></line> : <line x1="9" y1="14" x2="15" y2="14"></line>}
                    </svg>
                </button>
                <button
                    onClick={(e) => deleteChat(chat.id, e)}
                    style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-gray-medium)',
                    padding: '4px',
                    opacity: 0.6,
                    transition: 'opacity 0.2s'
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#ef4444'; }}
                    onMouseOut={(e) => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.color = 'var(--color-gray-medium)'; }}
                    title="Eliminar conversación"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
              </div>
            </div>
          ))}

          {chatHistory.length === 0 && (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-gray-medium)', fontSize: '13px' }}>
              No hay conversaciones guardadas
            </div>
          )}
        </div>

        {/* Sidebar Footer - Settings & Feedback */}
        <div style={{
          padding: '16px',
          borderTop: '1px solid var(--border-modal)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <button
            onClick={() => {
              setIsSettingsModalOpen(true);
              setIsSidebarOpen(false);
            }}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '8px',
              color: 'var(--color-white)',
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              textAlign: 'left'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-dark-tertiary)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            Personalizar Soflia
          </button>



          <button
            onClick={() => {
              signOut();
              setIsSidebarOpen(false);
            }}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: 'none',
              borderRadius: '8px',
              color: '#ef4444',
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              textAlign: 'left'
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            Cerrar Sesión
          </button>
        </div>
      </div>

      {/* Folder Creation Modal */}
      {isFolderModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 10001,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div style={{
            width: '360px',
            background: 'var(--bg-modal)',
            borderRadius: '16px',
            border: '1px solid var(--border-modal)',
            padding: '24px',
            boxShadow: 'var(--shadow-modal)'
          }}>
            <h3 style={{ color: 'var(--color-white)', fontSize: '16px', fontWeight: 600, margin: '0 0 16px 0' }}>Crear Carpeta</h3>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Nombre de la carpeta..."
              style={{
                width: '100%',
                padding: '12px 14px',
                backgroundColor: 'var(--bg-dark-tertiary)',
                border: '1px solid var(--border-modal)',
                borderRadius: '8px',
                color: 'var(--color-white)',
                fontSize: '14px',
                outline: 'none',
                marginBottom: '16px',
                boxSizing: 'border-box'
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') createFolder(); }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setIsFolderModalOpen(false); setNewFolderName(''); }}
                style={{
                  padding: '10px 20px',
                  background: 'transparent',
                  border: '1px solid var(--color-gray-medium)',
                  borderRadius: '8px',
                  color: 'var(--color-white)',
                  cursor: 'pointer',
                  fontSize: '13px'
                }}
              >
                Cancelar
              </button>
              <button
                onClick={createFolder}
                disabled={!newFolderName.trim()}
                style={{
                  padding: '10px 20px',
                  background: 'var(--color-accent)',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'var(--color-on-accent)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 600,
                  opacity: newFolderName.trim() ? 1 : 0.5
                }}
              >
                Crear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        user={user}
        supabase={supabase}
        onSave={loadUserSettings}
      />

      {/* Meeting Panel */}
      {isMeetingPanelOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 10003,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div style={{
            width: '90%',
            maxWidth: '500px',
            height: '80%',
            maxHeight: '600px',
            background: 'var(--bg-modal)',
            borderRadius: '16px',
            border: '1px solid var(--border-modal)',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-modal)'
          }}>
            <MeetingPanel onClose={() => setIsMeetingPanelOpen(false)} />
          </div>
        </div>
      )}

      {/* Move Chat Modal */}
      {movingChatId && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 10002,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }} onClick={() => setMovingChatId(null)}>
          <div style={{
            width: '320px',
            background: 'var(--bg-modal)',
            borderRadius: '16px',
            border: '1px solid var(--border-modal)',
            padding: '20px',
            boxShadow: 'var(--shadow-modal)'
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ color: 'var(--color-white)', fontSize: '16px', margin: '0 0 16px 0' }}>Mover a Carpeta</h3>
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                <button
                    onClick={() => moveChatToFolder(movingChatId, null)} // Null for removing from folder
                    style={{
                        width: '100%',
                        padding: '10px',
                        textAlign: 'left',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--color-white)',
                        cursor: 'pointer',
                        borderRadius: '8px',
                        marginBottom: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-dark-tertiary)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                    Sin Carpeta (General)
                </button>
                {Array.from(folders.values()).map(folder => (
                    <button
                        key={folder.id}
                        onClick={() => moveChatToFolder(movingChatId, folder.id)}
                        style={{
                            width: '100%',
                            padding: '10px',
                            textAlign: 'left',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--color-white)',
                            cursor: 'pointer',
                            borderRadius: '8px',
                            marginBottom: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-dark-tertiary)'}
                        onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                        {folder.name}
                    </button>
                ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                <button
                    onClick={() => setMovingChatId(null)}
                    style={{
                        padding: '8px 16px',
                        background: 'var(--bg-dark-tertiary)',
                        border: '1px solid var(--border-modal)',
                        borderRadius: '8px',
                        color: 'var(--color-white)',
                        cursor: 'pointer'
                    }}
                >
                    Cancelar
                </button>
            </div>
          </div>
        </div>
      )}

      {/* Premium Model Selector Modal */}
      {isModelSelectorOpen && (
        <div 
           style={{
             position: 'fixed',
             top: 0, 
             left: 0, 
             right: 0, 
             bottom: 0,
             background: 'rgba(0,0,0,0.6)', 
             backdropFilter: 'blur(4px)',
             zIndex: 9999,
             display: 'flex',
             alignItems: 'flex-start',
             justifyContent: 'center',
             paddingTop: '60px', 
             animation: 'fadeIn 0.2s ease-out'
           }}
           onClick={() => setIsModelSelectorOpen(false)}
        >
           <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
           <div 
             style={{
               background: 'var(--bg-dark-secondary)',
               border: '1px solid var(--border-modal)',
               borderRadius: '16px',
               width: '90%',
               maxWidth: '400px',
               padding: '16px',
               boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 10px 10px -5px rgba(0, 0, 0, 0.3)',
               maxHeight: '80vh',
               overflowY: 'auto'
             }}
             onClick={(e) => e.stopPropagation()}
           >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                 <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--color-white)', fontWeight: 600 }}>Seleccionar Modelo</h3>
                 <button 
                   onClick={() => setIsModelSelectorOpen(false)}
                   style={{ background: 'none', border: 'none', color: 'var(--color-gray-medium)', cursor: 'pointer', padding: '4px' }}
                 >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                 </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                 {MODEL_OPTIONS.map((model) => {
                    const isSelected = preferredPrimaryModel === model.id;
                    return (
                       <div 
                         key={model.id}
                         onClick={() => {
                            handleModelChange('primary', model.id);
                            setIsModelSelectorOpen(false);
                         }}
                         style={{
                           display: 'flex',
                           alignItems: 'center',
                           padding: '12px',
                           borderRadius: '12px',
                           background: isSelected ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                           border: `1px solid ${isSelected ? model.color || 'var(--color-accent)' : 'var(--border-modal)'}`,
                           cursor: 'pointer',
                           transition: 'all 0.2s',
                           position: 'relative',
                           overflow: 'hidden'
                         }}
                         onMouseOver={(e) => {
                            if (!isSelected) {
                               e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                               e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                            }
                         }}
                         onMouseOut={(e) => {
                            if (!isSelected) {
                               e.currentTarget.style.background = 'transparent';
                               e.currentTarget.style.borderColor = 'var(--border-modal)';
                            }
                         }}
                       >
                          {/* Indicator Bar */}
                          {isSelected && (
                             <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px', background: model.color || 'var(--color-accent)' }}></div>
                          )}

                          {/* Icon */}
                          <div style={{ 
                             fontSize: '20px', 
                             marginRight: '12px', 
                             width: '32px', 
                             height: '32px', 
                             display: 'flex', 
                             alignItems: 'center', 
                             justifyContent: 'center',
                             background: isSelected ? `rgba(${parseInt(model.color?.slice(1,3) || '00', 16)}, ${parseInt(model.color?.slice(3,5) || '00', 16)}, ${parseInt(model.color?.slice(5,7) || '00', 16)}, 0.15)` : 'rgba(255,255,255,0.05)',
                             borderRadius: '8px',
                             color: model.color
                          }}>
                             {model.icon}
                          </div>

                          <div style={{ flex: 1 }}>
                             <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                                <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-white)' }}>{model.name}</span>
                                {model.badge && (
                                   <span style={{ 
                                      fontSize: '9px', 
                                      padding: '2px 6px', 
                                      borderRadius: '4px', 
                                      background: model.badge === 'Pro' ? 'linear-gradient(45deg, #A855F7, #EC4899)' : (model.badge === 'Nuevo' ? 'var(--color-accent)' : 'rgba(255,255,255,0.1)'), 
                                      color: model.badge === 'Nuevo' ? 'black' : 'white',
                                      fontWeight: 600,
                                      textTransform: 'uppercase'
                                   }}>
                                      {model.badge}
                                   </span>
                                )}
                             </div>
                             <div style={{ fontSize: '11px', color: 'var(--color-gray-medium)' }}>
                                {model.desc}
                             </div>
                          </div>

                          {isSelected && (
                             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={model.color || 'var(--color-accent)'} strokeWidth="2.5" style={{ marginLeft: '8px' }}>
                                <polyline points="20 6 9 17 4 12"></polyline>
                             </svg>
                          )}
                       </div>
                    );
                 })}
              </div>

           </div>
        </div>
      )}

      {/* Zoomed Image Modal */}
      {zoomedImage && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
            backdropFilter: 'blur(5px)'
          }}
          onClick={() => setZoomedImage(null)}
        >
          <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '100%' }}>
            <img 
              src={zoomedImage} 
              alt="Zoomed view" 
              style={{
                maxWidth: '100%',
                maxHeight: '90vh',
                borderRadius: '12px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                objectFit: 'contain'
              }}
              onClick={(e) => e.stopPropagation()} 
            />
            <button
              onClick={() => setZoomedImage(null)}
              style={{
                position: 'absolute',
                top: '-40px',
                right: '0',
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'white'
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Tool Library Modal */}
      {isToolLibraryOpen && (
        <ToolLibrary
          onSelectTool={(tool) => {
            setActiveTool(tool);
            setIsToolLibraryOpen(false);
          }}
          onClose={() => setIsToolLibraryOpen(false)}
          onCreateTool={() => {
            setEditingTool(null);
            setIsToolEditorOpen(true);
          }}
          onEditTool={(tool) => {
            setEditingTool(tool);
            setIsToolEditorOpen(true);
          }}
        />
      )}

      {/* Tool Editor Modal */}
      <ToolEditorModal
        isOpen={isToolEditorOpen}
        tool={editingTool}
        initialPromptText={pendingPromptText}
        onClose={() => {
          setIsToolEditorOpen(false);
          setEditingTool(null);
          setPendingPromptText('');
        }}
        onSave={() => {
          setIsToolEditorOpen(false);
          setEditingTool(null);
          setPendingPromptText('');
          // Clear the input since the prompt was saved
          if (pendingPromptText) {
            setInputValue('');
          }
          // Refresh tool library by closing and reopening if open
          if (isToolLibraryOpen) {
            setIsToolLibraryOpen(false);
            setTimeout(() => setIsToolLibraryOpen(true), 100);
          }
        }}
      />

      {/* Project Suggestion Modal - Proactive Organization */}
      {suggestionData && (
        <ProjectSuggestionModal
          isOpen={suggestionData.isOpen}
          onClose={() => setSuggestionData(null)}
          onConfirm={handleSuggestionConfirm}
          suggestionType={suggestionData.type}
          targetName={suggestionData.targetName}
          reason={suggestionData.reason}
          relatedChatsCount={suggestionData.relatedChatsCount}
        />
      )}
    </div>
  );
}

export default App;
