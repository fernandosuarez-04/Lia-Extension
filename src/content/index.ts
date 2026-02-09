console.log('Soflia Content Script loaded');

// ============================================
// IMPORTS
// ============================================

import {
  isGoogleMeetUrl,
  isMeetingActive,
  enableClosedCaptions,
  findCaptionContainer,
  hideCaptionsVisually,
  getParticipants,
  getMeetingInfo
} from '../services/meet-detector';

import {
  MeetCaptionObserver,
  CaptionEntry
} from '../services/meet-transcription';

// ============================================
// UTILITIES
// ============================================

function safeSend(msg: object): void {
  try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch { /* context invalidated */ }
}

// ============================================
// WEB AGENT: Ref ID System
// ============================================

const INTERACTIVE_SELECTORS = [
  'a[href]', 'button', 'input', 'select', 'textarea',
  '[contenteditable="true"]', '[contenteditable=""]',
  '[role="textbox"]', '[role="button"]', '[role="link"]',
  '[role="tab"]', '[role="menuitem"]', '[role="option"]',
  '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
  '[role="combobox"]', '[role="searchbox"]',
];

/** Map of ref ID -> element for the current assignment */
let currentRefMap = new Map<string, Element>();

/** Get the implicit ARIA role for common HTML elements */
function getImplicitRole(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const type = el.getAttribute('type')?.toLowerCase();
  const role = el.getAttribute('role');
  if (role) return role;

  switch (tag) {
    case 'a': return el.hasAttribute('href') ? 'link' : 'generic';
    case 'button': return 'button';
    case 'input':
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'search') return 'searchbox';
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
      return 'textbox';
    case 'select': return 'combobox';
    case 'textarea': return 'textbox';
    case 'img': return 'img';
    default: return tag;
  }
}

/** Get the accessible name for an element (label, aria-label, text, placeholder) */
function getAccessibleName(el: Element): string {
  // aria-label has highest priority
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.substring(0, 80);

  // aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return (labelEl.textContent?.trim() || '').substring(0, 80);
  }

  // Title / tooltip
  const title = el.getAttribute('title') || el.getAttribute('data-tooltip');
  if (title) return title.substring(0, 80);

  // Placeholder for inputs
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.placeholder) return el.placeholder.substring(0, 80);
    // Check for associated label
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return (label.textContent?.trim() || '').substring(0, 80);
    }
  }

  // Inner text (short)
  const text = el.textContent?.trim() || '';
  return text.substring(0, 80);
}

/** Get element state flags */
function getElementState(el: Element): string {
  const states: string[] = [];
  if (el === document.activeElement) states.push('focused');
  if ((el as HTMLInputElement).checked) states.push('checked');
  if ((el as HTMLInputElement).disabled || el.hasAttribute('disabled')) states.push('disabled');
  if (el.getAttribute('aria-expanded') === 'true') states.push('expanded');
  if (el.getAttribute('aria-selected') === 'true') states.push('selected');
  if ((el as HTMLInputElement).value) {
    const val = (el as HTMLInputElement).value;
    if (val && el.getAttribute('type') !== 'password') {
      states.push(`value="${val.substring(0, 30)}"`);
    }
  }
  return states.length ? `[${states.join(', ')}]` : '';
}

/** Filter to only visible, interactive elements */
function getInteractiveElements(): Element[] {
  const seen = new WeakSet<Element>();
  const result: Element[] = [];

  for (const el of document.querySelectorAll(INTERACTIVE_SELECTORS.join(','))) {
    if (seen.has(el)) continue;
    seen.add(el);

    const rect = el.getBoundingClientRect();
    const tag = el.tagName;
    const isFormField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    // Use smaller min size for form fields (Gmail search input can be narrow)
    const minSize = isFormField ? 1 : 5;
    if (rect.width < minSize || rect.height < minSize) continue;
    // Include elements near the viewport (within 500px above/below)
    if (rect.bottom < -500 || rect.top > window.innerHeight + 500) continue;

    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (parseFloat(style.opacity) < 0.1) continue;

    // For non-form/non-button elements, require some accessible name
    const isButton = tag === 'BUTTON' || el.getAttribute('role') === 'button';
    const isLink = tag === 'A';
    if (!isFormField && !isButton && !isLink) {
      const name = getAccessibleName(el);
      if (!name) continue;
    }

    result.push(el);
  }

  // ALWAYS include the focused element — critical for elements that only become
  // visible/focusable after clicking (e.g. Gmail search input after clicking search icon)
  const focused = document.activeElement;
  if (focused && focused !== document.body && !seen.has(focused)) {
    const rect = focused.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      result.push(focused);
    }
  }

  return result;
}

