/**
 * Google Meet Caption Transcription Service
 *
 * NEW APPROACH: Instead of extracting text from individual mutations,
 * we use MutationObserver only as a TRIGGER, then read the full
 * caption container text with debouncing.
 *
 * This prevents duplicate captures and ensures clean text extraction.
 */

import { findCaptionContainer, hideCaptionsVisually } from './meet-detector';

export interface CaptionEntry {
  speaker: string;
  text: string;
  timestamp: number;
}

export type CaptionCallback = (entry: CaptionEntry) => void;

/**
 * MeetCaptionObserver - Debounced caption reading from container
 */
export class MeetCaptionObserver {
  private observer: MutationObserver | null = null;
  private captionContainer: HTMLElement | null = null;
  private onCaption: CaptionCallback | null = null;
  private isRunning = false;
  private retryCount = 0;
  private maxRetries = 30;
  private retryInterval: ReturnType<typeof setInterval> | null = null;

  // Debounce timer for reading container
  private readTimer: ReturnType<typeof setTimeout> | null = null;
  private readDebounceMs = 1500; // Wait 1.5s after last mutation before reading

  // Last emitted text to avoid duplicates
  private lastEmittedText = '';

  /**
   * Start observing for captions
   */
  start(callback: CaptionCallback): void {
    if (this.isRunning) {
      console.log('SOFLIA Transcription: Already running');
      return;
    }

    this.onCaption = callback;
    this.isRunning = true;
    this.retryCount = 0;

    console.log('SOFLIA Transcription: Starting...');

    // Try to find container immediately
    this.findAndObserveContainer();

    // Retry periodically until container found
    this.retryInterval = setInterval(() => {
      if (!this.captionContainer && this.retryCount < this.maxRetries) {
        this.retryCount++;
        console.log(`SOFLIA Transcription: Searching for captions... (${this.retryCount}/${this.maxRetries})`);
        this.findAndObserveContainer();
      } else if (this.captionContainer) {
        if (this.retryInterval) {
          clearInterval(this.retryInterval);
          this.retryInterval = null;
        }
      } else if (this.retryCount >= this.maxRetries) {
        if (this.retryInterval) {
          clearInterval(this.retryInterval);
          this.retryInterval = null;
        }
        console.log('SOFLIA Transcription: Max retries reached');
      }
    }, 2000);
  }

  /**
   * Stop observing
   */
  stop(): void {
    this.isRunning = false;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
    }

    if (this.readTimer) {
      clearTimeout(this.readTimer);
      this.readTimer = null;
    }

