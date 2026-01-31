
export const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || '';

// Lia Extension Supabase (datos locales: conversaciones, meetings, etc.)
export const SUPABASE = {
  URL: import.meta.env.VITE_SUPABASE_URL || '',
  ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY || ''
};

// SOFIA Supabase (autenticación principal + datos de organizaciones/equipos)
export const SOFIA_SUPABASE = {
  URL: import.meta.env.VITE_SOFIA_SUPABASE_URL || '',
  ANON_KEY: import.meta.env.VITE_SOFIA_SUPABASE_ANON_KEY || ''
};

// Content Generator Supabase
export const CONTENT_GEN_SUPABASE = {
  URL: import.meta.env.VITE_CONTENT_GEN_SUPABASE_URL || '',
  ANON_KEY: import.meta.env.VITE_CONTENT_GEN_SUPABASE_ANON_KEY || ''
};

// Model Configurations
export const MODELS = {
  PRIMARY: "gemini-3-flash-preview",  // Gemini 3 Flash (free tier disponible)
  FALLBACK: "gemini-2.5-flash",  // Fallback estable (no preview, amplia disponibilidad)
  COMPUTER_USE: "gemini-3-flash-preview",  // Mismo que PRIMARY; usa prompts custom [ACTION:...], no API nativa Computer Use
  IMAGE_GENERATION: "gemini-2.5-flash-image",
  DEEP_RESEARCH: "deep-research-pro-preview-12-2025",
  LIVE: "gemini-2.5-flash-native-audio-latest",  // Live API model - latest version
  PRO: "gemini-3-pro-preview", // High reasoning model for Prompt Engineering
  MAPS: "gemini-2.5-flash", // Maps Grounding NO disponible en Gemini 3, usar 2.5
};

// Live API URL - Using v1beta which supports the Live API models
export const LIVE_API_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
