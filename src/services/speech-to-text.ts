/**
 * Google Cloud Speech-to-Text Service
 * Provides high-quality transcription with speaker diarization
 */

export interface TranscriptionResult {
  text: string;
  speaker: number; // Speaker tag (1, 2, 3, etc.)
  confidence: number;
  startTime: number;
  endTime: number;
}

export interface SpeechToTextConfig {
  languageCode: string;
  enableSpeakerDiarization: boolean;
  minSpeakerCount: number;
  maxSpeakerCount: number;
  sampleRateHertz: number;
}

const DEFAULT_CONFIG: SpeechToTextConfig = {
  languageCode: 'es-MX', // Spanish Mexico
  enableSpeakerDiarization: true,
  minSpeakerCount: 2,
  maxSpeakerCount: 6,
  sampleRateHertz: 16000
};

export class SpeechToTextService {
  private apiKey: string;
  private config: SpeechToTextConfig;
  private audioBuffer: Int16Array[] = [];
  private isProcessing: boolean = false;
  private onTranscription: ((result: TranscriptionResult) => void) | null = null;
  private onError: ((error: Error) => void) | null = null;
  private processInterval: ReturnType<typeof setInterval> | null = null;
  private readonly BUFFER_DURATION_MS = 5000; // Process every 5 seconds
  private readonly MIN_AUDIO_DURATION_MS = 1000; // Minimum 1 second of audio

