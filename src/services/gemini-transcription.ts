/**
 * Gemini Audio Transcription Service
 * Uses Google's Gemini 2.5 Flash Native Audio to transcribe audio
 * This provides better quality than Live API's inputAudioTranscription
 */

import { MODELS } from '../config';

export interface GeminiTranscriptionResult {
  text: string;
  speaker?: string;
  confidence?: number;
}

export interface GeminiTranscriptionConfig {
  language?: string;
  contextPrompt?: string;
}

const DEFAULT_CONFIG: GeminiTranscriptionConfig = {
  language: 'español',
  contextPrompt: ''
};

export class GeminiTranscriptionService {
  private apiKey: string;
  private config: GeminiTranscriptionConfig;
  private audioChunks: Int16Array[] = [];
  private isProcessing: boolean = false;
  private onTranscription: ((result: GeminiTranscriptionResult) => void) | null = null;
  private onError: ((error: Error) => void) | null = null;
  private processInterval: ReturnType<typeof setInterval> | null = null;
  private readonly BUFFER_DURATION_MS = 10000; // Process every 10 seconds for better context
  private readonly MIN_AUDIO_DURATION_MS = 3000; // Minimum 3 seconds of audio
  private readonly SAMPLE_RATE = 16000;

  constructor(apiKey: string, config?: Partial<GeminiTranscriptionConfig>) {
    this.apiKey = apiKey;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the transcription service
   */
  start(
    onTranscription: (result: GeminiTranscriptionResult) => void,
    onError: (error: Error) => void
  ): void {
    this.onTranscription = onTranscription;
    this.onError = onError;
    this.audioChunks = [];
    this.isProcessing = false;

    // Start periodic processing
    this.processInterval = setInterval(() => {
      this.processAudioBuffer();
    }, this.BUFFER_DURATION_MS);

    console.log('GeminiTranscription: Started');
  }

  /**
   * Stop the transcription service
   */
  stop(): void {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }

    // Process any remaining audio
    if (this.audioChunks.length > 0) {
      this.processAudioBuffer();
    }

    this.onTranscription = null;
    this.onError = null;
    console.log('GeminiTranscription: Stopped');
  }

  /**
   * Add audio data to the buffer
   */
  addAudioData(base64Audio: string): void {
    // Convert base64 to Int16Array
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const audioData = new Int16Array(bytes.buffer);
    this.audioChunks.push(audioData);
  }

  /**
   * Process the accumulated audio buffer
   */
  private async processAudioBuffer(): Promise<void> {
    if (this.isProcessing || this.audioChunks.length === 0) {
      return;
    }

    // Calculate total samples
    const totalSamples = this.audioChunks.reduce((sum, arr) => sum + arr.length, 0);
    const durationMs = (totalSamples / this.SAMPLE_RATE) * 1000;

    // Skip if not enough audio
    if (durationMs < this.MIN_AUDIO_DURATION_MS) {
      return;
    }

    this.isProcessing = true;

    // Combine all chunks
    const combinedBuffer = new Int16Array(totalSamples);
    let offset = 0;
    for (const chunk of this.audioChunks) {
      combinedBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    // Clear the buffer
    this.audioChunks = [];

    try {
      // Convert PCM to base64 for Gemini
      const base64Audio = this.int16ArrayToBase64(combinedBuffer);

      // Call Gemini API
      const result = await this.callGeminiAPI(base64Audio);

      // Send result to callback
      if (result && result.text && this.onTranscription) {
        this.onTranscription(result);
      }
    } catch (error) {
      console.error('GeminiTranscription: Error processing audio', error);
      if (this.onError) {
        this.onError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Call Gemini API for transcription
   */
  private async callGeminiAPI(base64Audio: string): Promise<GeminiTranscriptionResult> {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(this.apiKey);

    // Use Gemini 2.5 Flash Native Audio for audio transcription
    const model = genAI.getGenerativeModel({ model: MODELS.LIVE });

    const prompt = `Transcribe el siguiente audio a texto en ${this.config.language}.

INSTRUCCIONES IMPORTANTES:
- Transcribe EXACTAMENTE lo que se dice, palabra por palabra
- NO interpretes ni analices el contenido
- NO añadas comentarios ni explicaciones
- Si hay varios hablantes, intenta diferenciarlos con "Hablante 1:", "Hablante 2:", etc.
- Incluye puntuación apropiada
- Si no se entiende algo, escribe [inaudible]
- Si hay ruido de fondo o silencio, omítelo
${this.config.contextPrompt ? `\nContexto: ${this.config.contextPrompt}` : ''}

Devuelve SOLO la transcripción, nada más.`;

    console.log('GeminiTranscription: Calling API with audio length:', base64Audio.length);

    try {
      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: 'audio/pcm;rate=16000',
            data: base64Audio
          }
        },
        { text: prompt }
      ]);

      const response = await result.response;
      const rawText = response.text().trim();

      console.log('GeminiTranscription: Raw result:', rawText.substring(0, 100) + '...');

      // Filter out common non-transcription responses
      if (!this.isValidTranscription(rawText)) {
        console.log('GeminiTranscription: Invalid response, skipping');
        return { text: '' };
      }

      // Clean up the transcription with fast model
      console.log('GeminiTranscription: Cleaning up text...');
      const cleanedResult = await this.cleanupTranscription(rawText);
      console.log('GeminiTranscription: Cleaned result:', cleanedResult.text.substring(0, 100) + '...');

      return cleanedResult;
    } catch (error: any) {
      // Handle specific error cases
      if (error.message?.includes('Could not process audio')) {
        console.log('GeminiTranscription: Audio too short or unclear');
        return { text: '' };
      }
      throw error;
    }
  }

