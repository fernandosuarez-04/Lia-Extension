/**
 * MeetCaptionScraper - Scrapes Google Meet's built-in CC (Closed Captions)
 *
 * Same approach as Tactiq: reads the caption text directly from the DOM.
 * Requires the user to enable CC in Google Meet (click the CC button).
 *
 * Benefits over audio-based transcription:
 * - Speaker names come from Google's own system (no guessing)
 * - Real-time: text appears as it's spoken, no buffering
 * - Zero hallucinations: text is from Google's own speech engine
 * - No Gemini API calls needed for transcription
 *
 * Usage:
 *   const scraper = new MeetCaptionScraper();
 *   scraper.start((entry) => console.log(entry.speaker, entry.text));
 */

export interface CaptionEntry {
  speaker: string;
  text: string;
  timestamp: number;
}

export class MeetCaptionScraper {
  private observer: MutationObserver | null = null;
  private onCaption: ((entry: CaptionEntry) => void) | null = null;
  private isRunning = false;
  private lastEmittedText = '';
  private captionRoot: Element | null = null;
  private scanInterval: ReturnType<typeof setInterval> | null = null;

  // --- Selectors tried in order. Google changes class names; we try multiple. ---
  // Container: the div that holds all caption blocks
  private static readonly CONTAINER_SELECTORS = [
    'div[jscontroller="TEjq6e"]',          // Meet caption container (seen in 2024-2025)
    '[aria-live="polite"][role="status"]',  // Accessible live + status
    '[aria-live="polite"]',                 // Generic live region
    '[aria-live="assertive"]',
  ];

  // Speaker name element (inside caption block)
  private static readonly SPEAKER_SELECTORS = [
    '.zs7s8d.jxFHg',
    '.zs7s8d',
    '[data-speaker-name]',
  ];

  // Caption text element (inside caption block)
  private static readonly TEXT_SELECTORS = [
    '.CNusmb',
    '.iTTPOb',
  ];

  // ---- public API ----

  start(onCaption: (entry: CaptionEntry) => void): void {
    if (this.isRunning) return;
    this.onCaption = onCaption;
    this.isRunning = true;
    this.lastEmittedText = '';

    // Try to find the container right away
    this.captionRoot = this.findContainer();
    if (this.captionRoot) {
      console.log('MeetCaptionScraper: Caption container found on start');
    } else {
      console.log('MeetCaptionScraper: Caption container not found yet — user may need to enable CC (click the CC button in Meet)');
    }

    // Observe all DOM mutations; re-check container + extract captions
    this.observer = new MutationObserver(() => {
      if (!this.captionRoot) {
        this.captionRoot = this.findContainer();
        if (this.captionRoot) {
          console.log('MeetCaptionScraper: Caption container appeared');
        }
      }
      if (this.captionRoot) this.extract();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Periodic fallback scan (1 s) — MutationObserver can miss some updates
    this.scanInterval = setInterval(() => {
      if (!this.captionRoot) {
        this.captionRoot = this.findContainer();
        if (this.captionRoot) {
          console.log('MeetCaptionScraper: Caption container found via periodic scan');
        }
      }
      if (this.captionRoot) this.extract();
    }, 1000);

    console.log('MeetCaptionScraper: Started');
  }

  stop(): void {
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    if (this.scanInterval) { clearInterval(this.scanInterval); this.scanInterval = null; }
    this.isRunning = false;
    this.captionRoot = null;
    this.lastEmittedText = '';
    console.log('MeetCaptionScraper: Stopped');
  }

  /** Returns true once a caption container has been located in the DOM. */
  isCaptionsDetected(): boolean {
    return this.captionRoot !== null;
  }

  // ---- private helpers ----

  /**
   * Try every known selector for the caption container.
   * Falls back to heuristic: look for aria-live regions in the lower half of the viewport.
   */
  private findContainer(): Element | null {
    for (const sel of MeetCaptionScraper.CONTAINER_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent?.trim()) return el;
      } catch { /* invalid selector */ }
    }

    // Heuristic fallback: any aria-live element in the bottom half of viewport with text
    const liveDivs = document.querySelectorAll('[aria-live]');
    for (const el of liveDivs) {
      try {
        const rect = el.getBoundingClientRect();
        if (rect.width > 150 && rect.top > window.innerHeight * 0.25 && el.textContent?.trim()) {
          console.log('MeetCaptionScraper: Found caption container via heuristic (aria-live in lower viewport)');
          return el;
        }
      } catch { /* skip */ }
    }
    return null;
  }

