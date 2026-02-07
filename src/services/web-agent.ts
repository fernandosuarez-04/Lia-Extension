/**
 * WEB AGENT SERVICE
 *
 * Autonomous browser control using Gemini function calling with an
 * observe-act-verify loop. Takes screenshots + accessibility tree,
 * sends them to Gemini, and executes the returned tool calls.
 *
 * Inspired by: Anthropic CUA, OpenAI Operator, Browser-Use, Google Mariner.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { MODELS } from '../config';
import { WEB_AGENT_SYSTEM_PROMPT, WEB_AGENT_TOOLS } from '../prompts/computer-use';
import { getApiKeyWithCache } from './api-keys';
import { GOOGLE_API_KEY } from '../config';

// ============================================
// Types
// ============================================

export interface WebAgentCallbacks {
  /** Called when the agent sends a text message to display */
  onMessage: (text: string) => void;
  /** Called when the agent starts executing an action */
  onActionStart: (description: string) => void;
  /** Called when the agent completes */
  onComplete: (summary: string) => void;
  /** Called on error */
  onError: (error: string) => void;
}

interface PageState {
  tree: string;
  screenshot?: string; // base64 data URL
  url: string;
  title: string;
}

// ============================================
// Screenshot capture (via background script)
// ============================================

async function captureScreenshot(): Promise<string | null> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' });
    return response?.screenshot || null;
  } catch (err) {
    console.warn('Web Agent: Could not capture screenshot:', err);
    return null;
  }
}

// ============================================
// Content script pre-flight check
// ============================================

/** URLs where content scripts cannot be injected */
function isInjectableUrl(url: string | undefined): boolean {
  if (!url) return false;
  // Chrome forbids content scripts on these schemes
  if (url.startsWith('chrome://')) return false;
  if (url.startsWith('chrome-extension://')) return false;
  if (url.startsWith('about:')) return false;
  if (url.startsWith('chrome-search://')) return false;
  if (url.startsWith('devtools://')) return false;
  if (url === 'about:blank') return false;
  // Edge cases
  if (url.startsWith('data:')) return false;
  if (url.startsWith('view-source:')) return false;
  return true;
}

async function getTabUrl(tabId: number): Promise<string | undefined> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url;
  } catch {
    return undefined;
  }
}

async function pingContentScript(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    return !!response?.pong;
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId: number): Promise<boolean> {
  // First check if the URL is injectable
  const url = await getTabUrl(tabId);
  if (!isInjectableUrl(url)) {
    console.warn(`Web Agent: Cannot inject into ${url} — not a web page`);
    return false;
  }

  if (await pingContentScript(tabId)) return true;

  // Try injecting the content script
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['assets/content.js']
    });
    // Wait a bit for it to initialize
    await new Promise(r => setTimeout(r, 500));
    return await pingContentScript(tabId);
  } catch (err) {
    console.warn('Web Agent: Could not inject content script:', err);
    return false;
  }
}

// ============================================
// Wait for page to finish loading after navigation
// ============================================

function waitForPageLoad(tabId: number, timeoutMs: number = 10000): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      // Extra settle time for JS-heavy pages (SPAs, React hydration, etc.)
      setTimeout(resolve, 800);
    };

    const listener = (id: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        done();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    // Safety timeout — don't hang forever on slow pages
    const timer = setTimeout(done, timeoutMs);

    // If the tab is already complete (e.g. cached page), resolve immediately
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') done();
    }).catch(() => done());
  });
}

// ============================================
// Find an existing tab that already has the target URL open
// ============================================