/** Assign data-lia-ref attributes to interactive elements and return the accessibility tree */
function assignRefsAndGetTree(): { tree: string; url: string; title: string } {
  // Clean previous refs
  document.querySelectorAll('[data-lia-ref]').forEach(el =>
    el.removeAttribute('data-lia-ref'));
  currentRefMap.clear();

  // Cap elements to avoid overwhelming the model on complex pages (Meet, Gmail, etc.)
  const allElements = getInteractiveElements();
  const MAX_ELEMENTS = 150;
  const elements = allElements.length > MAX_ELEMENTS ? allElements.slice(0, MAX_ELEMENTS) : allElements;
  const lines: string[] = [];
  lines.push(`page [title="${document.title}"] [url="${location.href}"]`);
  if (allElements.length > MAX_ELEMENTS) {
    lines.push(`  (showing ${MAX_ELEMENTS} of ${allElements.length} interactive elements — scroll to see more)`);
  }

  elements.forEach((el, i) => {
    const ref = `e${i}`;
    el.setAttribute('data-lia-ref', ref);
    currentRefMap.set(ref, el);

    const role = getImplicitRole(el);
    const name = getAccessibleName(el);
    const state = getElementState(el);
    const nameStr = name ? ` "${name}"` : '';
    // Include HTML tag + type so agent can distinguish <input> from <button>
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type');
    const tagInfo = type ? `<${tag} type="${type}">` : `<${tag}>`;

    lines.push(`  - ${role} ${tagInfo} [ref=${ref}]${nameStr} ${state}`.trimEnd());
  });

  return {
    tree: lines.join('\n'),
    url: location.href,
    title: document.title
  };
}

// ============================================
// WEB AGENT: Set-of-Marks (visual labels)
// ============================================

function drawSetOfMarks(): void {
  clearSetOfMarks();
  document.querySelectorAll('[data-lia-ref]').forEach(el => {
    const ref = el.getAttribute('data-lia-ref')!;
    const rect = el.getBoundingClientRect();
    // Skip off-screen elements
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    if (rect.width < 2 || rect.height < 2) return;

    // Label with ref ID
    const label = document.createElement('div');
    label.className = '__lia-som-label';
    label.textContent = ref;
    label.style.cssText = `
      position:fixed; z-index:2147483647;
      left:${Math.round(rect.left)}px; top:${Math.max(0, Math.round(rect.top) - 18)}px;
      background:#FF6B00; color:white; font-size:11px; font-weight:bold;
      padding:1px 5px; border-radius:3px; font-family:monospace;
      pointer-events:none; line-height:16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.4);
    `;
    document.body.appendChild(label);

    // Highlight border around the element
    const highlight = document.createElement('div');
    highlight.className = '__lia-som-label';
    highlight.style.cssText = `
      position:fixed; z-index:2147483646;
      left:${Math.round(rect.left) - 1}px; top:${Math.round(rect.top) - 1}px;
      width:${Math.round(rect.width) + 2}px; height:${Math.round(rect.height) + 2}px;
      border:2px solid #FF6B00; border-radius:3px;
      pointer-events:none; box-sizing:border-box;
    `;
    document.body.appendChild(highlight);
  });
}

function clearSetOfMarks(): void {
  document.querySelectorAll('.__lia-som-label').forEach(el => el.remove());
}

// ============================================
// WEB AGENT: Action Execution (by ref ID)
// ============================================

interface ActionResult {
  success: boolean;
  message: string;
  changed?: boolean;
}

