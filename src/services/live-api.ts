
import { GOOGLE_API_KEY, LIVE_API_URL, MODELS } from "../config";
import { getApiKeyWithCache } from "./api-keys";
import { WEB_AGENT_TOOLS, WEB_AGENT_SYSTEM_PROMPT } from "../prompts/computer-use";

export interface LiveCallbacks {
  onTextResponse: (text: string) => void;
  onAudioResponse: (audioData: string) => void;  // base64 PCM audio
  onError: (error: Error) => void;
  onClose: () => void;
  onReady: () => void;
  onFunctionCall?: (functionCall: { name: string; args: any }) => Promise<string>; // Execute function and return result
}

export interface PageContext {
  accessibilityTree: string;
  screenshot: string; // base64 image
  url: string;
  title: string;
}

export class LiveClient {
  private ws: WebSocket | null = null;
  private callbacks: LiveCallbacks;
  private isConnected: boolean = false;
  private setupComplete: boolean = false;
  private audioContext: AudioContext | null = null;
  private audioQueue: AudioBuffer[] = [];
  private nextPlayTime: number = 0;  // For seamless audio scheduling
  private lastAudioTime: number = 0;  // Track last audio playback
  private audioResetInterval: number = 30000;  // Reset audio context every 30 seconds of silence
  private sessionStartTime: number = 0;  // Track session start for 15-min limit
  private maxSessionDuration: number = 14 * 60 * 1000;  // 14 minutes (before 15-min limit)
  private sessionCheckInterval: ReturnType<typeof setInterval> | null = null;
  private playedBuffersCount: number = 0;  // Track buffers to reset periodically
  private enableComputerUse: boolean = false;  // Enable Computer Use tools
  private pageContext: PageContext | null = null;  // Current page context

  constructor(callbacks: LiveCallbacks, enableComputerUse: boolean = false) {
    this.callbacks = callbacks;
    this.enableComputerUse = enableComputerUse;
  }

  // Reset audio context to prevent degradation
  private resetAudioContext() {
    console.log("Live API: Resetting AudioContext to prevent degradation");
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
    this.audioContext = new AudioContext({ sampleRate: 24000 });
    this.nextPlayTime = 0;
    this.playedBuffersCount = 0;
  }

  // Check if audio context needs reset (only during silence, never during active speech)
  private checkAudioContextHealth() {
    const now = Date.now();

    // Only reset if there's been significant silence (not during active playback)
    // This prevents interrupting ongoing speech
    if (this.lastAudioTime > 0 && (now - this.lastAudioTime) > this.audioResetInterval) {
      // Reset buffer count on silence to allow fresh start
      this.playedBuffersCount = 0;
      this.resetAudioContext();
      return;
    }
  }

  // Start session timeout checking
  private startSessionCheck() {
    // Clear any existing interval
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
    }

