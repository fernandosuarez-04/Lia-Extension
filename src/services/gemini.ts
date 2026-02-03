
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GOOGLE_API_KEY, MODELS } from "../config";
import {
  buildComputerUsePrompt,
  buildPrimaryChatPrompt,
  PRIMARY_CHAT_PROMPT,
  PROMPT_OPTIMIZER,
  AUDIO_TRANSCRIPTION_PROMPT,
  getImageGenerationPrompt,
  needsComputerUse
} from "../prompts";
import { getApiKeyWithCache } from "./api-keys";

// Lazy initialization for GoogleGenerativeAI
// This allows us to fetch the API key from database when needed
let genAI: GoogleGenerativeAI | null = null;
let currentApiKey: string | null = null;

/**
 * Gets or creates a GoogleGenerativeAI instance with the current API key
 * Fetches from database (with cache) if available, falls back to env variable
 */
async function getGenAI(): Promise<GoogleGenerativeAI> {
  try {
    // Try to get API key from database (user's key or system default)
    const dbApiKey = await getApiKeyWithCache('google');

    if (dbApiKey) {
      // If we have a new key or no instance yet, create/recreate
      if (!genAI || currentApiKey !== dbApiKey) {
        genAI = new GoogleGenerativeAI(dbApiKey);
        currentApiKey = dbApiKey;
        console.log('🔑 Using API key from database');
      }
      return genAI;
    }
  } catch (error) {
    console.warn('Could not fetch API key from database, using fallback:', error);
  }

  // Fallback to environment variable
  if (!genAI || currentApiKey !== GOOGLE_API_KEY) {
    if (!GOOGLE_API_KEY) {
      throw new Error('No API key available. Please configure your Google API key in settings.');
    }
    genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
    currentApiKey = GOOGLE_API_KEY;
    console.log('🔑 Using API key from environment');
  }

  return genAI;
}

// Gemini 3 no soporta googleSearch + functionDeclarations juntos (error 400)
// Solo Google Search como tool para los modelos primario y deep research
const searchTools: any[] = [
  { googleSearch: {} },
];

// Model getter functions (lazy initialization)
async function getPrimaryModel() {
  const ai = await getGenAI();
  return ai.getGenerativeModel({
    model: MODELS.PRIMARY,
    tools: searchTools,
  });
}

async function getComputerUseModel() {
  const ai = await getGenAI();
  return ai.getGenerativeModel({
    model: MODELS.COMPUTER_USE,
  });
}

async function getImageGenerationModel() {
  const ai = await getGenAI();
  return ai.getGenerativeModel({
    model: MODELS.IMAGE_GENERATION,
  });
}

async function getProModel() {
  const ai = await getGenAI();
  return ai.getGenerativeModel({
    model: (MODELS as any).PRO || "gemini-2.5-pro",
  });
}

let chatSession: any = null;

