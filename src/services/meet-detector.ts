/**
 * Google Meet Detection & CC Activation Service
 * Detects active meetings, enables captions, and tracks participants
 */

export interface MeetParticipant {
  id: string;
  name: string;
  isSpeaking: boolean;
}

export interface MeetingInfo {
  isActive: boolean;
  url: string;
  title: string;
  participants: MeetParticipant[];
  activeSpeaker: string | null;
}

/**
 * Check if current URL is a Google Meet meeting (not landing page)
 */
export function isGoogleMeetUrl(): boolean {
  const url = window.location.href;
  return url.includes('meet.google.com') &&
         !url.includes('/landing') &&
         /\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(url);
}

/**
 * Check if the meeting is active (user has joined)
 */
export function isMeetingActive(): boolean {
  const indicators = [
    'video',
    '[data-self-name]',
    '[aria-label*="Salir" i]',
    '[aria-label*="Leave" i]',
    '[aria-label*="Colgar" i]',
    '[aria-label*="Hang up" i]',
    'button[aria-label*="micrófono" i]',
    'button[aria-label*="microphone" i]',
    'button[aria-label*="cámara" i]',
    'button[aria-label*="camera" i]',
    '[data-is-muted]',
    '[data-call-id]',
    '[data-meeting-code]'
  ];

  return indicators.some(sel => {
    try {
      return document.querySelector(sel) !== null;
    } catch {
      return false;
    }
  });
}

/**
 * Get meeting title from the page
 */
export function getMeetingTitle(): string {
  // Simply use the meeting code from URL - most reliable
  const meetCode = window.location.pathname.split('/').pop();
  return meetCode ? `Reunión: ${meetCode}` : 'Google Meet';
}

/**
 * Check if captions are already visible/active
 */
