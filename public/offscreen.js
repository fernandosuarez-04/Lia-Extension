// Offscreen document for audio capture in Chrome Extension Manifest V3
// This runs in a separate context that has access to getUserMedia

console.log('Soflia Offscreen Audio Worker loaded');

let mediaStream = null;
let audioContext = null;
let processor = null;
let isCapturing = false;

// Handle messages from the service worker/popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  switch (message.action) {
    case 'start-audio-capture':
      startCapture()
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true; // Keep channel open for async response

    case 'stop-audio-capture':
      stopCapture();
      sendResponse({ success: true });
      break;

    case 'ping':
      sendResponse({ alive: true, capturing: isCapturing });
      break;
  }
});

async function startCapture() {
  if (isCapturing) {
    console.log('Already capturing');
    return;
  }

  try {
    // Request microphone access
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    // Create audio context
    audioContext = new AudioContext();
    const nativeSampleRate = audioContext.sampleRate;
    const resamplerRatio = nativeSampleRate / 16000;

    console.log('Offscreen: Native sample rate:', nativeSampleRate, 'Resampler ratio:', resamplerRatio);

    const source = audioContext.createMediaStreamSource(mediaStream);
    const bufferSize = 4096;
    processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

    processor.onaudioprocess = (e) => {
      if (!isCapturing) return;

      const inputData = e.inputBuffer.getChannelData(0);

      // Resample to 16kHz if needed
      let resampledData;
      if (resamplerRatio !== 1) {
        const outputLength = Math.floor(inputData.length / resamplerRatio);
        resampledData = new Float32Array(outputLength);
        for (let i = 0; i < outputLength; i++) {
          const srcIndex = Math.floor(i * resamplerRatio);
          resampledData[i] = inputData[srcIndex];
        }
      } else {
        resampledData = inputData;
      }

      // Convert Float32 to Int16 PCM
      const pcmData = new Int16Array(resampledData.length);
      for (let i = 0; i < resampledData.length; i++) {
        const s = Math.max(-1, Math.min(1, resampledData[i]));
        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      // Convert to base64
      const bytes = new Uint8Array(pcmData.buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      // Log every 10th chunk to avoid console spam
      if (Math.random() < 0.1) {
        console.log('Offscreen: Sending audio chunk, size:', base64.length);
      }

      // Send audio data to the background service worker
      // The background will relay it to the sidepanel/popup
      chrome.runtime.sendMessage({
        type: 'OFFSCREEN_AUDIO_DATA',
        data: base64
      }).catch((err) => {
        // Only log actual errors, not closed popup errors
        if (err?.message && !err.message.includes('Receiving end does not exist')) {
          console.warn('Offscreen: Failed to send audio:', err.message);
        }
      });
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    isCapturing = true;
    console.log('Offscreen: Audio capture started successfully');

  } catch (err) {
    console.error('Offscreen: Failed to start audio capture:', err);
    throw err;
  }
}

function stopCapture() {
  isCapturing = false;

  if (processor) {
    processor.disconnect();
    processor = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  console.log('Offscreen: Audio capture stopped');
}
