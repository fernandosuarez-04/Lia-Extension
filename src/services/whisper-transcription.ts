/**
 * OpenAI Whisper Transcription Service
 * High-quality speech-to-text using OpenAI's Whisper model
 */

export interface WhisperTranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

export interface WhisperConfig {
  language?: string; // ISO-639-1 code (e.g., 'es' for Spanish)
  prompt?: string; // Optional context prompt
  temperature?: number; // 0-1, lower = more deterministic
}

const DEFAULT_CONFIG: WhisperConfig = {
  language: 'es', // Spanish
  temperature: 0
};

export class WhisperTranscriptionService {
  private apiKey: string;
  private config: WhisperConfig;
  private audioChunks: Int16Array[] = [];
  private isProcessing: boolean = false;
  private onTranscription: ((result: WhisperTranscriptionResult) => void) | null = null;
  private onError: ((error: Error) => void) | null = null;
  private processInterval: ReturnType<typeof setInterval> | null = null;
  private readonly BUFFER_DURATION_MS = 8000; // Process every 8 seconds
  private readonly MIN_AUDIO_DURATION_MS = 2000; // Minimum 2 seconds of audio
  private readonly SAMPLE_RATE = 16000; // 16kHz

  constructor(apiKey: string, config?: Partial<WhisperConfig>) {
    this.apiKey = apiKey;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the transcription service
   */
  start(
    onTranscription: (result: WhisperTranscriptionResult) => void,
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

    console.log('WhisperService: Started');
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
    console.log('WhisperService: Stopped');
  }

  /**
   * Add audio data to the buffer
   * @param pcmData PCM audio data (base64 string)
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
      // Convert PCM to WAV
      const wavBlob = this.pcmToWav(combinedBuffer);

      // Call Whisper API
      const result = await this.callWhisperAPI(wavBlob);

      // Send result to callback
      if (result && result.text && this.onTranscription) {
        this.onTranscription(result);
      }
    } catch (error) {
      console.error('WhisperService: Error processing audio', error);
      if (this.onError) {
        this.onError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Convert PCM Int16Array to WAV Blob
   */
  private pcmToWav(pcmData: Int16Array): Blob {
    const numChannels = 1;
    const sampleRate = this.SAMPLE_RATE;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmData.length * bytesPerSample;
    const bufferSize = 44 + dataSize; // WAV header is 44 bytes

    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // WAV Header
    // "RIFF" chunk descriptor
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true); // File size - 8
    this.writeString(view, 8, 'WAVE');

    // "fmt " sub-chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // "data" sub-chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Write PCM data
    const dataOffset = 44;
    for (let i = 0; i < pcmData.length; i++) {
      view.setInt16(dataOffset + i * 2, pcmData[i], true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  /**
   * Write string to DataView
   */
  private writeString(view: DataView, offset: number, string: string): void {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  /**
   * Call OpenAI Whisper API
   */
  private async callWhisperAPI(audioBlob: Blob): Promise<WhisperTranscriptionResult> {
    const url = 'https://api.openai.com/v1/audio/transcriptions';

    // Create form data
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', 'whisper-1');

    if (this.config.language) {
      formData.append('language', this.config.language);
    }
    if (this.config.prompt) {
      formData.append('prompt', this.config.prompt);
    }
    if (this.config.temperature !== undefined) {
      formData.append('temperature', this.config.temperature.toString());
    }

    // Response format
    formData.append('response_format', 'json');

    console.log('WhisperService: Calling API with audio size:', audioBlob.size, 'bytes');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('WhisperService: API error', response.status, errorData);

      if (response.status === 401) {
        throw new Error('API key de OpenAI inválida o no autorizada');
      } else if (response.status === 429) {
        throw new Error('Límite de API excedido. Espera un momento.');
      } else if (response.status === 400) {
        throw new Error('Error en formato de audio: ' + (errorData.error?.message || 'formato inválido'));
      }

      throw new Error(`Whisper API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    console.log('WhisperService: API response', data);

    return {
      text: data.text || '',
      language: data.language,
      duration: data.duration
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<WhisperConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export default WhisperTranscriptionService;