function areCaptionsAlreadyActive(): boolean {
  // Check for caption container in DOM
  const captionSelectors = [
    '[aria-live="polite"]',
    '[aria-live="assertive"]',
    '[role="log"]',
    '[class*="caption" i]'
  ];

  for (const sel of captionSelectors) {
    try {
      const elements = document.querySelectorAll(sel);
      for (const el of elements) {
        if (!(el instanceof HTMLElement)) continue;
        const text = el.textContent?.trim() || '';
        // If there's text and it's in the lower part of the screen, captions are active
        if (text.length > 5) {
          try {
            const rect = el.getBoundingClientRect();
            if (rect && rect.top > window.innerHeight * 0.4) {
              return true;
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
  }

  return false;
}

/**
 * Enable closed captions by clicking the CC button
 * Returns true if captions are enabled, false otherwise
 */
export function enableClosedCaptions(): boolean {
  // Check if settings dialog is open - close it and don't do anything else
  const settingsDialog = document.querySelector('[aria-modal="true"]');
  if (settingsDialog) {
    // Close the dialog
    const closeBtn = settingsDialog.querySelector(
      'button[aria-label*="cerrar" i], button[aria-label*="close" i], button[aria-label*="Cerrar" i], button[aria-label*="Close" i]'
    ) as HTMLElement;
    if (closeBtn) {
      closeBtn.click();
      console.log('SOFLIA: Closed settings dialog');
    } else {
      // Try clicking outside or pressing escape
      const backdrop = document.querySelector('[data-backdrop="true"]') as HTMLElement;
      if (backdrop) backdrop.click();
    }
    return true; // Assume captions are already on if dialog opened
  }

  // If captions are already active, don't click anything
  if (areCaptionsAlreadyActive()) {
    console.log('SOFLIA: Captions already active (detected in DOM)');
    return true;
  }

  // Find CC button
  const ccSelectors = [
    'button[aria-label*="subtítulo" i]',
    'button[aria-label*="subtitle" i]',
    'button[aria-label*="caption" i]',
    'button[aria-label*="Activar subtítulos" i]',
    'button[aria-label*="Turn on captions" i]'
  ];

  for (const sel of ccSelectors) {
    try {
      const btn = document.querySelector(sel) as HTMLElement;
      if (!btn) continue;

      // Check button state - if "Desactivar" or "Turn off" is in label, it's already on
      const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
      if (ariaLabel.includes('desactivar') ||
          ariaLabel.includes('turn off') ||
          ariaLabel.includes('ocultar')) {
        console.log('SOFLIA: CC already enabled (button says turn off)');
        return true;
      }

      // Check if already pressed
      const isActive = btn.getAttribute('aria-pressed') === 'true';
      if (isActive) {
        console.log('SOFLIA: CC already enabled (aria-pressed)');
        return true;
      }

      // Only click if label says "Activar" or "Turn on"
      if (ariaLabel.includes('activar') || ariaLabel.includes('turn on') || ariaLabel.includes('habilitar')) {
        btn.click();
        console.log('SOFLIA: CC enabled via:', sel);
        return true;
      }
    } catch { /* skip */ }
  }

  console.log('SOFLIA: CC button not found or already active');
  return false;
}

/**
 * Check if element is in the caption zone (bottom portion of screen)
 */
function isInCaptionZone(element: HTMLElement): boolean {
  try {
    const rect = element.getBoundingClientRect();
    // Captions appear in the lower 50% of the screen
    return rect.top > window.innerHeight * 0.4 &&
           rect.height > 20 && rect.height < 500 &&
           rect.width > 150;
  } catch {
    return false;
  }
}

/**
 * Check if element is a toolbar/controls area (NOT captions)
 */
function isToolbarElement(element: HTMLElement): boolean {
  const role = element.getAttribute('role');
  if (role === 'toolbar' || role === 'menubar' || role === 'navigation' ||
      role === 'menu' || role === 'tablist') return true;

  // Toolbars have many buttons
  const buttons = element.querySelectorAll('button, [role="button"]');
  if (buttons.length > 5) return true;

  return false;
}

/**
 * Find the caption container element
 * Uses multiple strategies from most specific to broadest
 */
export function findCaptionContainer(): HTMLElement | null {
  try {
    // ============================================================
    // STRATEGY 1: aria-live regions (most standard for captions)
    // aria-live in the caption zone is a strong enough signal
    // even when the container is empty (nobody speaking yet)
    // ============================================================
    const liveRegions = document.querySelectorAll('[aria-live="polite"], [aria-live="assertive"]');
    for (const region of liveRegions) {
      if (!(region instanceof HTMLElement)) continue;
      if (!isInCaptionZone(region)) continue;
      if (isToolbarElement(region)) continue;

      // Accept: either has caption-like text OR is empty (waiting for speech)
      const text = region.textContent?.trim() || '';
      const hasText = text.length > 3 && text.includes(' ');
      const isEmpty = text.length === 0;

      if (hasText || isEmpty) {
        console.log('SOFLIA: Found caption container via aria-live', hasText ? '(with text)' : '(empty)');
        return region;
      }
    }

    // ============================================================
    // STRATEGY 2: role="region" or role="log" in caption zone
    // ============================================================
    const roleRegions = document.querySelectorAll('[role="region"], [role="log"], [role="status"]');
    for (const region of roleRegions) {
      if (!(region instanceof HTMLElement)) continue;
      if (!isInCaptionZone(region)) continue;
      if (isToolbarElement(region)) continue;

      const text = region.textContent?.trim() || '';
      // Accept with text (speech content) or empty (waiting for speech)
      if ((text.length > 10 && text.includes(' ')) || text.length === 0) {
        console.log('SOFLIA: Found caption container via role attribute');
        return region;
      }
    }

    // ============================================================
    // STRATEGY 3: Google Meet specific - look for caption overlay
    // Meet shows captions at the bottom of the video area with
    // speaker name + text. Look for positioned elements in the
    // bottom area that contain speech-like text.
    // ============================================================
    const allDivs = document.querySelectorAll('div');
    let bestCandidate: HTMLElement | null = null;
    let bestScore = 0;

    for (const div of allDivs) {
      if (!(div instanceof HTMLElement)) continue;

      try {
        const rect = div.getBoundingClientRect();

        // Must be in the lower 45% of the screen
        if (rect.top < window.innerHeight * 0.55) continue;

        // Must have reasonable caption size
        if (rect.height < 30 || rect.height > 400) continue;
        if (rect.width < 200) continue;

        // Must NOT be the bottom toolbar (which has many buttons)
        if (isToolbarElement(div)) continue;

        // Check positioning - caption overlays are typically absolute/fixed
        const style = window.getComputedStyle(div);
        const isPositioned = style.position === 'absolute' || style.position === 'fixed';

        // Get text content
        const text = div.textContent?.trim() || '';

        // Score this candidate
        let score = 0;

        // Positioned elements are more likely to be overlays
        if (isPositioned) score += 20;

        // Has aria-live on self or parent
        if (div.getAttribute('aria-live') ||
            div.parentElement?.getAttribute('aria-live')) score += 15;

        // Has background/backdrop (caption overlays have backgrounds)
        const bg = style.backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') score += 10;

        // Lower on screen = more likely to be captions
        const normalizedTop = rect.top / window.innerHeight;
        if (normalizedTop > 0.7) score += 10;
        if (normalizedTop > 0.8) score += 5;

        // Text content looks like speech (bonus points, not required)
        if (text.length > 0 && text.includes(' ')) {
          const words = text.split(/\s+/).length;
          if (words > 3) score += 5;
          if (words > 8) score += 5;
        }

        // Fewer buttons = more likely captions (not toolbar)
        const btnCount = div.querySelectorAll('button').length;
        if (btnCount === 0) score += 10;
        else if (btnCount <= 2) score += 5;

        // Contains an image (speaker avatar)
        const hasImage = div.querySelector('img') !== null;
        if (hasImage) score += 5;

        if (score > bestScore) {
          bestScore = score;
          bestCandidate = div;
        }
      } catch { /* skip invalid elements */ }
    }

    if (bestCandidate && bestScore >= 15) {
      console.log('SOFLIA: Found caption container via heuristic scan, score:', bestScore);
      return bestCandidate;
    }

  } catch (e) {
    console.error('SOFLIA: Error finding caption container:', e);
  }

  return null;
}

/**
 * Hide the caption overlay visually while keeping it in the DOM
 *
 * CRITICAL: Only use clip-path and opacity to hide.
 * DO NOT change height, width, display, or visibility.
 * Google Meet may stop updating captions if the container dimensions change.
 * The element must remain fully "alive" in the layout for MutationObserver to work.
 */
export function hideCaptionsVisually(container: HTMLElement): void {
  try {
    // clip-path hides the visual rendering but keeps the element in layout
    container.style.setProperty('clip-path', 'inset(100%)', 'important');
    // opacity 0 as backup visual hiding
    container.style.setProperty('opacity', '0', 'important');
    // Don't let the invisible element intercept clicks
    container.style.setProperty('pointer-events', 'none', 'important');

    // DO NOT set height:0, width:0, display:none, or visibility:hidden
    // Those can cause Meet to stop updating the captions

    console.log('SOFLIA: Captions hidden visually (clip-path + opacity)');
  } catch (e) {
    console.error('SOFLIA: Error hiding captions:', e);
  }
}

/**
 * Get list of meeting participants
 */
export function getParticipants(): MeetParticipant[] {
  const participants: MeetParticipant[] = [];
  const seen = new Set<string>();

  try {
    // Method 1: Look for self-name in the bottom bar (your own name)
    const selfNameEl = document.querySelector('[data-self-name]');
    if (selfNameEl) {
      const selfName = selfNameEl.getAttribute('data-self-name');
      if (selfName && !seen.has('self')) {
        seen.add('self');
        participants.push({
          id: 'self',
          name: selfName.substring(0, 50),
          isSpeaking: false
        });
      }
    }

    // Method 2: Look for participant tiles with actual names
    const tiles = document.querySelectorAll('[data-participant-id]');
    tiles.forEach(tile => {
      try {
        if (!(tile instanceof HTMLElement)) return;

        const id = tile.getAttribute('data-participant-id') || '';
        if (seen.has(id)) return;

        // Get name ONLY from data attributes, not textContent (which includes UI elements)
        let name = tile.getAttribute('data-self-name') ||
                   tile.getAttribute('data-tooltip');

        // If no data attribute, try to find a dedicated name element
        if (!name) {
          const nameEl = tile.querySelector('[data-self-name]');
          name = nameEl?.getAttribute('data-self-name') || null;
        }

        // Skip if no valid name found
        if (!name || name.length < 2 || name.length > 50) return;

        // Skip if name looks like UI text
        if (isUIText(name)) return;

        seen.add(id);
        participants.push({ id, name, isSpeaking: detectSpeaking(tile) });
      } catch { /* skip */ }
    });

  } catch (e) {
    console.error('SOFLIA: Error getting participants:', e);
  }

  return participants;
}

/**
 * Check if text looks like UI element text (not a person's name)
 */
function isUIText(text: string): boolean {
  const uiPatterns = [
    /^(activar|desactivar|habilitar|deshabilitar)/i,
    /^(más|more|menos|less|cerrar|close)$/i,
    /^(micrófono|microphone|cámara|camera|video)/i,
    /^(fondos|backgrounds|efectos|effects|visual)/i,
    /^(compartir|share|presentar|present)/i,
    /^(reencuadrar|frame|person)/i,
    /^(chat|participantes|participants)/i,
    /^\d+$/,  // Just numbers
    /^[a-z_]+$/,  // lowercase_with_underscores (likely class names)
  ];

  for (const pattern of uiPatterns) {
    if (pattern.test(text.toLowerCase())) return true;
  }

  return false;
}

/**
 * Detect if an element (participant tile) is currently speaking
 */
function detectSpeaking(element: HTMLElement): boolean {
  try {
    if (!(element instanceof HTMLElement)) return false;

    // Method 1: data-is-speaking attribute
    if (element.getAttribute('data-is-speaking') === 'true') {
      return true;
    }

    // Method 2: Blue border (Google Meet's active speaker indicator)
    try {
      const style = window.getComputedStyle(element);
      const borderColor = style.borderColor || style.outlineColor || '';
      if (borderColor.includes('26, 115, 232') || // RGB blue
          borderColor.includes('1a73e8')) { // Hex blue
        return true;
      }

      // Method 4: Animation styles (speaking animation)
      const animation = style.animation || style.animationName || '';
      if (animation.toLowerCase().includes('speak') || animation.toLowerCase().includes('pulse')) {
        return true;
      }
    } catch { /* getComputedStyle may fail */ }

    // Method 3: Speaking class
    if (element.classList && (
        element.classList.contains('speaking') ||
        Array.from(element.classList).some(c => c.toLowerCase().includes('speaking')))) {
      return true;
    }
  } catch { /* element access failed */ }

  return false;
}

/**
 * Get the current active speaker
 */
export function getActiveSpeaker(): string | null {
  const participants = getParticipants();
  const speaker = participants.find(p => p.isSpeaking);
  return speaker?.name || null;
}

/**
 * Get full meeting info
 */
export function getMeetingInfo(): MeetingInfo {
  return {
    isActive: isMeetingActive(),
    url: window.location.href,
    title: getMeetingTitle(),
    participants: getParticipants(),
    activeSpeaker: getActiveSpeaker()
  };
}
