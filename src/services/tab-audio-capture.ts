/**
 * Tab Audio Capture Service
 * Captures audio from a browser tab (Google Meet, Zoom, etc.)
 * using getDisplayMedia API (Manifest V3 compatible)
 *
 * This approach uses screen/tab sharing with audio, which prompts
 * the user to select which tab to capture - similar to how
 * screen sharing works in video conferencing apps.
 */

export interface TabAudioCaptureCallbacks {
  onAudioData: (base64Audio: string) => void;
  onError: (error: Error) => void;
  onStart: () => void;
  onStop: () => void;
}

export class TabAudioCapture {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private callbacks: TabAudioCaptureCallbacks | null = null;
  private isCapturing: boolean = false;

  /**
   * Start capturing audio from a browser tab
   * Uses getDisplayMedia which prompts user to select a tab
   * This is the most reliable method for Manifest V3
   */
  async startCapture(_tabId: number, callbacks: TabAudioCaptureCallbacks): Promise<void> {
    if (this.isCapturing) {
      console.warn('TabAudioCapture: Already capturing');
      return;
    }

    this.callbacks = callbacks;

    try {
      console.log('TabAudioCapture: Requesting tab audio capture via getDisplayMedia...');

      // Use getDisplayMedia to capture tab audio
      // The user will be prompted to select which tab to share
      // They should select the "Chrome Tab" option and choose the meeting tab
      this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser' // Prefer browser tab
        } as any,
        audio: true, // Capture tab audio
        // @ts-ignore - preferCurrentTab is a newer API
        preferCurrentTab: true, // Prefer the current tab
        // @ts-ignore
        selfBrowserSurface: 'include',
        // @ts-ignore
        systemAudio: 'include'
      });

      // Check if we got audio tracks
      const audioTracks = this.mediaStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No se seleccionó compartir el audio de la pestaña. Por favor, activa "Compartir audio de la pestaña" al seleccionar.');
      }

      console.log('TabAudioCapture: Got audio tracks:', audioTracks.length);

      // We only need audio, stop video track to save resources
      const videoTracks = this.mediaStream.getVideoTracks();
      videoTracks.forEach(track => track.stop());

      // Create a new stream with only audio
      const audioOnlyStream = new MediaStream(audioTracks);

      // Process the audio
      await this.processAudioStream(audioOnlyStream);

      this.isCapturing = true;
      this.callbacks.onStart();
      console.log('TabAudioCapture: Started capturing tab audio');
    } catch (error) {
      console.error('TabAudioCapture: Failed to start', error);

      // Provide user-friendly error messages
      let errorMessage = 'Error al capturar audio de la pestaña';
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          errorMessage = 'Permiso denegado. Por favor, permite compartir la pestaña con audio.';
        } else if (error.message.includes('audio')) {
          errorMessage = error.message;
        }
      }

      const finalError = new Error(errorMessage);
      this.callbacks?.onError(finalError);
      throw finalError;
    }
  }

  /**
   * Process audio stream and convert to PCM for Live API
   */
  private async processAudioStream(stream: MediaStream): Promise<void> {
    // Create audio context at 16kHz (required by Live API)
    this.audioContext = new AudioContext({ sampleRate: 16000 });
    const source = this.audioContext.createMediaStreamSource(stream);

    // Use ScriptProcessor for raw PCM access
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.callbacks) return;

      const inputData = e.inputBuffer.getChannelData(0);

      // Convert Float32 to Int16 PCM
      const pcmData = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
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

    source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  /**
   * Start capturing from an existing MediaStream
   * (Used for mixing audio or direct stream input)
   */
  async startFromStream(stream: MediaStream, callbacks: TabAudioCaptureCallbacks): Promise<void> {
    if (this.isCapturing) {
      console.warn('TabAudioCapture: Already capturing');
      return;
    }

    this.callbacks = callbacks;
    this.mediaStream = stream;

    try {
      await this.processAudioStream(stream);
      this.isCapturing = true;
      this.callbacks.onStart();
      console.log('TabAudioCapture: Started capturing from stream');
    } catch (error) {
      console.error('TabAudioCapture: Failed to start from stream', error);
      this.callbacks?.onError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Stop capturing tab audio
   */
  stop(): void {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    this.isCapturing = false;
    this.callbacks?.onStop();
    this.callbacks = null;

    console.log('TabAudioCapture: Stopped');
  }

  /**
   * Check if currently capturing
   */
  isActive(): boolean {
    return this.isCapturing;
  }

  /**
   * Get the current media stream (for mixing with microphone)
   */
  getStream(): MediaStream | null {
    return this.mediaStream;
  }
}

export default TabAudioCapture;
