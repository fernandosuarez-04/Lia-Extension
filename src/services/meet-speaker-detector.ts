/**
 * Google Meet Speaker Detector Service
 * Scrapes the Google Meet DOM to detect participants and the active speaker
 *
 * Note: DOM selectors may change with Google Meet updates
 * These selectors were analyzed from the current Google Meet UI
 *
 * Improvements:
 * - Faster polling (250ms vs 500ms)
 * - Multiple detection methods with fallbacks
 * - Robust name extraction with confidence scoring
 * - Audio level indicators detection
 */

export interface MeetParticipant {
  id: string;
  name: string;
  isSelf?: boolean;
  isSpeaking?: boolean;
  lastSpokenAt?: number;
  confidence?: number;
}

export interface SpeakerChangeEvent {
  previousSpeaker: string | null;
  currentSpeaker: string | null;
  timestamp: number;
  confidence?: number;
}

// DOM Selectors for Google Meet (may need updates as Google changes UI)
const SELECTORS = {
  // Participant tiles in the main view (try multiple attribute formats)
  participantTile: '[data-participant-id], [data-participantid], [data-callee-id]',
  participantName: '[data-self-name]',

  // Active speaker indicators (visual border/highlight)
  activeSpeakerIndicator: '[data-participant-id][data-is-speaking="true"]',
  speakingBorder: '[data-participant-id] [style*="border-color: rgb(26, 115, 232)"]',

  // Participant panel (list of all participants)
  participantPanel: '[aria-label*="participant" i], [aria-label*="participante" i]',
  participantListItem: '[role="listitem"]',

  // Alternative selectors for participant names
  nameInTile: '[data-participant-id] [data-tooltip]',
  nameLabel: '[data-self-name], [data-requested-participant-id] + * [data-tooltip]',

  // Video elements with participant info
  videoContainer: 'div[data-participant-id]',

  // Speaking animation/indicator
  speakingAnimation: '[data-participant-id] [class*="speaking"], [data-participant-id] [class*="audio"]',

  // Audio level indicators
  audioIndicator: '[data-participant-id] [role="progressbar"]',
  voiceIndicator: '[data-participant-id] [aria-label*="audio" i]',

  // Additional fallback selectors
  participantVideo: 'div[data-participant-id] video',
  participantCanvas: 'div[data-participant-id] canvas',
  activeBorder: '[style*="rgb(26, 115, 232)"], [style*="#1a73e8"]'
};

export class MeetSpeakerDetector {
  private participants: Map<string, MeetParticipant> = new Map();
  private currentSpeaker: string | null = null;
  private observer: MutationObserver | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private onSpeakerChange: ((event: SpeakerChangeEvent) => void) | null = null;
  private onParticipantsUpdate: ((participants: MeetParticipant[]) => void) | null = null;
  private isRunning: boolean = false;

  /**
   * Start monitoring for speaker changes
   */
  start(callbacks: {
    onSpeakerChange?: (event: SpeakerChangeEvent) => void;
    onParticipantsUpdate?: (participants: MeetParticipant[]) => void;
  }): void {
    if (this.isRunning) return;

    this.onSpeakerChange = callbacks.onSpeakerChange || null;
    this.onParticipantsUpdate = callbacks.onParticipantsUpdate || null;
    this.isRunning = true;

    console.log('MeetSpeakerDetector: Starting...');

    // Initial scan
    this.scanParticipants();
    this.detectActiveSpeaker();

    // Set up polling for active speaker detection (every 250ms for faster response)
    this.pollInterval = setInterval(() => {
      this.detectActiveSpeaker();
    }, 250);

    // Set up mutation observer for participant changes
    this.setupMutationObserver();

    console.log('MeetSpeakerDetector: Started with 250ms polling');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    this.isRunning = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.participants.clear();
    this.currentSpeaker = null;

    console.log('MeetSpeakerDetector: Stopped');
  }

  /**
   * Get current list of participants
   */
  getParticipants(): MeetParticipant[] {
    return Array.from(this.participants.values());
  }