function executeByRef(ref: string, action: string, value?: string): ActionResult {
  const el = currentRefMap.get(ref) || document.querySelector(`[data-lia-ref="${ref}"]`);

  // press_key can work without a specific element (uses activeElement or body)
  if (!el && action !== 'press_key') {
    return { success: false, message: `Element ${ref} not found. Available refs: ${Array.from(currentRefMap.keys()).slice(0, 10).join(', ')}` };
  }

  const target = el || document.activeElement || document.body;

  try {
    switch (action) {
      case 'click': {
        const htmlEl = target as HTMLElement;
        // Scroll into view first if not visible
        const rect = htmlEl.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          htmlEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        // Try multiple click strategies
        htmlEl.focus();
        htmlEl.click();
        // Also dispatch pointer events for React/modern frameworks
        htmlEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        htmlEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        htmlEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        const name = getAccessibleName(target) || target.tagName.toLowerCase();
        return { success: true, message: `Clicked "${name}" (${ref})` };
      }

      case 'type': {
        const text = value || '';
        const htmlEl = target as HTMLElement;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          htmlEl.focus();
          // Use native setter for React/Vue/Angular compat
          const proto = target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(target, text);
          } else {
            target.value = text;
          }
          target.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          target.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
          return { success: true, message: `Typed "${text.substring(0, 40)}" into ${ref}` };
        }
        if (htmlEl.isContentEditable) {
          htmlEl.focus();
          htmlEl.innerText = text;
          htmlEl.dispatchEvent(new Event('input', { bubbles: true }));
          return { success: true, message: `Typed into contenteditable ${ref}` };
        }
        return { success: false, message: `${ref} is not a text input (${target.tagName})` };
      }

      case 'clear': {
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          (target as HTMLElement).focus();
          const proto = target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(target, '');
          } else {
            target.value = '';
          }
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, message: `Cleared ${ref}` };
        }
        if ((target as HTMLElement).isContentEditable) {
          (target as HTMLElement).focus();
          (target as HTMLElement).innerText = '';
          target.dispatchEvent(new Event('input', { bubbles: true }));
          return { success: true, message: `Cleared contenteditable ${ref}` };
        }
        return { success: false, message: `${ref} is not clearable` };
      }

      case 'scroll': {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { success: true, message: `Scrolled to ${ref}` };
      }

      case 'select': {
        if (target instanceof HTMLSelectElement) {
          const optionValue = value || '';
          // Try matching by value first, then by text
          let found = false;
          for (const opt of Array.from(target.options)) {
            if (opt.value === optionValue || opt.textContent?.trim() === optionValue) {
              target.value = opt.value;
              found = true;
              break;
            }
          }
          if (!found) {
            // Try partial match
            for (const opt of Array.from(target.options)) {
              if (opt.textContent?.trim().toLowerCase().includes(optionValue.toLowerCase())) {
                target.value = opt.value;
                found = true;
                break;
              }
            }
          }
          if (found) {
            target.dispatchEvent(new Event('change', { bubbles: true }));
            target.dispatchEvent(new Event('input', { bubbles: true }));
            return { success: true, message: `Selected "${optionValue}" in ${ref}` };
          }
          return { success: false, message: `Option "${optionValue}" not found in ${ref}` };
        }
        return { success: false, message: `${ref} is not a select element` };
      }

      case 'hover': {
        const htmlEl = target as HTMLElement;
        const rect = htmlEl.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        htmlEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: cx, clientY: cy }));
        htmlEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: cx, clientY: cy }));
        htmlEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
        return { success: true, message: `Hovered over ${ref}` };
      }

      case 'press_key': {
        const key = value || 'Enter';
        const htmlEl = target as HTMLElement;
        if (htmlEl.focus) htmlEl.focus();

        const keyCode = key === 'Enter' ? 13 : key === 'Tab' ? 9 :
                        key === 'Escape' ? 27 : key === 'Backspace' ? 8 :
                        key === 'Space' ? 32 : key === 'ArrowDown' ? 40 :
                        key === 'ArrowUp' ? 38 : 0;

        for (const eventType of ['keydown', 'keypress', 'keyup'] as const) {
          htmlEl.dispatchEvent(new KeyboardEvent(eventType, {
            key: key === 'Space' ? ' ' : key,
            code: key === 'Space' ? 'Space' : key,
            keyCode,
            which: keyCode,
            bubbles: true,
            cancelable: true
          }));
        }
        // If Enter on input inside form, try form submit
        if (key === 'Enter' && target instanceof HTMLInputElement && target.form) {
          const submitBtn = target.form.querySelector('button[type="submit"], input[type="submit"]') as HTMLElement;
          if (submitBtn) submitBtn.click();
          else {
            const evt = new Event('submit', { bubbles: true, cancelable: true });
            target.form.dispatchEvent(evt);
          }
        }
        return { success: true, message: `Pressed ${key} on ${ref || 'active element'}` };
      }

      default:
        return { success: false, message: `Unknown action: ${action}` };
    }
  } catch (error) {
    return { success: false, message: `Error executing ${action} on ${ref}: ${error}` };
  }
}

