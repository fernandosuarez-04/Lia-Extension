/**
 * Gemini Audio Transcription Service
 * Uses Google's Gemini 2.5 Flash Native Audio to transcribe audio
 * This provides better quality than Live API's inputAudioTranscription
 *
 * Features:
 * - VAD (Voice Activity Detection) to filter silence
 * - Unified transcription + cleanup in single API call
 * - Optimized buffer timing for low latency
 */

import { MODELS } from '../config';
import { VADService } from './vad-service';

export interface GeminiTranscriptionResult {
  text: string;
  speaker?: string;
  confidence?: number;
}

export interface GeminiTranscriptionConfig {
  language?: string;
  contextPrompt?: string;
  enableVAD?: boolean;
  vadEnergyThreshold?: number;
}

const DEFAULT_CONFIG: GeminiTranscriptionConfig = {
  language: 'español',
  contextPrompt: '',
  enableVAD: true,
  vadEnergyThreshold: 0.008 // RMS energy threshold — 0.008 is reliable for speech in mixed audio
};

export class GeminiTranscriptionService {
  private apiKey: string;
  private config: GeminiTranscriptionConfig;
  private audioChunks: Int16Array[] = [];
  private isProcessing: boolean = false;
  private onTranscription: ((result: GeminiTranscriptionResult) => void) | null = null;
  private onError: ((error: Error) => void) | null = null;
  private processInterval: ReturnType<typeof setInterval> | null = null;
  private readonly BUFFER_DURATION_MS = 2000; // Process every 2 seconds for better context (reduces hallucinations)
  private readonly MIN_AUDIO_DURATION_MS = 1000; // Minimum 1 second of audio
  private readonly SAMPLE_RATE = 16000;

  // VAD integration
  private vadService: VADService | null = null;
  private hasVoiceInBuffer: boolean = false;
  private consecutiveSilenceChunks: number = 0;

  // Context tracking for phrase reconstruction
  private recentTranscripts: string[] = [];
  private readonly MAX_CONTEXT_HISTORY = 3; // Keep last 3 transcripts for context