    // Check every 30 seconds if we're approaching the 15-min limit
    this.sessionCheckInterval = setInterval(() => {
      const elapsed = Date.now() - this.sessionStartTime;

      if (elapsed >= this.maxSessionDuration) {
        console.log("Live API: Approaching 15-min session limit, auto-reconnecting...");
        this.autoReconnect();
      }
    }, 30000);
  }

  // Auto-reconnect to avoid session timeout
  private async autoReconnect() {
    console.log("Live API: Auto-reconnecting to refresh session...");

    // Clear the session check interval
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
      this.sessionCheckInterval = null;
    }

    // Close current connection
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Small delay before reconnecting
    await new Promise(resolve => setTimeout(resolve, 500));

    // Reconnect
    try {
      await this.connect();
      console.log("Live API: Auto-reconnect successful");
    } catch (error) {
      console.error("Live API: Auto-reconnect failed", error);
      this.callbacks.onError(new Error("Reconexión automática fallida. Por favor reconecta manualmente."));
    }
  }

  async connect(): Promise<void> {
    // Get API key from database or fallback to env
    let apiKey = await getApiKeyWithCache('google');
    if (!apiKey) {
      apiKey = GOOGLE_API_KEY;
    }

    return new Promise((resolve, reject) => {
      try {
        console.log("Live API: Checking configuration...");

        if (!apiKey) {
          const error = new Error('API key de Google no configurada. Configúrala en Ajustes.');
          console.error("Live API:", error.message);
          reject(error);
          return;
        }

        if (!LIVE_API_URL) {
          const error = new Error('URL de Live API no configurada');
          console.error("Live API:", error.message);
          reject(error);
          return;
        }

        const url = `${LIVE_API_URL}?key=${apiKey}`;
        console.log("Live API: Connecting to WebSocket...");
        console.log("Live API: Model:", MODELS.LIVE);
        console.log("Live API: URL:", LIVE_API_URL);

        this.ws = new WebSocket(url);

        const timeout = setTimeout(() => {
          if (!this.isConnected) {
            this.ws?.close();
            reject(new Error('Tiempo de conexión agotado'));
          }
        }, 15000);

        this.ws.onopen = () => {
          console.log("Live API: Connected, sending setup...");
          clearTimeout(timeout);
          this.isConnected = true;
          this.sessionStartTime = Date.now();

          // Start session timeout check (reconnect before 15-min limit)
          this.startSessionCheck();

          // Build system instruction based on mode
          let systemInstructionText = "Eres Lia, una asistente de productividad amigable y eficiente. Responde siempre en español de forma concisa y útil.";

          if (this.enableComputerUse) {
            // Use Computer Use system prompt when enabled
            systemInstructionText = WEB_AGENT_SYSTEM_PROMPT;
          } else {
            // Normal mode - add search instruction
            systemInstructionText += " Cuando el usuario pregunte sobre información actual, noticias, clima, eventos recientes o cualquier dato que requiera información actualizada, usa la herramienta de búsqueda de Google para obtener información precisa y actual.";
          }

          // Build tools array
          const tools: any[] = [];

          if (this.enableComputerUse) {
            // Add Computer Use tools (click, type, scroll, etc.)
            tools.push(...WEB_AGENT_TOOLS);
          }

          // Always add Google Search
          tools.push({ googleSearch: {} });

          // Setup message format according to BidiGenerateContent API
          const setupMessage = {
            setup: {
              model: `models/${MODELS.LIVE}`,
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: "Aoede"  // Female voice for Lia
                    }
                  }
                }
              },
              // Enable automatic voice activity detection so the model knows when user stops speaking
              realtimeInputConfig: {
                automaticActivityDetection: {
                  disabled: false  // VAD enabled
                }
              },
              systemInstruction: {
                parts: [{
                  text: systemInstructionText
                }]
              },
              tools: tools
            }
          };

          console.log("Live API: Setup message:", JSON.stringify(setupMessage, null, 2));
          this.send(setupMessage);
        };

        this.ws.onmessage = async (event) => {
          try {
            let data: any;

            // Check if data is binary (Blob)
            if (event.data instanceof Blob) {
              // Convert Blob to text first to check if it's JSON
              const text = await event.data.text();
              try {
                data = JSON.parse(text);
                console.log("Live API: Received JSON in Blob");
              } catch {
                // It's truly binary audio data
                console.log("Live API: Received binary audio, size:", event.data.size);
                const arrayBuffer = await event.data.arrayBuffer();
                this.handleBinaryAudio(new Uint8Array(arrayBuffer));
                return;
              }
            } else {
              // It's text JSON
              data = JSON.parse(event.data);
            }

            // Setup complete
            if (data.setupComplete) {
              console.log("Live API: Setup complete!");
              this.setupComplete = true;
              this.callbacks.onReady();
              resolve();
              return;
            }

            // Error from server
            if (data.error) {
              console.error("Live API: Server error:", JSON.stringify(data.error));
              const errorCode = data.error.code || '';
              const errorMessage = data.error.message || 'Error del servidor';
              const errorStatus = data.error.status || '';

              let userFriendlyMsg = errorMessage;
              if (errorStatus === 'INVALID_ARGUMENT') {
                userFriendlyMsg = `Configuración inválida: ${errorMessage}`;
              } else if (errorStatus === 'PERMISSION_DENIED') {
                userFriendlyMsg = 'Sin permisos para usar Live API. Verifica tu API key.';
              } else if (errorCode === 429) {
                userFriendlyMsg = 'Límite de uso alcanzado. Intenta más tarde.';
              }

              this.callbacks.onError(new Error(userFriendlyMsg));
              return;
            }

            // Process server content (JSON with audio/text)
            if (data.serverContent) {
              this.processServerContent(data.serverContent);
            }

          } catch (e) {
            console.error("Live API: Message processing error", e);
          }
        };

        this.ws.onerror = (event) => {
          console.error("Live API: WebSocket error", event);
          clearTimeout(timeout);
          this.isConnected = false;
          // Provide more context for common error scenarios
          let errorMsg = 'Error de conexión WebSocket';
          if (!navigator.onLine) {
            errorMsg = 'Sin conexión a internet';
          }
          this.callbacks.onError(new Error(errorMsg));
          reject(new Error(errorMsg));
        };

        this.ws.onclose = (event) => {
          console.log("Live API: WebSocket closed", event.code, event.reason);
          this.isConnected = false;
          this.setupComplete = false;

          // Provide meaningful error messages based on close codes
          let closeReason = event.reason || '';
          if (event.code === 1006) {
            closeReason = 'Conexión cerrada inesperadamente. Verifica tu conexión a internet.';
          } else if (event.code === 1008) {
            closeReason = 'Tu API key no tiene acceso a la Live API. Necesitas habilitar "Generative Language API" en Google Cloud Console y verificar que tu proyecto tenga acceso a modelos Live.';
          } else if (event.code === 1011) {
            closeReason = 'Error del servidor de Live API. Intenta más tarde.';
          }

          if (closeReason && !this.setupComplete) {
            console.warn("Live API: Close reason:", closeReason);
            // Only call onError if setup wasn't complete (actual connection error)
            this.callbacks.onError(new Error(closeReason));
          }

          this.callbacks.onClose();
        };

        // Secondary timeout for setup - mark as complete anyway so audio can be sent
        setTimeout(() => {
          if (this.isConnected && !this.setupComplete) {
            console.log("Live API: Setup timeout, marking as ready anyway...");
            this.setupComplete = true;  // Allow audio to be sent
            this.callbacks.onReady();
            resolve();
          }
        }, 3000);

      } catch (error) {
        reject(error);
      }
    });
  }

  private async processServerContent(content: any) {
    if (!content.modelTurn?.parts) return;

    for (const part of content.modelTurn.parts) {
      // Text response
      if (part.text) {
        console.log("Live API: Text response:", part.text);
        this.callbacks.onTextResponse(part.text);
      }

      // Audio response (inline data)
      if (part.inlineData?.data) {
        console.log("Live API: Audio response received");
        this.callbacks.onAudioResponse(part.inlineData.data);
        this.playAudio(part.inlineData.data);
      }

      // Function call - execute and send result back
      if (part.functionCall) {
        console.log("Live API: Function call:", part.functionCall);
        await this.handleFunctionCall(part.functionCall);
      }
    }

    // Check if turn is complete
    if (content.turnComplete) {
      console.log("Live API: Turn complete");
    }
  }

  private async handleFunctionCall(functionCall: { name: string; args: any }) {
    if (!this.callbacks.onFunctionCall) {
      console.warn("Live API: Function call received but no handler provided");
      return;
    }

    try {
      console.log(`Live API: Executing function ${functionCall.name} with args:`, functionCall.args);

      // Execute the function via callback
      const result = await this.callbacks.onFunctionCall(functionCall);

      // Send function response back to the model
      this.send({
        toolResponse: {
          functionResponses: [{
            name: functionCall.name,
            response: {
              result: result
            }
          }]
        }
      });

      console.log(`Live API: Function ${functionCall.name} executed successfully`);
    } catch (error: any) {
      console.error(`Live API: Function ${functionCall.name} failed:`, error);

      // Send error response back to the model
      this.send({
        toolResponse: {
          functionResponses: [{
            name: functionCall.name,
            response: {
              error: error.message || "Function execution failed"
            }
          }]
        }
      });
    }
  }

  // Handle raw binary audio data
  private handleBinaryAudio(bytes: Uint8Array) {
    // Skip if too small
    if (bytes.length < 100) {
      console.log("Live API: Skipping small binary chunk:", bytes.length, "bytes");
      return;
    }

    // Ensure byte length is even for Int16Array
    let audioBytes = bytes;
    if (bytes.length % 2 !== 0) {
      audioBytes = new Uint8Array(bytes.length + 1);
      audioBytes.set(bytes);
    }

    this.playRawAudio(audioBytes);
  }

  // Play raw PCM audio bytes
  private async playRawAudio(bytes: Uint8Array) {
    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext({ sampleRate: 24000 });
      }

      // Convert PCM to AudioBuffer (16-bit signed, 24kHz, mono)
      const pcmData = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
      const floatData = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 32768.0;
      }

      const audioBuffer = this.audioContext.createBuffer(1, floatData.length, 24000);
      audioBuffer.copyToChannel(floatData, 0);

      this.audioQueue.push(audioBuffer);
      this.playNextInQueue();
    } catch (e) {
      console.error("Live API: Raw audio playback error", e);
    }
  }

  // Play audio from base64 PCM data
  private async playAudio(base64Audio: string) {
    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext({ sampleRate: 24000 });
      }

      // Decode base64 to ArrayBuffer
      const binaryString = atob(base64Audio);
      let bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Ensure byte length is even (required for Int16Array)
      if (bytes.length % 2 !== 0) {
        // Pad with zero byte if odd
        const paddedBytes = new Uint8Array(bytes.length + 1);
        paddedBytes.set(bytes);
        paddedBytes[bytes.length] = 0;
        bytes = paddedBytes;
      }

      // Skip if too small (likely just a header or noise)
      if (bytes.length < 100) {
        console.log("Live API: Skipping small audio chunk:", bytes.length, "bytes");
        return;
      }

      // Convert PCM to AudioBuffer (16-bit signed, 24kHz, mono, little-endian)
      const pcmData = new Int16Array(bytes.buffer);
      const floatData = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 32768.0;
      }

      const audioBuffer = this.audioContext.createBuffer(1, floatData.length, 24000);
      audioBuffer.copyToChannel(floatData, 0);

      // Queue and play
      this.audioQueue.push(audioBuffer);
      this.playNextInQueue();

    } catch (e) {
      console.error("Live API: Audio playback error", e);
    }
  }

  private playNextInQueue() {
    if (this.audioQueue.length === 0) {
      // Only check health when queue is empty (silence period)
      // This prevents resetting during active speech
      this.checkAudioContextHealth();
      return;
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 24000 });
      this.nextPlayTime = 0;
    }

    // Update last audio time (used to detect silence periods)
    this.lastAudioTime = Date.now();

    // Process all queued buffers at once for seamless playback
    while (this.audioQueue.length > 0) {
      const buffer = this.audioQueue.shift()!;

      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);

      // Schedule precisely to avoid gaps
      const currentTime = this.audioContext.currentTime;
      const startTime = Math.max(currentTime + 0.01, this.nextPlayTime);

      // Schedule next buffer to start right when this one ends
      this.nextPlayTime = startTime + buffer.duration;

      source.start(startTime);
      this.playedBuffersCount++;
    }
  }

  send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  // Send audio chunk (PCM 16-bit, 16kHz, mono as base64)
  sendAudioChunk(base64Audio: string) {
    if (!this.isReady()) {
      console.log("Live API: Not ready to send audio, isConnected:", this.isConnected, "setupComplete:", this.setupComplete);
      return;
    }

    // Log first few sends
    console.log("Live API: Sending audio chunk, size:", base64Audio.length);

    this.send({
      realtimeInput: {
        mediaChunks: [{
          mimeType: "audio/pcm;rate=16000",
          data: base64Audio
        }]
      }
    });
  }

  // Send text message
  sendText(text: string) {
    if (!this.isReady()) return;

    this.send({
      clientContent: {
        turns: [{
          role: "user",
          parts: [{ text }]
        }],
        turnComplete: true
      }
    });
  }

  // Update page context (accessibility tree + screenshot)
  updatePageContext(context: PageContext) {
    this.pageContext = context;
    console.log("Live API: Page context updated", { url: context.url, title: context.title });
  }

  // Send page context to the model
  sendPageContext() {
    if (!this.isReady()) return;
    if (!this.pageContext) {
      console.warn("Live API: No page context available");
      return;
    }

    const contextMessage = `=== ESTADO ACTUAL DE LA PÁGINA ===
URL: ${this.pageContext.url}
Título: ${this.pageContext.title}

ACCESSIBILITY TREE (elementos interactivos):
${this.pageContext.accessibilityTree}

=== FIN DEL ESTADO ===`;

    // Send context with screenshot
    this.send({
      clientContent: {
        turns: [{
          role: "user",
          parts: [
            { text: contextMessage },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: this.pageContext.screenshot
              }
            }
          ]
        }],
        turnComplete: true
      }
    });

    console.log("Live API: Page context sent to model");
  }

  // Signal end of audio input turn (when user manually stops mic)
  // This tells the model to generate a response based on audio received so far
  endAudioTurn() {
    if (!this.isReady()) return;
    
    console.log("Live API: Signaling end of audio turn");
    this.send({
      clientContent: {
        turnComplete: true
      }
    });
  }

  isReady(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN && this.setupComplete;
  }

  disconnect() {
    this.isConnected = false;
    this.setupComplete = false;

    // Clear session check interval
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
      this.sessionCheckInterval = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.audioQueue = [];
    this.nextPlayTime = 0;
    this.playedBuffersCount = 0;
    this.lastAudioTime = 0;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Helper class to capture microphone audio using Offscreen Document
// This is required for Manifest V3 extensions where getUserMedia doesn't work in popups/side panels
export class AudioCapture {
  private onAudioData: ((base64: string) => void) | null = null;
  private isCapturing: boolean = false;
  private messageListener: ((message: any) => void) | null = null;

  async start(onAudioData: (base64: string) => void): Promise<void> {
    this.onAudioData = onAudioData;

    try {
      // Setup listener for audio data from offscreen document (relayed via background)
      let audioChunkCount = 0;
      this.messageListener = (message: any) => {
        if (message.type === 'OFFSCREEN_AUDIO_DATA' && this.onAudioData) {
          audioChunkCount++;
          // Log every 20th chunk to avoid spam
          if (audioChunkCount % 20 === 1) {
            console.log(`AudioCapture: Received chunk #${audioChunkCount}, size: ${message.data?.length || 0}`);
          }
          this.onAudioData(message.data);
        }
      };
      chrome.runtime.onMessage.addListener(this.messageListener);
      console.log("AudioCapture: Message listener registered");

      // Create offscreen document if it doesn't exist
      await this.setupOffscreenDocument();

      // Tell offscreen document to start capturing
      const response = await chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'start-audio-capture'
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Failed to start audio capture in offscreen document');
      }

      this.isCapturing = true;
      console.log("AudioCapture: Started successfully via offscreen document");

    } catch (e: any) {
      console.error("AudioCapture: Failed to start", e);
      
      // Cleanup listener on failure
      if (this.messageListener) {
        chrome.runtime.onMessage.removeListener(this.messageListener);
        this.messageListener = null;
      }
      
      // Provide more helpful error messages
      let errorMessage = 'Error al acceder al micrófono';
      
      if (e.message?.includes('NotAllowedError') || e.message?.includes('Permission')) {
        errorMessage = 'Permiso de micrófono denegado. Por favor, permite el acceso al micrófono.';
      } else if (e.message?.includes('NotFound')) {
        errorMessage = 'No se encontró ningún micrófono. Por favor, conecta un micrófono y vuelve a intentar.';
      } else if (e.message) {
        errorMessage = `Error de micrófono: ${e.message}`;
      }
      
      const error = new Error(errorMessage);
      error.name = 'AudioCaptureError';
      throw error;
    }
  }

  private async setupOffscreenDocument(): Promise<void> {
    // Check if offscreen document already exists
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT as any]
    });

    if (existingContexts.length > 0) {
      console.log("AudioCapture: Offscreen document already exists");
      return;
    }

    // Create a new offscreen document
    console.log("AudioCapture: Creating offscreen document...");
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.USER_MEDIA as any],
      justification: 'Microphone access for voice input'
    });
    
    // Wait a bit for the document to be ready
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log("AudioCapture: Offscreen document created");
  }

  stop() {
    if (this.messageListener) {
      chrome.runtime.onMessage.removeListener(this.messageListener);
      this.messageListener = null;
    }

    if (this.isCapturing) {
      // Tell offscreen document to stop capturing
      chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'stop-audio-capture'
      }).catch(() => {
        // Offscreen might already be closed
      });
    }

    this.isCapturing = false;
    this.onAudioData = null;
    console.log("AudioCapture: Stopped");
  }
}