function scrollPage(direction: string): ActionResult {
  const beforeY = window.scrollY;
  const maxY = document.documentElement.scrollHeight - window.innerHeight;
  // Scroll ~70% of viewport height for meaningful progress
  const amount = direction === 'up' ? -Math.round(window.innerHeight * 0.7) : Math.round(window.innerHeight * 0.7);
  window.scrollBy({ top: amount, behavior: 'smooth' });

  // Report scroll position so the agent knows if it reached the end
  const afterY = Math.min(Math.max(beforeY + amount, 0), maxY);
  const atEnd = direction === 'down' && beforeY >= maxY - 10;
  const atTop = direction === 'up' && beforeY <= 10;

  if (atEnd) {
    return { success: true, message: `Already at the bottom of the page. No more content below.` };
  }
  if (atTop) {
    return { success: true, message: `Already at the top of the page.` };
  }

  const percentScrolled = Math.round((afterY / Math.max(maxY, 1)) * 100);
  return { success: true, message: `Scrolled ${direction}. Position: ${percentScrolled}% of page.` };
}

// ============================================
// WEB AGENT: Page Content (for chat context)
// ============================================

function getPageContent(): string {
  // Simple content extraction for chat context (non-agent use)
  const contentSelectors = ['[role="main"]', 'main', 'article', '#content', '.content', '#app'];
  for (const sel of contentSelectors) {
    const el = document.querySelector(sel);
    if (el?.textContent && el.textContent.trim().length > 200) {
      return el.textContent.trim().substring(0, 100000);
    }
  }
  return document.body.innerText.substring(0, 100000);
}

// ============================================
// FIND AND HIGHLIGHT (Smart References)
// ============================================

function findAndHighlightText(searchText: string): { found: boolean; matchCount: number } {
  if (!searchText || searchText.trim().length === 0) {
    return { found: false, matchCount: 0 };
  }

  // Remove any previous highlights
  document.querySelectorAll('.__lia-highlight').forEach(el => {
    const parent = el.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(el.textContent || ''), el);
      parent.normalize();
    }
  });

  // For long snippets, use first 80 chars to increase match chance
  const query = searchText.trim();
  const searchFor = query.length > 100 ? query.substring(0, 80) : query;

  // Use TreeWalker to find text nodes containing the search text
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        // Skip script, style, noscript, hidden elements
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  // Collect all text nodes
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }

  // Try exact match first, then case-insensitive
  let matchCount = 0;
  const searchLower = searchFor.toLowerCase();

  for (const textNode of textNodes) {
    const content = textNode.textContent || '';
    const idx = content.toLowerCase().indexOf(searchLower);
    if (idx === -1) continue;

    // Found a match — create a highlighted range
    const range = document.createRange();
    range.setStart(textNode, idx);
    range.setEnd(textNode, Math.min(idx + searchFor.length, content.length));

    const mark = document.createElement('mark');
    mark.className = '__lia-highlight';
    mark.style.cssText = 'background: #FFEB3B; color: #000; padding: 2px 0; border-radius: 2px; transition: background 0.5s;';

    try {
      range.surroundContents(mark);
      matchCount++;

      // Scroll to first match
      if (matchCount === 1) {
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      // Fade out after 5 seconds
      setTimeout(() => {
        mark.style.background = 'rgba(255, 235, 59, 0.3)';
        // Remove completely after 10 seconds
        setTimeout(() => {
          const parent = mark.parentNode;
          if (parent) {
            parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
            parent.normalize();
          }
        }, 5000);
      }, 5000);

      // Only highlight first 3 matches to avoid overwhelming the page
      if (matchCount >= 3) break;
    } catch {
      // surroundContents can fail if range spans multiple elements
      continue;
    }
  }

  // If no exact match found, try matching across adjacent text nodes
  if (matchCount === 0 && searchFor.length > 20) {
    // Try shorter prefix (first 40 chars)
    const shortSearch = searchFor.substring(0, 40).toLowerCase();
    for (const textNode of textNodes) {
      const content = (textNode.textContent || '').toLowerCase();
      const idx = content.indexOf(shortSearch);
      if (idx === -1) continue;

      const el = textNode.parentElement;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Highlight the parent element temporarily
        const origBg = el.style.background;
        el.style.background = '#FFEB3B';
        el.style.transition = 'background 0.5s';
        matchCount = 1;
        setTimeout(() => {
          el.style.background = 'rgba(255, 235, 59, 0.3)';
          setTimeout(() => { el.style.background = origBg; }, 5000);
        }, 5000);
        break;
      }
    }
  }

  return { found: matchCount > 0, matchCount };
}

