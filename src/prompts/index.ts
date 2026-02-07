/**
 * PROMPTS - BARREL FILE
 *
 * Archivo central de exportación para todos los prompts de Soflia Agent.
 * Importa desde aquí para mantener imports limpios.
 *
 * Estructura:
 * - computer-use.ts: Prompts para control del navegador
 * - chat.ts: Prompts para conversación y research
 * - prompt-optimizer.ts: Optimizadores para diferentes LLMs
 * - security.ts: Prompts y utilidades de seguridad
 * - utils.ts: Templates cortos y helpers
 * - training-cases.ts: Casos de entrenamiento para Computer Use
 */

// ============================================
// WEB AGENT (browser control via function calling)
// ============================================
export {
  WEB_AGENT_SYSTEM_PROMPT,
  WEB_AGENT_TOOLS,
  needsWebAgent
} from './computer-use';

// ============================================
// CHAT & RESEARCH
// ============================================
export {
  PRIMARY_CHAT_PROMPT,
  DEEP_RESEARCH_PROMPT,
  buildPrimaryChatPrompt,
  CONVERSATION_MODES,
  type ConversationMode
} from './chat';

// ============================================
// PROMPT OPTIMIZER
// ============================================
export {
  CHATGPT_OPTIMIZER,
  CLAUDE_OPTIMIZER,
  GEMINI_OPTIMIZER,
  PROMPT_OPTIMIZER,
  buildOptimizationPrompt,
  type OptimizerTarget
} from './prompt-optimizer';

// ============================================
// SECURITY
// ============================================
export {
  SECURITY_SYSTEM_PROMPT,
  ANTI_JAILBREAK_PROMPT,
  URL_VALIDATION_PROMPT,
  SAFE_TRANSACTION_PROMPT,
  PRIVACY_PROMPT,
  FULL_SECURITY_PROMPT,
  SENSITIVE_DOMAINS,
  isSensitiveDomain,
  PHISHING_PATTERNS,
  detectPhishing,
  ACTIONS_REQUIRING_CONFIRMATION,
  requiresConfirmation
} from './security';

// ============================================
// UTILITIES
// ============================================
export {
  AUDIO_TRANSCRIPTION_PROMPT,
  IMAGE_GENERATION_BASE_PROMPT,
  getImageGenerationPrompt,
  SUMMARY_PROMPTS,
  TRANSLATION_PROMPTS,
  ANALYSIS_PROMPTS,
  WRITING_PROMPTS,
  EMAIL_PROMPTS,
  CODE_PROMPTS,
  FORMAT_INSTRUCTIONS,
  combinePrompts,
  withContext,
  withOutputFormat
} from './utils';

// ============================================
// TRAINING CASES
// ============================================
export {
  TRAINING_CASES,
  CATEGORIES,
  getCasesByCategory,
  getRandomExamples,
  generateExamplesForPrompt,
  getStats
} from './training-cases';