async function findExistingTab(targetUrl: string, currentTabId: number): Promise<chrome.tabs.Tab | null> {
  try {
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const webTabs = allTabs.filter(t =>
      t.id && t.id !== currentTabId &&
      t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://')
    );

    // Extract origin + pathname from the target URL for flexible matching
    let targetOrigin = '';
    let targetPath = '';
    try {
      const parsed = new URL(targetUrl);
      targetOrigin = parsed.origin;  // e.g. "https://mail.google.com"
      targetPath = parsed.pathname;  // e.g. "/mail/u/0/"
    } catch {
      // Not a valid URL — try substring match
      return webTabs.find(t => t.url!.includes(targetUrl)) || null;
    }

    // 1. Exact URL match (ignoring trailing slash and hash)
    const normalize = (u: string) => u.replace(/\/?(#.*)?$/, '');
    const exact = webTabs.find(t => normalize(t.url!) === normalize(targetUrl));
    if (exact) return exact;

    // 2. Same origin + path starts with target path (e.g. gmail inbox variations)
    const originMatch = webTabs.find(t => {
      try {
        const p = new URL(t.url!);
        return p.origin === targetOrigin && (
          p.pathname.startsWith(targetPath) || targetPath.startsWith(p.pathname)
        );
      } catch { return false; }
    });
    if (originMatch) return originMatch;

    // 3. Same origin only (e.g. user asks for "gmail.com" and a tab has "mail.google.com/...")
    const justOrigin = webTabs.find(t => {
      try { return new URL(t.url!).origin === targetOrigin; }
      catch { return false; }
    });
    if (justOrigin) return justOrigin;

    return null;
  } catch {
    return null;
  }
}

// ============================================
// Page state collection
// ============================================

async function getPageState(tabId: number, includeScreenshot: boolean): Promise<PageState> {
  // 0. Check if we can interact with this tab at all
  const tabUrl = await getTabUrl(tabId);
  if (!isInjectableUrl(tabUrl)) {
    // Tab is on a non-injectable page (chrome://, about:blank, etc.)
    return {
      tree: `ERROR: Current tab is on "${tabUrl}" which is a browser internal page. Use the navigate tool to go to a real website (e.g. https://mail.google.com).`,
      screenshot: undefined,
      url: tabUrl || '',
      title: 'Browser internal page'
    };
  }

  // 1. Ensure content script is alive (it dies after cross-page navigation)
  const scriptReady = await ensureContentScript(tabId);
  if (!scriptReady) {
    return {
      tree: `ERROR: Could not connect to the page at "${tabUrl}". The page may still be loading. Try wait_and_observe, then retry.`,
      screenshot: undefined,
      url: tabUrl || '',
      title: 'Page not responding'
    };
  }

  // 2. Assign refs + get accessibility tree
  let treeResponse: any;
  try {
    treeResponse = await chrome.tabs.sendMessage(tabId, { action: 'getAccessibilityTree' });
  } catch (err) {
    return {
      tree: `ERROR: Lost connection to page. Try wait_and_observe, then the page state will refresh.`,
      screenshot: undefined,
      url: tabUrl || '',
      title: 'Connection lost'
    };
  }

  let screenshot: string | null = null;
  if (includeScreenshot) {
    screenshot = await captureScreenshot();
  }

  return {
    tree: treeResponse?.tree || 'Error: could not get accessibility tree',
    screenshot: screenshot || undefined,
    url: treeResponse?.url || tabUrl || '',
    title: treeResponse?.title || ''
  };
}

// ============================================
// Action execution
// ============================================

async function executeToolCall(tabId: number, functionCall: any): Promise<string> {
  const { name, args } = functionCall;

  switch (name) {
    case 'click_element': {
      const result = await chrome.tabs.sendMessage(tabId, {
        action: 'webAgentAction',
        ref: args.element_ref,
        actionType: 'click'
      });
      return result?.message || 'Click executed';
    }

    case 'type_text': {
      // If clear_first is specified or default, clear first
      const shouldClear = args.clear_first !== false;
      if (shouldClear) {
        await chrome.tabs.sendMessage(tabId, {
          action: 'webAgentAction',
          ref: args.element_ref,
          actionType: 'clear'
        });
      }
      const result = await chrome.tabs.sendMessage(tabId, {
        action: 'webAgentAction',
        ref: args.element_ref,
        actionType: 'type',
        value: args.text
      });
      return result?.message || 'Text typed';
    }

    case 'scroll_page': {
      if (args.element_ref) {
        const result = await chrome.tabs.sendMessage(tabId, {
          action: 'webAgentAction',
          ref: args.element_ref,
          actionType: 'scroll'
        });
        return result?.message || 'Scrolled to element';
      }
      const result = await chrome.tabs.sendMessage(tabId, {
        action: 'webAgentAction',
        actionType: 'scroll_page',
        value: args.direction || 'down'
      });
      return result?.message || `Scrolled ${args.direction}`;
    }

    case 'press_key': {
      const result = await chrome.tabs.sendMessage(tabId, {
        action: 'webAgentAction',
        ref: args.element_ref,
        actionType: 'press_key',
        value: args.key
      });
      return result?.message || `Pressed ${args.key}`;
    }

    case 'navigate': {
      const url = args.url;
      if (url) {
        // Check if the URL is already open in another tab
        const existing = await findExistingTab(url, tabId);
        if (existing?.id) {
          await chrome.tabs.update(existing.id, { active: true });
          await new Promise(r => setTimeout(r, 500));
          return `TAB_SWITCH:${existing.id}:Found existing tab "${existing.title}" — switched to it instead of navigating`;
        }
        await chrome.tabs.update(tabId, { url });
        await waitForPageLoad(tabId);
        return `Navigated to ${url}`;
      }
      return 'No URL provided';
    }

    case 'go_back': {
      await chrome.tabs.goBack(tabId);
      await waitForPageLoad(tabId);
      return 'Navigated back';
    }

    case 'wait_and_observe': {
      const waitMs = Math.min(args.wait_ms || 1500, 5000); // cap at 5s
      await new Promise(r => setTimeout(r, waitMs));
      return `Waited ${waitMs}ms — ${args.reason || 'observing page state'}`;
    }

    case 'select_option': {
      const result = await chrome.tabs.sendMessage(tabId, {
        action: 'webAgentAction',
        ref: args.element_ref,
        actionType: 'select',
        value: args.value
      });
      return result?.message || 'Option selected';
    }

    case 'hover_element': {
      const result = await chrome.tabs.sendMessage(tabId, {
        action: 'webAgentAction',
        ref: args.element_ref,
        actionType: 'hover'
      });
      return result?.message || 'Hovered element';
    }

    case 'open_new_tab': {
      const url = args.url;
      if (url) {
        // Check if the URL is already open in an existing tab
        const existing = await findExistingTab(url, tabId);
        if (existing?.id) {
          await chrome.tabs.update(existing.id, { active: true });
          await new Promise(r => setTimeout(r, 500));
          return `TAB_SWITCH:${existing.id}:Found existing tab "${existing.title}" — switched to it instead of opening a new tab`;
        }
        const newTab = await chrome.tabs.create({ url, active: true });
        if (newTab.id) {
          await waitForPageLoad(newTab.id);
          return `TAB_SWITCH:${newTab.id}:Opened new tab and navigated to ${url}`;
        }
      }
      return 'No URL provided';
    }

    case 'switch_tab': {
      const idx = args.tab_index;
      const allTabs = await chrome.tabs.query({ currentWindow: true });
      const webTabs = allTabs.filter(t => t.url && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://'));
      if (idx >= 0 && idx < webTabs.length) {
        const target = webTabs[idx];
        await chrome.tabs.update(target.id!, { active: true });
        await new Promise(r => setTimeout(r, 500));
        return `TAB_SWITCH:${target.id}:Switched to tab ${idx}: "${target.title}"`;
      }
      return `Invalid tab index ${idx}. There are ${webTabs.length} tabs (0-${webTabs.length - 1}).`;
    }

    case 'list_tabs': {
      const allTabs = await chrome.tabs.query({ currentWindow: true });
      const webTabs = allTabs.filter(t => t.url && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://'));
      const list = webTabs.map((t, i) =>
        `[${i}] ${t.active ? '(active) ' : ''}${t.title} — ${t.url}`
      ).join('\n');
      return `Open tabs:\n${list}`;
    }

    case 'task_complete':
      return `TASK_COMPLETE: ${args.summary}`;

    case 'task_failed':
      return `TASK_FAILED: ${args.reason}`;

    default:
      return `Unknown tool: ${name}`;
  }
}

// ============================================
// Should we take a screenshot this step?
// ============================================

function shouldTakeScreenshot(lastAction: string | null, step: number): boolean {
  // Always screenshot on first step
  if (step === 0) return true;
  // Screenshot after visual/navigation actions
  if (!lastAction) return true;
  const visualActions = [
    'click_element', 'scroll_page', 'wait_and_observe',
    'navigate', 'go_back', 'hover_element', 'select_option',
    'open_new_tab', 'switch_tab'
  ];
  return visualActions.includes(lastAction);
}

// ============================================
// Build message parts for Gemini
// ============================================

function buildObservationParts(state: PageState, userRequest?: string): any[] {
  const parts: any[] = [];

  // Text: accessibility tree + page info
  let text = `Current page: ${state.title}\nURL: ${state.url}\n\n=== ACCESSIBILITY TREE ===\n${state.tree}`;
  if (userRequest) {
    text = `USER REQUEST: ${userRequest}\n\n${text}`;
  }
  parts.push({ text });

  // Image: annotated screenshot (if available)
  if (state.screenshot) {
    const match = state.screenshot.match(/^data:(image\/[a-z]+);base64,(.+)$/);
    if (match) {
      parts.push({
        inlineData: {
          mimeType: match[1],
          data: match[2]
        }
      });
    }
  }

  return parts;
}

// ============================================
// Build function response part for Gemini
// ============================================

function buildFunctionResponsePart(name: string, result: string): any {
  return {
    functionResponse: {
      name,
      response: { result }
    }
  };
}

// ============================================
// Find active tab (non-extension, non-chrome)
// ============================================

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const isWebTab = (t: chrome.tabs.Tab) => isInjectableUrl(t.url);

  // 1. Try current window active tab (prefer injectable web pages)
  let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  let tab = tabs.find(isWebTab);
  if (tab) return tab;

  // 2. Try any window active tab
  tabs = await chrome.tabs.query({ active: true });
  tab = tabs.find(isWebTab);
  if (tab) return tab;

  // 3. Try last focused window
  tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  tab = tabs.find(isWebTab);
  if (tab) return tab;

  // 4. If no injectable tab is active, return ANY active tab
  //    (the agent can navigate it to a real URL)
  tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length > 0) return tabs[0];

  return null;
}

// ============================================
// Main Agent Loop
// ============================================

export async function runWebAgent(
  userRequest: string,
  callbacks: WebAgentCallbacks,
  maxSteps: number = 50
): Promise<void> {
  try {
    // ---- API Key ----
    let apiKey = await getApiKeyWithCache('google');
    if (!apiKey) apiKey = GOOGLE_API_KEY;
    if (!apiKey) {
      callbacks.onError('No se encontró API key de Google. Configúrala en Ajustes.');
      return;
    }

    // ---- Active Tab ----
    const tab = await getActiveTab();
    if (!tab?.id) {
      callbacks.onError('No se encontró una pestaña activa. Abre una página web primero.');
      return;
    }
    let tabId = tab.id;

    // ---- Content Script Check ----
    // Don't fail hard if on a non-injectable page (chrome://, new tab, etc.)
    // — the agent can use `navigate` to go to a real web page.
    const tabUrl = tab.url || '';
    if (isInjectableUrl(tabUrl)) {
      await ensureContentScript(tabId);
      callbacks.onMessage(`Analizando la página: **${tab.title || tabUrl}**`);
    } else {
      callbacks.onMessage(`La pestaña actual (${tabUrl}) no es una página web. Voy a navegar al sitio correcto.`);
    }

    // ---- Initialize Gemini ----
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: MODELS.WEB_AGENT,
      systemInstruction: WEB_AGENT_SYSTEM_PROMPT,
      tools: WEB_AGENT_TOOLS as any,
    });

    // ---- Agent conversation loop ----
    const history: any[] = [];
    let lastActionName: string | null = null;
    let consecutiveErrors = 0;

    for (let step = 0; step < maxSteps; step++) {
      try {
        // 1. OBSERVE: Get page state
        const useScreenshot = shouldTakeScreenshot(lastActionName, step);
        const pageState = await getPageState(tabId, useScreenshot);

        // 2. Build message
        const parts = buildObservationParts(
          pageState,
          step === 0 ? userRequest : undefined
        );

        // 3. THINK: Send to Gemini with correct history format
        //    We use startChat + sendMessage pattern properly:
        //    - history contains all previous turns
        //    - sendMessage sends the current turn
        const chat = model.startChat({ history });
        const result = await chat.sendMessage(parts);
        const response = result.response;

        // Add this exchange to history for next iteration
        history.push({ role: 'user', parts });

        // 4. Parse response
        const candidate = response.candidates?.[0];
        const content = candidate?.content;

        if (!content?.parts) {
          callbacks.onComplete('El agente finalizó sin respuesta.');
          break;
        }

        // Add model response to history
        history.push({ role: 'model', parts: content.parts });

        // Extract text and ALL function calls from response
        let responseText = '';
        const functionCalls: any[] = [];

        for (const part of content.parts) {
          if (part.text) responseText += part.text;
          if (part.functionCall) functionCalls.push(part.functionCall);
        }

        // Show any text the model produced
        if (responseText) {
          callbacks.onMessage(responseText);
        }

        // 5. ACT: Execute function calls
        if (functionCalls.length === 0) {
          // No tool calls = model is done, just responded with text
          if (responseText) {
            callbacks.onComplete(responseText);
          } else {
            callbacks.onComplete('Tarea completada.');
          }
          break;
        }

        // Execute each function call and build responses
        let shouldBreak = false;
        const functionResponseParts: any[] = [];

        for (const fc of functionCalls) {
          const { name, args } = fc;
          lastActionName = name;

          // Check for terminal actions
          if (name === 'task_complete') {
            callbacks.onComplete(args?.summary || 'Tarea completada.');
            shouldBreak = true;
            break;
          }
          if (name === 'task_failed') {
            callbacks.onError(args?.reason || 'No se pudo completar la tarea.');
            shouldBreak = true;
            break;
          }

          // Describe what we're doing
          const actionDesc = args?.description || `${name}(${args?.element_ref || args?.direction || args?.key || args?.url || ''})`;
          callbacks.onActionStart(actionDesc);

          // Execute action
          let actionResult: string;
          try {
            actionResult = await executeToolCall(tabId, fc);
            consecutiveErrors = 0; // reset on success

            // Handle tab switches — update tabId for subsequent actions
            if (actionResult.startsWith('TAB_SWITCH:')) {
              const parts = actionResult.split(':');
              const newTabId = parseInt(parts[1], 10);
              if (!isNaN(newTabId)) tabId = newTabId;
              actionResult = parts.slice(2).join(':');
            }
          } catch (execError) {
            actionResult = `Error: ${execError instanceof Error ? execError.message : String(execError)}`;
            consecutiveErrors++;
          }

          // Build the function response for Gemini
          functionResponseParts.push(buildFunctionResponsePart(name, actionResult));

          // Wait for page to settle after action
          // press_key Enter triggers AJAX loads on SPAs (Gmail, etc.) — wait longer
          const isEnterKey = name === 'press_key' && (fc.args?.key === 'Enter' || fc.args?.key === 'enter');
          const waitTime = name === 'click_element' ? 1500 :
                           name === 'navigate' ? 500 :  // waitForPageLoad already waited
                           name === 'go_back' ? 500 :   // waitForPageLoad already waited
                           name === 'open_new_tab' ? 500 :  // waitForPageLoad already waited
                           name === 'switch_tab' ? 500 :
                           name === 'type_text' ? 500 :
                           name === 'scroll_page' ? 800 :
                           name === 'select_option' ? 500 :
                           isEnterKey ? 2500 :  // AJAX search/form submissions need time
                           name === 'press_key' ? 500 : 300;
          await new Promise(r => setTimeout(r, waitTime));
        }

        if (shouldBreak) break;

        // 6. VERIFY: Add function responses to history
        //    These go as a 'user' turn with functionResponse parts
        //    (following Gemini's function calling protocol)
        if (functionResponseParts.length > 0) {
          history.push({
            role: 'function',
            parts: functionResponseParts
          });
        }

        // Backoff if too many consecutive errors
        if (consecutiveErrors >= 3) {
          callbacks.onError('Demasiados errores consecutivos. Deteniendo el agente.');
          break;
        }

      } catch (stepError) {
        consecutiveErrors++;
        console.error(`Web Agent step ${step} error:`, stepError);

        if (consecutiveErrors >= 3) {
          callbacks.onError(
            `Error persistente: ${stepError instanceof Error ? stepError.message : String(stepError)}`
          );
          break;
        }

        // Exponential backoff
        const backoffMs = Math.min(1000 * Math.pow(2, consecutiveErrors), 8000);
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }

    // If we hit maxSteps without terminal action
    if (lastActionName && lastActionName !== 'task_complete' && lastActionName !== 'task_failed') {
      callbacks.onComplete('Se alcanzó el máximo de pasos. La tarea puede estar incompleta.');
    }

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Web Agent fatal error:', msg);
    callbacks.onError(`Error del agente: ${msg}`);
  }
}
