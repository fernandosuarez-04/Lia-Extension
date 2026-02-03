/**
 * Voice Activity Detection (VAD) Service
 * Detects when there's active speech vs silence to optimize transcription
 * Reduces unnecessary API calls by only processing audio with voice activity
 */

export interface VADConfig {
  /** Energy threshold for voice detection (0-1). Default: 0.01 */
  energyThreshold: number;
  /** Minimum consecutive frames with voice to trigger detection. Default: 3 */
  minVoiceFrames: number;
  /** Minimum consecutive frames of silence to end voice activity. Default: 10 */
  minSilenceFrames: number;
  /** Frame size in samples. Default: 512 */
  frameSize: number;
}

export interface VADEvent {
  type: 'voice_start' | 'voice_end' | 'voice_active' | 'silence';
  timestamp: number;
  energy: number;
}

const DEFAULT_CONFIG: VADConfig = {
  energyThreshold: 0.01,
  minVoiceFrames: 3,
  minSilenceFrames: 10,
  frameSize: 512
};

export class VADService {
  private config: VADConfig;
  private isVoiceActive: boolean = false;
  private voiceFrameCount: number = 0;
  private silenceFrameCount: number = 0;
  private onVoiceActivity: ((event: VADEvent) => void) | null = null;
  private lastEnergy: number = 0;

  constructor(config?: Partial<VADConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start listening for voice activity
   */
  start(onVoiceActivity: (event: VADEvent) => void): void {
    this.onVoiceActivity = onVoiceActivity;
    this.isVoiceActive = false;
    this.voiceFrameCount = 0;
    this.silenceFrameCount = 0;
    console.log('VADService: Started');
  }

  /**
   * Stop the VAD service
   */
  stop(): void {
    this.onVoiceActivity = null;
    console.log('VADService: Stopped');
  }

  /**
   * Process audio samples and detect voice activity
   * @param samples Int16Array of PCM audio samples
   */
  processAudio(samples: Int16Array): boolean {
    const energy = this.calculateEnergy(samples);
    this.lastEnergy = energy;

    const hasVoice = energy > this.config.energyThreshold;

    if (hasVoice) {
      this.voiceFrameCount++;
      this.silenceFrameCount = 0;

      // Voice activity started
      if (!this.isVoiceActive && this.voiceFrameCount >= this.config.minVoiceFrames) {
        this.isVoiceActive = true;
        this.emitEvent('voice_start', energy);
      } else if (this.isVoiceActive) {
        this.emitEvent('voice_active', energy);
      }
    } else {
      this.silenceFrameCount++;
      this.voiceFrameCount = 0;

      // Voice activity ended
      if (this.isVoiceActive && this.silenceFrameCount >= this.config.minSilenceFrames) {
        this.isVoiceActive = false;
        this.emitEvent('voice_end', energy);
      } else if (!this.isVoiceActive) {
        this.emitEvent('silence', energy);
      }
    }

    return this.isVoiceActive;
  }

  /**
   * Process audio from base64 string
   */
  processBase64Audio(base64Audio: string): boolean {
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const samples = new Int16Array(bytes.buffer);
    return this.processAudio(samples);
  }

  /**
   * Calculate RMS energy of audio samples
   */
  private calculateEnergy(samples: Int16Array): number {
    if (samples.length === 0) return 0;

    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      // Normalize to -1 to 1 range
      const normalized = samples[i] / 32768;
      sum += normalized * normalized;
    }

    // RMS (Root Mean Square)
    return Math.sqrt(sum / samples.length);
  }

  /**
   * Emit a VAD event
   */
  private emitEvent(type: VADEvent['type'], energy: number): void {
    if (this.onVoiceActivity) {
      this.onVoiceActivity({
        type,
        timestamp: Date.now(),
        energy
      });
    }
  }

  /**
   * Check if voice is currently active
   */
  isActive(): boolean {
    return this.isVoiceActive;
  }

  /**
   * Get current energy level
   */
  getEnergy(): number {
    return this.lastEnergy;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<VADConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export default VADService;