    this.captionContainer = null;
    this.lastEmittedText = '';
    console.log('SOFLIA Transcription: Stopped');
  }

  isCaptionsDetected(): boolean {
    return this.captionContainer !== null;
  }

  getCaptionRoot(): HTMLElement | null {
    return this.captionContainer;
  }

  resetContainer(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.captionContainer = null;
    this.findAndObserveContainer();
  }

  /**
   * Find caption container and start observing it
   */
  private findAndObserveContainer(): void {
    const container = findCaptionContainer();

    if (container && container !== this.captionContainer) {
      this.captionContainer = container;
      console.log('SOFLIA Transcription: Caption container found');

      // Hide visually (only clip-path, keep dimensions intact)
      hideCaptionsVisually(container);

      // Start observing - mutations only trigger a debounced read
      this.observeContainer(container);
    }
  }

  /**
   * Set up MutationObserver on the caption container.
   * The observer ONLY triggers a debounced read of the full container.
   * It does NOT extract text from individual mutations.
   */
  private observeContainer(container: HTMLElement): void {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver(() => {
      // Any mutation in the container → schedule a read
      this.scheduleRead();
    });

    this.observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Do an initial read
    this.scheduleRead();

    console.log('SOFLIA Transcription: Observing container');
  }

  /**
   * Schedule a debounced read of the caption container
   * Waits for mutations to settle before reading
   */
  private scheduleRead(): void {
    if (this.readTimer) {
      clearTimeout(this.readTimer);
    }

    this.readTimer = setTimeout(() => {
      this.readCaptionContainer();
    }, this.readDebounceMs);
  }

  /**
   * Read the full caption container and extract speaker + text
   */
  private readCaptionContainer(): void {
    if (!this.captionContainer || !this.onCaption) return;

    // Extract speaker and text from the container structure
    const { speaker, text } = this.extractSpeakerAndText(this.captionContainer);

    if (!text || text.length < 3) return;

    // Check if this is the same as what we already emitted
    if (text === this.lastEmittedText) return;

    // Check if this is just a small extension of the previous text
    // In that case, only emit if it's significantly different
    if (this.lastEmittedText && text.startsWith(this.lastEmittedText)) {
      const newPart = text.slice(this.lastEmittedText.length).trim();
      // If less than 5 new characters, wait for more
      if (newPart.length < 5) return;
    }

    // Emit the caption
    const now = Date.now();
    this.lastEmittedText = text;

    this.onCaption({
      speaker,
      text,
      timestamp: now
    });
  }

  /**
   * Extract speaker name and caption text from the container structure
   *
   * Google Meet caption structure typically:
   * <container>
   *   <entry>
   *     <img> (speaker avatar)
   *     <div>Speaker Name</div>
   *     <div>Caption text...</div>
   *   </entry>
   * </container>
   */
  private extractSpeakerAndText(container: HTMLElement): { speaker: string; text: string } {
    let speaker = 'Participante';
    let captionText = '';

    try {
      // Clone to avoid modifying the DOM
      const clone = container.cloneNode(true) as HTMLElement;

      // Remove buttons, icons, and UI elements
      clone.querySelectorAll(
        'button, [role="button"], svg, [role="img"], ' +
        '[class*="icon"], [aria-hidden="true"], input, select'
      ).forEach(el => el.remove());

      // Get all text content
      const fullText = clone.textContent?.trim() || '';
      if (!fullText) return { speaker, text: '' };

      // Try to find the speaker name
      // Method 1: Look for img elements followed by text (avatar + name pattern)
      const imgElements = container.querySelectorAll('img');
      if (imgElements.length > 0) {
        // The name is usually right after or near the image
        for (const img of imgElements) {
          const nextEl = img.nextElementSibling;
          if (nextEl instanceof HTMLElement) {
            const nameText = nextEl.textContent?.trim() || '';
            // Name should be short (1-4 words, under 60 chars)
            if (nameText.length > 1 && nameText.length < 60 &&
                nameText.split(/\s+/).length <= 5) {
              speaker = nameText;
              // Caption text is everything after the speaker name
              const nameIndex = fullText.indexOf(nameText);
              if (nameIndex !== -1) {
                captionText = fullText.slice(nameIndex + nameText.length).trim();
              }
              break;
            }
          }
        }
      }

      // Method 2: If no speaker found via img, try to find by structure
      // The first short line is often the speaker name
      if (captionText === '' || speaker === 'Participante') {
        const children = Array.from(container.children);
        for (const child of children) {
          if (!(child instanceof HTMLElement)) continue;

          // Look for caption entry elements (direct children of container)
          const childText = child.textContent?.trim() || '';
          if (!childText) continue;

          // Try to split first line as speaker
          const lines = childText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          if (lines.length >= 2) {
            const firstLine = lines[0];
            // First line is likely speaker if it's short (a name)
            if (firstLine.length < 60 && firstLine.split(/\s+/).length <= 5) {
              speaker = firstLine;
              captionText = lines.slice(1).join(' ').trim();
              break;
            }
          }
        }
      }

      // Method 3: Fallback - use data-self-name from page
      if (speaker === 'Participante') {
        const selfNameEl = document.querySelector('[data-self-name]');
        if (selfNameEl) {
          const selfName = selfNameEl.getAttribute('data-self-name');
          if (selfName && selfName.length > 1) {
            speaker = selfName;
          }
        }
      }

      // If no caption text extracted by methods above, use full text
      if (!captionText) {
        captionText = fullText;
        // Try to remove speaker name from the beginning
        if (speaker !== 'Participante' && captionText.startsWith(speaker)) {
          captionText = captionText.slice(speaker.length).trim();
        }
      }

      // Clean up caption text
      captionText = captionText.replace(/\s+/g, ' ').trim();

      // Filter out UI text that might sneak in
      if (this.isNotCaption(captionText)) {
        return { speaker, text: '' };
      }

    } catch (e) {
      console.error('SOFLIA: Error extracting caption:', e);
    }

    return { speaker, text: captionText };
  }

  /**
   * Check if text is NOT a caption (is UI/icon/button text)
   */
  private isNotCaption(text: string): boolean {
    const lower = text.toLowerCase().trim();

    // Material icon names
    if (/^[a-z]+(_[a-z]+)+$/.test(lower)) return true;

    // Known UI identifiers
    const knownUI = [
      'closed_caption', 'closed_caption_off', 'call_end', 'mic', 'mic_off',
      'videocam', 'videocam_off', 'present_to_all', 'screen_share',
      'more_vert', 'more_horiz', 'settings', 'fullscreen',
      'volume_up', 'volume_down', 'volume_off', 'volume_mute',
      'pan_tool', 'grid_view', 'view_sidebar',
      'chat', 'info', 'close', 'done', 'check', 'stop', 'play', 'pause',
      'record', 'security', 'keyboard', 'emoji', 'hand', 'people',
      'effects', 'background', 'reaction'
    ];
    if (knownUI.includes(lower)) return true;

    // Timestamps
    if (/^\d+:\d+(:\d+)?$/.test(lower)) return true;

    // Pure numbers
    if (/^\d+$/.test(lower)) return true;

    // UI action labels
    const uiStarts = [
      /^(activar|desactivar|habilitar|deshabilitar|enable|disable)\b/i,
      /^(turn on|turn off)\b/i,
      /^(subtítulo|subtitle|caption|closed caption)\b/i,
      /^(compartir pantalla|share screen)\b/i,
      /^(salir de la llamada|leave call|hang up|end call)\b/i,
    ];
    for (const pattern of uiStarts) {
      if (pattern.test(lower)) return true;
    }

    // CSS class-like identifiers
    if (/^[a-z][a-z0-9]*[-_][a-z0-9-_]+$/.test(lower)) return true;

    return false;
  }
}

/**
 * Singleton instance
 */
let observerInstance: MeetCaptionObserver | null = null;

export function getMeetCaptionObserver(): MeetCaptionObserver {
  if (!observerInstance) {
    observerInstance = new MeetCaptionObserver();
  }
  return observerInstance;
}

export function startCaptionObservation(callback: CaptionCallback): MeetCaptionObserver {
  const observer = getMeetCaptionObserver();
  observer.start(callback);
  return observer;
}

export function stopCaptionObservation(): void {
  if (observerInstance) {
    observerInstance.stop();
    observerInstance = null;
  }
}