// Deep Research Function - Uses official @google/genai SDK for Interactions API
// Documentation: https://ai.google.dev/gemini-api/docs/deep-research
// Deep Research analyzes up to 100+ sources and takes 2-15 minutes to complete
export const runDeepResearch = async (prompt: string) => {
  try {
    console.log("🔬 Starting Deep Research with prompt:", prompt);
    console.log("📚 Agent:", MODELS.DEEP_RESEARCH);

    // Get API key from database or fallback to env
    let apiKey = await getApiKeyWithCache('google');
    if (!apiKey) {
      apiKey = GOOGLE_API_KEY;
    }
    if (!apiKey) {
      throw new Error('No API key available for Deep Research');
    }

    // Import the new Google GenAI SDK (required for Interactions API)
    const { GoogleGenAI } = await import('@google/genai');
    const client = new GoogleGenAI({ apiKey });

    // Step 1: Create the research interaction
    console.log("📤 Creating interaction...");
    const interaction = await client.interactions.create({
      agent: MODELS.DEEP_RESEARCH as 'deep-research-pro-preview-12-2025',
      input: prompt,
      background: true // Required for async execution
    });

    // Get interaction ID - can be in 'name' or 'id' field
    const interactionId = (interaction as any).name || (interaction as any).id;
    if (!interactionId) {
      console.log("Full interaction response:", JSON.stringify(interaction, null, 2));
      throw new Error("No interaction ID received from API");
    }
    console.log("✅ Deep Research interaction created:", interactionId);

    // Step 2: Poll for results - Deep Research takes 2-15 minutes
    async function* pollForResults(): AsyncGenerator<{ text: () => string }> {
      let isComplete = false;
      let pollCount = 0;
      const POLL_INTERVAL_MS = 15000; // 15 seconds between polls
      const MAX_POLLS = 60; // 60 polls * 15 seconds = 15 minutes max

      // Initial status message
      yield { text: () => "# 🔬 Investigación Profunda Iniciada\n\n" };
      yield { text: () => "Lia está analizando múltiples fuentes web para darte una respuesta completa y fundamentada.\n\n" };
      yield { text: () => "⏱️ **Tiempo estimado:** 2-10 minutos\n\n---\n\n" };

      while (!isComplete && pollCount < MAX_POLLS) {
        pollCount++;

        // Wait before polling
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

        const elapsedMinutes = Math.floor((pollCount * 15) / 60);
        const elapsedSeconds = (pollCount * 15) % 60;

        try {
          // Poll using the SDK - get(id, params)
          const result = await client.interactions.get(interactionId) as any;

          const status = result.status || (result.done ? "COMPLETED" : "IN_PROGRESS");
          console.log(`🔄 Poll #${pollCount} (${elapsedMinutes}m ${elapsedSeconds}s): Status = ${status}`);

          // Show progress
          yield { text: () => `🔍 **Investigando...** (${elapsedMinutes}m ${elapsedSeconds}s)\n` };

          // Check for completion
          if (status === "COMPLETED" || status === "completed" || result.done === true) {
            isComplete = true;
            console.log("✅ Research completed!");
            console.log("Full result:", JSON.stringify(result, null, 2).substring(0, 1000));

            // Extract final response - try multiple formats
            let finalText = "";

            // Format 1: outputs array (Interactions API standard)
            if (result.outputs && Array.isArray(result.outputs)) {
              const lastOutput = result.outputs[result.outputs.length - 1];
              if (lastOutput?.text) {
                finalText = lastOutput.text;
              } else if (typeof lastOutput === 'string') {
                finalText = lastOutput;
              }
            }

            // Format 2: modelContent.parts
            if (!finalText && result.modelContent?.parts) {
              for (const part of result.modelContent.parts) {
                if (part.text) finalText += part.text;
              }
            }

            // Format 3: content.parts
            if (!finalText && result.content?.parts) {
              for (const part of result.content.parts) {
                if (part.text) finalText += part.text;
              }
            }

            // Format 4: Direct text field
            if (!finalText && result.text) {
              finalText = result.text;
            }

            if (finalText) {
              yield { text: () => "\n\n---\n\n# 📋 Resultado de la Investigación\n\n" };
              yield { text: () => finalText };
            } else {
              yield { text: () => "\n\n⚠️ La investigación terminó pero no se obtuvo contenido.\n" };
              console.log("Full response:", JSON.stringify(result, null, 2));
            }
          }

          // Check for failure
          if (status === "FAILED" || status === "failed" || status === "CANCELLED" || status === "cancelled") {
            isComplete = true;
            const errorMsg = result.error?.message || result.error || "Error desconocido";
            yield { text: () => `\n\n❌ **La investigación falló:** ${errorMsg}\n` };
          }

        } catch (pollError: any) {
          console.error(`❌ Poll #${pollCount} error:`, pollError);
          // Continue polling unless it's a fatal error
          if (pollError.message?.includes('not found') || pollError.message?.includes('404')) {
            yield { text: () => `\n\n❌ **Error:** La investigación no se encontró.\n` };
            isComplete = true;
          }
        }
      }

      if (!isComplete) {
        yield { text: () => "\n\n⚠️ La investigación está tomando más de 15 minutos. Por favor intenta con una consulta más específica.\n" };
      }
    }

    return {
      stream: pollForResults(),
      getGroundingMetadata: async () => null
    };

  } catch (error: any) {
    console.error("❌ Deep Research error:", error);

    // If SDK doesn't support interactions, fall back to enhanced search
    if (error.message?.includes('interactions') || error.message?.includes('not a function') || error.message?.includes('not supported')) {
      console.log("⚠️ Interactions API not available, falling back to enhanced search...");
      return runEnhancedResearch(prompt);
    }

    throw error;
  }
};

