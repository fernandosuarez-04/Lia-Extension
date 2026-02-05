console.log('SOFLIA Content Script loaded');

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

// chrome.runtime.sendMessage can throw synchronously when the extension context
// is invalidated (e.g. after extension reload while the tab stays open).
// .catch() does not protect against that, so wrap every fire-and-forget send here.
function safeSend(msg: object): void {
  try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch { /* context invalidated */ }
}

// ============================================
// DOM Analysis Functions
// ============================================

function generateElementId(element: Element, index: number): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const classes = element.className && typeof element.className === 'string'
    ? `.${element.className.split(' ').filter(c => c).join('.')}`
    : '';
  return `[${index}]${tag}${id}${classes}`.substring(0, 100);
}

function getVisibleText(element: Element): string {
  const text = element.textContent?.trim() || '';
  return text.substring(0, 150);
}

function getActiveConversation(): string | null {
  // Strategy: Find individual message elements and extract their text.
  // This avoids capturing UI elements from the sidebar/navigation.

  console.log('=== SOFLIA: Buscando conversación activa ===');

  // MÉTODO ESPECIAL: ChatGPT pages (chatgpt.com, share pages)
  const isChatGPT = window.location.hostname.includes('chatgpt.com') ||
                    window.location.hostname.includes('chat.openai.com');

  if (isChatGPT) {
    console.log('🤖 Detectada página de ChatGPT');

    // Método 1: Buscar mensajes por data-message-author-role
    const messageElements = document.querySelectorAll('[data-message-author-role]');
    if (messageElements.length > 0) {
      const messages: string[] = [];
      messageElements.forEach(el => {
        const role = el.getAttribute('data-message-author-role');
        const text = el.textContent?.trim() || '';
        if (text.length > 10) {
          messages.push(`[${role === 'user' ? 'Usuario' : 'Asistente'}]: ${text}`);
        }
      });
      if (messages.length > 0) {
        console.log('✓ ChatGPT: Extraídos', messages.length, 'mensajes por data-message-author-role');
        return `[CONVERSACIÓN DE CHATGPT]\n${messages.join('\n\n---\n\n')}`;
      }
    }

    // Método 2: Buscar dentro de <main> excluyendo nav/aside
    const mainEl = document.querySelector('main');
    if (mainEl) {
      // Clonar para no modificar el DOM real
      const mainClone = mainEl.cloneNode(true) as HTMLElement;

      // Remover elementos de navegación del clon
      mainClone.querySelectorAll('nav, aside, [role="navigation"], [role="complementary"]').forEach(el => el.remove());

      // Buscar elementos de texto con contenido de conversación
      const textElements = mainClone.querySelectorAll('.markdown, .prose, [class*="message"], [class*="conversation"]');
      if (textElements.length > 0) {
        const texts: string[] = [];
        textElements.forEach(el => {
          const text = el.textContent?.trim() || '';
          if (text.length > 20 && !texts.some(t => t.includes(text) || text.includes(t))) {
            texts.push(text);
          }
        });
        if (texts.length > 0) {
          console.log('✓ ChatGPT: Extraído contenido de', texts.length, 'elementos markdown/prose');
          return `[CONVERSACIÓN DE CHATGPT]\n${texts.join('\n\n---\n\n')}`;
        }
      }

      // Método 3: Extraer todo el texto de main, pero filtrar sidebar
      const mainText = mainClone.textContent?.trim() || '';
      if (mainText.length > 200) {
        // Filtrar líneas que parecen ser del sidebar (nombres de chats cortos, etc.)
        const lines = mainText.split('\n').filter(line => {
          const l = line.trim();
          // Mantener líneas que parecen ser contenido de conversación
          return l.length > 30 || // Líneas largas son probablemente contenido
                 l.includes('?') || // Preguntas
                 l.includes('.') || // Oraciones
                 l.includes(':'); // Listas o diálogos
        });
        const filteredText = lines.join('\n');
        if (filteredText.length > 200) {
          console.log('✓ ChatGPT: Extraído texto filtrado de main:', filteredText.length, 'chars');
          return `[CONVERSACIÓN DE CHATGPT]\n${filteredText.substring(0, 15000)}`;
        }
      }
    }

    // Método 4: Buscar el contenedor principal de la conversación por posición
    // En ChatGPT, el sidebar está a la izquierda (<300px), el contenido principal está centrado
    const allDivs = document.querySelectorAll('div');
    let bestConversationDiv: Element | null = null;
    let bestScore = 0;

    for (const div of allDivs) {
      const rect = div.getBoundingClientRect();

      // Buscar divs grandes en el centro/derecha de la pantalla (no sidebar)
      if (rect.left > 200 && // No es sidebar izquierdo
          rect.width > 400 && // Suficientemente ancho
          rect.height > 300 && // Suficientemente alto
          rect.top >= 0 && rect.top < 200) { // Cerca del top

        const text = div.textContent?.trim() || '';
        // Puntuar por contenido que parece conversación
        let score = text.length;
        if (text.includes('?')) score += 500; // Tiene preguntas
        if (text.includes(':')) score += 300; // Tiene diálogo
        if (text.length > 1000) score += 1000; // Contenido sustancial

        // Penalizar si parece ser sidebar (muchas líneas cortas)
        const lines = text.split('\n');
        const shortLines = lines.filter(l => l.trim().length > 0 && l.trim().length < 40).length;
        if (shortLines > lines.length * 0.7) score -= 2000; // Muchas líneas cortas = sidebar

        if (score > bestScore) {
          bestScore = score;
          bestConversationDiv = div;
        }
      }
    }

    if (bestConversationDiv && bestScore > 500) {
      const text = bestConversationDiv.textContent?.trim() || '';
      console.log('✓ ChatGPT: Encontrado contenedor de conversación por posición, score:', bestScore);
      return `[CONVERSACIÓN DE CHATGPT]\n${text.substring(0, 15000)}`;
    }
  }

  // MÉTODO 0: Extraer mensajes individuales buscando elementos con timestamps
  // En Google Chat, los mensajes tienen timestamps como "24 min", "hace 2 horas", etc.
  const extractMessagesFromChat = (): string | null => {
    const messages: string[] = [];

    // Buscar todos los elementos que podrían ser mensajes
    const allElements = document.querySelectorAll('div, span');

    // Regex más flexible para timestamps (no requiere que sea el texto COMPLETO)
    const timestampRegex = /\d+\s*(min|hora|hour|seg|sec|día|day)s?|\d{1,2}:\d{2}|hace\s+\d|ayer|yesterday|hoy|today/i;

    const foundTimestamps = new Set<Element>();

    // Primero, encontrar todos los timestamps
    for (const el of allElements) {
      const text = el.textContent?.trim() || '';
      // Solo elementos pequeños que contengan timestamps
      if (text.length > 0 && text.length < 50 && timestampRegex.test(text)) {
        // Verificar que el elemento sea pequeño (no un contenedor grande)
        const rect = el.getBoundingClientRect();
        if (rect.width < 200 && rect.height < 50) {
          foundTimestamps.add(el);
        }
      }
    }

    console.log('Timestamps encontrados:', foundTimestamps.size);

    if (foundTimestamps.size > 2) {
      // Hay timestamps, intentar extraer mensajes cerca de ellos
      for (const timestamp of foundTimestamps) {
        // Buscar el contenedor padre que tiene el mensaje
        let parent = timestamp.parentElement;
        for (let i = 0; i < 8 && parent; i++) {
          const rect = parent.getBoundingClientRect();
          // Contenedor de mensaje típico: ancho medio, no muy alto
          if (rect.width > 100 && rect.width < 800 && rect.height > 20 && rect.height < 500) {
            const text = parent.textContent?.trim() || '';
            // Filtrar textos que parecen ser mensajes (no UI)
            if (text.length > 10 && text.length < 3000 &&
                !text.includes('Buscar en el chat') && !text.includes('Nuevo chat') &&
                !text.includes('Página principal') && !text.includes('Atajos') &&
                !text.includes('Mensajes directos') && !text.includes('Espacios') &&
                !text.includes('Google Drive') && !text.includes('Explorar espacios')) {
              if (!messages.some(m => m.includes(text) || text.includes(m))) {
                messages.push(text);
              }
            }
          }
          parent = parent.parentElement;
        }
      }
    }

    // Deduplicar mensajes (algunos pueden estar anidados)
    const uniqueMessages = messages.filter((msg, idx) => {
      for (let i = 0; i < messages.length; i++) {
        if (i !== idx && messages[i].includes(msg) && messages[i].length > msg.length) {
          return false; // Este mensaje está contenido en otro más largo
        }
      }
      return true;
    });

    if (uniqueMessages.length > 2) {
      console.log('✓ Extraídos', uniqueMessages.length, 'mensajes por método de timestamps');
      return `[CONVERSACIÓN ACTIVA - ${uniqueMessages.length} mensajes]\n${uniqueMessages.join('\n---\n')}`;
    }

    return null;
  };

  // Intentar extraer mensajes primero
  const extractedMessages = extractMessagesFromChat();
  if (extractedMessages) {
    return extractedMessages;
  }

  // MÉTODO 0.5: Buscar contenedor scrolleable que NO sea el sidebar
  // El sidebar está a la izquierda (left < 300), el chat está a la derecha
  const scrollableContainers = document.querySelectorAll('div');
  for (const container of scrollableContainers) {
    const style = window.getComputedStyle(container);
    const rect = container.getBoundingClientRect();

    // Buscar divs scrolleables que estén en la parte derecha/centro de la pantalla
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        rect.left > 250 && // No es el sidebar izquierdo
        rect.width > 300 &&
        rect.height > 200) {

      const text = container.textContent?.trim() || '';

      // Verificar que contenga timestamps (indicador de chat)
      if ((text.includes('min') || text.includes('hora') || text.includes(':')) && text.length > 100) {
        // Filtrar texto de UI
        const cleanText = text
          .split('\n')
          .filter(line => {
            const l = line.trim();
            // Filtrar líneas de navegación/UI
            return l.length > 0 &&
                   !l.match(/^(Mail|Chat|Spaces|Meet|Atajos|Página principal|Menciones|Destacadas|Mensajes directos|Espacios|Apps|Nuevo chat|Buscar)$/i) &&
                   l.length < 1000;
          })
          .join('\n');

        if (cleanText.length > 100) {
          console.log('✓ Encontrado contenedor scrolleable:', cleanText.length, 'chars, left:', rect.left);
          return `[CONVERSACIÓN ACTIVA]\n${cleanText.substring(0, 15000)}`;
        }
      }
    }
  }

  // MÉTODO 1: Buscar por aria-label que mencione "mensaje", "chat", "conversación"
  const ariaSelectors = [
    '[aria-label*="mensaje" i]',
    '[aria-label*="message" i]',
    '[aria-label*="chat" i]',
    '[aria-label*="conversación" i]',
    '[aria-label*="conversation" i]',
  ];

  for (const selector of ariaSelectors) {
    try {
      const els = document.querySelectorAll(selector);
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        // Panel grande y visible
        if (rect.width > 200 && rect.height > 200 && rect.top < window.innerHeight) {
          const text = el.textContent?.trim() || '';
          if (text.length > 100) {
            console.log('✓ Encontrado por aria-label:', selector, text.length, 'chars');
            return `[CONVERSACIÓN ACTIVA]\n${text.substring(0, 15000)}`;
          }
        }
      }
    } catch (e) { /* skip invalid selectors */ }
  }

  // MÉTODO 2: Buscar el campo de entrada de chat y subir al contenedor padre
  // En Google Chat, el input tiene aria-label específico o es contenteditable
  const inputSelectors = [
    '[contenteditable="true"]',
    '[role="textbox"]',
    'textarea',
    '[aria-label*="Escribe" i]',
    '[aria-label*="Type" i]',
    '[aria-label*="mensaje" i]',
  ];

  for (const selector of inputSelectors) {
    try {
      const inputs = document.querySelectorAll(selector);
      for (const input of inputs) {
        const inputRect = input.getBoundingClientRect();
        // El input debe ser visible y razonable en tamaño
        if (inputRect.width < 100 || inputRect.height < 20) continue;
        if (inputRect.top < 0 || inputRect.top > window.innerHeight) continue;

        console.log('Encontrado input:', selector, 'en posición', inputRect.top, inputRect.left);

        // Subir por los padres buscando un contenedor con suficiente contenido
        let container = input.parentElement;
        for (let level = 0; level < 25 && container; level++) {
          const rect = container.getBoundingClientRect();
          const text = container.textContent?.trim() || '';

          // Log para debugging
          if (level % 5 === 0) {
            console.log(`  Nivel ${level}: ${container.tagName}, ${text.length} chars, ${Math.round(rect.width)}x${Math.round(rect.height)}`);
          }

          // Buscar un contenedor que:
          // - Sea lo suficientemente grande (ancho > 200, alto > 150)
          // - Tenga suficiente texto (> 150 caracteres - muy reducido)
          // - Esté visible en pantalla
          if (rect.width > 200 && rect.height > 150 && text.length > 150) {
            // Verificar que no sea el body o html
            if (container.tagName !== 'BODY' && container.tagName !== 'HTML') {
              // Verificar que tenga una estructura de chat (múltiples líneas de texto)
              const lineBreaks = (text.match(/\n/g) || []).length;
              const hasMultipleMessages = lineBreaks > 2 || text.includes('min') || text.includes('hora');

              if (hasMultipleMessages || text.length > 300) {
                console.log('✓ Encontrado contenedor de chat en nivel', level, ':', text.length, 'chars');
                return `[CONVERSACIÓN ACTIVA]\n${text.substring(0, 15000)}`;
              }
            }
          }
          container = container.parentElement;
        }
      }
    } catch (e) { /* skip */ }
  }

  // MÉTODO 3: Buscar paneles que tengan un botón de cerrar (X) - típico de ventanas de chat
  // MEJORADO: Extraer solo el contenido del área de mensajes, no todo el panel
  const closeButtons = document.querySelectorAll('[aria-label*="Cerrar" i], [aria-label*="Close" i], [data-tooltip*="Cerrar" i]');
  for (const btn of closeButtons) {
    const btnRect = btn.getBoundingClientRect();
    // Solo botones en la parte derecha de la pantalla (no sidebar)
    if (btnRect.left < 250) continue;

    // Subir al contenedor padre que probablemente es el panel de chat
    let panel = btn.parentElement;
    for (let i = 0; i < 10 && panel; i++) {
      const rect = panel.getBoundingClientRect();

      // Panel de chat típico: ancho moderado (no toda la página), en la parte derecha
      if (rect.width > 300 && rect.width < 900 && rect.height > 200 && rect.left > 200) {
        // Buscar dentro del panel un área scrolleable que contenga los mensajes
        const scrollAreas = panel.querySelectorAll('div');
        for (const area of scrollAreas) {
          const areaStyle = window.getComputedStyle(area);
          const areaRect = area.getBoundingClientRect();

          // Área scrolleable dentro del panel
          if ((areaStyle.overflowY === 'auto' || areaStyle.overflowY === 'scroll') &&
              areaRect.height > 150 && areaRect.width > 200) {
            const areaText = area.textContent?.trim() || '';

            // Filtrar elementos de UI del texto
            const cleanedText = areaText
              .split('\n')
              .map(line => line.trim())
              .filter(line => {
                if (line.length === 0) return false;
                if (line.length > 1500) return false; // Líneas muy largas son probablemente contenedores
                // Filtrar elementos de navegación conocidos
                const uiPatterns = /^(Mail|Chat|Spaces|Meet|Atajos|Página principal|Menciones|Destacadas|Mensajes directos|Espacios|Apps|Nuevo chat|Buscar|Google Drive|Explorar espacios|Administrador|Agente Web|Ecos de liderazgo|Ecos_Devops|Aprende y Aplica|El historial está activado)$/i;
                return !uiPatterns.test(line);
              })
              .join('\n');

            if (cleanedText.length > 100 && (cleanedText.includes('min') || cleanedText.includes('hora') || cleanedText.includes(':'))) {
              console.log('✓ Encontrado área de mensajes dentro del panel:', cleanedText.length, 'chars (de', areaText.length, 'original)');
              return `[CONVERSACIÓN ACTIVA]\n${cleanedText.substring(0, 15000)}`;
            }
          }
        }

        // Fallback: usar el panel completo pero filtrar
        const text = panel.textContent?.trim() || '';
        if (text.includes('min') || text.includes('hora') || text.includes(':')) {
          const cleanedText = text
            .split('\n')
            .map(line => line.trim())
            .filter(line => {
              if (line.length === 0 || line.length > 1500) return false;
              const uiPatterns = /^(Mail|Chat|Spaces|Meet|Atajos|Página principal|Menciones|Destacadas|Mensajes directos|Espacios|Apps|Nuevo chat|Buscar|Google Drive|Explorar espacios|Administrador|Agente Web|Ecos|El historial está activado|Unirse|Videoconferencia)$/i;
              return !uiPatterns.test(line);
            })
            .join('\n');

          if (cleanedText.length > 100) {
            console.log('✓ Encontrado panel con botón cerrar (filtrado):', cleanedText.length, 'chars');
            return `[CONVERSACIÓN ACTIVA]\n${cleanedText.substring(0, 15000)}`;
          }
        }
      }
      panel = panel.parentElement;
    }
  }

  // MÉTODO 4: Buscar divs con estructura de lista de mensajes (hijos con mismas clases)
  const allDivs = document.querySelectorAll('div');
  let bestCandidate: Element | null = null;
  let bestScore = 0;

  for (const div of allDivs) {
    const rect = div.getBoundingClientRect();
    // Solo considerar paneles visibles y de tamaño razonable
    if (rect.width < 250 || rect.height < 150) continue;
    if (rect.top > window.innerHeight || rect.bottom < 0) continue;

    const children = div.children;
    if (children.length < 3) continue;

    // Contar hijos con clases similares
    const classMap = new Map<string, number>();
    for (const child of children) {
      const cls = child.className;
      if (cls && typeof cls === 'string') {
        classMap.set(cls, (classMap.get(cls) || 0) + 1);
      }
    }

    // Si hay muchos hijos con la misma clase, podría ser una lista de mensajes
    let maxRepeats = 0;
    for (const count of classMap.values()) {
      if (count > maxRepeats) maxRepeats = count;
    }

    const text = div.textContent?.trim() || '';
    const score = maxRepeats * 10 + text.length / 100;

    if (maxRepeats >= 3 && text.length > 150 && score > bestScore) {
      bestScore = score;
      bestCandidate = div;
    }
  }

  if (bestCandidate) {
    const text = bestCandidate.textContent?.trim() || '';
    console.log('✓ Encontrado por patrón de lista:', text.length, 'chars');
    return `[CONVERSACIÓN ACTIVA]\n${text.substring(0, 15000)}`;
  }

  console.log('✗ No se encontró conversación activa');
  return null;
}