  /**
   * Extract the most-recent caption text + speaker from the container.
   * Only fires the callback when the text has actually changed.
   */
  private extract(): void {
    if (!this.captionRoot || !this.onCaption) return;

    const { speaker, text } = this.readSpeakerAndText(this.captionRoot);
    if (!text || text === this.lastEmittedText) return;

    this.lastEmittedText = text;
    console.log('MeetCaptionScraper: Caption detected —', speaker, ':', text);
    this.onCaption({ speaker, text, timestamp: Date.now() });
  }

  /**
   * Two-pass extraction:
   * 1. Try known class selectors for speaker + caption text elements.
   * 2. Fall back to parsing the raw textContent of the container.
   */
  private readSpeakerAndText(root: Element): { speaker: string; text: string } {
    // --- Pass 1: structured selectors ---
    let speaker: string | null = null;
    for (const sel of MeetCaptionScraper.SPEAKER_SELECTORS) {
      try {
        const els = root.querySelectorAll(sel);
        // Use the LAST speaker element (most recent block)
        if (els.length > 0) {
          const last = els[els.length - 1];
          const name = last.textContent?.trim();
          if (name && name.length > 0 && name.length < 80) { speaker = name; break; }
        }
      } catch { /* skip */ }
    }

    let text: string | null = null;
    for (const sel of MeetCaptionScraper.TEXT_SELECTORS) {
      try {
        const els = root.querySelectorAll(sel);
        if (els.length > 0) {
          // Concatenate all caption spans (they may be split across elements)
          text = Array.from(els).map(el => el.textContent?.trim() || '').join(' ').trim();
          if (text) break;
        }
      } catch { /* skip */ }
    }

    if (speaker && text) return { speaker, text };

    // --- Pass 2: parse from raw textContent ---
    return this.parseFromText(root.textContent?.trim() || '');
  }

  /**
   * Parse speaker + text from the raw textContent string.
   *
   * Google Meet renders captions roughly as:
   *   "SpeakerName\nCaption line 1\nCaption line 2\nSpeakerName2\n..."
   *
   * We scan backwards to find the last line that looks like a name,
   * then take everything after it as the caption text.
   */
  private parseFromText(raw: string): { speaker: string; text: string } {
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return { speaker: 'Participante', text: '' };

    // Scan backwards for a name-like line
    for (let i = lines.length - 1; i >= 0; i--) {
      if (this.looksLikeName(lines[i])) {
        const captionText = lines.slice(i + 1).join(' ');
        // If there's text after the name, use it; otherwise the name might actually be text
        if (captionText.length > 0) {
          return { speaker: lines[i], text: captionText };
        }
      }
    }

    // No name found — return all text, speaker unknown
    return { speaker: 'Participante', text: lines.join(' ') };
  }

  /**
   * Heuristic: does this line look like a person's name rather than spoken text?
   *
   * Names are typically:
   *   - Short (< 60 chars)
   *   - Do NOT end in sentence-ending punctuation (.?!)
   *   - Do NOT start with common sentence-starter words
   */
  private looksLikeName(line: string): boolean {
    if (line.length < 2 || line.length > 60) return false;
    if (/[.?!]$/.test(line)) return false;

    const sentenceStarts = /^(Hola|Gracias|Sí|Si|No|Bien|Bueno|Es|El|La|Los|Las|Un|Una|De|En|Con|Para|Por|Que|Esto|Todo|Muy|Yes|Hello|The|And|But|So|I |We |He |She |They|OK|Okay|Wait|Hmm|Eh|Uh|Bueno|Creo|Pues|Claro|Vamos|Entonces|Quiero|Necesit)/i;
    if (sentenceStarts.test(line)) return false;

    return true;
  }
}

export default MeetCaptionScraper;