// Fallback: Enhanced Research using regular Gemini with Google Search grounding
async function runEnhancedResearch(prompt: string) {
  console.log("🔄 Using enhanced search fallback...");

  const researchPrompt = `Realiza una investigación exhaustiva sobre el siguiente tema.
Busca información en múltiples fuentes web y proporciona:

1. **Resumen Ejecutivo** - Puntos clave en 2-3 párrafos
2. **Análisis Detallado** - Información profunda del tema
3. **Datos y Estadísticas** - Números y hechos relevantes
4. **Diferentes Perspectivas** - Puntos de vista variados si aplica
5. **Conclusiones** - Síntesis final

TEMA A INVESTIGAR:
${prompt}

Responde de forma estructurada y completa, citando fuentes cuando sea posible.`;

  const localSearchTools: any[] = [{ googleSearch: {} }];
  const ai = await getGenAI();
  const researchModel = ai.getGenerativeModel({
    model: MODELS.FALLBACK,
    tools: localSearchTools,
  });

  const result = await researchModel.generateContentStream(researchPrompt);

  return {
    stream: (async function* () {
      yield { text: () => "# 🔍 Investigación en Progreso\n\n" };
      yield { text: () => "_Usando búsqueda avanzada con Google Search..._\n\n---\n\n" };

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          yield { text: () => text };
        }
      }
    })(),
    getGroundingMetadata: async () => {
      try {
        const response = await result.response;
        return response.candidates?.[0]?.groundingMetadata || null;
      } catch {
        return null;
      }
    }
  };
}