function getMainContentArea(): string {
  // PRIORITY 1: Active conversation (open chat panel)
  const activeConvo = getActiveConversation();
  if (activeConvo) {
    return activeConvo;
  }

  // PRIORITY 2: General page content areas
  const contentSelectors = [
    '[role="main"]',
    'main',
    '#main-content',
    '#content',
    '.main-content',
    'article',
    '.content',
    '#app',
  ];

  for (const selector of contentSelectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent && el.textContent.trim().length > 200) {
      return el.textContent.trim().substring(0, 15000);
    }
  }

  // PRIORITY 3: Fallback - walk body text skipping nav/header/footer
  const skipSelectors = ['nav', 'header', 'footer', 'aside', '[role="navigation"]', '[role="banner"]', '[role="complementary"]'];
  const skipElements = new Set<Element>();
  skipSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => skipElements.add(el));
  });

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        for (const skip of skipElements) {
          if (skip.contains(parent)) return NodeFilter.FILTER_REJECT;
        }
        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let text = '';
  let node: Node | null;
  while ((node = walker.nextNode()) && text.length < 15000) {
    const t = node.textContent?.trim();
    if (t && t.length > 1) {
      text += t + '\n';
    }
  }

  return text.substring(0, 15000);
}

function getStructuredDOM(): object {
  const interactiveElements: any[] = [];
  let elementIndex = 0; // Índice real que usaremos

  // Selectores más específicos - incluye navegación de Gmail/Google
  const selectors = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[role="textbox"]',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="treeitem"]',
    '[role="listitem"]',
    '[role="navigation"] *[aria-label]',
    '[onclick]',
    // Gmail-specific: iconos de navegación con tooltips
    '[data-tooltip]',
    '[aria-label]',
    // Solo tabindex en elementos que tienen texto o aria-label
    'div[tabindex]:not(:empty)',
    'span[tabindex]:not(:empty)',
    // Elementos con jsaction (Gmail/Google apps)
    '[jsaction]'
  ];

  const elements = document.querySelectorAll(selectors.join(','));
  const seen = new Set<Element>(); // Evitar duplicados

  elements.forEach((el) => {
    // Evitar duplicados
    if (seen.has(el)) return;
    seen.add(el);

    const rect = el.getBoundingClientRect();

    // Filtrar elementos invisibles
    if (rect.width === 0 && rect.height === 0) return;
    if (rect.width < 5 || rect.height < 5) return; // Muy pequeños
    if (window.getComputedStyle(el).display === 'none') return;
    if (window.getComputedStyle(el).visibility === 'hidden') return;
    if (window.getComputedStyle(el).opacity === '0') return;

    // Obtener texto y aria-label
    const text = getVisibleText(el);
    const ariaLabel = el.getAttribute('aria-label') || '';
    const title = el.getAttribute('title') || '';
    const dataTooltip = el.getAttribute('data-tooltip') || '';
    
    // FILTRO CRÍTICO: Solo incluir elementos con contenido útil
    // Excepciones: inputs, textareas, selects (campos de formulario)
    const isFormField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
    const isLink = el.tagName === 'A';
    const isButton = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
    
    // Si es un div/span con tabindex pero sin texto/aria-label, SALTAR
    if (!isFormField && !isLink && !isButton) {
      const hasContent = text.length > 0 || ariaLabel.length > 0 || title.length > 0 || dataTooltip.length > 0;
      if (!hasContent) return;
    }

    const elementInfo: any = {
      index: elementIndex, // Usar nuestro índice controlado
      id: generateElementId(el, elementIndex),
      tag: el.tagName.toLowerCase(),
      text: text,
      attributes: {}
    };

    if (el instanceof HTMLAnchorElement) {
      elementInfo.attributes.href = el.href;
    }
    if (el instanceof HTMLInputElement) {
      elementInfo.attributes.type = el.type;
      elementInfo.attributes.name = el.name;
      elementInfo.attributes.placeholder = el.placeholder;
      elementInfo.attributes.value = el.type !== 'password' ? el.value : '***';
    }
    if (el instanceof HTMLButtonElement || el.getAttribute('role') === 'button') {
      elementInfo.type = 'button';
    }
    if ((el as HTMLElement).isContentEditable && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
      elementInfo.type = 'contenteditable';
      elementInfo.attributes.contenteditable = 'true';
    }
    if (el.getAttribute('role') === 'textbox') {
      elementInfo.type = 'textbox';
    }
    if (ariaLabel) {
      elementInfo.ariaLabel = ariaLabel;
    }
    if (title) {
      elementInfo.title = title;
    }
    if (dataTooltip) {
      elementInfo.tooltip = dataTooltip;
    }
    if (el.hasAttribute('aria-placeholder')) {
      elementInfo.attributes.placeholder = el.getAttribute('aria-placeholder');
    }

    elementInfo.position = {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      visible: rect.top >= 0 && rect.top < window.innerHeight
    };

    interactiveElements.push(elementInfo);
    elementIndex++; // Solo incrementar para elementos que realmente agregamos
  });

  console.log(`SOFLIA: Mapeados ${interactiveElements.length} elementos interactivos`);

  return {
    url: window.location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollY: window.scrollY
    },
    interactiveElements: interactiveElements.slice(0, 400),
    headings: Array.from(document.querySelectorAll('h1, h2, h3')).map(h => ({
      level: h.tagName,
      text: h.textContent?.trim().substring(0, 100)
    })).slice(0, 20),
    mainContent: getMainContentArea()
  };
}

