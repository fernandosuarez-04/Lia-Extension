/**
 * Mixed Audio Capture Service
 * Combines tab audio (meeting participants) with microphone (user's voice)
 * for unified streaming to Live API
 */

export interface MixedAudioCallbacks {
  onAudioData: (base64Audio: string) => void;
  onError: (error: Error) => void;
  onStart: () => void;
  onStop: () => void;
}

export class MixedAudioCapture {
  private audioContext: AudioContext | null = null;
  private tabStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private tabSource: MediaStreamAudioSourceNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private merger: ChannelMergerNode | null = null;
  private callbacks: MixedAudioCallbacks | null = null;
  private isCapturing: boolean = false;
  private isMicMuted: boolean = false;
  private micGainNode: GainNode | null = null;
  private tabGainNode: GainNode | null = null;

  /**
   * Start capturing by prompting user to select a tab (Manifest V3 compatible)
   * Uses getDisplayMedia which is more reliable than tabCapture in MV3
   */
  async startWithTabSelection(
    _tabId: number,
    callbacks: MixedAudioCallbacks,
    options?: { includeMicrophone?: boolean }
  ): Promise<void> {
    if (this.isCapturing) {
      console.warn('MixedAudioCapture: Already capturing');
      return;
    }

    this.callbacks = callbacks;

    try {
      console.log('MixedAudioCapture: Requesting tab audio via getDisplayMedia...');

      // Use getDisplayMedia to capture tab audio
      // User will see a dialog to select which tab/window to share
      // NOTE: Don't use preferCurrentTab as it would show the extension's side panel, not the Meet tab
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser'
        } as any,
        audio: true,
        // @ts-ignore - Chrome-specific: include the extension itself in the list
        selfBrowserSurface: 'include',
        // @ts-ignore - Chrome-specific: allow system audio capture
        systemAudio: 'include',
        // @ts-ignore - Chrome-specific: prefer showing tab picker
        surfaceSwitching: 'include'
      });

      // Check if we got audio
      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        // Stop video track
        displayStream.getTracks().forEach(t => t.stop());
        throw new Error('No se seleccionó compartir el audio. Asegúrate de activar "Compartir audio de la pestaña" en el diálogo.');
      }

      // Stop video track - we only need audio
      displayStream.getVideoTracks().forEach(track => track.stop());

      // Create audio-only stream from tab
      this.tabStream = new MediaStream(audioTracks);

      console.log('MixedAudioCapture: Tab audio stream obtained');

      // Now proceed with normal audio setup
      await this.setupAudioProcessing(options);

    } catch (error) {
      console.error('MixedAudioCapture: Failed to start with tab selection', error);

      let errorMessage = 'Error al capturar audio de la pestaña';
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          errorMessage = 'Permiso denegado. Por favor, selecciona una pestaña y activa "Compartir audio".';
        } else {
          errorMessage = error.message;
        }
      }

      const finalError = new Error(errorMessage);
      this.callbacks?.onError(finalError);
      throw finalError;
    }
  }

  /**
   * Setup audio processing (shared between start methods)
   */
  private async setupAudioProcessing(options?: { includeMicrophone?: boolean }): Promise<void> {
    if (!this.tabStream) {
      throw new Error('No tab stream available');
    }

    // Create audio context at 16kHz (required by Live API)
    this.audioContext = new AudioContext({ sampleRate: 16000 });

    // Create tab audio source
    this.tabSource = this.audioContext.createMediaStreamSource(this.tabStream);
    this.tabGainNode = this.audioContext.createGain();
    this.tabGainNode.gain.value = 1.0;
    this.tabSource.connect(this.tabGainNode);

    // Create merger for combining audio sources
    this.merger = this.audioContext.createChannelMerger(2);
    this.tabGainNode.connect(this.merger, 0, 0);

    // Optionally add microphone
    if (options?.includeMicrophone !== false) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 16000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true
          }
        });

        this.micSource = this.audioContext.createMediaStreamSource(this.micStream);
        this.micGainNode = this.audioContext.createGain();
        this.micGainNode.gain.value = 1.0;
        this.micSource.connect(this.micGainNode);
        this.micGainNode.connect(this.merger, 0, 1);

        console.log('MixedAudioCapture: Microphone added to mix');
      } catch (micError) {
        console.warn('MixedAudioCapture: Could not add microphone', micError);
        // Continue without microphone
      }
    }

    // Create processor for PCM output
    this.processor = this.audioContext.createScriptProcessor(4096, 2, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.callbacks) return;

      // Get data from both channels
      const tabData = e.inputBuffer.getChannelData(0);
      const micData = e.inputBuffer.numberOfChannels > 1
        ? e.inputBuffer.getChannelData(1)
        : new Float32Array(tabData.length);

      // Mix the two channels
      const mixedData = new Float32Array(tabData.length);
      for (let i = 0; i < tabData.length; i++) {
        // Simple mix: average of both sources (with mic mute support)
        const micSample = this.isMicMuted ? 0 : micData[i];
        mixedData[i] = (tabData[i] + micSample) / 2;

        // Clamp to prevent clipping
        mixedData[i] = Math.max(-1, Math.min(1, mixedData[i]));
      }

      // Convert Float32 to Int16 PCM
      const pcmData = new Int16Array(mixedData.length);
      for (let i = 0; i < mixedData.length; i++) {
        const s = Math.max(-1, Math.min(1, mixedData[i]));
        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      // Convert to base64
      const bytes = new Uint8Array(pcmData.buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      this.callbacks.onAudioData(base64);
    };

    this.merger.connect(this.processor);
    this.processor.connect(this.audioContext.destination);

    this.isCapturing = true;
    this.callbacks?.onStart();
    console.log('MixedAudioCapture: Started');
  }

  /**
   * Start capturing mixed audio from an existing tab stream and microphone
   */
  async start(
    tabStream: MediaStream,
    callbacks: MixedAudioCallbacks,
    options?: { includeMicrophone?: boolean }
  ): Promise<void> {
    if (this.isCapturing) {
      console.warn('MixedAudioCapture: Already capturing');
      return;
    }

    this.callbacks = callbacks;
    this.tabStream = tabStream;

    try {
      await this.setupAudioProcessing(options);
    } catch (error) {
      console.error('MixedAudioCapture: Failed to start', error);
      this.callbacks?.onError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Toggle microphone mute
   */
  toggleMicrophone(): boolean {
    this.isMicMuted = !this.isMicMuted;

    if (this.micGainNode) {
      this.micGainNode.gain.value = this.isMicMuted ? 0 : 1.0;
    }

    console.log(`MixedAudioCapture: Microphone ${this.isMicMuted ? 'muted' : 'unmuted'}`);
    return !this.isMicMuted;
  }

  /**
   * Set microphone mute state
   */
  setMicrophoneMuted(muted: boolean): void {
    this.isMicMuted = muted;

    if (this.micGainNode) {
      this.micGainNode.gain.value = muted ? 0 : 1.0;
    }
  }

  /**
   * Check if microphone is muted
   */
  isMicrophoneMuted(): boolean {
    return this.isMicMuted;
  }

  /**
   * Set tab audio volume (0-1)
   */
  setTabVolume(volume: number): void {
    if (this.tabGainNode) {
      this.tabGainNode.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  /**
   * Set microphone volume (0-1)
   */
  setMicrophoneVolume(volume: number): void {
    if (this.micGainNode) {
      this.micGainNode.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  /**
   * Stop all audio capture
   */
  stop(): void {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.merger) {
      this.merger.disconnect();
      this.merger = null;
    }

    if (this.tabGainNode) {
      this.tabGainNode.disconnect();
      this.tabGainNode = null;
    }

    if (this.micGainNode) {
      this.micGainNode.disconnect();
      this.micGainNode = null;
    }

    if (this.tabSource) {
      this.tabSource.disconnect();
      this.tabSource = null;
    }

    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }

    if (this.tabStream) {
      this.tabStream.getTracks().forEach(track => track.stop());
      this.tabStream = null;
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
      this.micStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    this.isCapturing = false;
    this.isMicMuted = false;
    this.callbacks?.onStop();
    this.callbacks = null;

    console.log("MixedAudioCapture: Stopped");
  }

  /**
   * Check if currently capturing
   */
  isActive(): boolean {
    return this.isCapturing;
  }

  /**
   * Check if microphone is connected
   */
  hasMicrophone(): boolean {
    return this.micStream !== null && this.micSource !== null;
  }
}

export default MixedAudioCapture;