// Image Generation Function
export const generateImage = async (prompt: string): Promise<{ text: string; imageData?: string }> => {
  try {
    console.log("Generating image with prompt:", prompt);

    const enhancedPrompt = getImageGenerationPrompt(prompt);
    const imageModel = await getImageGenerationModel();

    // Use generateContent with responseModalities in the request
    const result = await (imageModel as any).generateContent({
      contents: [{ role: "user", parts: [{ text: enhancedPrompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    });
    
    const response = result.response;
    const candidate = response.candidates?.[0];
    
    let textResponse = '';
    let imageData: string | undefined;
    
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.text) {
          textResponse += part.text;
        }
        if (part.inlineData) {
          // Image data is base64 encoded
          const mimeType = part.inlineData.mimeType || 'image/png';
          imageData = `data:${mimeType};base64,${part.inlineData.data}`;
        }
      }
    }
    
    return { 
      text: textResponse || '¡Aquí está tu imagen generada!', 
      imageData 
    };
  } catch (error) {
    console.error("Image generation error:", error);
    throw error;
  }
};

export const startChatSession = async (history: any[] = []) => {
  const model = await getPrimaryModel();
  chatSession = model.startChat({
    history: history,
    generationConfig: {
      maxOutputTokens: 16384,
    },
  });
  return chatSession;
};

// Thinking config types
// Gemini 3: uses thinkingLevel ("minimal", "low", "medium", "high")
// Gemini 2.5: uses thinkingBudget (0 to 24576 tokens, or -1 for dynamic)
export interface ThinkingConfig {
  mode: 'off' | 'minimal' | 'low' | 'medium' | 'high';
  type: 'level' | 'budget'; // Gemini 3 uses 'level', Gemini 2.5 uses 'budget'
}

// Budget values for Gemini 2.5 (0 = off for Flash, 128-24576 range)
const THINKING_BUDGETS: Record<string, number> = {
  off: 0,
  minimal: 0,
  low: 1024,
  medium: 8192,
  high: 24576
};

// ============================================
// DEEP ANALYSIS DETECTION AND BOOST
// ============================================
const DEEP_ANALYSIS_TRIGGERS = [
  'analiza profundamente', 'analiza a fondo', 'análisis profundo', 'análisis detallado',
  'analizar profundamente', 'analizar a fondo', 'análisis exhaustivo', 'analiza completamente',
  'análisis completo', 'profundiza', 'explica a fondo', 'explica en detalle',
  'explicación detallada', 'quiero todos los detalles', 'dime todo sobre', 'cuéntame todo',
  'análisis extenso', 'deep analysis', 'full analysis', 'dame un análisis completo',
  'analiza la pagina', 'analiza la página', 'analiza esta pagina', 'analiza esta página'
];

const needsDeepAnalysis = (message: string): boolean => {
  const lowerMessage = message.toLowerCase();
  return DEEP_ANALYSIS_TRIGGERS.some(trigger => lowerMessage.includes(trigger));
};

// Prompt COMPLETAMENTE SEPARADO para análisis profundo
const DEEP_ANALYSIS_ONLY_PROMPT = `Eres Lia, una analista de contenido. Tu tarea es analizar el CONTENIDO INTELECTUAL de la página.

═══════════════════════════════════════════════════════════════════
🚫 PROHIBICIONES ABSOLUTAS - NUNCA HAGAS ESTO:
═══════════════════════════════════════════════════════════════════

NUNCA menciones ni analices:
- "Elementos de la Interfaz" o "Interfaz de Usuario"
- "Modelo Utilizado" o qué versión de ChatGPT/IA se usa
- "Barra Lateral" o contenido del sidebar
- "Historial de chats" o proyectos listados
- "Campo de texto", "botones", o elementos interactivos
- "Estado del navegador" o "Estado actual de la página"
- CUALQUIER cosa sobre la UI, DOM, o estructura técnica de la página

NUNCA crees secciones como:
- "Elementos de la Interfaz"
- "Estructura de la Página" (en sentido técnico/UI)
- "Herramientas Observadas"
- "Modelo en Uso"

═══════════════════════════════════════════════════════════════════
✅ ANALIZA ÚNICAMENTE EL CONTENIDO INTELECTUAL:
═══════════════════════════════════════════════════════════════════

- Las IDEAS y CONCEPTOS que se discuten
- Las ESTRATEGIAS y METODOLOGÍAS propuestas
- Los ARGUMENTOS y su justificación
- Los FRAMEWORKS o modelos conceptuales (como "Alex Hormozi Style", "Ecuación de Valor")
- Las PROPUESTAS concretas y recomendaciones
- Los BENEFICIOS y resultados esperados
- Los PÚBLICOS OBJETIVO mencionados en el contenido
- Las ACCIONES sugeridas dentro de la discusión

═══════════════════════════════════════════════════════════════════

REQUISITO: Tu respuesta debe tener MÍNIMO 3000 palabras analizando el CONTENIDO, no la interfaz.

FORMATO OBLIGATORIO - USA EXACTAMENTE ESTA ESTRUCTURA:

## 📋 RESUMEN EJECUTIVO
[Escribe MÍNIMO 200 palabras sobre el tema central, propósito y relevancia del CONTENIDO discutido]

## 🎯 TEMA CENTRAL Y CONTEXTO
### Tema Principal
[Párrafo de 100+ palabras describiendo el tema central]
### Contexto del Contenido
[Dónde se enmarca, es parte de qué proyecto o conversación]
### Origen y Autoría
[Quién lo creó, cuándo, con qué propósito]
### Propósito Identificado
[Qué intenta lograr el contenido]

## 🔍 DESGLOSE DETALLADO DEL CONTENIDO
[Crea UNA SUBSECCIÓN ### para CADA concepto importante. Mínimo 8-10 subsecciones]

### [Concepto/Tema 1]
- **Descripción completa**: [50+ palabras]
- **Rol en el contexto**: [Por qué importa]
- **Detalles técnicos**: [Especificaciones si las hay]
- **Implicaciones prácticas**: [Qué significa en la práctica]
- **Conexiones**: [Cómo se relaciona con otros elementos]

### [Concepto/Tema 2]
[Repite la misma estructura]

[...continúa con TODOS los conceptos...]

## 🏗️ ARQUITECTURA Y ESTRUCTURA
[Mínimo 150 palabras sobre cómo está organizado el contenido]

## 💡 IDEAS CLAVE Y PROPUESTAS
[Lista numerada con TODAS las ideas. Cada una con 50+ palabras de explicación]
1. **[Idea]**: [Explicación extensa]
2. ...

## 🔧 ASPECTOS TÉCNICOS (USA TABLA OBLIGATORIAMENTE)
| Tecnología/Herramienta | Descripción | Función/Rol | Beneficio |
|------------------------|-------------|-------------|-----------|
| [Nombre] | [Qué es] | [Para qué sirve] | [Qué aporta] |
| ... | ... | ... | ... |

## 📊 DATOS Y EVIDENCIAS
| Dato/Métrica | Valor | Contexto | Significado |
|--------------|-------|----------|-------------|
| [Nombre del dato] | [Valor] | [Dónde se menciona] | [Qué implica] |

## 👥 STAKEHOLDERS (USA TABLA OBLIGATORIAMENTE)
| Actor/Rol | Descripción | Interés | Responsabilidad |
|-----------|-------------|---------|-----------------|
| [Nombre/Rol] | [Quién es] | [Qué busca] | [Qué hace] |
| ... | ... | ... | ... |

## ⚡ ACCIONES IDENTIFICADAS (USA CHECKLIST)
- [ ] **[Acción 1]**: [Descripción detallada y contexto]
- [ ] **[Acción 2]**: [Descripción detallada y contexto]
- [ ] **[Acción 3]**: [Descripción detallada y contexto]

## 🔗 CONEXIONES Y RELACIONES
[Muestra las relaciones entre conceptos usando flechas y texto:]
Concepto A → Concepto B → Resultado
          ↓
     Concepto C

## 💭 ANÁLISIS CRÍTICO
### Fortalezas
[Lista con explicaciones]
### Áreas de Mejora
[Lista con explicaciones]
### Riesgos
[Lista con explicaciones]

## 📝 CONCLUSIÓN INTEGRAL
[MÍNIMO 250 palabras sintetizando todo, implicaciones y recomendaciones]

---
═══════════════════════════════════════════════════════════════════
REGLAS CRÍTICAS PARA FORMATO VISUAL:
═══════════════════════════════════════════════════════════════════
1. TABLAS SON OBLIGATORIAS en: Aspectos Técnicos, Stakeholders, Datos
2. USA CHECKLIST (- [ ]) para acciones y tareas
3. USA DIAGRAMAS ASCII para mostrar relaciones y flujos
4. Cada sección debe tener contenido EXTENSO, no solo bullets
5. NUNCA termines preguntando si quiero más detalles
6. USA negritas **así** para términos importantes
7. USA código \`así\` para términos técnicos
8. Responde SIEMPRE en español
═══════════════════════════════════════════════════════════════════`;

export async function sendMessageStream(
  message: string,
  context?: string,
  modelOverrides?: { primary?: string; fallback?: string },
  personalization?: {
    nickname?: string;
    occupation?: string;
    tone?: string;
    about?: string;
    instructions?: string;
  },
  projectContext?: string,
  thinkingConfig?: ThinkingConfig
) {
  // Determine IDs
  const primaryId = modelOverrides?.primary || MODELS.PRIMARY;
  const fallbackId = modelOverrides?.fallback || MODELS.FALLBACK;

  // Detect Computer Use
  const useComputerUse = needsComputerUse(message);

  // Decide active model
  const activeModelId = useComputerUse ? MODELS.COMPUTER_USE : primaryId;

  // Detect if user wants deep analysis
  // Log the message for debugging
  console.log('🔎 Message received:', message.substring(0, 200) + '...');
  console.log('🔎 Checking for deep analysis triggers...');

  const isDeepAnalysis = needsDeepAnalysis(message);

  console.log('🔎 Deep analysis detected:', isDeepAnalysis);

  if (isDeepAnalysis) {
    console.log('🔍 DEEP ANALYSIS MODE ACTIVATED - Using DEEP_ANALYSIS_ONLY_PROMPT');
  } else {
    console.log('📝 Normal mode - Using PRIMARY_CHAT_PROMPT');
  }

  // Build Personalized System Instruction
  // IMPORTANT: For deep analysis, put the boost FIRST (LLMs prioritize earlier instructions)
  let systemInstruction: string;

  if (isDeepAnalysis && !useComputerUse) {
    // Deep analysis: use ONLY the deep analysis prompt (it's self-contained)
    // Don't append PRIMARY_CHAT_PROMPT to avoid conflicting instructions
    systemInstruction = DEEP_ANALYSIS_ONLY_PROMPT;
    console.log('✅ System instruction set to: DEEP_ANALYSIS_ONLY_PROMPT');
    console.log('📏 Prompt length:', systemInstruction.length, 'chars');
  } else {
    systemInstruction = PRIMARY_CHAT_PROMPT;
    console.log('📝 System instruction set to: PRIMARY_CHAT_PROMPT');
  }

  if (!useComputerUse && personalization) {
      let personality = "\n\n=== USER PERSONALIZATION SETTINGS ===\n";
      if (personalization.nickname) personality += `User's Name/Nickname: "${personalization.nickname}". Address them by this name occasionally.\n`;
      if (personalization.occupation) personality += `User's Occuption/Role: ${personalization.occupation}. Adapt analogies and complexity to this role.\n`;
      if (personalization.tone) personality += `Response Tone/Style: ${personalization.tone}.\n`;
      if (personalization.about) personality += `More about User: ${personalization.about}\n`;
      if (personalization.instructions) personality += `CUSTOM INSTRUCTIONS (PRIORITY): ${personalization.instructions}\n`;
      personality += "=====================================\n";

      systemInstruction = systemInstruction + personality;
  }

  // Inject Project Context if available
  if (projectContext) {
      systemInstruction += `\n\n=== PROJECT CONTEXT (SHARED KNOWLEDGE) ===\nThe user has grouped this chat in a project folder. Here is relevant context from other chats in the same project:\n\n${projectContext}\n\nUse this information to provide more cohesive and context-aware responses across the project.\n==========================================\n`;
  }

  // Build generation config with thinking settings
  const generationConfig: any = { maxOutputTokens: 16384 };

  // Apply thinking config if provided
  if (thinkingConfig) {
    if (thinkingConfig.type === 'level') {
      // Gemini 3 models use thinkingLevel: "minimal", "low", "medium", "high"
      // "minimal" = fastest, "high" = deepest reasoning
      const validLevels = ['minimal', 'low', 'medium', 'high'];
      const level = validLevels.includes(thinkingConfig.mode) ? thinkingConfig.mode : 'minimal';
      generationConfig.thinkingConfig = {
        thinkingLevel: level
      };
      console.log('Thinking Level:', level);
    } else {
      // Gemini 2.5 models use thinkingBudget (token count: 0-24576, or -1 for dynamic)
      const budget = THINKING_BUDGETS[thinkingConfig.mode] ?? 0;
      // Only set thinkingConfig if budget > 0 (0 means no thinking)
      if (budget > 0) {
        generationConfig.thinkingConfig = {
          thinkingBudget: budget
        };
        console.log('Thinking Budget:', budget);
      } else {
        console.log('Thinking: Off (budget = 0)');
      }
    }
  }

  // Initialize specific model instance dynamically
  const ai = await getGenAI();
  const activeModelInstance = useComputerUse
    ? await getComputerUseModel()
    : ai.getGenerativeModel({
        model: activeModelId,
        tools: searchTools, // Assuming primary/chosen model supports search
        systemInstruction: systemInstruction
      });

  console.log('=== GEMINI SERVICE ===');
  console.log('Model:', activeModelId);
  console.log('Deep Analysis Mode:', isDeepAnalysis);
  console.log('System Instruction Preview:', systemInstruction.substring(0, 100) + '...');
  console.log('Personalization:', !!personalization);
  console.log('Thinking Config:', thinkingConfig);

  // Handle Session Logic - ALWAYS refresh session to apply system prompt updates or model changes
  let currentHistory: any[] = [];
  if (chatSession) {
    try { currentHistory = await chatSession.getHistory(); } catch {}
  }

  // Start fresh session with history to ensure new System Prompt applies
  chatSession = activeModelInstance.startChat({
     history: currentHistory,
     generationConfig
  });

  // Build Prompt
  let prompt = message;
  if (context) {
    prompt = useComputerUse 
      ? buildComputerUsePrompt(context, message) 
      : buildPrimaryChatPrompt(context, message);
  }

  try {
    try {
      const result = await chatSession.sendMessageStream(prompt);
      return {
        stream: result.stream,
        response: result.response,
        getGroundingMetadata: async () => {
             try {
                const r = await result.response;
                return r.candidates?.[0]?.groundingMetadata || null;
             } catch { return null; }
        }
      };
    } catch (primaryError) {
      console.warn(`Primary model (${activeModelId}) failed, trying fallback (${fallbackId})...`, primaryError);

      if (useComputerUse) throw primaryError; // No fallback for computer use

      const history = await chatSession.getHistory();
      const fallbackInstance = ai.getGenerativeModel({
        model: fallbackId,
        systemInstruction: systemInstruction
      });

      const fallbackChat = fallbackInstance.startChat({
        history,
        generationConfig // Apply same generation config (maxOutputTokens, thinking, etc)
      });
      chatSession = fallbackChat; // Update global session

      const result = await fallbackChat.sendMessageStream(prompt);
      return {
        stream: result.stream,
        response: result.response,
        getGroundingMetadata: async () => {
             try {
                const r = await result.response;
                return r.candidates?.[0]?.groundingMetadata || null;
             } catch { return null; }
        }
      };
    }
  } catch (finalError) {
    console.error("All models failed:", finalError);
    throw finalError;
  }
};

// Type for grounding metadata
export interface GroundingSource {
  uri: string;
  title: string;
}

export interface GroundingMetadata {
  searchEntryPoint?: {
    renderedContent: string;
  };
  groundingChunks?: Array<{
    web?: {
      uri: string;
      title: string;
    };
  }>;
  webSearchQueries?: string[];
}

// Types for Maps Grounding
export interface MapPlace {
  placeId?: string;
  name: string;
  location?: { lat: number; lng: number };
  address?: string;
  rating?: number;
  uri?: string;
}

export interface MapsGroundingMetadata {
  groundingChunks?: Array<{
    web?: {
      uri: string;
      title: string;
    };
    retrievedContext?: {
      uri: string;
      title: string;
    };
  }>;
  groundingSupports?: Array<{
    segment: {
      startIndex: number;
      endIndex: number;
      text: string;
    };
    groundingChunkIndices: number[];
  }>;
  googleMapsWidgetContextToken?: string;
}

// Maps Grounding Function
export const runMapsQuery = async (
  prompt: string,
  location: { latitude: number; longitude: number }
): Promise<{
  text: string;
  places: MapPlace[];
  widgetToken?: string;
}> => {
  try {
    console.log("Starting Maps Query with prompt:", prompt);
    console.log("Location:", location);

    // Crear modelo con Maps Grounding
    // Usamos gemini-2.0-flash para mejor soporte de JSON + Tools
    const ai = await getGenAI();
    const mapsModel = ai.getGenerativeModel({
      model: "gemini-2.5-flash",
    });

    // Construir prompt para JSON
    const jsonPrompt = `
      Actúa como un asistente de local y guía turística.
      El usuario está en: Lat ${location.latitude}, Lng ${location.longitude}.
      Búsqueda: "${prompt}".

      Usa la herramienta Google Maps para encontrar lugares reales y relevantes cercanos.
      
      IMPORTANTE: Debes responder EXCLUSIVAMENTE con un objeto JSON válido (sin markdown, sin texto extra) con la siguiente estructura:
      {
        "summary": "Un breve resumen texto de 1 o 2 frases sobre lo encontrado",
        "places": [
          {
            "name": "Nombre del lugar",
            "location": { "lat": 0.0, "lng": 0.0 }, // Coordenadas aproximadas
            "address": "Dirección corta",
            "rating": 4.5,
            "description": "Breve razón de por qué es bueno",
            "uri": "URL de Google Maps si está disponible o link de búsqueda"
          }
        ]
      }
    `;

    // Usar generateContent
    // NOTA: No podemos usar responseMimeType: "application/json" junto con tools (Search/Maps) en la misma request actualmente.
    // Dependemos del prompt para obtener JSON.
    const result = await (mapsModel as any).generateContent({
      contents: [{
        role: "user",
        parts: [{ text: jsonPrompt }]
      }],
      tools: [{ googleMaps: {} }]
    });

    const response = result.response;
    const textData = response.text();
    console.log("Maps JSON Response:", textData);

    let parsedData: { summary: string; places: any[] } = { summary: '', places: [] };
    
    try {
        parsedData = JSON.parse(textData);
    } catch (e) {
        console.error("Error parsing Maps JSON:", e);
        // Fallback simple parsing if model adds markdown blocks
        const match = textData.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                parsedData = JSON.parse(match[0]);
            } catch (e2) {
                return { text: "No pude procesar los resultados del mapa.", places: [] };
            }
        } else {
             return { text: "Hubo un error interpretando los datos del mapa.", places: [] };
        }
    }

    const places: MapPlace[] = parsedData.places.map((p: any) => ({
        name: p.name,
        location: p.location, // { lat, lng }
        address: p.address,
        rating: p.rating,
        uri: p.uri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`
    }));

    return {
      text: parsedData.summary || `Encontré ${places.length} lugares cercanos.`,
      places,
      widgetToken: undefined 
    };

  } catch (error) {
    console.error("Maps Query error:", error);
    throw error;
  }
};

// Keywords para detectar consultas de Maps/Ubicación
export const MAPS_KEYWORDS = [
  // Búsqueda de lugares
  'cerca', 'cercano', 'cercana', 'cercanos', 'cercanas',
  'donde hay', 'dónde hay', 'donde encuentro', 'dónde encuentro',
  'donde queda', 'dónde queda', 'donde está', 'dónde está',
  // Tipos de lugares
  'restaurante', 'restaurantes', 'cafe', 'café', 'cafetería', 'cafeterias',
  'tienda', 'tiendas', 'supermercado', 'supermercados',
  'farmacia', 'farmacias', 'hospital', 'hospitales', 'clínica', 'clinica',
  'banco', 'bancos', 'cajero', 'cajeros', 'atm',
  'gasolinera', 'gasolineras', 'estación de servicio',
  'estacionamiento', 'parking', 'parqueo',
  'hotel', 'hoteles', 'hostal', 'hospedaje',
  'gimnasio', 'gimnasios', 'gym',
  'parque', 'parques', 'plaza', 'plazas',
  'cine', 'cines', 'teatro', 'teatros',
  'bar', 'bares', 'antro', 'club', 'discoteca',
  // Servicios
  'mecánico', 'mecanico', 'taller', 'talleres',
  'veterinaria', 'veterinario', 'pet shop',
  'barbería', 'barberia', 'peluquería', 'peluqueria', 'salón', 'salon',
  'dentista', 'doctor', 'médico', 'medico',
  // Comida específica
  'pizza', 'pizzería', 'pizzeria', 'hamburguesa', 'hamburguesas',
  'tacos', 'taquería', 'taqueria', 'sushi', 'comida china', 'comida japonesa',
  'comida italiana', 'comida mexicana', 'mariscos',
  // Acciones de ubicación
  'llegar a', 'cómo llego', 'como llego', 'ruta a', 'ruta hacia',
  'direcciones a', 'indicaciones a', 'camino a',
  // Distancia/tiempo
  'minutos caminando', 'minutos en carro', 'minutos en auto',
  'a pie', 'caminando', 'en bicicleta', 'en coche', 'en carro',
  // Preguntas de ubicación
  'qué hay cerca', 'que hay cerca', 'lugares cerca', 'sitios cerca',
  'recomendaciones cerca', 'opciones cerca'
];

// Detectar si necesita Maps Grounding
export const needsMapsGrounding = (prompt: string): boolean => {
  const lowerPrompt = prompt.toLowerCase();
  return MAPS_KEYWORDS.some(keyword => lowerPrompt.includes(keyword));
};

export const optimizePrompt = async (originalPrompt: string, targetAI: 'chatgpt' | 'claude' | 'gemini'): Promise<string> => {
  const systemInstruction = PROMPT_OPTIMIZER[targetAI];

  try {
    const proModel = await getProModel();
    const result = await proModel.generateContent({
      contents: [
        { role: "user", parts: [{ text: `${systemInstruction}\n\nPROMPT ORIGINAL (A optimizar):\n"${originalPrompt}"\n\nGenera SOLAMENTE el prompt optimizado final:` }] }
      ]
    });

    return result.response.text();
  } catch (error) {
    console.error("Error optimizing prompt:", error);
    throw error;
  }
};

export const transcribeAudio = async (base64Audio: string): Promise<string> => {
  try {
    // Usamos el modelo primario que debe ser capaz de multimodalidad (Gemini 1.5/2.0 Flash)
    const primaryModel = await getPrimaryModel();
    const result = await primaryModel.generateContent({
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType: "audio/webm", data: base64Audio } },
          { text: AUDIO_TRANSCRIPTION_PROMPT }
        ]
      }]
    });
    return result.response.text();
  } catch (error) {
    console.error("Audio transcription error:", error);
    throw error;
  }
};