function getPageContent(): string {
  return document.body.innerText;
}

function executeAction(action: { type: string; selector?: string; value?: string; index?: number }): { success: boolean; message: string } {
  console.log('=== LIA EJECUTANDO ACCIÓN ===');
  console.log('Acción recibida:', JSON.stringify(action));

  try {
    let element: Element | null = null;

    if (action.selector) {
      element = document.querySelector(action.selector);
      console.log('Buscando por selector:', action.selector, '->' ,'encontrado:', !!element);
    } else if (typeof action.index === 'number') {
      // IMPORTANTE: Usar EXACTAMENTE la misma lógica que getStructuredDOM()
      const selectors = [
        'a[href]',
        'button',
        'input',
        'select',
        'textarea',
        '[contenteditable="true"]',
        '[contenteditable=""]',
        '[role="textbox"]',
        '[role="button"]',
        '[role="link"]',
        '[role="tab"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="switch"]',
        '[role="treeitem"]',
        '[role="listitem"]',
        '[role="navigation"] *[aria-label]',
        '[onclick]',
        '[data-tooltip]',
        '[aria-label]',
        'div[tabindex]:not(:empty)',
        'span[tabindex]:not(:empty)',
        '[jsaction]'
      ];
      
      const allElements = document.querySelectorAll(selectors.join(','));
      const filteredElements: Element[] = [];
      const seen = new Set<Element>();
      
      // Aplicar EXACTAMENTE los mismos filtros que getStructuredDOM
      allElements.forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        if (rect.width < 5 || rect.height < 5) return;
        if (window.getComputedStyle(el).display === 'none') return;
        if (window.getComputedStyle(el).visibility === 'hidden') return;
        if (window.getComputedStyle(el).opacity === '0') return;
        
        const text = el.textContent?.trim() || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        const dataTooltip = el.getAttribute('data-tooltip') || '';
        
        const isFormField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
        const isLink = el.tagName === 'A';
        const isButton = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
        
        if (!isFormField && !isLink && !isButton) {
          const hasContent = text.length > 0 || ariaLabel.length > 0 || title.length > 0 || dataTooltip.length > 0;
          if (!hasContent) return;
        }
        
        filteredElements.push(el);
      });
      
      console.log(`Total elementos interactivos (filtrados): ${filteredElements.length}`);
      element = filteredElements[action.index] || null;
      console.log(`Elemento en índice ${action.index}:`, element);
      if (element) {
        const text = element.textContent?.substring(0, 80) || '';
        const ariaLabel = element.getAttribute('aria-label') || '';
        console.log('Tag:', element.tagName, 'Text:', text, 'AriaLabel:', ariaLabel);
      }
    }

    if (!element) {
      console.log('✗ Elemento NO encontrado');
      return { success: false, message: 'Elemento no encontrado' };
    }

    console.log('Ejecutando tipo de acción:', action.type);

    switch (action.type) {
      case 'click':
        (element as HTMLElement).click();
        console.log('✓ Click ejecutado');
        return { success: true, message: `Click ejecutado en ${element.tagName}` };

      case 'type':
        console.log('Intentando escribir en elemento:', element.tagName);
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          element.focus();

          // Método mejorado para React/Vue/Angular: simular escritura real
          // Primero limpiar el campo
          element.value = '';
          element.dispatchEvent(new Event('input', { bubbles: true }));

          // Usar nativeInputValueSetter para frameworks reactivos
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
            'value'
          )?.set;

          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(element, action.value || '');
          } else {
            element.value = action.value || '';
          }

          // Disparar eventos en el orden correcto para máxima compatibilidad
          element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

          // También disparar eventos de teclado para frameworks que los escuchan
          const inputEvent = new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: action.value || ''
          });
          element.dispatchEvent(inputEvent);

          console.log('✓ Texto escrito:', action.value, '- Valor actual:', element.value);
          return { success: true, message: `Texto escrito: ${action.value}` };
        }
        // Intentar con contenteditable
        if ((element as HTMLElement).isContentEditable) {
          (element as HTMLElement).focus();
          (element as HTMLElement).innerText = action.value || '';
          element.dispatchEvent(new Event('input', { bubbles: true }));
          console.log('✓ Texto escrito en contenteditable');
          return { success: true, message: `Texto escrito en contenteditable: ${action.value}` };
        }
        console.log('✗ El elemento no es un campo de texto');
        return { success: false, message: `El elemento no es un campo de texto (es ${element.tagName})` };

      case 'scroll':
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        console.log('✓ Scroll ejecutado');
        return { success: true, message: 'Scroll ejecutado' };

      case 'focus':
        (element as HTMLElement).focus();
        console.log('✓ Focus aplicado');
        return { success: true, message: 'Focus aplicado' };

      case 'submit':
      case 'enter':
        // Presionar Enter en el elemento (para enviar formularios/búsquedas)
        (element as HTMLElement).focus();

        // Crear eventos de teclado más completos para máxima compatibilidad
        const enterKeydownEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        });
        element.dispatchEvent(enterKeydownEvent);

        const enterKeypressEvent = new KeyboardEvent('keypress', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        });
        element.dispatchEvent(enterKeypressEvent);

        const enterKeyupEvent = new KeyboardEvent('keyup', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        });
        element.dispatchEvent(enterKeyupEvent);

        // Si es un input dentro de un form, intentar múltiples métodos de submit
        if (element instanceof HTMLInputElement && element.form) {
          const form = element.form;

          // Método 1: Disparar evento submit
          const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
          const submitted = !form.dispatchEvent(submitEvent);

          // Método 2: Si el evento no fue cancelado, intentar submit nativo
          if (!submitted) {
            // Buscar botón de submit y hacer click
            const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]') as HTMLElement;
            if (submitBtn) {
              submitBtn.click();
              console.log('✓ Click en botón submit del formulario');
            } else {
              // Último recurso: llamar submit() directamente
              try {
                form.submit();
                console.log('✓ Form.submit() ejecutado');
              } catch (e) {
                console.log('Submit directo falló, pero Enter ya se envió');
              }
            }
          }
        }

        console.log('✓ Enter/Submit ejecutado');
        return { success: true, message: 'Enter presionado' };

      default:
        console.log('✗ Acción desconocida:', action.type);
        return { success: false, message: `Acción desconocida: ${action.type}` };
    }
  } catch (error) {
    console.error('✗ Error en executeAction:', error);
    return { success: false, message: `Error: ${error}` };
  }
}