  /**
   * Get current speaker name
   */
  getCurrentSpeaker(): string | null {
    return this.currentSpeaker;
  }

  /**
   * Scan DOM for all participants
   */
  private scanParticipants(): void {
    const foundParticipants = new Map<string, MeetParticipant>();

    // Method 1: Get participants from video tiles
    const tiles = document.querySelectorAll(SELECTORS.participantTile);
    console.log(`MeetSpeakerDetector: Found ${tiles.length} participant tiles`);

    tiles.forEach((tile) => {
      const participantId = tile.getAttribute('data-participant-id');
      if (!participantId) return;

      const name = this.extractNameFromTile(tile);
      console.log(`MeetSpeakerDetector: Tile ${participantId} -> name: "${name}"`);

      if (name) {
        foundParticipants.set(participantId, {
          id: participantId,
          name,
          isSelf: tile.hasAttribute('data-self-name'),
          isSpeaking: false
        });
      }
    });

    // Method 1b: Fallback — scan near video elements when tile selectors find nothing
    if (foundParticipants.size === 0) {
      const videos = document.querySelectorAll('video');
      console.log(`MeetSpeakerDetector: Fallback - scanning ${videos.length} video elements for names`);
      videos.forEach((video, index) => {
        let container: Element | null = video.parentElement;
        for (let depth = 0; depth < 10 && container; depth++) {
          const name = this.extractNameFromTile(container);
          if (name && !this.isUIElement(name)) {
            const id = `video_${index}`;
            if (!foundParticipants.has(id)) {
              foundParticipants.set(id, {
                id,
                name: this.cleanParticipantName(name),
                isSpeaking: false
              });
              console.log(`MeetSpeakerDetector: Found name near video[${index}]: "${name}"`);
            }
            break;
          }
          container = container.parentElement;
        }
      });
    }

    // Method 2: Get participants from participant panel (if open)
    const panelItems = document.querySelectorAll('[role="listitem"]');
    panelItems.forEach((item, index) => {
      const text = item.textContent?.trim();
      if (text && text.length > 0 && text.length < 100) {
        // Filter out UI elements
        if (!this.isUIElement(text)) {
          const id = `panel_${index}`;
          if (!foundParticipants.has(id)) {
            foundParticipants.set(id, {
              id,
              name: this.cleanParticipantName(text),
              isSpeaking: false
            });
          }
        }
      }
    });

    // Method 3: Get self name
    const selfNameEl = document.querySelector('[data-self-name]');
    if (selfNameEl) {
      const selfName = selfNameEl.getAttribute('data-self-name');
      if (selfName) {
        foundParticipants.set('self', {
          id: 'self',
          name: selfName,
          isSelf: true,
          isSpeaking: false
        });
      }
    }

    // Update participants if changed
    if (this.hasParticipantsChanged(foundParticipants)) {
      this.participants = foundParticipants;
      console.log('MeetSpeakerDetector: Participants updated:', Array.from(foundParticipants.values()).map(p => p.name));

      if (this.onParticipantsUpdate) {
        this.onParticipantsUpdate(this.getParticipants());
      }
    }
  }