  constructor(apiKey: string, config?: Partial<GeminiTranscriptionConfig>) {
    this.apiKey = apiKey;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize VAD if enabled
    if (this.config.enableVAD) {
      this.vadService = new VADService({
        energyThreshold: this.config.vadEnergyThreshold || 0.008,
        minVoiceFrames: 2,
        minSilenceFrames: 8
      });
    }
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
    this.hasVoiceInBuffer = false;
    this.consecutiveSilenceChunks = 0;

    // Start VAD if enabled
    if (this.vadService) {
      this.vadService.start((event) => {
        if (event.type === 'voice_start' || event.type === 'voice_active') {
          this.hasVoiceInBuffer = true;
          this.consecutiveSilenceChunks = 0;
        }
      });
      console.log('GeminiTranscription: VAD enabled');
    }

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

    // Stop VAD
    if (this.vadService) {
      this.vadService.stop();
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

    // Process through VAD if enabled
    if (this.vadService) {
      const hasVoice = this.vadService.processAudio(audioData);
      if (hasVoice) {
        this.hasVoiceInBuffer = true;
      }
    }

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

    // VAD check: skip if no voice detected — never send silence/noise to API
    if (this.vadService && !this.hasVoiceInBuffer) {
      this.consecutiveSilenceChunks++;
      console.log(`GeminiTranscription: VAD=silence | energy=${this.vadService.getEnergy().toFixed(5)} threshold=${this.config.vadEnergyThreshold} chunks=${this.consecutiveSilenceChunks} duration=${durationMs.toFixed(0)}ms`);
      this.audioChunks = [];
      return;
    }
    if (this.vadService) {
      console.log(`GeminiTranscription: VAD=VOICE | energy=${this.vadService.getEnergy().toFixed(5)} threshold=${this.config.vadEnergyThreshold} duration=${durationMs.toFixed(0)}ms → sending to API`);
    }

    this.isProcessing = true;

    // Combine all chunks
    const combinedBuffer = new Int16Array(totalSamples);
    let offset = 0;
    for (const chunk of this.audioChunks) {
      combinedBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    // Clear the buffer and reset VAD state
    this.audioChunks = [];
    this.hasVoiceInBuffer = false;

    try {
      // Convert PCM to base64 for Gemini
      const base64Audio = this.int16ArrayToBase64(combinedBuffer);

      // Call Gemini API
      const result = await this.callGeminiAPI(base64Audio);

      // Send result to callback
      if (result && result.text && this.onTranscription) {
        this.onTranscription(result);
        // Reset silence counter on successful transcription
        this.consecutiveSilenceChunks = 0;
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
   * Unified: transcription + cleanup in a single API call for lower latency
   */
  private async callGeminiAPI(base64Audio: string): Promise<GeminiTranscriptionResult> {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(this.apiKey);

    // Use Gemini with strict Spanish-only systemInstruction
    const model = genAI.getGenerativeModel({
      model: MODELS.TRANSCRIPTION,
      systemInstruction: `Eres un transcriptor de audio en tiempo real para reuniones en español.
REGLAS CRÍTICAS:
- SOLO transcribes lo que se dice CLARAMENTE en el audio. Si no escuchas habla clara, devuelve EXACTAMENTE: {"text": "", "speaker": null}
- NUNCA inventes ni generes texto que no estés escuchando directamente. Es mejor devolver texto vacío que inventar.
- Si hay ruido de fondo, silencio o habla muy poco clara, devuelve texto vacío.
- Transcribe en español. Si escuchas inglés, transcríbelo en inglés tal cual.
- Preserva nombres propios como "Isra", "Fernando", "Lia", "Pedro".`,
      generationConfig: {
        temperature: 0.1,  // Low temperature for deterministic, accurate transcription
        topK: 40,
        topP: 0.95,
      }
    });

    // Build context from recent transcripts for better phrase reconstruction
    const contextText = this.recentTranscripts.length > 0
      ? `\n\nCONTEXTO PREVIO (últimas transcripciones):\n${this.recentTranscripts.join('\n')}`
      : '';

    // Prompt: explicit about returning empty when no clear speech
    const prompt = `Transcribe el audio. Si no hay habla clara, responde con {"text": "", "speaker": null}.
${contextText}
Responde SOLO con JSON: {"text": "texto transcrito o vacío si no hay habla", "speaker": null}`;

    console.log('GeminiTranscription: Calling unified API with audio length:', base64Audio.length);

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

      console.log('GeminiTranscription: Result:', rawText.substring(0, 150) + '...');

      // Try to parse JSON response
      try {
        const jsonText = rawText.replace(/```json\n?|\n?```/g, '').trim();
        const parsed = JSON.parse(jsonText);

        const transcriptionText = parsed.text || '';

        // Validate the transcription
        if (!this.isValidTranscription(transcriptionText)) {
          console.log('GeminiTranscription: Invalid transcription, skipping');
          return { text: '' };
        }

        // Add to context history for future reconstructions
        if (transcriptionText && transcriptionText.length > 5) {
          this.recentTranscripts.push(transcriptionText);
          if (this.recentTranscripts.length > this.MAX_CONTEXT_HISTORY) {
            this.recentTranscripts.shift(); // Remove oldest
          }
        }

        return {
          text: transcriptionText,
          speaker: parsed.speaker || undefined
        };
      } catch {
        // If JSON parsing fails, try to use raw text
        console.log('GeminiTranscription: JSON parse failed, using raw response');

        if (!this.isValidTranscription(rawText)) {
          console.log('GeminiTranscription: Invalid response, skipping');
          return { text: '' };
        }

        // Add to context even if JSON parsing failed
        if (rawText && rawText.length > 5) {
          this.recentTranscripts.push(rawText);
          if (this.recentTranscripts.length > this.MAX_CONTEXT_HISTORY) {
            this.recentTranscripts.shift();
          }
        }

        return { text: rawText };
      }
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
   * Check if the response is a valid transcription
   * Improved: Only reject if the ENTIRE response is an error message, not if it contains valid content
   */
  private isValidTranscription(text: string): boolean {
    const lowerText = text.toLowerCase().trim();

    // Must have at least some content
    if (text.length < 5) {
      return false;
    }

    // If the text is long enough (>50 chars), it's likely valid transcription
    // even if it mentions audio issues somewhere
    if (text.length > 50) {
      return true;
    }

    // For short responses, check if it's PRIMARILY an error message
    const invalidPhrases = [
      'no puedo transcribir',
      'no es posible transcribir',
      'no hay audio',
      'no se escucha nada',
      'solo silencio',
      'audio vacío',
      'sin contenido de audio',
      'no contiene audio',
      'no tiene audio',
      'unable to transcribe',
      'cannot process audio',
      'no speech detected',
      'i cannot transcribe',
      '[inaudible]', // Only inaudible marker with nothing else
      'el audio no contiene',
      'no detecté'
    ];

    // Only reject if the SHORT text matches an error pattern closely
    for (const phrase of invalidPhrases) {
      // Check if the text is essentially just this error phrase (with some tolerance)
      if (lowerText.includes(phrase) && text.length < phrase.length + 30) {
        return false;
      }
    }

    return true;
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