  constructor(apiKey: string, config?: Partial<SpeechToTextConfig>) {
    this.apiKey = apiKey;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the transcription service
   */
  start(
    onTranscription: (result: TranscriptionResult) => void,
    onError: (error: Error) => void
  ): void {
    this.onTranscription = onTranscription;
    this.onError = onError;
    this.audioBuffer = [];
    this.isProcessing = false;

    // Start periodic processing
    this.processInterval = setInterval(() => {
      this.processAudioBuffer();
    }, this.BUFFER_DURATION_MS);

    console.log('SpeechToText: Service started');
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
    if (this.audioBuffer.length > 0) {
      this.processAudioBuffer();
    }

    this.onTranscription = null;
    this.onError = null;
    console.log('SpeechToText: Service stopped');
  }

  /**
   * Add audio data to the buffer
   * @param pcmData PCM audio data (Int16Array or base64 string)
   */
  addAudioData(pcmData: Int16Array | string): void {
    let audioData: Int16Array;

    if (typeof pcmData === 'string') {
      // Convert base64 to Int16Array
      const binaryString = atob(pcmData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      audioData = new Int16Array(bytes.buffer);
    } else {
      audioData = pcmData;
    }

    this.audioBuffer.push(audioData);
  }

  /**
   * Process the accumulated audio buffer
   */
  private async processAudioBuffer(): Promise<void> {
    if (this.isProcessing || this.audioBuffer.length === 0) {
      return;
    }

    // Calculate total samples
    const totalSamples = this.audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
    const durationMs = (totalSamples / this.config.sampleRateHertz) * 1000;

    // Skip if not enough audio
    if (durationMs < this.MIN_AUDIO_DURATION_MS) {
      return;
    }

    this.isProcessing = true;

    // Combine all buffers
    const combinedBuffer = new Int16Array(totalSamples);
    let offset = 0;
    for (const buffer of this.audioBuffer) {
      combinedBuffer.set(buffer, offset);
      offset += buffer.length;
    }

    // Clear the buffer
    this.audioBuffer = [];

    try {
      // Convert to base64 for API
      const base64Audio = this.int16ArrayToBase64(combinedBuffer);

      // Call Speech-to-Text API
      const results = await this.callSpeechAPI(base64Audio);

      // Send results to callback
      if (results && this.onTranscription) {
        for (const result of results) {
          this.onTranscription(result);
        }
      }
    } catch (error) {
      console.error('SpeechToText: Error processing audio', error);
      if (this.onError) {
        this.onError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Call Google Cloud Speech-to-Text API
   */
  private async callSpeechAPI(base64Audio: string): Promise<TranscriptionResult[]> {
    const url = `https://speech.googleapis.com/v1/speech:recognize?key=${this.apiKey}`;

    // Build config object with correct field names for Google Cloud Speech-to-Text API
    const config: any = {
      encoding: 'LINEAR16',
      sampleRateHertz: this.config.sampleRateHertz,
      languageCode: this.config.languageCode,
      enableAutomaticPunctuation: true,
      enableWordTimeOffsets: true,
      model: 'default'
    };

    // Add speaker diarization config if enabled (uses nested object)
    if (this.config.enableSpeakerDiarization) {
      config.diarizationConfig = {
        enableSpeakerDiarization: true,
        minSpeakerCount: this.config.minSpeakerCount,
        maxSpeakerCount: this.config.maxSpeakerCount
      };
    }

    const requestBody = {
      config,
      audio: {
        content: base64Audio
      }
    };

    console.log('SpeechToText: Calling API with', {
      audioLength: base64Audio.length,
      config: this.config
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('SpeechToText: API error', response.status, errorData);

      // Check for specific errors
      if (response.status === 403) {
        throw new Error('Speech-to-Text API no habilitada. Habilita la API en Google Cloud Console.');
      } else if (response.status === 400) {
        throw new Error('Error en formato de audio: ' + (errorData.error?.message || 'formato inválido'));
      }

      throw new Error(`Speech API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    console.log('SpeechToText: API response', data);

    return this.parseAPIResponse(data);
  }

  /**
   * Parse the API response into TranscriptionResult objects
   */
  private parseAPIResponse(data: any): TranscriptionResult[] {
    const results: TranscriptionResult[] = [];

    if (!data.results || data.results.length === 0) {
      console.log('SpeechToText: No transcription results');
      return results;
    }

    // Get the last result which contains speaker diarization info
    const lastResult = data.results[data.results.length - 1];

    if (!lastResult.alternatives || lastResult.alternatives.length === 0) {
      return results;
    }

    const alternative = lastResult.alternatives[0];

    // If we have word-level speaker info, group by speaker
    if (alternative.words && alternative.words.length > 0) {
      let currentSpeaker = -1;
      let currentText = '';
      let startTime = 0;
      let endTime = 0;

      for (const word of alternative.words) {
        const speakerTag = word.speakerTag || 1;
        const wordStartTime = this.parseTime(word.startTime);
        const wordEndTime = this.parseTime(word.endTime);

        if (speakerTag !== currentSpeaker) {
          // Save previous segment
          if (currentText.trim()) {
            results.push({
              text: currentText.trim(),
              speaker: currentSpeaker,
              confidence: alternative.confidence || 0.9,
              startTime,
              endTime
            });
          }

          // Start new segment
          currentSpeaker = speakerTag;
          currentText = word.word;
          startTime = wordStartTime;
          endTime = wordEndTime;
        } else {
          // Continue current segment
          currentText += ' ' + word.word;
          endTime = wordEndTime;
        }
      }

      // Don't forget the last segment
      if (currentText.trim()) {
        results.push({
          text: currentText.trim(),
          speaker: currentSpeaker,
          confidence: alternative.confidence || 0.9,
          startTime,
          endTime
        });
      }
    } else {
      // No word-level info, return full transcript
      results.push({
        text: alternative.transcript || '',
        speaker: 1,
        confidence: alternative.confidence || 0.9,
        startTime: 0,
        endTime: 0
      });
    }

    return results;
  }

  /**
   * Parse Google's time format (e.g., "1.5s") to milliseconds
   */
  private parseTime(timeStr: string | undefined): number {
    if (!timeStr) return 0;
    const seconds = parseFloat(timeStr.replace('s', ''));
    return Math.round(seconds * 1000);
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
  updateConfig(config: Partial<SpeechToTextConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get speaker label (convert number to name)
   */
  static getSpeakerLabel(speakerTag: number, participantNames?: string[]): string {
    if (participantNames && participantNames[speakerTag - 1]) {
      return participantNames[speakerTag - 1];
    }
    return `Participante ${speakerTag}`;
  }
}

export default SpeechToTextService;