  /**
   * Clean up transcription text using a fast model
   */
  private async cleanupTranscription(rawText: string): Promise<GeminiTranscriptionResult> {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(this.apiKey);

    // Use fast model for cleanup
    const model = genAI.getGenerativeModel({ model: MODELS.FALLBACK });

    const prompt = `Corrige y mejora la siguiente transcripción de audio de una reunión.

TEXTO ORIGINAL:
"${rawText}"

INSTRUCCIONES:
1. CORRIGE palabras fragmentadas (ejemplo: "pri mero" → "primero", "escu che" → "escuche")
2. CORRIGE espacios incorrectos entre letras o sílabas
3. MANTÉN el significado exacto, no cambies las palabras
4. AÑADE puntuación correcta (puntos, comas, signos de interrogación)
5. Si detectas diferentes voces/hablantes, indica el cambio con [Hablante 1], [Hablante 2], etc.
6. NO agregues contenido nuevo, solo corrige errores de transcripción

FORMATO DE RESPUESTA (JSON):
{
  "text": "texto corregido aquí",
  "speaker": "Hablante 1" o null si no se detecta cambio de hablante
}

Devuelve SOLO el JSON, nada más.`;

    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const responseText = response.text().trim();

      // Try to parse JSON response
      try {
        // Remove markdown code blocks if present
        const jsonText = responseText.replace(/```json\n?|\n?```/g, '').trim();
        const parsed = JSON.parse(jsonText);
        return {
          text: parsed.text || rawText,
          speaker: parsed.speaker || undefined
        };
      } catch {
        // If JSON parsing fails, return cleaned text directly
        console.log('GeminiTranscription: JSON parse failed, using raw response');
        return { text: responseText };
      }
    } catch (error) {
      console.error('GeminiTranscription: Cleanup failed, using raw text', error);
      return { text: rawText };
    }
  }

  /**
   * Check if the response is a valid transcription
   */
  private isValidTranscription(text: string): boolean {
    const lowerText = text.toLowerCase();

    // Filter out common non-transcription responses
    const invalidPhrases = [
      'no puedo',
      'no es posible',
      'no hay audio',
      'no se escucha',
      'silencio',
      'audio vacío',
      'sin contenido',
      'no contiene',
      'no tiene audio',
      'unable to',
      'cannot process',
      'no speech',
      'i cannot'
    ];

    for (const phrase of invalidPhrases) {
      if (lowerText.includes(phrase)) {
        return false;
      }
    }

    // Must have at least some content
    return text.length > 5;
  }

  /**
   * Convert Int16Array to base64
   */
  private int16ArrayToBase64(int16Array: Int16Array): string {
    const uint8Array = new Uint8Array(int16Array.buffer);
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<GeminiTranscriptionConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export default GeminiTranscriptionService;