// ============================================
// Text Selection Popup
// ============================================

let selectionPopup: HTMLDivElement | null = null;
let currentSelection = '';

function handleButtonClick(action: string) {
  if (!currentSelection) return;

  let prompt = '';
  switch (action) {
    case 'ask':
      prompt = `Tengo una pregunta sobre este texto: "${currentSelection}"`;
      break;
    case 'explain':
      prompt = `Explícame este texto de forma sencilla: "${currentSelection}"`;
      break;
    case 'summarize':
      prompt = `Resume este texto: "${currentSelection}"`;
      break;
    case 'translate':
      prompt = `Traduce este texto al inglés: "${currentSelection}"`;
      break;
    default:
      prompt = currentSelection;
  }

  safeSend({
    type: 'SELECTION_ACTION',
    action: action,
    text: currentSelection,
    prompt: prompt
  });

  hideSelectionPopup();
  currentSelection = '';
}

function createSelectionPopup() {
  if (selectionPopup) return;

  const host = document.createElement('div');
  host.id = 'lia-selection-popup-host';
  host.style.cssText = 'position: fixed; z-index: 2147483647; display: none;';

  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .lia-popup { background: #1E2329; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); animation: liaFadeIn 0.15s ease-out; }
    @keyframes liaFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .lia-popup-content { display: flex; gap: 4px; }
    .lia-popup-btn { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: transparent; border: none; border-radius: 8px; color: #e0e0e0; font-size: 13px; cursor: pointer; transition: all 0.15s ease; white-space: nowrap; font-family: inherit; }
    .lia-popup-btn:hover { background: #00d4b3; color: #0a2540; }
    .lia-popup-btn svg { flex-shrink: 0; width: 16px; height: 16px; }
  `;
  shadow.appendChild(style);

  const popup = document.createElement('div');
  popup.className = 'lia-popup';
  const content = document.createElement('div');
  content.className = 'lia-popup-content';

  const buttons = [
    { action: 'ask', label: 'Preguntar a Lia', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' },
    { action: 'explain', label: 'Explicar', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>' },
    { action: 'summarize', label: 'Resumir', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/></svg>' },
    { action: 'translate', label: 'Traducir', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>' }
  ];

  buttons.forEach(({ action, label, icon }) => {
    const btn = document.createElement('button');
    btn.className = 'lia-popup-btn';
    btn.innerHTML = icon + ' ' + label;
    btn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      handleButtonClick(action);
      return false;
    };
    content.appendChild(btn);
  });

  popup.appendChild(content);
  shadow.appendChild(popup);
  document.body.appendChild(host);
  selectionPopup = host;
}

function showSelectionPopup(x: number, y: number) {
  if (!selectionPopup) createSelectionPopup();
  if (!selectionPopup) return;

  const popupWidth = 420;
  const popupHeight = 50;
  let left = x - popupWidth / 2;
  let top = y - popupHeight - 10;
  if (left < 10) left = 10;
  if (left + popupWidth > window.innerWidth - 10) left = window.innerWidth - popupWidth - 10;
  if (top < 10) top = y + 25;

  selectionPopup.style.left = `${left}px`;
  selectionPopup.style.top = `${top}px`;
  selectionPopup.style.display = 'block';
}

function hideSelectionPopup() {
  if (selectionPopup) selectionPopup.style.display = 'none';
}

document.addEventListener('mouseup', (e) => {
  if (selectionPopup && selectionPopup.contains(e.target as Node)) return;
  setTimeout(() => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();
    if (selectedText && selectedText.length > 3 && selectedText.length < 5000) {
      currentSelection = selectedText;
      try {
        safeSend({ type: 'TEXT_SELECTED', text: currentSelection });
        const range = selection?.getRangeAt(0);
        if (range) {
          const rect = range.getBoundingClientRect();
          showSelectionPopup(rect.left + rect.width / 2, rect.top);
        }
      } catch { /* ignore */ }
    } else if (!selectionPopup?.contains(e.target as Node)) {
      hideSelectionPopup();
      currentSelection = '';
    }
  }, 50);
});

document.addEventListener('mousedown', (e) => {
  if (selectionPopup && !selectionPopup.contains(e.target as HTMLElement)) hideSelectionPopup();
});
document.addEventListener('scroll', () => hideSelectionPopup(), true);

// ============================================
// Message Listener
// ============================================

chrome.runtime.onMessage.addListener((request: any, _sender: any, sendResponse: any) => {
  const action = request.action || request.type;

  switch (action) {
    case 'ping':
      sendResponse({ pong: true });
      break;

    // --- Web Agent handlers ---

    case 'getAccessibilityTree': {
      const result = assignRefsAndGetTree();
      sendResponse(result);
      break;
    }

    case 'drawSetOfMarks':
      drawSetOfMarks();
      sendResponse({ success: true });
      break;

    case 'clearSetOfMarks':
      clearSetOfMarks();
      sendResponse({ success: true });
      break;

    case 'webAgentAction': {
      const { ref, actionType, value } = request;
      if (actionType === 'scroll_page') {
        sendResponse(scrollPage(value || 'down'));
      } else {
        sendResponse(executeByRef(ref, actionType, value));
      }
      break;
    }

    // --- Legacy context handlers (used by normal chat) ---

    case 'GET_DOM_CONTEXT':
      sendResponse({
        context: `URL: ${window.location.href}\nTítulo: ${document.title}\n\nCONTENIDO PRINCIPAL:\n${getPageContent()}`
      });
      break;

    case 'getPageContent':
      sendResponse({ content: getPageContent() });
      break;

    case 'getSelectedText':
      sendResponse({ text: currentSelection });
      break;

    case 'FIND_AND_HIGHLIGHT': {
      const { searchText } = request;
      const result = findAndHighlightText(searchText || '');
      sendResponse(result);
      break;
    }

    case 'getGeolocation':
      navigator.geolocation.getCurrentPosition(
        (position) => {
          sendResponse({
            success: true,
            location: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy
            }
          });
        },
        (error) => {
          let errorMessage = 'Error desconocido';
          switch (error.code) {
            case error.PERMISSION_DENIED: errorMessage = 'Permisos de ubicación denegados'; break;
            case error.POSITION_UNAVAILABLE: errorMessage = 'Ubicación no disponible'; break;
            case error.TIMEOUT: errorMessage = 'Tiempo de espera agotado'; break;
          }
          sendResponse({ success: false, error: errorMessage, errorCode: error.code });
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 }
      );
      break;

    // --- Google Meet handlers ---

    case 'startMeetTranscription':
      startMeetTranscriptionFromMessage();
      sendResponse({ success: true });
      break;

    case 'stopMeetTranscription':
      stopMeetTranscriptionFromMessage();
      sendResponse({ success: true });
      break;

    case 'getMeetingInfo':
      sendResponse(getMeetingInfo());
      break;

    default:
      sendResponse({ error: 'Unknown action' });
  }

  return true;
});

// ============================================
// GOOGLE MEET AUTO-DETECTION & TRANSCRIPTION
// ============================================

let meetCaptionObserver: MeetCaptionObserver | null = null;
let meetAutoDetectRunning = false;
let ccEnableRetryInterval: ReturnType<typeof setInterval> | null = null;
let participantUpdateInterval: ReturnType<typeof setInterval> | null = null;

function startMeetTranscriptionFromMessage(): void {
  if (meetCaptionObserver) return;
  startMeetTranscription();
}

function stopMeetTranscriptionFromMessage(): void {
  stopMeetTranscription();
}

function startMeetTranscription(): void {
  safeSend({ type: 'MEETING_DETECTED', url: window.location.href, title: getMeetingInfo().title });
  enableCCWithRetry();

  meetCaptionObserver = new MeetCaptionObserver();
  meetCaptionObserver.start((entry: CaptionEntry) => {
    safeSend({ type: 'CAPTION_RECEIVED', speaker: entry.speaker, text: entry.text, timestamp: entry.timestamp });
  });

  participantUpdateInterval = setInterval(() => {
    safeSend({ type: 'PARTICIPANTS_UPDATED', participants: getParticipants() });
  }, 5000);
}

function stopMeetTranscription(): void {
  if (meetCaptionObserver) { meetCaptionObserver.stop(); meetCaptionObserver = null; }
  if (ccEnableRetryInterval) { clearInterval(ccEnableRetryInterval); ccEnableRetryInterval = null; }
  if (participantUpdateInterval) { clearInterval(participantUpdateInterval); participantUpdateInterval = null; }
  safeSend({ type: 'MEETING_ENDED' });
}

function enableCCWithRetry(): void {
  if (enableClosedCaptions()) { setupCaptionHiding(); return; }
  let attempts = 0;
  ccEnableRetryInterval = setInterval(() => {
    attempts++;
    if (attempts > 5 || meetCaptionObserver?.isCaptionsDetected()) {
      if (ccEnableRetryInterval) { clearInterval(ccEnableRetryInterval); ccEnableRetryInterval = null; }
      return;
    }
    if (enableClosedCaptions()) {
      if (ccEnableRetryInterval) { clearInterval(ccEnableRetryInterval); ccEnableRetryInterval = null; }
      setupCaptionHiding();
    }
  }, 5000);
}

function setupCaptionHiding(): void {
  let hideAttempts = 0;
  const hideInterval = setInterval(() => {
    hideAttempts++;
    if (hideAttempts > 10) { clearInterval(hideInterval); return; }
    const container = findCaptionContainer();
    if (container) { hideCaptionsVisually(container); clearInterval(hideInterval); }
  }, 2000);
}

function autoDetectGoogleMeet(): void {
  if (!isGoogleMeetUrl() || meetAutoDetectRunning || meetCaptionObserver) return;
  meetAutoDetectRunning = true;
  let checkCount = 0;
  const checkInterval = setInterval(() => {
    checkCount++;
    if (isMeetingActive()) {
      clearInterval(checkInterval);
      meetAutoDetectRunning = false;
      setTimeout(() => startMeetTranscription(), 2000);
    }
    if (checkCount > 45) { clearInterval(checkInterval); meetAutoDetectRunning = false; }
  }, 2000);
}

function handleMeetNavigation(): void {
  if (!isGoogleMeetUrl()) {
    if (meetCaptionObserver) stopMeetTranscription();
    meetAutoDetectRunning = false;
  }
}

// ============================================
// AUTO-DETECT GOOGLE MEET ON LOAD
// ============================================

const Soflia_VERSION = Date.now().toString();
(window as any).__Soflia_MEET_VERSION__ = Soflia_VERSION;

autoDetectGoogleMeet();

if (document.readyState !== 'complete') {
  window.addEventListener('load', () => {
    if ((window as any).__Soflia_MEET_VERSION__ === Soflia_VERSION) {
      setTimeout(autoDetectGoogleMeet, 1500);
    }
  });
}

if (!(window as any).__Soflia_PUSHSTATE_PATCHED__) {
  (window as any).__Soflia_PUSHSTATE_PATCHED__ = true;
  const origPushState = history.pushState;
  history.pushState = function(data: any, title: string, url?: string | URL | null) {
    origPushState.call(this, data, title, url);
    setTimeout(() => { autoDetectGoogleMeet(); handleMeetNavigation(); }, 1000);
  };
  window.addEventListener('popstate', () => {
    setTimeout(() => { autoDetectGoogleMeet(); handleMeetNavigation(); }, 1000);
  });
}