  /**
   * Extract participant name from a video tile element
   */
  private extractNameFromTile(tile: Element): string | null {
    console.log('MeetSpeakerDetector: Extracting name from tile:', tile.outerHTML.substring(0, 200));

    // Method 1: Try data-tooltip attribute (most reliable)
    const tooltipEl = tile.querySelector('[data-tooltip]');
    if (tooltipEl) {
      const tooltip = tooltipEl.getAttribute('data-tooltip');
      console.log('MeetSpeakerDetector: Found tooltip:', tooltip);
      if (tooltip && !this.isUIElement(tooltip)) {
        const cleaned = this.cleanParticipantName(tooltip);
        console.log('MeetSpeakerDetector: Using tooltip name:', cleaned);
        return cleaned;
      }
    }

    // Method 2: Try aria-label on tile itself
    const ariaLabel = tile.getAttribute('aria-label');
    if (ariaLabel) {
      console.log('MeetSpeakerDetector: Found aria-label:', ariaLabel);
      if (!this.isUIElement(ariaLabel)) {
        const cleaned = this.cleanParticipantName(ariaLabel);
        console.log('MeetSpeakerDetector: Using aria-label name:', cleaned);
        return cleaned;
      }
    }

    // Method 3: Try data-self-name attribute
    const selfName = tile.getAttribute('data-self-name');
    if (selfName) {
      console.log('MeetSpeakerDetector: Found self-name:', selfName);
      const cleaned = this.cleanParticipantName(selfName);
      console.log('MeetSpeakerDetector: Using self-name:', cleaned);
      return cleaned;
    }

    // Method 4: Try text content of name elements
    const nameEl = tile.querySelector('[class*="name" i], [class*="participant" i]');
    if (nameEl?.textContent) {
      const name = nameEl.textContent.trim();
      console.log('MeetSpeakerDetector: Found name element text:', name);
      if (name && !this.isUIElement(name)) {
        const cleaned = this.cleanParticipantName(name);
        console.log('MeetSpeakerDetector: Using name element:', cleaned);
        return cleaned;
      }
    }

    // Method 5: Search all text nodes for name-like text
    const allText = tile.textContent?.trim();
    if (allText) {
      // Split by common separators and look for name-like text
      const parts = allText.split(/\n|,|\|/).map(p => p.trim()).filter(p => p.length > 0);
      for (const part of parts) {
        if (part.length >= 2 && part.length <= 50 && !this.isUIElement(part)) {
          // Check if it looks like a name (contains letters, not just numbers/symbols)
          if (/[a-záéíóúñA-ZÁÉÍÓÚÑ]{2,}/.test(part)) {
            const cleaned = this.cleanParticipantName(part);
            console.log('MeetSpeakerDetector: Using text content name:', cleaned);
            return cleaned;
          }
        }
      }
    }

    console.log('MeetSpeakerDetector: Could not extract name from tile');
    return null;
  }

