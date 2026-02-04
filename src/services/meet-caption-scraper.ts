/**
 * MeetCaptionScraper - Simple, robust CC scraper (Tactiq-style)
 *
 * Reads Google Meet's live captions directly from known DOM selectors.
 * NO complex mutation detection — just simple polling.
 * NO hiding logic — focus ONLY on reliable transcription.
 */

export interface CaptionEntry {
  speaker: string;
  text: string;
  timestamp: number;
}

export class MeetCaptionScraper {
  private onCaption: ((entry: CaptionEntry) => void) | null = null;
  private isRunning = false;
  private lastEmittedText = '';
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  // Known CC container selectors for Google Meet (as of 2024-2025)
  // These jscontroller values are stable across Meet versions
  private static readonly CC_CONTAINER_SELECTORS = [
    'div[jscontroller="TEjq6e"]',      // Primary Meet CC container
    'div[jscontroller="mbtgMb"]',      // Alternative
    'div[jscontroller="r4E1ne"]',      // Another variant
    '[aria-live="polite"]',            // Generic live region (fallback)
    '[role="log"]',                    // Accessibility role (fallback)
  ];

  // Speaker name selectors (within CC container)
  private static readonly SPEAKER_SELECTORS = [
    '.zs7s8d',           // Meet's speaker name class
    '[class*="speaker"]',
  ];

  // Caption text selectors (within CC container)
  private static readonly TEXT_SELECTORS = [
    '.CNusmb',          // Meet's caption text class
    '.iTTPOb',          // Alternative
    '[class*="caption"]',
  ];

  start(onCaption: (entry: CaptionEntry) => void): void {
    if (this.isRunning) return;
    this.onCaption = onCaption;
    this.isRunning = true;
    this.lastEmittedText = '';

    console.log('MeetCaptionScraper: Starting simple polling mode');

    // Poll every 500ms for new caption text
    this.pollInterval = setInterval(() => this.poll(), 500);
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
    this.lastEmittedText = '';
    console.log('MeetCaptionScraper: Stopped');
  }

  isCaptionsDetected(): boolean {
    return this.findContainer() !== null;
  }

  getCaptionRoot(): Element | null {
    return this.findContainer();
  }

  resetContainer(): void {
    // No-op in simple mode — we just keep polling
  }

  // ---- Private methods ----

  private poll(): void {
    const container = this.findContainer();
    if (!container) return;

    const { speaker, text } = this.extractText(container);
    if (!text) return;

    // System message filter — basic patterns only
    if (this.isSystemMessage(text)) {
      console.log('MeetCaptionScraper: System message filtered:', text.substring(0, 50));
      return;
    }

    // Dedup: only emit if text changed
    if (text === this.lastEmittedText) return;

    this.lastEmittedText = text;
    console.log('MeetCaptionScraper: Caption —', speaker, ':', text);

    if (this.onCaption) {
      this.onCaption({ speaker, text, timestamp: Date.now() });
    }
  }

  private findContainer(): Element | null {
    // Try each selector in order
    for (const selector of MeetCaptionScraper.CC_CONTAINER_SELECTORS) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const rect = el.getBoundingClientRect();
          const text = el.textContent?.trim();

          // Basic validation: element must be visible, in lower viewport, have text
          if (rect.width > 100 && rect.height > 10 &&
              rect.top > window.innerHeight * 0.3 &&  // Lower portion of screen
              text && text.length > 2) {
            return el;
          }
        }
      } catch { /* skip invalid selector */ }
    }
    return null;
  }

  private extractText(container: Element): { speaker: string; text: string } {
    // Try structured extraction first (speaker + text elements)
    let speaker = '';
    let text = '';

    // Find speaker
    for (const sel of MeetCaptionScraper.SPEAKER_SELECTORS) {
      try {
        const els = container.querySelectorAll(sel);
        if (els.length > 0) {
          const last = els[els.length - 1];  // Most recent speaker
          const name = last.textContent?.trim();
          if (name && name.length > 0 && name.length < 100) {
            speaker = name;
            break;
          }
        }
      } catch { /* skip */ }
    }

    // Find text
    for (const sel of MeetCaptionScraper.TEXT_SELECTORS) {
      try {
        const els = container.querySelectorAll(sel);
        if (els.length > 0) {
          // Concatenate all text spans
          text = Array.from(els)
            .map(el => el.textContent?.trim() || '')
            .filter(t => t.length > 0)
            .join(' ');
          if (text) break;
        }
      } catch { /* skip */ }
    }

    // Fallback: extract from container's full text
    if (!text) {
      const raw = container.textContent?.trim() || '';
      const parsed = this.parseRawText(raw);
      speaker = speaker || parsed.speaker;
      text = parsed.text;
    }

    return {
      speaker: speaker || 'Participante',
      text: text || ''
    };
  }

  private parseRawText(raw: string): { speaker: string; text: string } {
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return { speaker: '', text: '' };

    // Simple heuristic: first short line is speaker, rest is text
    if (lines.length >= 2 && lines[0].length < 50) {
      return {
        speaker: lines[0],
        text: lines.slice(1).join(' ')
      };
    }

    return {
      speaker: '',
      text: lines.join(' ')
    };
  }

  private isSystemMessage(text: string): boolean {
    // Minimal system message patterns — only the most common
    const patterns = [
      /te uniste/i,
      /you joined/i,
      /left the/i,
      /se fue/i,
      /unió a la llamada/i,
      /joined the/i,
      /preparando/i,
      /preparing/i,
      /llamada.*terminad/i,
      /call.*ended/i,
      /meeting.*ended/i,
      /subtítulos/i,
      /subtitles/i,
      /captions/i,
      /permit.*cámara/i,         // "Permite el acceso a la cámara"
      /camera.*permission/i,
      /permit.*micrófono/i,
      /microphone.*permission/i,
    ];

    return patterns.some(p => p.test(text));
  }
}

export default MeetCaptionScraper;