// ============================================
// Text Selection Popup
// ============================================

let selectionPopup: HTMLDivElement | null = null;
let currentSelection = '';

function handleButtonClick(action: string) {
  console.log('Button clicked:', action, 'Current selection:', currentSelection);

  if (!currentSelection) {
    console.log('No selection to process');
    return;
  }

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

  console.log('Sending to Lia:', prompt.substring(0, 100) + '...');

  // Send to extension background
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

  // Create host element
  const host = document.createElement('div');
  host.id = 'lia-selection-popup-host';
  host.style.cssText = 'position: fixed; z-index: 2147483647; display: none;';

  // Create shadow root for isolation
  const shadow = host.attachShadow({ mode: 'closed' });

  // Add styles inside shadow DOM
  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .lia-popup {
      background: #1E2329;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 8px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      animation: liaFadeIn 0.15s ease-out;
    }

    @keyframes liaFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .lia-popup-content {
      display: flex;
      gap: 4px;
    }

    .lia-popup-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      background: transparent;
      border: none;
      border-radius: 8px;
      color: #e0e0e0;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
      font-family: inherit;
    }

    .lia-popup-btn:hover {
      background: #00d4b3;
      color: #0a2540;
    }

    .lia-popup-btn svg {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
    }
  `;
  shadow.appendChild(style);

  // Create popup container inside shadow
  const popup = document.createElement('div');
  popup.className = 'lia-popup';

  const content = document.createElement('div');
  content.className = 'lia-popup-content';

  // Button definitions
  const buttons = [
    { action: 'ask', label: 'Preguntar a Lia', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>' },
    { action: 'explain', label: 'Explicar', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>' },
    { action: 'summarize', label: 'Resumir', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="21" y1="18" x2="3" y2="18"></line></svg>' },
    { action: 'translate', label: 'Traducir', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>' }
  ];

  buttons.forEach(({ action, label, icon }) => {
    const btn = document.createElement('button');
    btn.className = 'lia-popup-btn';
    btn.innerHTML = icon + ' ' + label;

    // Use onclick property for maximum compatibility
    btn.onclick = function(e) {
      console.log('LIA SHADOW BUTTON CLICKED:', action);
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
  console.log('Lia selection popup created with Shadow DOM');
}

function showSelectionPopup(x: number, y: number) {
  if (!selectionPopup) createSelectionPopup();
  if (!selectionPopup) return;

  const popupWidth = 420;
  const popupHeight = 50;

  // Center horizontally relative to selection
  let left = x - popupWidth / 2;

  // Position above the selection (y is already viewport-relative from getBoundingClientRect)
  let top = y - popupHeight - 10;

  // Keep within horizontal viewport bounds
  if (left < 10) left = 10;
  if (left + popupWidth > window.innerWidth - 10) {
    left = window.innerWidth - popupWidth - 10;
  }

  // If popup would go above viewport, put it below the selection instead
  if (top < 10) {
    top = y + 25;
  }

  selectionPopup.style.left = `${left}px`;
  selectionPopup.style.top = `${top}px`;
  selectionPopup.style.display = 'block';
  console.log('Lia popup shown at:', left, top);
}

function hideSelectionPopup() {
  if (selectionPopup) {
    selectionPopup.style.display = 'none';
  }
}

// Listen for text selection
document.addEventListener('mouseup', (e) => {
  // Skip if clicking inside popup
  if (selectionPopup && selectionPopup.contains(e.target as Node)) {
    return;
  }

  // Small delay to let selection complete
  setTimeout(() => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (selectedText && selectedText.length > 3 && selectedText.length < 5000) {
      currentSelection = selectedText;
      console.log('Lia: Text selected, length:', selectedText.length);

      try {
        // Send selection immediately to background/popup
        safeSend({ type: 'TEXT_SELECTED', text: currentSelection });

        const range = selection?.getRangeAt(0);
        if (range) {
          const rect = range.getBoundingClientRect();
          // rect.top is already viewport-relative, which is what we need for position:fixed
          showSelectionPopup(
            rect.left + rect.width / 2,
            rect.top
          );
        }
      } catch (err) {
        console.log('Could not get selection range');
      }
    } else if (!selectionPopup?.contains(e.target as Node)) {
      hideSelectionPopup();
      currentSelection = '';
    }
  }, 50);
});

// Hide popup on click elsewhere (but not on buttons)
document.addEventListener('mousedown', (e) => {
  const target = e.target as HTMLElement;
  if (selectionPopup && !selectionPopup.contains(target)) {
    hideSelectionPopup();
  }
});

// Hide on scroll
document.addEventListener('scroll', () => {
  hideSelectionPopup();
}, true);

// ============================================
// Message Listener
// ============================================

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  console.log('Lia content script recibió mensaje:', request.action);

  switch (request.action) {
    case 'ping':
      // Respond to ping from background to check if script is loaded
      sendResponse({ pong: true });
      break;

    case 'getPageContent':
      sendResponse({ content: getPageContent() });
      break;

    case 'getStructuredDOM':
      sendResponse({ dom: getStructuredDOM() });
      break;

    case 'executeAction':
      console.log('Ejecutando acción:', request.actionData);
      const result = executeAction(request.actionData);
      console.log('Resultado de la acción:', result);
      sendResponse(result);
      break;

    case 'getSelectedText':
      sendResponse({ text: currentSelection });
      break;

    case 'getGeolocation':
      // Obtener geolocalización desde el contexto de la página web
      console.log('Lia: Solicitando geolocalización...');
      navigator.geolocation.getCurrentPosition(
        (position) => {
          console.log('✓ Geolocalización obtenida:', position.coords);
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
          console.error('✗ Error de geolocalización:', error);
          let errorMessage = 'Error desconocido';
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = 'Permisos de ubicación denegados por el usuario';
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = 'Ubicación no disponible';
              break;
            case error.TIMEOUT:
              errorMessage = 'Tiempo de espera agotado';
              break;
          }
          sendResponse({
            success: false,
            error: errorMessage,
            errorCode: error.code
          });
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 300000 // 5 minutos de cache
        }
      );
      break;

    // ============================================
    // GOOGLE MEET HANDLERS
    // ============================================

    case 'startMeetTranscription':
      console.log('SOFLIA: Starting Meet transcription...');
      startMeetTranscriptionFromMessage();
      sendResponse({ success: true });
      break;

    case 'stopMeetTranscription':
      console.log('SOFLIA: Stopping Meet transcription...');
      stopMeetTranscriptionFromMessage();
      sendResponse({ success: true });
      break;

    case 'getMeetingInfo':
      sendResponse(getMeetingInfo());
      break;

    default:
      console.log('Acción no reconocida:', request.action);
      sendResponse({ error: 'Acción no reconocida' });
  }

  return true;
});

// ============================================
// GOOGLE MEET AUTO-DETECTION & TRANSCRIPTION
// ============================================

// State
let meetCaptionObserver: MeetCaptionObserver | null = null;
let meetAutoDetectRunning = false;
let ccEnableRetryInterval: ReturnType<typeof setInterval> | null = null;
let participantUpdateInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start Meet transcription from message handler
 */
function startMeetTranscriptionFromMessage(): void {
  if (meetCaptionObserver) {
    console.log('SOFLIA Meet: Transcription already running');
    return;
  }
  startMeetTranscription();
}

/**
 * Stop Meet transcription from message handler
 */
function stopMeetTranscriptionFromMessage(): void {
  stopMeetTranscription();
}

/**
 * Start the Meet transcription system
 */
function startMeetTranscription(): void {
  console.log('SOFLIA Meet: Starting transcription...');

  // Notify background about meeting detection
  safeSend({
    type: 'MEETING_DETECTED',
    url: window.location.href,
    title: getMeetingInfo().title
  });

  // 1. Enable CC with retry
  enableCCWithRetry();

  // 2. Start caption observer
  meetCaptionObserver = new MeetCaptionObserver();
  meetCaptionObserver.start((entry: CaptionEntry) => {
    console.log('SOFLIA Meet Caption:', entry.speaker, '-', entry.text);

    safeSend({
      type: 'CAPTION_RECEIVED',
      speaker: entry.speaker,
      text: entry.text,
      timestamp: entry.timestamp
    });
  });

  // 3. Periodically update participants
  participantUpdateInterval = setInterval(() => {
    const participants = getParticipants();
    safeSend({
      type: 'PARTICIPANTS_UPDATED',
      participants
    });
  }, 5000);

  console.log('SOFLIA Meet: Transcription started');
}

/**
 * Stop the Meet transcription system
 */
function stopMeetTranscription(): void {
  console.log('SOFLIA Meet: Stopping transcription...');

  if (meetCaptionObserver) {
    meetCaptionObserver.stop();
    meetCaptionObserver = null;
  }

  if (ccEnableRetryInterval) {
    clearInterval(ccEnableRetryInterval);
    ccEnableRetryInterval = null;
  }

  if (participantUpdateInterval) {
    clearInterval(participantUpdateInterval);
    participantUpdateInterval = null;
  }

  safeSend({ type: 'MEETING_ENDED' });
  console.log('SOFLIA Meet: Transcription stopped');
}

/**
 * Enable CC with retry logic (limited retries)
 */
function enableCCWithRetry(): void {
  // First attempt
  const firstResult = enableClosedCaptions();
  if (firstResult) {
    console.log('SOFLIA Meet: CC enabled on first attempt');
    // Still set up a few retries to hide the container
    setupCaptionHiding();
    return;
  }

  // Retry a few times only (max 5 attempts, every 5 seconds)
  let attempts = 0;
  ccEnableRetryInterval = setInterval(() => {
    attempts++;

    // Stop after 5 attempts
    if (attempts > 5) {
      console.log('SOFLIA Meet: Stopping CC enable retries');
      if (ccEnableRetryInterval) {
        clearInterval(ccEnableRetryInterval);
        ccEnableRetryInterval = null;
      }
      return;
    }

    // Stop if captions are already detected
    if (meetCaptionObserver?.isCaptionsDetected()) {
      console.log('SOFLIA Meet: Captions detected, stopping retries');
      if (ccEnableRetryInterval) {
        clearInterval(ccEnableRetryInterval);
        ccEnableRetryInterval = null;
      }
      return;
    }

    // Try to enable
    const enabled = enableClosedCaptions();
    if (enabled) {
      console.log('SOFLIA Meet: CC enabled, stopping retries');
      if (ccEnableRetryInterval) {
        clearInterval(ccEnableRetryInterval);
        ccEnableRetryInterval = null;
      }
      setupCaptionHiding();
    }
  }, 5000); // 5 seconds between attempts
}

/**
 * Set up caption hiding (separate from enabling)
 */
function setupCaptionHiding(): void {
  // Try to hide captions a few times
  let hideAttempts = 0;
  const hideInterval = setInterval(() => {
    hideAttempts++;

    if (hideAttempts > 10) {
      clearInterval(hideInterval);
      return;
    }

    const container = findCaptionContainer();
    if (container) {
      hideCaptionsVisually(container);
      clearInterval(hideInterval);
      console.log('SOFLIA Meet: Caption container hidden');
    }
  }, 2000);
}


/**
 * Auto-detect Google Meet and start transcription
 * Runs automatically when content script loads on meet.google.com
 */
function autoDetectGoogleMeet(): void {
  if (!isGoogleMeetUrl()) return;

  // Prevent concurrent detection loops, but allow if transcription already exists
  if (meetAutoDetectRunning) return;
  if (meetCaptionObserver) return; // Already transcribing

  meetAutoDetectRunning = true;
  console.log('SOFLIA Meet: Auto-detecting meeting...');

  // Wait for meeting to become active
  let checkCount = 0;
  const checkInterval = setInterval(() => {
    checkCount++;

    if (isMeetingActive()) {
      clearInterval(checkInterval);
      meetAutoDetectRunning = false;
      console.log('SOFLIA Meet: Meeting is active, starting transcription');

      // Small delay to let UI settle
      setTimeout(() => {
        startMeetTranscription();
      }, 2000);
    }

    // Stop checking after 90 seconds
    if (checkCount > 45) {
      clearInterval(checkInterval);
      meetAutoDetectRunning = false;
      console.log('SOFLIA Meet: Timeout waiting for meeting');
    }
  }, 2000);
}

/**
 * Handle navigation away from meeting
 */
function handleMeetNavigation(): void {
  if (!isGoogleMeetUrl()) {
    if (meetCaptionObserver) {
      console.log('SOFLIA Meet: Navigated away from meeting');
      stopMeetTranscription();
    }
    meetAutoDetectRunning = false;
  }
}

// ============================================
// AUTO-DETECT GOOGLE MEET ON LOAD
// ============================================

// Use a version-stamped guard so reloaded content scripts always run
const SOFLIA_VERSION = Date.now().toString();
(window as any).__SOFLIA_MEET_VERSION__ = SOFLIA_VERSION;

// Try immediately
autoDetectGoogleMeet();

// Also try on load event
if (document.readyState !== 'complete') {
  window.addEventListener('load', () => {
    // Only run if this is still the active version
    if ((window as any).__SOFLIA_MEET_VERSION__ === SOFLIA_VERSION) {
      setTimeout(autoDetectGoogleMeet, 1500);
    }
  });
}

// Watch for SPA navigations (Google Meet is a SPA)
// Only patch pushState once
if (!(window as any).__SOFLIA_PUSHSTATE_PATCHED__) {
  (window as any).__SOFLIA_PUSHSTATE_PATCHED__ = true;

  const origPushState = history.pushState;
  history.pushState = function(data: any, title: string, url?: string | URL | null) {
    origPushState.call(this, data, title, url);
    setTimeout(() => {
      autoDetectGoogleMeet();
      handleMeetNavigation();
    }, 1000);
  };

  window.addEventListener('popstate', () => {
    setTimeout(() => {
      autoDetectGoogleMeet();
      handleMeetNavigation();
    }, 1000);
  });
}

console.log('SOFLIA Meet: Auto-detection initialized');