  /**
   * Detect which participant is currently speaking
   * Uses multiple detection methods with confidence scoring
   */
  private detectActiveSpeaker(): void {
    let newSpeaker: string | null = null;
    let maxConfidence = 0;
    let detectionMethod = '';

    // Method 1: Check data-is-speaking attribute (HIGH CONFIDENCE)
    const speakingEl = document.querySelector('[data-participant-id][data-is-speaking="true"]');
    if (speakingEl) {
      const name = this.extractNameFromTile(speakingEl);
      console.log('MeetSpeakerDetector: Method 1 (data-is-speaking) found:', name);
      if (name && 1.0 > maxConfidence) {
        newSpeaker = name;
        maxConfidence = 1.0;
        detectionMethod = 'data-is-speaking';
      }
    } else {
      console.log('MeetSpeakerDetector: Method 1 (data-is-speaking) found no elements');
    }

    // Method 2: Check for audio/voice indicators (HIGH CONFIDENCE)
    if (!newSpeaker) {
      const audioIndicators = document.querySelectorAll(SELECTORS.audioIndicator);
      console.log('MeetSpeakerDetector: Method 2 (audio indicators) found', audioIndicators.length, 'indicators');
      for (const indicator of audioIndicators) {
        const tile = indicator.closest('[data-participant-id]');
        if (tile) {
          const name = this.extractNameFromTile(tile);
          if (name && 0.95 > maxConfidence) {
            newSpeaker = name;
            maxConfidence = 0.95;
            detectionMethod = 'audio-indicator';
            console.log('MeetSpeakerDetector: Method 2 detected speaker:', name);
          }
        }
      }
    }

    // Method 3: Check for blue border (Google Meet's speaking indicator) (HIGH CONFIDENCE)
    // Scan both data-attribute tiles AND video containers as fallback
    const tiles = document.querySelectorAll('[data-participant-id], [data-participantid]');
    console.log('MeetSpeakerDetector: Method 3 (blue border) checking', tiles.length, 'tiles');

    // Build candidate list: tiles first, then video parent containers as fallback
    const candidates: Element[] = Array.from(tiles);
    if (candidates.length === 0) {
      const seen = new Set<Element>();
      document.querySelectorAll('video').forEach((video) => {
        // Walk up to find a tile-sized container (>80px) that hasn't been added yet
        let container: Element | null = video.parentElement;
        for (let i = 0; i < 5 && container; i++) {
          const rect = container.getBoundingClientRect();
          if (rect.width > 80 && rect.height > 80 && !seen.has(container)) {
            candidates.push(container);
            seen.add(container);
            break;
          }
          container = container.parentElement;
        }
      });
      console.log('MeetSpeakerDetector: Method 3 - using', candidates.length, 'video containers as fallback');
    }

    for (const tile of candidates) {
      const indicator = this.hasSpeakingIndicator(tile);
      if (indicator > maxConfidence) {
        const name = this.extractNameFromTile(tile);
        if (name) {
          newSpeaker = name;
          maxConfidence = indicator;
          detectionMethod = `blue-border(${indicator.toFixed(2)})`;
          console.log('MeetSpeakerDetector: Method 3 detected speaker:', name, 'confidence:', indicator);
        }
      }
    }

    // Method 4: Check for CSS classes related to speaking (MEDIUM CONFIDENCE)
    if (maxConfidence < 0.7) {
      const speakingClasses = document.querySelectorAll('[class*="speaking" i], [class*="active-speaker" i]');
      for (const el of speakingClasses) {
        // Find parent with participant ID
        let parent = el.parentElement;
        for (let i = 0; i < 10 && parent; i++) {
          if (parent.hasAttribute('data-participant-id')) {
            const name = this.extractNameFromTile(parent);
            if (name && 0.7 > maxConfidence) {
              newSpeaker = name;
              maxConfidence = 0.7;
              break;
            }
          }
          parent = parent.parentElement;
        }
        if (newSpeaker) break;
      }
    }

    // Method 5: Check for animations (LOW-MEDIUM CONFIDENCE)
    if (maxConfidence < 0.6) {
      for (const tile of tiles) {
        const animationScore = this.checkForAnimation(tile);
        if (animationScore > maxConfidence) {
          const name = this.extractNameFromTile(tile);
          if (name) {
            newSpeaker = name;
            maxConfidence = animationScore;
          }
        }
      }
    }

    // Log detection result every time (for debugging)
    if (maxConfidence > 0) {
      console.log('MeetSpeakerDetector: Detection result:', newSpeaker, 'confidence:', (maxConfidence * 100).toFixed(0) + '%', 'method:', detectionMethod);
    } else {
      console.log('MeetSpeakerDetector: No speaker detected (all methods failed)');
    }

    // Only update if confidence is reasonable and speaker changed
    if (newSpeaker !== this.currentSpeaker && maxConfidence > 0.5) {
      const event: SpeakerChangeEvent = {
        previousSpeaker: this.currentSpeaker,
        currentSpeaker: newSpeaker,
        timestamp: Date.now(),
        confidence: maxConfidence
      };

      console.log('MeetSpeakerDetector: ✅ Speaker changed:', this.currentSpeaker, '->', newSpeaker, `(confidence: ${(maxConfidence * 100).toFixed(0)}%, method: ${detectionMethod})`);

      // Update speaking status in participants
      for (const participant of this.participants.values()) {
        const wasSpeaking = participant.isSpeaking;
        participant.isSpeaking = participant.name === newSpeaker;

        if (participant.isSpeaking && !wasSpeaking) {
          participant.lastSpokenAt = Date.now();
          participant.confidence = maxConfidence;
        }
      }

      this.currentSpeaker = newSpeaker;

      if (this.onSpeakerChange) {
        this.onSpeakerChange(event);
      }
    }
  }

