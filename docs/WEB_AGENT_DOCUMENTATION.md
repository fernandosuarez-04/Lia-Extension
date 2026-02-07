# Web Agent (Lia Agent) — Documentacion Tecnica Exhaustiva

> Fecha de implementacion: 6 de febrero de 2026
> Autor: Desarrollo asistido por Claude Code (Opus 4.6)
> Estado: Funcional con iteraciones en curso

---

## Tabla de Contenidos

1. [Vision General](#1-vision-general)
2. [Arquitectura](#2-arquitectura)
3. [Archivos del Sistema](#3-archivos-del-sistema)
4. [Flujo de Ejecucion Completo](#4-flujo-de-ejecucion-completo)
5. [Content Script — Accessibility Tree](#5-content-script--accessibility-tree)
6. [Agent Loop — web-agent.ts](#6-agent-loop--web-agentts)
7. [System Prompt — computer-use.ts](#7-system-prompt--computer-usets)
8. [Tool Declarations (14 herramientas)](#8-tool-declarations-14-herramientas)
9. [Navegacion Cross-Page](#9-navegacion-cross-page)
10. [Reutilizacion de Pestanas](#10-reutilizacion-de-pestanas)
11. [Proteccion contra URLs No-Inyectables](#11-proteccion-contra-urls-no-inyectables)
12. [Manejo de AJAX y SPAs](#12-manejo-de-ajax-y-spas)
13. [Integracion UI (App.tsx)](#13-integracion-ui-apptsx)
14. [Auto-deteccion de Intenciones](#14-auto-deteccion-de-intenciones)
15. [Screenshot Capture](#15-screenshot-capture)
16. [Protocolo de Conversacion con Gemini](#16-protocolo-de-conversacion-con-gemini)
17. [Bugs Encontrados y Solucionados](#17-bugs-encontrados-y-solucionados)
18. [Lecciones Aprendidas y Anti-patrones](#18-lecciones-aprendidas-y-anti-patrones)
19. [Configuracion del Modelo](#19-configuracion-del-modelo)
20. [Limitaciones Conocidas](#20-limitaciones-conocidas)
21. [Proximos Pasos](#21-proximos-pasos)

---

## 1. Vision General

### Que es el Web Agent

El Web Agent (internamente "Lia Agent") es un sistema de control autonomo del navegador integrado en la extension de Chrome Lia/Soflia. Permite al usuario dar instrucciones en lenguaje natural (ej: "busca en mis correos que mando Ernesto y hazme un resumen") y el agente:

1. **Observa** la pagina actual (accessibility tree + screenshot)
2. **Decide** que accion tomar (via Gemini con function calling)
3. **Ejecuta** la accion en el navegador
4. **Verifica** el resultado y repite

### Inspiracion

El diseno se inspira en cuatro sistemas de referencia:

| Sistema | Empresa | Enfoque |
|---------|---------|---------|
| CUA (Computer Use Agent) | Anthropic | Screenshots + coordenadas |
| Operator | OpenAI | Navegador dedicado |
| Browser-Use | Open Source | Accessibility tree + acciones DOM |
| Project Mariner | Google DeepMind | Chromium con vision |

### Enfoque Hibrido Adoptado

Se combina lo mejor de cada uno:

- **Accessibility Tree** (como Browser-Use): Texto estructurado con ref IDs para interaccion precisa
- **Screenshots** (como CUA/Mariner): Vision para verificacion y contexto visual
- **Function Calling Nativo** (como Mariner): Gemini ejecuta tool calls, no texto parseado
- **Observe-Act-Verify Loop** (patron comun en todos): Ciclo continuo hasta completar la tarea

---

## 2. Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                        POPUP (App.tsx)                       │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────────┐  │
│  │ User     │  │ isWebAgent│  │ Message Display          │  │
│  │ Input    │──│ Mode      │──│ (onMessage, onAction,    │  │
│  │          │  │ Toggle    │  │  onComplete, onError)    │  │
│  └──────────┘  └───────────┘  └──────────────────────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │ runWebAgent(userRequest, callbacks)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   WEB AGENT (web-agent.ts)                   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   AGENT LOOP                          │   │
│  │                                                      │   │
│  │  for (step = 0; step < 50; step++) {                 │   │
│  │    1. OBSERVE:  getPageState(tabId)─────────────┐    │   │
│  │    2. BUILD:    buildObservationParts()          │    │   │
│  │    3. THINK:    chat.sendMessage(parts) ──► Gemini   │   │
│  │    4. PARSE:    Extract functionCalls from response   │   │
│  │    5. ACT:      executeToolCall(tabId, fc)──────┐    │   │
│  │    6. VERIFY:   Add functionResponse to history │    │   │
│  │  }                                              │    │   │
│  └────────────────────────────────────────────────┘    │   │
└──────────────┬──────────────────────────┬──────────────────┘
               │                          │
    ┌──────────▼──────────┐    ┌──────────▼──────────┐
    │  CONTENT SCRIPT     │    │  BACKGROUND          │
    │  (content/index.ts) │    │  (background/index.ts)│
    │                     │    │                      │
    │  • getAccessibility │    │  • CAPTURE_SCREENSHOT│
    │    Tree()           │    │    (captureVisibleTab)│
    │  • executeByRef()   │    │                      │
    │  • scrollPage()     │    │                      │
    └─────────────────────┘    └──────────────────────┘
```

### Comunicacion entre componentes

| Origen | Destino | Metodo | Mensajes |
|--------|---------|--------|----------|
| Popup → Web Agent | Direct import | `runWebAgent()` function call |
| Web Agent → Content Script | `chrome.tabs.sendMessage` | `getAccessibilityTree`, `webAgentAction` |
| Web Agent → Background | `chrome.runtime.sendMessage` | `CAPTURE_SCREENSHOT` |
| Content Script → Background | `chrome.runtime.sendMessage` | `ping` response |

---

## 3. Archivos del Sistema

### Archivos Principales

| Archivo | Lineas | Responsabilidad |
|---------|--------|-----------------|
| `src/services/web-agent.ts` | ~727 | Loop principal del agente, ejecucion de acciones, navegacion |
| `src/prompts/computer-use.ts` | ~467 | System prompt, tool declarations, auto-deteccion |
| `src/content/index.ts` | ~677 | Accessibility tree, acciones DOM, ref system |
| `src/background/index.ts` | (parcial) | Handler de screenshot |
| `src/popup/App.tsx` | (parcial) | UI toggle, callbacks, auto-deteccion |
| `src/config.ts` | ~37 | Modelo configurado: `gemini-2.5-flash` |
| `src/prompts/index.ts` | ~96 | Barrel file de exportaciones |

### Dependencias

```typescript
// web-agent.ts imports
import { GoogleGenerativeAI } from '@google/generative-ai';
import { MODELS } from '../config';
import { WEB_AGENT_SYSTEM_PROMPT, WEB_AGENT_TOOLS } from '../prompts/computer-use';
import { getApiKeyWithCache } from './api-keys';
import { GOOGLE_API_KEY } from '../config';
```

---

## 4. Flujo de Ejecucion Completo

### Paso a paso detallado

```
1. USUARIO escribe mensaje en el popup
   └─► "busca en mis correos que mando Ernesto"

2. APP.TSX detecta intencion web
   ├─► isWebAgentMode === true (manual) O
   └─► needsWebAgent(message) === true (auto-deteccion)
       └─► Regex match: "busca" + "en" + "correos"

3. APP.TSX importa y ejecuta runWebAgent()
   └─► runWebAgent("busca en mis correos...", callbacks, 50)

4. WEB-AGENT.TS inicializa
   ├─► Obtiene API key (getApiKeyWithCache o GOOGLE_API_KEY)
   ├─► Encuentra tab activa (getActiveTab)
   │   └─► Filtra tabs inyectables (isInjectableUrl)
   ├─► Inyecta content script (ensureContentScript)
   │   ├─► pingContentScript() → pong?
   │   └─► Si no: chrome.scripting.executeScript()
   └─► Inicializa Gemini model con system prompt + tools

5. LOOP (hasta 50 pasos):

   5a. OBSERVE — getPageState(tabId, useScreenshot)
       ├─► Verifica URL inyectable
       ├─► ensureContentScript (re-inyecta si murio tras navegacion)
       ├─► chrome.tabs.sendMessage → getAccessibilityTree
       │   └─► Content script: assignRefsAndGetTree()
       │       ├─► Limpia refs anteriores
       │       ├─► getInteractiveElements() con filtros
       │       ├─► Agrega document.activeElement si falta
       │       ├─► Cap a 150 elementos
       │       └─► Genera tree con role + HTML tag + ref + name + state
       └─► captureScreenshot() (via background)
           └─► chrome.tabs.captureVisibleTab(JPEG, 80%)

   5b. BUILD — buildObservationParts(pageState, userRequest)
       ├─► Texto: title + URL + accessibility tree
       ├─► Imagen: screenshot base64 como inlineData
       └─► Si step === 0: prefija USER REQUEST

   5c. THINK — Envio a Gemini
       ├─► model.startChat({ history })
       ├─► chat.sendMessage(parts)
       └─► Parsea response: texto + functionCalls[]

   5d. PARSE
       ├─► Agrega user parts a history
       ├─► Agrega model response a history
       ├─► Extrae responseText (mostrado al usuario)
       └─► Extrae functionCalls[] (acciones a ejecutar)

   5e. ACT — executeToolCall(tabId, functionCall)
       ├─► Identifica accion por name
       ├─► Ejecuta via chrome.tabs.sendMessage → content script
       ├─► Maneja TAB_SWITCH: prefix para actualizar tabId
       └─► Espera settle time (300ms-2500ms segun accion)

   5f. VERIFY
       ├─► Agrega functionResponse a history (role: 'function')
       ├─► Verifica consecutiveErrors < 3
       └─► Vuelve a paso 5a (nueva observacion)

6. TERMINAL
   ├─► task_complete → callbacks.onComplete(summary)
   ├─► task_failed → callbacks.onError(reason)
   ├─► maxSteps alcanzado → "tarea puede estar incompleta"
   └─► 3 errores consecutivos → "demasiados errores"
```

---

## 5. Content Script — Accessibility Tree

### Selectores Interactivos

```typescript
const INTERACTIVE_SELECTORS = [
  'a[href]', 'button', 'input', 'select', 'textarea',
  '[contenteditable="true"]', '[contenteditable=""]',
  '[role="textbox"]', '[role="button"]', '[role="link"]',
  '[role="tab"]', '[role="menuitem"]', '[role="option"]',
  '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
  '[role="combobox"]', '[role="searchbox"]',
];
```

### Filtros de Visibilidad

```typescript
// Para form fields: minimo 1px (Gmail search puede ser estrecho)
// Para otros elementos: minimo 5px
const minSize = isFormField ? 1 : 5;
if (rect.width < minSize || rect.height < minSize) continue;

// Viewport extendido: 500px arriba/abajo
if (rect.bottom < -500 || rect.top > window.innerHeight + 500) continue;

// CSS visibility
if (style.display === 'none' || style.visibility === 'hidden') continue;
if (parseFloat(style.opacity) < 0.1) continue;

// Elementos sin nombre requieren ser form/button/link
if (!isFormField && !isButton && !isLink) {
  if (!getAccessibleName(el)) continue;
}
```

### Focused Element Capture

```typescript
// SIEMPRE incluye document.activeElement — critico para Gmail search
const focused = document.activeElement;
if (focused && focused !== document.body && !seen.has(focused)) {
  const rect = focused.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) {
    result.push(focused);
  }
}
```

### Element Cap

```typescript
const MAX_ELEMENTS = 150;
const elements = allElements.length > MAX_ELEMENTS
  ? allElements.slice(0, MAX_ELEMENTS)
  : allElements;
```

Razon: Paginas complejas como Google Meet pueden tener 300+ elementos interactivos. Enviar todos a Gemini satura el contexto y degrada la calidad de las decisiones.

### Formato del Tree Output

```
page [title="Gmail - Bandeja de entrada"] [url="https://mail.google.com/mail/u/0/#inbox"]
  - button <button> [ref=e0] "Menu principal"
  - link <a> [ref=e1] "Gmail"
  - textbox <input type="text"> [ref=e2] "Buscar en el correo" [focused]
  - button <button> [ref=e3] "Buscar"
  - link <a> [ref=e4] "Recibidos" [value="556"]
  ...
```

Cada linea incluye:
- **role**: Rol ARIA implicito o explicito
- **HTML tag + type**: `<button>`, `<input type="text">`, `<a>`, etc.
- **ref ID**: Identificador unico para interaccion (`e0`, `e1`, ...)
- **name**: Texto accesible (aria-label, placeholder, textContent)
- **state**: Flags como `focused`, `checked`, `disabled`, `expanded`, `value="..."`

### Acciones DOM Disponibles

| Accion | Descripcion | Compatibilidad |
|--------|-------------|----------------|
| `click` | Multi-estrategia: `.click()` + `PointerEvent` + `MouseEvent` | React, Vue, Angular, vanilla |
| `type` | Native setter + `input`/`change`/`InputEvent` dispatch | React/framework-compat via `Object.getOwnPropertyDescriptor` |
| `clear` | Misma tecnica que type pero con valor vacio | React/framework-compat |
| `scroll` | `scrollIntoView({ behavior: 'smooth', block: 'center' })` | Universal |
| `scroll_page` | `window.scrollBy` 70% viewport + reporte de posicion | Universal |
| `select` | Match por value exacto, text exacto, o text parcial | Native `<select>` |
| `hover` | `mouseenter` + `mouseover` + `mousemove` en centro del rect | Tooltips, dropdowns |
| `press_key` | `keydown`/`keypress`/`keyup` + form submit en Enter | Con keyCode legacy |

### Scroll con Reporte de Posicion

```typescript
function scrollPage(direction: string): ActionResult {
  const amount = direction === 'up'
    ? -Math.round(window.innerHeight * 0.7)
    : Math.round(window.innerHeight * 0.7);
  window.scrollBy({ top: amount, behavior: 'smooth' });

  const percentScrolled = Math.round((afterY / Math.max(maxY, 1)) * 100);

  if (atEnd) return { message: 'Already at the bottom. No more content below.' };
  if (atTop) return { message: 'Already at the top.' };
  return { message: `Scrolled ${direction}. Position: ${percentScrolled}% of page.` };
}
```

El agente sabe exactamente en que porcentaje de la pagina esta y cuando llego al final.

---

## 6. Agent Loop — web-agent.ts

### Funciones Helper

#### `isInjectableUrl(url)`
Previene inyeccion en paginas protegidas:
```
chrome://     → false
chrome-extension:// → false
about:        → false
chrome-search:// → false
devtools://   → false
data:         → false
view-source:  → false
Cualquier otra → true
```

#### `getTabUrl(tabId)`
Wrapper seguro de `chrome.tabs.get()` que retorna `undefined` en error.

#### `pingContentScript(tabId)`
Envia `{ action: 'ping' }` y espera `{ pong: true }`.

#### `ensureContentScript(tabId)`
1. Verifica URL inyectable
2. Intenta ping
3. Si falla: `chrome.scripting.executeScript()` con `assets/content.js`
4. Espera 500ms
5. Re-intenta ping

#### `waitForPageLoad(tabId, timeoutMs=10000)`
- Usa `chrome.tabs.onUpdated` listener (NO `setTimeout` fijo)
- Resuelve cuando `changeInfo.status === 'complete'`
- Safety timeout de 10 segundos
- Extra settle time de 800ms para SPAs
- Verifica si tab ya esta `complete` (pagina cacheada)

#### `findExistingTab(targetUrl, currentTabId)`
Busqueda de pestana existente en 3 niveles:
1. **URL exacta** (normalizada, sin trailing slash/hash)
2. **Mismo origin + path coincidente** (ej: gmail inbox variaciones)
3. **Solo origin** (ej: usuario pide "gmail.com", tab tiene "mail.google.com/...")

#### `getPageState(tabId, includeScreenshot)`
Resiliente a fallos — retorna error PageState en vez de throw:
```typescript
// Si URL no inyectable:
tree: 'ERROR: Current tab is on "chrome://..." which is a browser internal page.'

// Si content script no responde:
tree: 'ERROR: Could not connect to the page. Try wait_and_observe.'

// Si pierde conexion:
tree: 'ERROR: Lost connection to page. Try wait_and_observe.'
```

#### `shouldTakeScreenshot(lastAction, step)`
Screenshot en step 0 y despues de acciones visuales:
`click_element`, `scroll_page`, `wait_and_observe`, `navigate`, `go_back`, `hover_element`, `select_option`, `open_new_tab`, `switch_tab`

NO screenshot despues de: `type_text`, `press_key` (solo texto/teclado).

### Wait Times Post-Accion

| Accion | Wait (ms) | Razon |
|--------|-----------|-------|
| `click_element` | 1500 | Menus, modales, navegacion SPA |
| `navigate` | 500 | `waitForPageLoad` ya espero |
| `go_back` | 500 | `waitForPageLoad` ya espero |
| `open_new_tab` | 500 | `waitForPageLoad` ya espero |
| `switch_tab` | 500 | Tab ya cargada |
| `type_text` | 500 | Autocomplete puede aparecer |
| `scroll_page` | 800 | Smooth scroll + lazy loading |
| `select_option` | 500 | Cambio de estado |
| `press_key Enter` | 2500 | **AJAX search/form submissions** |
| `press_key (otros)` | 500 | Navegacion con flechas, etc. |
| Otros | 300 | Default minimo |

### Tab Switching Protocol

Cuando una accion causa cambio de pestana, el resultado incluye prefijo `TAB_SWITCH:`:

```
TAB_SWITCH:1673396089:Found existing tab "Gmail" — switched to it
```

El loop parsea este prefijo y actualiza `tabId`:
```typescript
if (actionResult.startsWith('TAB_SWITCH:')) {
  const parts = actionResult.split(':');
  const newTabId = parseInt(parts[1], 10);
  if (!isNaN(newTabId)) tabId = newTabId;
  actionResult = parts.slice(2).join(':');
}
```

### Error Handling

- `consecutiveErrors` counter, reset a 0 en cada accion exitosa
- A 3 errores consecutivos: detiene el agente
- Exponential backoff entre errores: `min(1000 * 2^n, 8000)` ms
- Errores individuales de step NO detienen el loop (solo incrementan counter)

---

## 7. System Prompt — computer-use.ts

### Estructura del Prompt

El system prompt (`WEB_AGENT_SYSTEM_PROMPT`) tiene ~190 lineas organizadas en secciones:

1. **Identidad**: "Eres Lia Agent, un agente autonomo..."
2. **Informacion que recibe**: Accessibility tree + screenshot
3. **Reglas criticas**: Una accion por turno, verificacion visual, ref IDs correctos
4. **Se exhaustivo**: Reglas obligatorias para analisis profundo
   - Entra a cada elemento individualmente
   - Procesa TODOS los elementos (scroll completo)
   - Operaciones en masa uno por uno
   - Scroll completo antes de concluir
5. **Completa tareas enteras**: Ejemplos detallados (Amazon, Gmail, carpetas)
6. **Navegacion entre paginas**: 5 herramientas de navegacion
7. **Paginas dinamicas (AJAX/SPAs)**: Reglas post-Enter, wait_and_observe
8. **Manejo de errores**: Alternativas cuando algo falla
9. **Deteccion de elementos**: Como leer el tree (HTML tags)
10. **Alternativas por URL**: Gmail, Google, YouTube search URLs directas
11. **No te quedes atascado**: Regla de 3 intentos maximos
12. **Uso correcto de task_failed**: 5 puntos de verificacion obligatorios
13. **Patrones comunes**: Quick-reference de 9 patrones
14. **Formato de respuesta**: Texto breve + progreso

### Reglas Criticas para el Comportamiento del Agente

#### Exhaustividad
```
OBLIGATORIO: Entra a cada elemento individualmente
- NO leas solo titulos/previews de una lista
- SI haz click en CADA elemento para ver contenido completo
- Despues de leer cada uno, usa go_back para volver
```

#### AJAX Wait
```
REGLA OBLIGATORIA: Despues de press_key Enter
1. SIEMPRE llama wait_and_observe con al menos 2000ms
2. Si el tree parece vacio, espera de nuevo
3. NUNCA concluyas "no hay resultados" sin haber esperado al menos 2 veces
```

#### task_failed Guardrails
```
Antes de llamar task_failed, verifica TODOS estos puntos:
1. Esperaste lo suficiente? (wait_and_observe x2)
2. La pagina todavia esta cargando?
3. Probaste una ruta alternativa?
4. Hiciste scroll?
5. Verificaste visualmente el screenshot?
```

#### Anti-bucle
```
Si llevas mas de 3 intentos haciendo lo mismo:
1. PARA
2. Prueba alternativa diferente (URL directa, otro boton, tecla atajo)
3. Si nada funciona, describe que ves en el screenshot
```

---

## 8. Tool Declarations (14 herramientas)

### Herramientas de Interaccion (6)

| Herramienta | Params Requeridos | Descripcion |
|-------------|-------------------|-------------|
| `click_element` | `element_ref` | Click multi-estrategia |
| `type_text` | `element_ref`, `text` | Escribe en input/textarea/contenteditable |
| `press_key` | `key` | Tecla: Enter, Tab, Escape, Backspace, Arrow*, Space |
| `scroll_page` | `direction` | Scroll up/down (70% viewport) |
| `select_option` | `element_ref`, `value` | Seleccion en `<select>` |
| `hover_element` | `element_ref` | Hover para tooltips/menus |

### Herramientas de Navegacion (5)

| Herramienta | Params Requeridos | Descripcion |
|-------------|-------------------|-------------|
| `navigate` | `url` | Redirige tab actual (con tab reuse) |
| `go_back` | (ninguno) | Boton atras del navegador |
| `open_new_tab` | `url` | Nueva pestana (con tab reuse) |
| `switch_tab` | `tab_index` | Cambia a pestana por indice |
| `list_tabs` | (ninguno) | Lista pestanas abiertas |

### Herramientas de Control (3)

| Herramienta | Params Requeridos | Descripcion |
|-------------|-------------------|-------------|
| `wait_and_observe` | (ninguno) | Espera N ms y re-observa |
| `task_complete` | `summary` | Tarea completada exitosamente |
| `task_failed` | `reason` | Tarea imposible de completar |

### Formato de Declaracion (Gemini Function Calling)

```typescript
export const WEB_AGENT_TOOLS = [{
  functionDeclarations: [
    {
      name: "click_element",
      description: "Click on an interactive element...",
      parameters: {
        type: "OBJECT",
        properties: {
          element_ref: { type: "STRING", description: "..." },
          description: { type: "STRING", description: "..." }
        },
        required: ["element_ref"]
      }
    },
    // ... 13 mas
  ]
}];
```

---

## 9. Navegacion Cross-Page

### Problema
Cuando el agente navega a otra pagina (`navigate`, `go_back`, `open_new_tab`), Chrome destruye el content script de la pagina anterior. El nuevo contenido no tiene content script inyectado.

### Solucion

1. **Pre-flight check**: `ensureContentScript(tabId)` se llama en `getPageState()` ANTES de cada request al accessibility tree
2. **Deteccion por ping**: Si el content script no responde al ping, se re-inyecta
3. **waitForPageLoad**: Espera `chrome.tabs.onUpdated` con status `complete` + 800ms settle
4. **Tab ID mutable**: `let tabId` se actualiza via prefijo `TAB_SWITCH:` cuando cambia de pestana

### Flujo de navegacion

```
navigate("https://mail.google.com")
  ├─► findExistingTab() → existe? → switch a esa tab
  └─► No existe:
      ├─► chrome.tabs.update(tabId, { url })
      ├─► waitForPageLoad(tabId, 10000)
      │   ├─► chrome.tabs.onUpdated listener
      │   ├─► Safety timeout 10s
      │   └─► Settle time 800ms
      └─► return "Navigated to ..."

(siguiente iteracion del loop)
  └─► getPageState(tabId)
      ├─► getTabUrl() → URL inyectable?
      ├─► ensureContentScript(tabId)
      │   ├─► ping → falla (script muerto)
      │   ├─► chrome.scripting.executeScript()
      │   ├─► wait 500ms
      │   └─► ping → exito
      └─► chrome.tabs.sendMessage → getAccessibilityTree
```

---

## 10. Reutilizacion de Pestanas

### Problema
El agente abria pestanas duplicadas cuando el usuario ya tenia el sitio abierto.

### Solucion: `findExistingTab()`

Busqueda en 3 niveles de precision:

```typescript
// Nivel 1: URL exacta (normalizada)
normalize("https://mail.google.com/mail/u/0/#inbox")
  === normalize("https://mail.google.com/mail/u/0/#inbox/")

// Nivel 2: Mismo origin + path compatible
origin: "https://mail.google.com"
path: "/mail/u/0/" — si la tab tiene path que empieza asi, match

// Nivel 3: Solo origin
"https://mail.google.com" — cualquier path
```

### Integracion

`findExistingTab()` se invoca en 2 herramientas:
- **`navigate`**: Si encuentra tab existente, switch en vez de navegar
- **`open_new_tab`**: Si encuentra tab existente, switch en vez de abrir nueva

Ambas retornan `TAB_SWITCH:{tabId}:mensaje` para actualizar el ID activo.

---

## 11. Proteccion contra URLs No-Inyectables

### Problema
Chrome prohibe inyectar content scripts en paginas internas (`chrome://`, `about:blank`, etc.). Intentarlo causa errores fatales: "Could not establish connection" / "Cannot access a chrome:// URL".

### Solucion: `isInjectableUrl()`

```typescript
function isInjectableUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('chrome://')) return false;
  if (url.startsWith('chrome-extension://')) return false;
  if (url.startsWith('about:')) return false;
  if (url.startsWith('chrome-search://')) return false;
  if (url.startsWith('devtools://')) return false;
  if (url === 'about:blank') return false;
  if (url.startsWith('data:')) return false;
  if (url.startsWith('view-source:')) return false;
  return true;
}
```

### Puntos de verificacion

1. **`ensureContentScript()`**: Verifica URL antes de intentar inyectar
2. **`getPageState()`**: Retorna error descriptivo si URL no inyectable
3. **`getActiveTab()`**: Prefiere tabs con URL inyectable, pero acepta cualquiera como fallback
4. **Inicio del agente**: No falla si la tab actual es `chrome://` — el agente puede usar `navigate` para ir a una web real

---

## 12. Manejo de AJAX y SPAs

### Problema
Gmail, YouTube, Amazon y la mayoria de sitios modernos cargan contenido via AJAX. Despues de enviar un formulario o hacer una busqueda con Enter, los resultados no aparecen inmediatamente. El agente capturaba el accessibility tree antes de que los resultados cargaran y concluia falsamente que "no hay resultados".

### Solucion: Dos niveles

#### Nivel 1: Wait time post-accion (web-agent.ts)
```typescript
// press_key Enter ahora espera 2500ms (antes 300ms)
const isEnterKey = name === 'press_key' &&
  (fc.args?.key === 'Enter' || fc.args?.key === 'enter');
const waitTime = isEnterKey ? 2500 : name === 'press_key' ? 500 : 300;
```

#### Nivel 2: Instrucciones en system prompt (computer-use.ts)
```
REGLA OBLIGATORIA: Despues de press_key Enter
1. SIEMPRE llama wait_and_observe con al menos 2000ms
2. Si el tree parece vacio, espera de nuevo
3. NUNCA concluyas "no hay resultados" sin esperar al menos 2 veces
```

Ademas, se proporcionan **URLs directas** como alternativa:
```
Gmail: https://mail.google.com/mail/u/0/#search/from:nombre
Google: https://www.google.com/search?q=query
YouTube: https://www.youtube.com/results?search_query=query
```

---

## 13. Integracion UI (App.tsx)

### Estado

```typescript
const [isWebAgentMode, setIsWebAgentMode] = useState(false);
```

### Activacion

Dos modos:
1. **Manual**: Boton "Agente Web" en el menu plus
2. **Auto-deteccion**: `needsWebAgent(message)` detecta intencion del usuario

```typescript
const { needsWebAgent } = await import('../prompts');
const shouldUseWebAgent = isWebAgentMode || needsWebAgent(apiMessage);
```

### Callbacks

```typescript
await runWebAgent(apiMessage, {
  onMessage: (text) => { /* Agrega texto al mensaje del agente */ },
  onActionStart: (description) => { /* Muestra accion en italicas */ },
  onComplete: (summary) => { /* Muestra resumen final */ },
  onError: (error) => { /* Muestra error */ }
});
```

### UI Components

- **Header badge**: Icono de monitor + "Web Agent" cuando activo
- **Plus menu button**: Toggle con icono, descripcion "Controla el navegador"
- **Checkmark**: Indicador visual cuando modo activo

---

## 14. Auto-deteccion de Intenciones

### Funcion: `needsWebAgent(message)`

```typescript
export function needsWebAgent(message: string): boolean {
  if (lower.length < 8) return false;  // Muy corto

  // Excluir preguntas de conocimiento
  if (/^(que|como|por que|cual|quien|cuando|donde|what|how|why)
       \s+(es|son|fue|era|is|are|was|were)\b/i.test(lower)) {
    return false;
  }

  return WEB_AGENT_PATTERNS.some(pattern => pattern.test(message));
}
```

### Patrones (25 regex)

Organizados por categoria:

**Navegacion (ES)**: llévame, ve a, abre, navega, entra + pagina/sitio/web/gmail/youtube...
**Acciones (ES)**: haz click, clickea, pulsa, presiona, toca
**Texto (ES)**: escribe, rellena, llena, completa + campo/formulario/input
**Busqueda (ES)**: busca, búscame + en/amazon/google/youtube
**Seleccion (ES)**: selecciona, elige, marca, desmarca
**Scroll (ES)**: scroll, desplaza, baja, sube + pagina/abajo/arriba
**Envio (ES)**: envía, enviar, mandar + correo/email/mensaje
**Descarga (ES)**: descarga, descargar, download
**Cierre (ES)**: cierra, cerrar + pestana/tab/ventana
**Retroceso (ES)**: regresa, vuelve, retrocede, atras

**Navegacion (EN)**: go to, navigate to, open, take me, visit
**Click (EN)**: click, tap, press, hit + on/the/button/link
**Texto (EN)**: type, write, enter, fill + in/into/the/field
**Busqueda (EN)**: search, find, look for + on/in/amazon/google
**Scroll (EN)**: scroll, swipe + up/down/left/right
**Otros (EN)**: submit/send, select/choose, go back/forward

**URL directa**: `https?://\S+`
**Invocacion explicita**: "agente web", "web agent", "usa el navegador"

---

## 15. Screenshot Capture

### Background Handler

```typescript
// background/index.ts
if (message.type === 'CAPTURE_SCREENSHOT') {
  const windowId = sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
  chrome.tabs.captureVisibleTab(windowId, {
    format: 'jpeg',
    quality: 80
  }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      sendResponse({ screenshot: null });
    } else {
      sendResponse({ screenshot: dataUrl });
    }
  });
  return true; // async response
}
```

### Caracteristicas
- Formato: JPEG 80% calidad (balance entre tamano y claridad)
- Captura la pestana visible completa
- Manejo de errores graceful (retorna null, no throw)
- Usado selectivamente (no en cada paso) via `shouldTakeScreenshot()`

---

## 16. Protocolo de Conversacion con Gemini

### Formato del History

```typescript
history: [
  // Turno 1: Observacion del usuario
  { role: 'user', parts: [
    { text: "USER REQUEST: ...\n\nCurrent page: ...\n\n=== ACCESSIBILITY TREE ===" },
    { inlineData: { mimeType: 'image/jpeg', data: '...' } }
  ]},

  // Turno 1: Respuesta del modelo con function call
  { role: 'model', parts: [
    { text: "Voy a hacer click en el boton de busqueda." },
    { functionCall: { name: 'click_element', args: { element_ref: 'e2' } } }
  ]},

  // Turno 1: Resultado de la funcion
  { role: 'function', parts: [
    { functionResponse: {
      name: 'click_element',
      response: { result: 'Clicked "Buscar" (e2)' }
    }}
  ]},

  // Turno 2: Nueva observacion
  { role: 'user', parts: [{ text: "Current page: ..." }] },
  // ... repite
]
```

### Patron startChat + sendMessage

```typescript
// History NO incluye el turno actual
const chat = model.startChat({ history });

// sendMessage envia el turno actual
const result = await chat.sendMessage(parts);

// Despues, se agrega todo al history para la siguiente iteracion
history.push({ role: 'user', parts });
history.push({ role: 'model', parts: content.parts });
history.push({ role: 'function', parts: functionResponseParts });
```

**IMPORTANTE**: El USER REQUEST solo se envia en el step 0. Los steps siguientes solo contienen el estado de la pagina (tree + screenshot).

---

## 17. Bugs Encontrados y Solucionados

### Bug 1: History Duplication (Critico)
- **Sintoma**: El agente recibia el mismo contexto duplicado
- **Causa**: Codigo viejo hacia `history.slice(0, -1)` y reenviaba los mismos parts
- **Fix**: Patron correcto de `startChat({ history })` + `sendMessage(currentParts)`

### Bug 2: Single functionCall Capture
- **Sintoma**: Solo se ejecutaba la ultima tool call cuando Gemini retornaba multiples
- **Causa**: Variable sobrescrita en loop (`functionCall = part.functionCall`)
- **Fix**: Array `functionCalls: any[] = []` que colecta todos los calls

### Bug 3: No Content Script Pre-flight
- **Sintoma**: Errores despues de navegacion cross-page
- **Causa**: Content script muere al navegar, nunca se re-inyectaba
- **Fix**: `pingContentScript()` + `ensureContentScript()` antes de cada `getAccessibilityTree`

### Bug 4: "Cannot access chrome:// URL"
- **Sintoma**: Error fatal al intentar inyectar en `chrome://extensions`
- **Causa**: Sin verificacion de URL antes de `executeScript()`
- **Fix**: `isInjectableUrl()` guard en `ensureContentScript()` y `getPageState()`

### Bug 5: "Could not establish connection"
- **Sintoma**: Error cuando la tab activa era nueva pestana (`chrome://newtab`)
- **Causa**: `getActiveTab()` no filtraba tabs no-inyectables
- **Fix**: `isInjectableUrl` filter con fallback a cualquier tab activa

### Bug 6: Premature task_failed (Gmail AJAX)
- **Sintoma**: Agente busca en Gmail, dice "no encontre correos" cuando los resultados estan visibles
- **Causa**: Tree capturado antes de que AJAX cargara resultados (300ms default para press_key)
- **Fix**: Wait time 2500ms para `press_key Enter` + instrucciones de `wait_and_observe` en prompt

### Bug 7: Analisis Superficial
- **Sintoma**: Agente solo lee titulos de correos, no entra a cada uno
- **Causa**: Prompt original no especificaba comportamiento exhaustivo, maxSteps = 20
- **Fix**: Seccion "SE EXHAUSTIVO" en prompt, maxSteps = 50, scroll 70% viewport

### Bug 8: Tree Overflow (Regresion)
- **Sintoma**: Agente abandona reunion de Meet en vez de navegar a Gmail
- **Causa**: `[tabindex="0"]` capturaba cientos de elementos en Meet, saturando a Gemini
- **Fix**: Removidos `[tabindex="0"]`, `[tabindex="1"]`, `[aria-haspopup]`. Cap de 150 elementos.

### Bug 9: Gmail Search Input Invisible
- **Sintoma**: Agente no encuentra `<input>` de busqueda de Gmail en el tree
- **Causa**: Input puede tener dimensiones < 5px o estar oculto hasta hacer click
- **Fix**: Min size 1px para form fields + `document.activeElement` siempre incluido + HTML tag en tree output

---

## 18. Lecciones Aprendidas y Anti-patrones

### NUNCA agregar `[tabindex="0"]` a selectores
Google usa `tabindex="0"` extensivamente. En Meet puede haber 300+ elementos con este atributo. Inundar el tree satura el contexto de Gemini y degrada drasticamente la calidad de las decisiones.

### NUNCA confiar en timing fijo para SPAs
Gmail, YouTube, y la mayoria de apps modernas cargan contenido via AJAX. Un `setTimeout(500)` no es suficiente. Usar `waitForPageLoad` + settle time + instrucciones de `wait_and_observe` en el prompt.

### El system prompt tiene peso ENORME en el comportamiento
Gemini sigue las instrucciones del system prompt de manera bastante literal. Si dices "se exhaustivo" sin dar ejemplos concretos, no lo sera. Si dices "despues de Enter siempre usa wait_and_observe" CON un ejemplo correcto e incorrecto, lo hara.

### Mas selectores != mejor tree
Agregar selectores como `[aria-haspopup]` o `[tabindex]` puede parecer util pero introduce ruido masivo. Cada elemento extra en el tree compite por atencion del modelo. Mantener los selectores estrictos.

### `document.activeElement` es critico
Despues de hacer click en un boton que revela un input (como Gmail search), el focus se mueve al input. Si el input no estaba en el tree original (porque era invisible), `document.activeElement` es la unica forma de capturarlo.

### Error handling graceful > crash
`getPageState()` retorna un objeto de error en vez de throw. Esto permite al agente continuar y potencialmente recuperarse (usando `navigate` para ir a otra pagina, o `wait_and_observe` para esperar).

### URLs directas como escape hatch
Cuando la interaccion con la UI falla (no encuentra el input, no puede hacer click), navegar directamente por URL es la solucion mas robusta: `https://mail.google.com/mail/u/0/#search/from:Ernesto`.

---

## 19. Configuracion del Modelo

```typescript
// config.ts
export const MODELS = {
  WEB_AGENT: "gemini-2.5-flash",  // Needs stable tool support
  // ...
};
```

### Por que gemini-2.5-flash y no gemini-3-flash-preview?

- `gemini-2.5-flash` tiene soporte estable de function calling
- Los modelos "preview" (gemini-3-*) pueden tener comportamiento inconsistente con tools
- Flash es mas rapido y barato que Pro, importante para un loop de 50 pasos
- Suficiente capacidad de razonamiento para tareas web comunes

### Inicializacion de Gemini

```typescript
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({
  model: MODELS.WEB_AGENT,
  systemInstruction: WEB_AGENT_SYSTEM_PROMPT,
  tools: WEB_AGENT_TOOLS as any,
});
```

---

## 20. Limitaciones Conocidas

### Tecnicas
1. **Shadow DOM**: No se penetra en shadow roots (Web Components encapsulados)
2. **iframes**: No se inyecta content script en iframes cross-origin
3. **Canvas/WebGL**: Elementos renderizados en canvas no aparecen en el tree
4. **Captchas**: No puede resolver CAPTCHAs
5. **2FA popups**: No puede interactuar con dialogs nativos del OS
6. **File upload**: No puede seleccionar archivos del filesystem

### De Gemini
7. **Context window**: Con screenshots + trees grandes, puede acercarse al limite
8. **Alucinacion de refs**: Ocasionalmente inventa ref IDs que no existen
9. **Bucles**: Puede repetir la misma accion sin progresar
10. **Comprension de tarea**: Puede malinterpretar tareas complejas/ambiguas

### De Gmail Especificamente
11. **Search input oculto**: Gmail puede no mostrar el input hasta interaccion
12. **AJAX timing**: Resultados pueden tardar 1-5 segundos en aparecer
13. **DOM complejo**: Gmail tiene estructura DOM profundamente anidada

---

## 21. Proximos Pasos

### Pendientes de resolver
- [ ] Gmail search input: Verificar que `document.activeElement` capture correctamente
- [ ] Agente abandonando Meet: Verificar que el cap de 150 elementos resuelve el issue
- [ ] Testing exhaustivo en multiples sitios (Amazon, YouTube, LinkedIn)

### Mejoras potenciales
- [ ] **Retry con backoff inteligente**: Si una accion falla, intentar variante automaticamente
- [ ] **Vision-only mode**: Para paginas donde el tree es pobre, usar solo screenshots
- [ ] **Historial de acciones comprimido**: Resumir pasos anteriores para ahorrar contexto
- [ ] **Parallel page analysis**: Abrir multiples pestanas para comparar informacion
- [ ] **User confirmation**: Preguntar al usuario antes de acciones destructivas (borrar, enviar)
- [ ] **Learning from failures**: Registrar patrones de fallo para mejorar el prompt

---

## Apendice: Permisos Necesarios (manifest.json)

```json
{
  "permissions": [
    "activeTab",
    "tabs",
    "scripting"
  ],
  "host_permissions": [
    "<all_urls>"
  ]
}
```

- `activeTab`: Acceso a la tab activa
- `tabs`: Query de todas las tabs, captureVisibleTab
- `scripting`: executeScript para inyectar content script
- `<all_urls>`: Inyeccion en cualquier sitio web
