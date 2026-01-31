/**
 * Google Meet Speaker Detector Service
 * Scrapes the Google Meet DOM to detect participants and the active speaker
 *
 * Note: DOM selectors may change with Google Meet updates
 * These selectors were analyzed from the current Google Meet UI
 */

export interface MeetParticipant {
  id: string;
  name: string;
  isSelf?: boolean;
  isSpeaking?: boolean;
  lastSpokenAt?: number;
}

export interface SpeakerChangeEvent {
  previousSpeaker: string | null;
  currentSpeaker: string | null;
  timestamp: number;
}

// DOM Selectors for Google Meet (may need updates as Google changes UI)
const SELECTORS = {
  // Participant tiles in the main view
  participantTile: '[data-participant-id]',
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
  speakingAnimation: '[data-participant-id] [class*="speaking"], [data-participant-id] [class*="audio"]'
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

    // Set up polling for active speaker detection (every 500ms)
    this.pollInterval = setInterval(() => {
      this.detectActiveSpeaker();
    }, 500);

    // Set up mutation observer for participant changes
    this.setupMutationObserver();

    console.log('MeetSpeakerDetector: Started');
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
    tiles.forEach((tile) => {
      const participantId = tile.getAttribute('data-participant-id');
      if (!participantId) return;

      const name = this.extractNameFromTile(tile);
      if (name) {
        foundParticipants.set(participantId, {
          id: participantId,
          name,
          isSelf: tile.hasAttribute('data-self-name'),
          isSpeaking: false
        });
      }
    });

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
    // Try data-tooltip attribute
    const tooltipEl = tile.querySelector('[data-tooltip]');
    if (tooltipEl) {
      const tooltip = tooltipEl.getAttribute('data-tooltip');
      if (tooltip && !this.isUIElement(tooltip)) {
        return this.cleanParticipantName(tooltip);
      }
    }

    // Try aria-label
    const ariaLabel = tile.getAttribute('aria-label');
    if (ariaLabel && !this.isUIElement(ariaLabel)) {
      return this.cleanParticipantName(ariaLabel);
    }

    // Try text content of name elements
    const nameEl = tile.querySelector('[class*="name" i], [class*="participant" i]');
    if (nameEl?.textContent) {
      const name = nameEl.textContent.trim();
      if (name && !this.isUIElement(name)) {
        return this.cleanParticipantName(name);
      }
    }

    // Try innerText of small elements (likely name labels)
    const smallElements = tile.querySelectorAll('span, div');
    for (const el of smallElements) {
      const rect = el.getBoundingClientRect();
      // Name labels are typically small
      if (rect.height > 10 && rect.height < 40 && rect.width > 30 && rect.width < 300) {
        const text = el.textContent?.trim();
        if (text && text.length > 1 && text.length < 50 && !this.isUIElement(text)) {
          return this.cleanParticipantName(text);
        }
      }
    }

    return null;
  }

  /**
   * Detect which participant is currently speaking
   */
  private detectActiveSpeaker(): void {
    let newSpeaker: string | null = null;

    // Method 1: Check data-is-speaking attribute
    const speakingEl = document.querySelector('[data-participant-id][data-is-speaking="true"]');
    if (speakingEl) {
      const name = this.extractNameFromTile(speakingEl);
      if (name) newSpeaker = name;
    }

    // Method 2: Check for blue border (Google Meet's speaking indicator)
    if (!newSpeaker) {
      const tiles = document.querySelectorAll('[data-participant-id]');
      for (const tile of tiles) {
        if (this.hasSpeakingIndicator(tile)) {
          const name = this.extractNameFromTile(tile);
          if (name) {
            newSpeaker = name;
            break;
          }
        }
      }
    }

    // Method 3: Check for CSS classes related to speaking
    if (!newSpeaker) {
      const speakingClasses = document.querySelectorAll('[class*="speaking" i], [class*="active-speaker" i]');
      for (const el of speakingClasses) {
        // Find parent with participant ID
        let parent = el.parentElement;
        for (let i = 0; i < 10 && parent; i++) {
          if (parent.hasAttribute('data-participant-id')) {
            const name = this.extractNameFromTile(parent);
            if (name) {
              newSpeaker = name;
              break;
            }
          }
          parent = parent.parentElement;
        }
        if (newSpeaker) break;
      }
    }

    // Update if speaker changed
    if (newSpeaker !== this.currentSpeaker) {
      const event: SpeakerChangeEvent = {
        previousSpeaker: this.currentSpeaker,
        currentSpeaker: newSpeaker,
        timestamp: Date.now()
      };

      console.log('MeetSpeakerDetector: Speaker changed:', this.currentSpeaker, '->', newSpeaker);

      // Update speaking status in participants
      for (const participant of this.participants.values()) {
        const wasSpeaking = participant.isSpeaking;
        participant.isSpeaking = participant.name === newSpeaker;

        if (participant.isSpeaking && !wasSpeaking) {
          participant.lastSpokenAt = Date.now();
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
   */
  private hasSpeakingIndicator(element: Element): boolean {
    // Check for blue border color (Google Meet uses this for active speaker)
    const allElements = element.querySelectorAll('*');
    for (const el of allElements) {
      const style = window.getComputedStyle(el);

      // Check border color (Google's speaking indicator is typically blue)
      const borderColor = style.borderColor;
      if (borderColor && (
        borderColor.includes('26, 115, 232') || // Google blue
        borderColor.includes('rgb(26, 115, 232)') ||
        borderColor.includes('#1a73e8')
      )) {
        return true;
      }

      // Check for animation (speaking animation)
      if (style.animation && style.animation !== 'none') {
        const parent = el.closest('[data-participant-id]');
        if (parent === element) {
          return true;
        }
      }
    }

    // Check element's own border
    const style = window.getComputedStyle(element);
    if (style.borderColor?.includes('26, 115, 232')) {
      return true;
    }

    // Check for specific class patterns
    const className = element.className;
    if (typeof className === 'string' && (
      className.includes('speaking') ||
      className.includes('active-speaker')
    )) {
      return true;
    }

    return false;
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
