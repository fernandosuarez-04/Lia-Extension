console.log('SOFLIA Agent Background Service Worker running');

// Store pending selection to send to popup when it opens
let pendingSelection: { action: string; text: string; prompt: string } | null = null;

// Track which tabs already have the content script
const injectedTabs = new Set<number>();

// ============================================
// MEETING STATE MANAGEMENT
// ============================================

interface MeetingParticipant {
  id: string;
  name: string;
  isSpeaking: boolean;
}

interface CaptionEntry {
  speaker: string;
  text: string;
  timestamp: number;
}

interface MeetingState {
  isActive: boolean;
  tabId: number;
  url: string;
  title: string;
  startTime: number;
  captions: CaptionEntry[];
  participants: MeetingParticipant[];
}

let meetingState: MeetingState | null = null;

// Open side panel on icon click (runs every time the service worker starts)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('setPanelBehavior:', error));

chrome.runtime.onInstalled.addListener(() => {
  console.log('SOFLIA Agent installed');

  // Inject content script into all existing tabs
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id && tab.url && isInjectableUrl(tab.url)) {
        injectContentScript(tab.id);
      }
    });
  });
});

// Check if URL is injectable (not chrome://, edge://, about:, etc.)
function isInjectableUrl(url: string): boolean {
  return !url.startsWith('chrome://') &&
         !url.startsWith('chrome-extension://') &&
         !url.startsWith('edge://') &&
         !url.startsWith('about:') &&
         !url.startsWith('moz-extension://') &&
         !url.startsWith('file://');
}

// Inject content script into a tab
async function injectContentScript(tabId: number) {
  // Skip if already injected
  if (injectedTabs.has(tabId)) {
    return;
  }

  try {
    // First check if content script is already running
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    injectedTabs.add(tabId);
    console.log(`Content script already running in tab ${tabId}`);
  } catch {
    // Content script not running, inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['assets/content.js']
      });
      injectedTabs.add(tabId);
      console.log(`Content script injected into tab ${tabId}`);
    } catch (error) {
      console.log(`Could not inject into tab ${tabId}:`, error);
    }
  }
}

