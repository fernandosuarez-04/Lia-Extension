
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GOOGLE_API_KEY, MODELS } from "../config";
import {
  buildComputerUsePrompt,
  buildPrimaryChatPrompt,
  PRIMARY_CHAT_PROMPT,
  DEEP_RESEARCH_PROMPT,
  PROMPT_OPTIMIZER,
  AUDIO_TRANSCRIPTION_PROMPT,
  getImageGenerationPrompt,
  needsComputerUse
} from "../prompts";

const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

// Gemini 3 no soporta googleSearch + functionDeclarations juntos (error 400)
// Solo Google Search como tool para los modelos primario y deep research
const searchTools: any[] = [
  { googleSearch: {} },
];


// Model Instances
const primaryModel = genAI.getGenerativeModel({
  model: MODELS.PRIMARY,
  tools: searchTools,
});

// Computer Use Model - para acciones en página (sin Google Search para evitar conflictos)
const computerUseModel = genAI.getGenerativeModel({
  model: MODELS.COMPUTER_USE,
});


// Image Generation Model - just get the model without special config
const imageGenerationModel = genAI.getGenerativeModel({ 
  model: MODELS.IMAGE_GENERATION,
});

// Deep Research Model
const deepResearchModel = genAI.getGenerativeModel({
  model: MODELS.DEEP_RESEARCH,
  tools: searchTools,
});

// PRO Model for Prompt Engineering
const proModel = genAI.getGenerativeModel({
  model: (MODELS as any).PRO || "gemini-2.5-pro",
});

let chatSession: any = null;

// Deep Research Function
export const runDeepResearch = async (prompt: string) => {
  try {
    console.log("Starting Deep Research with prompt:", prompt);
    
    // Create a new chat session specifically for research to avoid polluting main chat history initially
    // or we can treat it as a one-off generation. Deep Research is often a complex process.
    // For simplicity and seamless integration, we'll run it as a chat but with a specific system prompt.
    
    const researchChat = deepResearchModel.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: DEEP_RESEARCH_PROMPT.user }]
        },
        {
          role: "model",
          parts: [{ text: DEEP_RESEARCH_PROMPT.model }]
        }
      ]
    });

    const result = await researchChat.sendMessageStream(prompt);
    
    return {
        stream: result.stream,
        getGroundingMetadata: async () => {
          try {
            const response = await result.response;
            const candidate = response.candidates?.[0];
            if (candidate?.groundingMetadata) {
              return candidate.groundingMetadata;
            }
            return null;
          } catch {
            return null;
          }
        }
      };

  } catch (error) {
    console.error("Deep Research error:", error);
    throw error;
  }
};



// Image Generation Function
export const generateImage = async (prompt: string): Promise<{ text: string; imageData?: string }> => {
  try {
    console.log("Generating image with prompt:", prompt);

    const enhancedPrompt = getImageGenerationPrompt(prompt);
    
    // Use generateContent with responseModalities in the request
    const result = await (imageGenerationModel as any).generateContent({
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

export const startChatSession = (history: any[] = []) => {
  chatSession = primaryModel.startChat({
    history: history,
    generationConfig: {
      maxOutputTokens: 2000,
    },
  });
  return chatSession;
};

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
  projectContext?: string
) {
  // Determine IDs
  const primaryId = modelOverrides?.primary || MODELS.PRIMARY;
  const fallbackId = modelOverrides?.fallback || MODELS.FALLBACK;
  
  // Detect Computer Use
  const useComputerUse = needsComputerUse(message);
  
  // Decide active model
  const activeModelId = useComputerUse ? MODELS.COMPUTER_USE : primaryId;

  // Build Personalized System Instruction
  let systemInstruction = PRIMARY_CHAT_PROMPT;
  
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

  // Initialize specific model instance dynamically
  const activeModelInstance = useComputerUse 
    ? computerUseModel 
    : genAI.getGenerativeModel({ 
        model: activeModelId,
        tools: searchTools, // Assuming primary/chosen model supports search
        systemInstruction: systemInstruction 
      });

  console.log('=== GEMINI SERVICE ===');
  console.log('Model:', activeModelId);
  console.log('Personalization:', !!personalization);

  // Handle Session Logic - ALWAYS refresh session to apply system prompt updates or model changes
  let currentHistory: any[] = [];
  if (chatSession) {
    try { currentHistory = await chatSession.getHistory(); } catch {}
  }
  
  // Start fresh session with history to ensure new System Prompt applies
  chatSession = activeModelInstance.startChat({
     history: currentHistory,
     generationConfig: { maxOutputTokens: 2000 }
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
      const fallbackInstance = genAI.getGenerativeModel({ model: fallbackId });
      
      const fallbackChat = fallbackInstance.startChat({ history });
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
    const mapsModel = genAI.getGenerativeModel({
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