  /**
   * Check if element has visual speaking indicator
   * Returns confidence score (0-1)
   */
  private hasSpeakingIndicator(element: Element): number {
    let confidence = 0;

    // Check for blue border color (Google Meet uses this for active speaker)
    const allElements = element.querySelectorAll('*');
    for (const el of allElements) {
      const style = window.getComputedStyle(el);

      // Check border color (Google's speaking indicator is typically blue)
      const borderColor = style.borderColor;
      if (borderColor) {
        if (borderColor.includes('26, 115, 232') ||
            borderColor.includes('rgb(26, 115, 232)') ||
            borderColor.includes('#1a73e8')) {
          confidence = Math.max(confidence, 0.9);
        }
      }

      // Check border width (speaking indicator often has thicker border)
      const borderWidth = parseFloat(style.borderWidth);
      if (borderWidth > 2) {
        confidence = Math.max(confidence, 0.75);
      }
    }

    // Check element's own border
    const style = window.getComputedStyle(element);
    if (style.borderColor?.includes('26, 115, 232')) {
      confidence = Math.max(confidence, 0.9);
    }

    // Check for specific class patterns
    const className = element.className;
    if (typeof className === 'string') {
      if (className.includes('speaking') || className.includes('active-speaker')) {
        confidence = Math.max(confidence, 0.85);
      }
    }

    // Check for shadow/glow effect (sometimes used for speaking indicator)
    if (style.boxShadow && style.boxShadow !== 'none') {
      confidence = Math.max(confidence, 0.65);
    }

    return confidence;
  }

  /**
   * Check for animation indicators
   * Returns confidence score (0-1)
   */
  private checkForAnimation(element: Element): number {
    let confidence = 0;

    const allElements = element.querySelectorAll('*');
    for (const el of allElements) {
      const style = window.getComputedStyle(el);

      // Check for animation (speaking animation)
      if (style.animation && style.animation !== 'none') {
        const parent = el.closest('[data-participant-id]');
        if (parent === element) {
          confidence = Math.max(confidence, 0.7);
        }
      }

      // Check for transform (scaling/pulsing animation)
      if (style.transform && style.transform !== 'none') {
        confidence = Math.max(confidence, 0.6);
      }

      // Check for transition (smooth animations)
      if (style.transition && style.transition.includes('transform')) {
        confidence = Math.max(confidence, 0.55);
      }
    }

    return confidence;
  }

  /**
   * Set up mutation observer to watch for participant changes
   */
  private setupMutationObserver(): void {
    this.observer = new MutationObserver((mutations) => {
      let shouldRescan = false;

      for (const mutation of mutations) {
        // Check for added/removed nodes that might be participants
        if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
          shouldRescan = true;
          break;
        }

        // Check for attribute changes on participant tiles
        if (mutation.type === 'attributes' &&
            mutation.target instanceof Element &&
            mutation.target.hasAttribute('data-participant-id')) {
          shouldRescan = true;
          break;
        }
      }

      if (shouldRescan) {
        this.scanParticipants();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-participant-id', 'data-is-speaking', 'data-self-name']
    });
  }

  /**
   * Check if participants list has changed
   */
  private hasParticipantsChanged(newParticipants: Map<string, MeetParticipant>): boolean {
    if (this.participants.size !== newParticipants.size) return true;

    for (const [id, participant] of newParticipants) {
      const existing = this.participants.get(id);
      if (!existing || existing.name !== participant.name) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if text is a UI element (not a participant name)
   */
  private isUIElement(text: string): boolean {
    const uiPatterns = [
      /^(Presentación|Presentation|Silenciar|Mute|Unmute|Activar|Desactivar)$/i,
      /^(Más acciones|More actions|Fijar|Pin|Desfijar|Unpin)$/i,
      /^(Tú|You|Yo|Me)$/i,
      /\d+:\d+/, // Time patterns
      /^[0-9]+$/, // Just numbers
    ];

    return uiPatterns.some(pattern => pattern.test(text.trim()));
  }

  /**
   * Clean participant name
   */
  private cleanParticipantName(name: string): string {
    return name
      .replace(/\(Tú\)/gi, '')
      .replace(/\(You\)/gi, '')
      .replace(/\(Presentando\)/gi, '')
      .replace(/\(Presenting\)/gi, '')
      .trim();
  }
}

export default MeetSpeakerDetector;
