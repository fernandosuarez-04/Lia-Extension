import React, { useState, useEffect, useRef } from 'react';
import { getUserApiKey, saveUserApiKey, deleteUserApiKey, validateApiKey, invalidateApiKeyCache } from '../services/api-keys';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    user: any;
    supabase: any;
    onSave?: () => void;
}

// Custom Select Component for cleaner look
const CustomSelect = ({ value, onChange, options }: { value: string, onChange: (val: string) => void, options: {value: string, label: string}[] }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedLabel = options.find(o => o.value === value)?.label || value;

    return (
        <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
            <div 
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    width: '100%',
                    padding: '12px 14px',
                    backgroundColor: 'var(--bg-dark-tertiary)',
                    border: isOpen ? '1px solid var(--color-accent)' : '1px solid var(--border-modal)',
                    borderRadius: '8px',
                    color: 'var(--color-white)',
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    transition: 'all 0.2s'
                }}
            >
                <span>{selectedLabel}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', opacity: 0.7 }}>
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </div>
            
            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: '4px',
                    backgroundColor: 'var(--bg-dark-secondary)',
                    border: '1px solid var(--border-modal)',
                    borderRadius: '8px',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                    zIndex: 100,
                    overflow: 'hidden',
                    maxHeight: '200px',
                    overflowY: 'auto'
                }}>
                    {options.map((opt) => (
                        <div
                            key={opt.value}
                            onClick={() => {
                                onChange(opt.value);
                                setIsOpen(false);
                            }}
                            style={{
                                padding: '10px 14px',
                                fontSize: '13px',
                                color: 'var(--color-white)',
                                cursor: 'pointer',
                                backgroundColor: value === opt.value ? 'rgba(0, 212, 179, 0.1)' : 'transparent',
                                borderLeft: value === opt.value ? '3px solid var(--color-accent)' : '3px solid transparent'
                            }}
                            onMouseOver={(e) => {
                                if (value !== opt.value) e.currentTarget.style.backgroundColor = 'var(--bg-dark-tertiary)';
                            }}
                            onMouseOut={(e) => {
                                if (value !== opt.value) e.currentTarget.style.backgroundColor = 'transparent';
                            }}
                        >
                            {opt.label}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// Available Models
const MODEL_OPTIONS = [
    { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro (Preview)', description: 'Máximo razonamiento, más lento' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)', description: 'Rápido y capaz, recomendado' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Alto rendimiento, estable' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Balanceado, muy estable' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', description: 'Ultra rápido, respuestas cortas' }
];

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, user, supabase, onSave }) => {
    const [activeTab, setActiveTab] = useState('personalization');
    const [loading, setLoading] = useState(false);

    // Form States - Personalization
    const [nickname, setNickname] = useState('');
    const [occupation, setOccupation] = useState('');
    const [aboutUser, setAboutUser] = useState('');
    const [toneStyle, setToneStyle] = useState('Profesional');
    const [customInstructions, setCustomInstructions] = useState('');
    const [charEmojis, setCharEmojis] = useState('Auto');

    // Form States - Models
    const [primaryModel, setPrimaryModel] = useState('gemini-3-flash-preview');
    const [fallbackModel, setFallbackModel] = useState('gemini-2.5-flash');

    // Form States - API Keys (stored locally only, never in Supabase)
    const [userApiKey, setUserApiKey] = useState('');
    const [showApiKey, setShowApiKey] = useState(false);
    const [apiKeyStatus, setApiKeyStatus] = useState<'none' | 'saved' | 'testing' | 'valid' | 'invalid'>('none');

    // Load Data
    useEffect(() => {
        if (isOpen && user) {
            loadSettings();
            loadApiKey();
        }
    }, [isOpen, user]);

    // Load API key from Supabase database
    const loadApiKey = async () => {
        try {
            const userKey = await getUserApiKey('google');
            if (userKey) {
                setUserApiKey(userKey.api_key);
                setApiKeyStatus('saved');
            }
        } catch (error) {
            console.error('Error loading API key:', error);
        }
    };

    // Save API key to Supabase database
    const saveApiKey = async () => {
        const key = userApiKey.trim();
        if (!key) {
            // If empty, delete the key
            const result = await deleteUserApiKey('google');
            if (result.success) {
                invalidateApiKeyCache();
                setApiKeyStatus('none');
            }
            return;
        }

        setApiKeyStatus('testing');

        // First validate the key
        const isValid = await validateApiKey(key, 'google');
        if (!isValid) {
            setApiKeyStatus('invalid');
            return;
        }

        // Save to database
        const result = await saveUserApiKey({ provider: 'google', api_key: key });
        if (result.success) {
            invalidateApiKeyCache();
            setApiKeyStatus('valid');
        } else {
            console.error('Error saving API key:', result.error);
            setApiKeyStatus('invalid');
        }
    };

    const loadSettings = async () => {
        setLoading(true);
        const { data } = await supabase
            .from('user_ai_settings')
            .select('*')
            .eq('user_id', user.id)
            .single();

        if (data) {
            setNickname(data.nickname || '');
            setOccupation(data.occupation || '');
            setAboutUser(data.about_user || '');
            setToneStyle(data.tone_style || 'Profesional');
            setCustomInstructions(data.custom_instructions || '');
            setCharEmojis(data.char_emojis || 'Auto');
            // Model settings
            setPrimaryModel(data.primary_model || 'gemini-3-flash-preview');
            setFallbackModel(data.fallback_model || 'gemini-2.5-flash');
        }
        setLoading(false);
    };

    const handleSave = async () => {
        setLoading(true);
        try {
            const updates = {
                user_id: user.id,
                nickname,
                occupation,
                about_user: aboutUser,
                tone_style: toneStyle,
                custom_instructions: customInstructions,
                char_emojis: charEmojis,
                primary_model: primaryModel,
                fallback_model: fallbackModel,
                updated_at: new Date()
            };

            const { error } = await supabase
                .from('user_ai_settings')
                .upsert(updates, { onConflict: 'user_id' });

            if (error) throw error;

            // Also save to chrome.storage for quick access by gemini service
            if (typeof chrome !== 'undefined' && chrome.storage) {
                chrome.storage.local.set({
                    lia_primary_model: primaryModel,
                    lia_fallback_model: fallbackModel
                });
            }

            if (onSave) onSave();
            onClose();
        } catch (error) {
            console.error('Error saving settings:', error);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div style={{
                width: '900px', 
                height: '80vh', 
                maxHeight: '700px',
                backgroundColor: 'var(--bg-modal)', 
                borderRadius: '16px', 
                border: '1px solid var(--border-modal)', 
                display: 'flex', 
                overflow: 'hidden',
                boxShadow: 'var(--shadow-modal)'
            }}>
                {/* Sidebar */}
                <div style={{ 
                    width: '240px', 
                    backgroundColor: 'var(--bg-dark-secondary)', 
                    padding: '24px', 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: '8px',
                    borderRight: '1px solid var(--border-modal)'
                }}>
                     <h3 style={{ color: 'var(--color-white)', fontSize: '18px', marginBottom: '24px', fontWeight: 600 }}>Configuración</h3>
                     
                     <div
                        onClick={() => setActiveTab('personalization')}
                        style={{
                            padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 500,
                            backgroundColor: activeTab === 'personalization' ? 'var(--bg-dark-tertiary)' : 'transparent',
                            color: activeTab === 'personalization' ? 'var(--color-accent)' : 'var(--color-gray-medium)',
                            display: 'flex', alignItems: 'center', gap: '10px', transition: 'all 0.2s'
                        }}
                     >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                          <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                        Personalización
                     </div>
                     <div
                        onClick={() => setActiveTab('models')}
                        style={{
                            padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 500,
                            backgroundColor: activeTab === 'models' ? 'var(--bg-dark-tertiary)' : 'transparent',
                            color: activeTab === 'models' ? 'var(--color-accent)' : 'var(--color-gray-medium)',
                            display: 'flex', alignItems: 'center', gap: '10px', transition: 'all 0.2s'
                        }}
                     >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                          <path d="M2 17l10 5 10-5"></path>
                          <path d="M2 12l10 5 10-5"></path>
                        </svg>
                        Modelos de IA
                     </div>
                     <div
                        onClick={() => setActiveTab('apikeys')}
                        style={{
                            padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 500,
                            backgroundColor: activeTab === 'apikeys' ? 'var(--bg-dark-tertiary)' : 'transparent',
                            color: activeTab === 'apikeys' ? 'var(--color-accent)' : 'var(--color-gray-medium)',
                            display: 'flex', alignItems: 'center', gap: '10px', transition: 'all 0.2s'
                        }}
                     >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
                        </svg>
                        API Keys
                     </div>
                     <div
                         style={{
                             padding: '10px 14px', fontSize: '14px', fontWeight: 500,
                             color: 'var(--color-gray-medium)', cursor: 'not-allowed', opacity: 0.6,
                             display: 'flex', alignItems: 'center', gap: '10px'
                         }}
                     >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                           <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                           <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                        </svg>
                        Notificaciones
                     </div>
                </div>

                {/* Content */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-modal)' }}>
                    {/* Header */}
                    <div style={{ padding: '20px 32px', borderBottom: '1px solid var(--border-modal)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--color-white)', margin: 0 }}>
                            {activeTab === 'personalization' ? 'Personalización' : activeTab === 'models' ? 'Modelos de IA' : 'API Keys'}
                        </h2>
                        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--color-gray-medium)', cursor: 'pointer', padding: '4px' }}>
                           <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18"></line>
                              <line x1="6" y1="6" x2="18" y2="18"></line>
                           </svg>
                        </button>
                    </div>

                    {/* Scrollable Form */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>

                        {/* === MODELS TAB === */}
                        {activeTab === 'models' && (
                            <>
                                {/* Info Banner */}
                                <div style={{
                                    padding: '14px 16px',
                                    background: 'rgba(0, 212, 179, 0.08)',
                                    border: '1px solid rgba(0, 212, 179, 0.2)',
                                    borderRadius: '10px',
                                    marginBottom: '28px',
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '12px'
                                }}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" style={{ flexShrink: 0, marginTop: '1px' }}>
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <line x1="12" y1="16" x2="12" y2="12"></line>
                                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                                    </svg>
                                    <div>
                                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-white)', marginBottom: '4px' }}>
                                            Elige tu modelo de IA preferido
                                        </div>
                                        <div style={{ fontSize: '12px', color: 'var(--color-gray-medium)', lineHeight: 1.5 }}>
                                            El modelo primario se usa para todas las conversaciones. Si falla, se usará el modelo de respaldo automáticamente.
                                        </div>
                                    </div>
                                </div>

                                {/* Primary Model */}
                                <div style={{ marginBottom: '28px' }}>
                                    <h4 style={{ color: 'var(--color-white)', fontSize: '15px', marginBottom: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2">
                                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                                        </svg>
                                        Modelo Primario
                                    </h4>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {MODEL_OPTIONS.map((model) => (
                                            <div
                                                key={model.value}
                                                onClick={() => setPrimaryModel(model.value)}
                                                style={{
                                                    padding: '14px 16px',
                                                    background: primaryModel === model.value ? 'rgba(0, 212, 179, 0.1)' : 'var(--bg-dark-tertiary)',
                                                    border: primaryModel === model.value ? '2px solid var(--color-accent)' : '2px solid transparent',
                                                    borderRadius: '10px',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between'
                                                }}
                                            >
                                                <div>
                                                    <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--color-white)', marginBottom: '3px' }}>
                                                        {model.label}
                                                    </div>
                                                    <div style={{ fontSize: '12px', color: 'var(--color-gray-medium)' }}>
                                                        {model.description}
                                                    </div>
                                                </div>
                                                {primaryModel === model.value && (
                                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="3">
                                                        <polyline points="20 6 9 17 4 12"></polyline>
                                                    </svg>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Fallback Model */}
                                <div style={{ marginBottom: '24px' }}>
                                    <h4 style={{ color: 'var(--color-white)', fontSize: '15px', marginBottom: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-gray-medium)" strokeWidth="2">
                                            <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                                        </svg>
                                        Modelo de Respaldo
                                    </h4>

                                    <CustomSelect
                                        value={fallbackModel}
                                        onChange={setFallbackModel}
                                        options={MODEL_OPTIONS.filter(m => m.value !== primaryModel).map(m => ({
                                            value: m.value,
                                            label: m.label
                                        }))}
                                    />
                                    <p style={{ fontSize: '12px', color: 'var(--color-gray-medium)', marginTop: '8px' }}>
                                        Se usará si el modelo primario no está disponible o falla.
                                    </p>
                                </div>
                            </>
                        )}

                        {/* === API KEYS TAB === */}
                        {activeTab === 'apikeys' && (
                            <>
                                {/* Security Warning */}
                                <div style={{
                                    padding: '14px 16px',
                                    background: 'rgba(245, 158, 11, 0.1)',
                                    border: '1px solid rgba(245, 158, 11, 0.3)',
                                    borderRadius: '10px',
                                    marginBottom: '28px',
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '12px'
                                }}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" style={{ flexShrink: 0, marginTop: '1px' }}>
                                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                        <line x1="12" y1="9" x2="12" y2="13"></line>
                                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                                    </svg>
                                    <div>
                                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#f59e0b', marginBottom: '4px' }}>
                                            Seguridad de API Keys
                                        </div>
                                        <div style={{ fontSize: '12px', color: 'var(--color-gray-medium)', lineHeight: 1.5 }}>
                                            Tu API key se guarda de forma segura en tu cuenta de SOFLIA.
                                            Solo tú puedes ver y usar tu propia API key.
                                        </div>
                                    </div>
                                </div>

                                {/* Google API Key */}
                                <div style={{ marginBottom: '28px' }}>
                                    <h4 style={{ color: 'var(--color-white)', fontSize: '15px', marginBottom: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2">
                                            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
                                        </svg>
                                        Google Gemini API Key
                                    </h4>

                                    <div style={{ marginBottom: '12px' }}>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--color-gray-medium)', marginBottom: '8px' }}>
                                            Tu API Key personal
                                        </label>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <div style={{ flex: 1, position: 'relative' }}>
                                                <input
                                                    type={showApiKey ? 'text' : 'password'}
                                                    value={userApiKey}
                                                    onChange={e => setUserApiKey(e.target.value)}
                                                    style={{...inputStyle, paddingRight: '40px'}}
                                                    placeholder="AIzaSy..."
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowApiKey(!showApiKey)}
                                                    style={{
                                                        position: 'absolute',
                                                        right: '10px',
                                                        top: '50%',
                                                        transform: 'translateY(-50%)',
                                                        background: 'none',
                                                        border: 'none',
                                                        cursor: 'pointer',
                                                        padding: '4px',
                                                        color: 'var(--color-gray-medium)'
                                                    }}
                                                >
                                                    {showApiKey ? (
                                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                                            <line x1="1" y1="1" x2="23" y2="23"></line>
                                                        </svg>
                                                    ) : (
                                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                                            <circle cx="12" cy="12" r="3"></circle>
                                                        </svg>
                                                    )}
                                                </button>
                                            </div>
                                            <button
                                                onClick={saveApiKey}
                                                style={{
                                                    padding: '12px 16px',
                                                    borderRadius: '8px',
                                                    border: 'none',
                                                    background: 'var(--color-accent)',
                                                    color: 'var(--color-on-accent)',
                                                    cursor: 'pointer',
                                                    fontSize: '13px',
                                                    fontWeight: 500,
                                                    whiteSpace: 'nowrap'
                                                }}
                                            >
                                                Guardar Key
                                            </button>
                                        </div>

                                        {/* Status indicator */}
                                        {apiKeyStatus !== 'none' && (
                                            <div style={{
                                                marginTop: '8px',
                                                fontSize: '12px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                color: apiKeyStatus === 'valid' ? '#10b981' :
                                                       apiKeyStatus === 'invalid' ? '#ef4444' :
                                                       apiKeyStatus === 'testing' ? '#f59e0b' : 'var(--color-gray-medium)'
                                            }}>
                                                {apiKeyStatus === 'testing' && (
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                                                        <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                                                    </svg>
                                                )}
                                                {apiKeyStatus === 'valid' && (
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <polyline points="20 6 9 17 4 12"></polyline>
                                                    </svg>
                                                )}
                                                {apiKeyStatus === 'invalid' && (
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                                    </svg>
                                                )}
                                                {apiKeyStatus === 'saved' && (
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                                                        <polyline points="17 21 17 13 7 13 7 21"></polyline>
                                                        <polyline points="7 3 7 8 15 8"></polyline>
                                                    </svg>
                                                )}
                                                {apiKeyStatus === 'testing' && 'Verificando...'}
                                                {apiKeyStatus === 'valid' && 'API Key válida'}
                                                {apiKeyStatus === 'invalid' && 'API Key inválida'}
                                                {apiKeyStatus === 'saved' && 'API Key guardada'}
                                            </div>
                                        )}
                                    </div>

                                    <div style={{
                                        padding: '12px 14px',
                                        background: 'var(--bg-dark-tertiary)',
                                        borderRadius: '8px',
                                        marginTop: '16px'
                                    }}>
                                        <p style={{ fontSize: '12px', color: 'var(--color-gray-medium)', margin: 0, lineHeight: 1.6 }}>
                                            <strong style={{ color: 'var(--color-white)' }}>¿Cómo obtener tu API Key?</strong><br/>
                                            1. Ve a <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)' }}>Google AI Studio</a><br/>
                                            2. Haz clic en "Create API Key"<br/>
                                            3. Copia la key y pégala aquí
                                        </p>
                                    </div>
                                </div>

                                {/* Clear Key Button */}
                                {userApiKey && (
                                    <div style={{ marginBottom: '24px' }}>
                                        <button
                                            onClick={async () => {
                                                const result = await deleteUserApiKey('google');
                                                if (result.success) {
                                                    setUserApiKey('');
                                                    invalidateApiKeyCache();
                                                    setApiKeyStatus('none');
                                                }
                                            }}
                                            style={{
                                                padding: '10px 16px',
                                                borderRadius: '8px',
                                                border: '1px solid #ef4444',
                                                background: 'transparent',
                                                color: '#ef4444',
                                                cursor: 'pointer',
                                                fontSize: '13px',
                                                fontWeight: 500
                                            }}
                                        >
                                            Eliminar API Key
                                        </button>
                                    </div>
                                )}
                            </>
                        )}

                        {/* === PERSONALIZATION TAB === */}
                        {activeTab === 'personalization' && (
                        <>
                        {/* Section: About You */}
                        <div style={{ marginBottom: '32px' }}>
                            <h4 style={{ color: 'var(--color-white)', fontSize: '15px', marginBottom: '16px', fontWeight: 600 }}>Acerca de ti</h4>
                            
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--color-gray-medium)', marginBottom: '8px' }}>Apodo / Cómo llamarte</label>
                                    <input 
                                        value={nickname} onChange={e => setNickname(e.target.value)}
                                        style={inputStyle} placeholder="Ej: Fer"
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--color-gray-medium)', marginBottom: '8px' }}>Ocupación / Rol</label>
                                    <input 
                                        value={occupation} onChange={e => setOccupation(e.target.value)}
                                        style={inputStyle} placeholder="Ej: Ingeniero de Software"
                                    />
                                </div>
                            </div>

                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--color-gray-medium)', marginBottom: '8px' }}>Más información de contexto</label>
                                <textarea 
                                    value={aboutUser} onChange={e => setAboutUser(e.target.value)}
                                    style={{...inputStyle, height: '80px', resize: 'none'}} 
                                    placeholder="Intereses, ubicación, o cualquier contexto útil..."
                                />
                            </div>
                        </div>

                        {/* Section: Response Style */}
                        <div style={{ marginBottom: '32px' }}>
                            <h4 style={{ color: 'var(--color-white)', fontSize: '15px', marginBottom: '16px', fontWeight: 600 }}>Estilo de Respuesta</h4>
                            
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--color-gray-medium)', marginBottom: '8px' }}>Tono Base</label>
                                    <CustomSelect 
                                        value={toneStyle} 
                                        onChange={setToneStyle}
                                        options={[
                                            { value: 'Profesional', label: 'Profesional' },
                                            { value: 'Casual', label: 'Casual / Amigable' },
                                            { value: 'Directo', label: 'Directo / Conciso' },
                                            { value: 'Académico', label: 'Académico / Formal' },
                                            { value: 'Entusiasta', label: 'Entusiasta' }
                                        ]}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--color-gray-medium)', marginBottom: '8px' }}>Uso de Emojis</label>
                                    <CustomSelect 
                                        value={charEmojis} 
                                        onChange={setCharEmojis}
                                        options={[
                                            { value: 'Auto', label: 'Automático' },
                                            { value: 'Mínimo', label: 'Mínimo / Serio' },
                                            { value: 'Moderado', label: 'Moderado' },
                                            { value: 'Muchos', label: 'Muchos / Divertido' }
                                        ]}
                                    />
                                </div>
                            </div>
                        </div>

                         {/* Section: Custom Instructions */}
                         <div style={{ marginBottom: '24px' }}>
                            <h4 style={{ color: 'var(--color-white)', fontSize: '15px', marginBottom: '16px', fontWeight: 600 }}>Instrucciones Personalizadas (Prompt del Sistema)</h4>
                            <p style={{ fontSize: '12px', color: 'var(--color-gray-medium)', marginBottom: '12px' }}>Esto tendrá prioridad sobre otras configuraciones.</p>
                            <textarea
                                value={customInstructions} onChange={e => setCustomInstructions(e.target.value)}
                                style={{...inputStyle, height: '120px', resize: 'vertical'}}
                                placeholder="Ej: Siempre responde en listas con bullets. Nunca uses jerga técnica compleja..."
                            />
                        </div>
                        </>
                        )}

                    </div>

                    {/* Footer Actions */}
                    <div style={{ padding: '20px 32px', borderTop: '1px solid var(--border-modal)', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'var(--bg-modal)' }}>
                        <button 
                            onClick={onClose}
                            style={{ 
                                padding: '10px 20px', borderRadius: '8px', 
                                border: '1px solid var(--color-gray-medium)', 
                                background: 'transparent', 
                                color: 'var(--color-white)', 
                                cursor: 'pointer', fontSize: '13px', fontWeight: 500 
                            }}
                        >
                            Cancelar
                        </button>
                        <button 
                            onClick={handleSave}
                            disabled={loading}
                            style={{ 
                                padding: '10px 24px', borderRadius: '8px', border: 'none', 
                                background: 'var(--color-accent)', 
                                color: 'var(--color-on-accent, white)', /* FIXED: Ensure white text */
                                cursor: 'pointer', fontSize: '13px', fontWeight: 600, 
                                opacity: loading ? 0.7 : 1,
                                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                            }}
                        >
                            {loading ? 'Guardando...' : 'Guardar Cambios'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const inputStyle = {
    width: '100%',
    padding: '12px 14px',
    backgroundColor: 'var(--bg-dark-tertiary)', 
    border: '1px solid var(--border-modal)',
    borderRadius: '8px',
    color: 'var(--color-white)', 
    fontSize: '13px',
    outline: 'none',
    boxSizing: 'border-box' as const,
    transition: 'border-color 0.2s, box-shadow 0.2s'
};