// Listen for tab updates (navigation)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Inject when page finishes loading
  if (changeInfo.status === 'complete' && tab.url && isInjectableUrl(tab.url)) {
    // Remove from injected set since page reloaded
    injectedTabs.delete(tabId);
    injectContentScript(tabId);
  }
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle ping from content script to confirm it's running
  if (message.action === 'ping') {
    sendResponse({ pong: true });
    if (sender.tab?.id) {
      injectedTabs.add(sender.tab.id);
    }
    return true;
  }

  if (message.type === 'SELECTION_ACTION') {
    pendingSelection = {
      action: message.action,
      text: message.text,
      prompt: message.prompt
    };

    console.log('Selection action received:', message.action);

    // Open the side panel
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]?.id) {
        try {
          await chrome.sidePanel.open({ tabId: tabs[0].id });
          console.log('Side panel opened');

          // Small delay then notify the popup
          setTimeout(() => {
            chrome.runtime.sendMessage({ type: 'PENDING_SELECTION_AVAILABLE' }).catch(() => {
              // Popup might not be ready yet, that's ok
            });
          }, 300);
        } catch (err) {
          console.log('Could not open side panel:', err);
        }
      }
    });

    sendResponse({ success: true });
  }

  if (message.type === 'TEXT_SELECTED') {
    // Update pending selection without opening panel
    pendingSelection = {
      action: 'preview', // Default action
      text: message.text,
      prompt: ''
    };

    // Notify popup if it's open
    chrome.runtime.sendMessage({
      type: 'SELECTION_UPDATED',
      text: message.text,
      action: 'preview'
    }).catch(() => {
      // Popup closed, expected
    });

    sendResponse({ success: true });
  }

  if (message.type === 'GET_PENDING_SELECTION') {
    const selection = pendingSelection;
    console.log('GET_PENDING_SELECTION called, returning:', selection ? 'has data' : 'null');
    // Only clear after a successful retrieval
    if (selection) {
      pendingSelection = null;
    }
    sendResponse(selection);
  }

  // ============================================
  // MEETING MESSAGE HANDLERS
  // ============================================

  if (message.type === 'MEETING_DETECTED') {
    const tabId = sender.tab?.id || 0;
    console.log('Background: Meeting detected in tab', tabId, message.title);

    meetingState = {
      isActive: true,
      tabId,
      url: message.url || '',
      title: message.title || 'Google Meet',
      startTime: Date.now(),
      captions: [],
      participants: []
    };

    // Notify popup if open
    chrome.runtime.sendMessage({
      type: 'MEETING_STATE_CHANGED',
      state: meetingState
    }).catch(() => {});

    sendResponse({ received: true });
    return true;
  }

  if (message.type === 'CAPTION_RECEIVED') {
    if (meetingState && meetingState.isActive) {
      // Add caption to buffer
      meetingState.captions.push({
        speaker: message.speaker || 'Participante',
        text: message.text || '',
        timestamp: message.timestamp || Date.now()
      });

      // Keep last 500 captions (prevent memory issues)
      if (meetingState.captions.length > 500) {
        meetingState.captions.shift();
      }

      console.log('Background: Caption received -', message.speaker, ':', message.text?.substring(0, 50));
    }

    // Relay to popup/sidepanel
    chrome.runtime.sendMessage({
      type: 'CAPTION_RECEIVED',
      speaker: message.speaker,
      text: message.text,
      timestamp: message.timestamp
    }).catch(() => {});

    sendResponse({ received: true });
    return true;
  }

  if (message.type === 'PARTICIPANTS_UPDATED') {
    if (meetingState && meetingState.isActive) {
      meetingState.participants = message.participants || [];
    }

    // Relay to popup/sidepanel
    chrome.runtime.sendMessage({
      type: 'PARTICIPANTS_UPDATED',
      participants: message.participants
    }).catch(() => {});

    sendResponse({ received: true });
    return true;
  }

  if (message.type === 'MEETING_ENDED') {
    console.log('Background: Meeting ended');

    if (meetingState) {
      meetingState.isActive = false;
    }

    // Notify popup
    chrome.runtime.sendMessage({
      type: 'MEETING_STATE_CHANGED',
      state: meetingState
    }).catch(() => {});

    sendResponse({ received: true });
    return true;
  }

  if (message.type === 'GET_MEETING_STATE') {
    console.log('Background: GET_MEETING_STATE, isActive:', meetingState?.isActive);
    sendResponse(meetingState);
    return true;
  }

  if (message.type === 'CLEAR_MEETING_STATE') {
    console.log('Background: Clearing meeting state');
    meetingState = null;
    sendResponse({ cleared: true });
    return true;
  }

  // When popup requests transcription start, find the Meet tab and tell it to start
  if (message.type === 'START_MEET_TRANSCRIPTION') {
    console.log('Background: Popup requesting transcription start');
    chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
      const meetTab = tabs.find(t => t.id && t.url && /\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(t.url));
      if (meetTab && meetTab.id) {
        console.log('Background: Forwarding startMeetTranscription to tab', meetTab.id);
        chrome.tabs.sendMessage(meetTab.id, { action: 'startMeetTranscription' }, (resp) => {
          console.log('Background: Content script responded:', resp);
          sendResponse({ sent: true, tabId: meetTab.id });
        });
      } else {
        console.log('Background: No Google Meet tab found');
        sendResponse({ sent: false, error: 'No Google Meet tab found' });
      }
    });
    return true;
  }

  return true;
});

// Clean up meeting state when meeting tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);

  // Clear meeting state if meeting tab was closed
  if (meetingState && meetingState.tabId === tabId) {
    console.log('Background: Meeting tab closed, clearing state');
    meetingState.isActive = false;

    chrome.runtime.sendMessage({
      type: 'MEETING_STATE_CHANGED',
      state: meetingState
    }).catch(() => {});
  }
});
