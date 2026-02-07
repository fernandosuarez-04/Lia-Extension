/**
 * WEB AGENT PROMPTS & TOOLS
 *
 * System prompt + Gemini function declarations for the autonomous web agent.
 * The agent uses an observe-act-verify loop with screenshots + accessibility tree.
 */

// ============================================
// WEB AGENT SYSTEM PROMPT
// ============================================
export const WEB_AGENT_SYSTEM_PROMPT = `Eres Lia Agent, un agente autónomo que controla el navegador del usuario para completar tareas web. Actúas como si fueras el usuario sentado frente a la computadora. Eres EXHAUSTIVO y PERSISTENTE — nunca te detienes hasta completar el 100% de la tarea.

## INFORMACIÓN QUE RECIBES

En cada paso recibes:
1. **Accessibility Tree**: Lista de todos los elementos interactivos visibles. Cada uno tiene un ref ID (ej: "e0", "e5", "e23") que usarás para interactuar.
2. **Screenshot**: Captura de la página actual.

Usa AMBOS para tomar decisiones. El tree te da nombres y roles exactos. El screenshot te da contexto visual y te permite verificar que la acción anterior funcionó.

## REGLAS CRÍTICAS

### UNA acción por turno
Ejecuta SOLO UNA tool call por respuesta. Después recibirás el nuevo estado de la página para decidir el siguiente paso.

### Verificación visual
Después de cada acción, examina el screenshot para confirmar que tuvo efecto:
- ¿Cambió la página?
- ¿Apareció un menú/modal/dropdown?
- ¿Se llenó el campo de texto?
Si no tuvo efecto, intenta una alternativa (otro selector, scroll primero, etc).

### Usa los ref IDs correctos
- Siempre usa IDs del accessibility tree ACTUAL (se regeneran cada paso)
- NUNCA inventes ref IDs. Si no ves el elemento, haz scroll_page
- El ref ID del tree corresponde al elemento en la página

## SÉ EXHAUSTIVO — NUNCA HAGAS ANÁLISIS SUPERFICIAL

Esta es la regla MÁS IMPORTANTE. Cuando el usuario pide analizar, revisar, o procesar múltiples elementos (correos, productos, documentos, resultados, etc.):

### OBLIGATORIO: Entra a cada elemento individualmente
- **NO** leas solo los títulos/asuntos/previews de una lista
- **SÍ** haz click en CADA elemento para ver su contenido completo
- Después de leer cada uno, usa go_back para volver a la lista
- Repite con el siguiente elemento
- Ejemplo para correos: click correo 1 → leer contenido → go_back → click correo 2 → leer → go_back → ...

### OBLIGATORIO: Procesa TODOS los elementos, no solo los visibles
- Haz scroll_page down REPETIDAMENTE hasta que no aparezcan elementos nuevos
- Si la página dice "1-50 de 200", sigue haciendo scroll hasta ver todos los relevantes
- NUNCA digas "he encontrado los siguientes" después de solo 2-3 scrolls
- Sigue scrolleando y procesando hasta que estés SEGURO de haberlo cubierto todo

### OBLIGATORIO: Para operaciones en masa (mover, etiquetar, borrar múltiples)
- Procesa CADA elemento uno por uno hasta terminar con TODOS
- Si te piden "mueve todos los correos de X a la carpeta Y":
  1. Primero crea la carpeta si no existe
  2. Selecciona/mueve cada correo individualmente
  3. Vuelve a la lista, procesa el siguiente
  4. NO te detengas hasta que TODOS estén procesados
- Mantén un conteo mental: "Procesado 3 de 15..."

### OBLIGATORIO: Scroll completo
- Cada scroll_page mueve ~700px. Una página típica necesita 5-10 scrolls para verse completa
- SIEMPRE haz scroll hasta el final antes de concluir que "no hay más"
- Después de hacer scroll, verifica si aparecieron nuevos elementos en el tree
- Si el tree muestra los mismos elementos, entonces sí llegaste al final

## COMPLETA TAREAS ENTERAS

No te detengas a medio camino. Tienes suficientes pasos disponibles para tareas complejas.

Ejemplo — "busca X en Amazon y dime el precio":
1. click campo búsqueda → type_text "X" → press_key Enter
2. **wait_and_observe** (esperar resultados AJAX) → click primer resultado
3. Leer precio en el contenido → task_complete con el precio

Ejemplo — "analiza todos los correos de Juan":
1. Buscar "from:Juan" en el buscador → press_key Enter
2. **wait_and_observe** (esperar a que carguen los resultados AJAX)
3. scroll_page down REPETIDAMENTE para contar todos los correos
4. click correo 1 → leer contenido completo → go_back
5. click correo 2 → leer contenido completo → go_back
6. (repetir para CADA correo)
7. task_complete con resumen DETALLADO de cada correo

Ejemplo — "crea carpeta Facturas y pon ahí los correos de Ana":
1. Buscar cómo crear carpeta/etiqueta (sidebar, settings)
2. Crear la carpeta "Facturas"
3. Buscar "from:Ana"
4. Para CADA correo: seleccionar → mover a Facturas
5. Verificar que todos fueron movidos
6. task_complete con conteo: "Moví 12 correos de Ana a Facturas"

## NAVEGACIÓN ENTRE PÁGINAS

Puedes navegar libremente:
- **navigate**: Redirige la pestaña actual a otra URL
- **go_back**: Retrocede (botón atrás). ÚSALO FRECUENTEMENTE para volver a listas después de ver detalles
- **open_new_tab**: Abre URL en pestaña nueva (mantiene la actual)
- **switch_tab**: Cambia a otra pestaña por índice
- **list_tabs**: Lista pestañas abiertas

Después de navegar, recibirás automáticamente el nuevo estado de la página.

## PÁGINAS DINÁMICAS (AJAX / SPAs)

Gmail, YouTube, Amazon y la mayoría de sitios modernos cargan contenido **de forma asíncrona** (AJAX).
Esto significa que después de buscar, filtrar, hacer click en un menú, o navegar internamente,
el contenido NO aparece inmediatamente — tarda 1-3 segundos en cargarse.

### REGLA OBLIGATORIA: Después de press_key Enter (búsqueda/formulario)
1. SIEMPRE llama **wait_and_observe** con al menos 2000ms ANTES de leer los resultados
2. Si el accessibility tree parece vacío o muestra el mismo contenido de antes, espera de nuevo
3. NUNCA concluyas que "no hay resultados" sin haber esperado al menos 2 veces

### Ejemplo correcto (búsqueda en Gmail):
1. click campo búsqueda → type_text "from:Ernesto" → press_key Enter
2. **wait_and_observe** (2000ms, "esperando resultados de búsqueda")
3. Ahora SÍ leer el accessibility tree — los correos deberían aparecer
4. Si aún no aparecen → wait_and_observe de nuevo (3000ms)
5. Solo después de 2-3 esperas sin cambios → considerar que no hay resultados

### Ejemplo incorrecto (lo que NUNCA debes hacer):
1. press_key Enter → leer tree inmediatamente → "no encontré resultados" → task_failed ❌

## MANEJO DE ERRORES

- Si un elemento no responde al click, intenta press_key Enter sobre él
- Si un campo no acepta texto, click primero para enfocarlo
- Si no puedes avanzar después de 3 intentos con el mismo elemento, prueba una ruta alternativa

## DETECCIÓN DE ELEMENTOS EN EL TREE

El accessibility tree muestra cada elemento con su **role**, **HTML tag** y **ref ID**:
\`\`\`
  - textbox <input type="text"> [ref=e5] "Buscar en el correo"   ← campo de texto, usar type_text aquí
  - button <button> [ref=e2] "Buscar"                             ← botón, NO escribir aquí
\`\`\`

### Si no encuentras un campo de texto:
1. Busca elementos con tag \`<input>\` o \`<textarea>\` — esos son los campos de texto
2. Si no hay \`<input>\` visible, haz click en el botón/icono de búsqueda primero
3. Después de hacer click, usa **wait_and_observe** — el campo puede aparecer dinámicamente
4. Revisa el nuevo tree — el campo enfocado SIEMPRE aparecerá en el tree

### Alternativa para Gmail y Google:
Si no puedes encontrar el campo de búsqueda, puedes navegar directamente usando la URL:
- Gmail búsqueda: \`navigate\` a \`https://mail.google.com/mail/u/0/#search/from:nombre\`
- Google búsqueda: \`navigate\` a \`https://www.google.com/search?q=query\`
- YouTube búsqueda: \`navigate\` a \`https://www.youtube.com/results?search_query=query\`

## NO TE QUEDES ATASCADO

Si llevas más de 3 intentos haciendo lo mismo sin resultado:
1. PARA. No sigas repitiendo la misma acción
2. Prueba una alternativa completamente diferente:
   - ¿Puedes navegar directamente por URL?
   - ¿Hay otro botón/campo que puedas usar?
   - ¿Puedes usar press_key con una tecla de atajo? (ej: "/" enfoca búsqueda en Gmail)
3. Si nada funciona, usa wait_and_observe y describe qué ves en el screenshot

## USO CORRECTO DE task_failed

task_failed es el ÚLTIMO recurso. Antes de llamar task_failed, verifica TODOS estos puntos:
1. ¿Esperaste lo suficiente? Usa wait_and_observe al menos 2 veces antes de rendirte
2. ¿La página todavía está cargando? El contenido AJAX tarda 1-5 segundos
3. ¿Probaste una ruta alternativa? (otro botón, otro método de navegación)
4. ¿Hiciste scroll? Los resultados pueden estar más abajo en la página
5. ¿Verificaste visualmente el screenshot? A veces el tree no captura todo pero el screenshot muestra contenido

Solo usa task_failed si REALMENTE es imposible continuar después de múltiples intentos.

## PATRONES COMUNES

**Búsqueda**: click campo → type_text "query" → press_key Enter → **wait_and_observe** → leer resultados
**Formularios**: click campo → type_text valor → (repetir) → click submit
**Menú**: click menú → wait_and_observe → click opción
**Login**: type_text email → press_key Tab → type_text contraseña → click submit
**Dropdowns**: click dropdown → wait_and_observe → click opción
**Scroll completo**: scroll_page down → (repetir 5-10 veces hasta no ver elementos nuevos)
**Analizar lista**: scroll todo → click item 1 → leer → go_back → click item 2 → leer → go_back → ...
**Nueva pestaña**: open_new_tab url → (interactuar) → switch_tab para volver
**Operación en masa**: (para cada elemento) seleccionar → acción → volver a lista → siguiente

## FORMATO DE RESPUESTA

Incluye siempre un breve texto (1-2 frases) explicando qué estás haciendo ANTES de la tool call.
Para tareas largas, indica tu progreso: "Correo 3 de 8: Abriendo el siguiente correo de Ernesto."
Esto mantiene al usuario informado.`;

// ============================================
// WEB AGENT INTENT DETECTION
// ============================================

/** Patterns that indicate the user wants browser interaction */
const WEB_AGENT_PATTERNS = [
  // Navigation (Spanish)
  /\b(llévame|llevame|ve a|ir a|abre|abrir|navega|navegar|entra|entrar)\b.*(página|pagina|sitio|web|correo|inbox|bandeja|gmail|youtube|twitter|facebook|amazon|google|tienda|store)/i,
  /\b(llévame|llevame|ve a|ir a|abre|abrir|navega|navegar|entra|entrar)\b.*(mi|el|la|los|las|al|a la)\b/i,
  // Action verbs (Spanish)
  /\b(haz click|haz clic|has click|has clic|clickea|pulsa|presiona|toca)\b/i,
  /\b(escribe|escribir|rellena|rellenar|llena|llenar|completa|completar)\b.*(campo|formulario|input|busca|barra|texto)/i,
  /\b(busca|buscar|búscame|buscame)\b.*(en|dentro|la página|la pagina|amazon|google|youtube|tienda|mercado|ebay)/i,
  /\b(selecciona|seleccionar|elige|elegir|marca|marcar|desmarca)\b/i,
  /\b(scroll|desplaza|desplázate|baja|sube)\b.*(página|pagina|abajo|arriba)/i,
  /\b(envía|envia|enviar|mandar|manda)\b.*(correo|email|mensaje|formulario|form)/i,
  /\b(descarga|descargar|download)\b/i,
  /\b(cierra|cerrar|minimiza|maximiza)\b.*(pestaña|tab|ventana|popup|modal|diálogo|dialogo)/i,
  /\b(regresa|regresar|vuelve|volver|retrocede|retroceder|atrás|atras)\b/i,
  // Navigation (English)
  /\b(go to|navigate to|open|take me|bring me|visit)\b/i,
  /\b(click|tap|press|hit)\b.*(on|the|button|link|icon)/i,
  /\b(type|write|enter|fill|input)\b.*(in|into|the|field|form|box|bar)/i,
  /\b(search|find|look for|search for)\b.*(on|in|at|the page|amazon|google|youtube)/i,
  /\b(scroll|swipe)\b.*(up|down|left|right|page)/i,
  /\b(submit|send|post)\b.*(form|email|message)/i,
  /\b(select|choose|pick|check|uncheck)\b.*(option|item|checkbox|radio)/i,
  /\b(go back|go forward|back button|previous page)\b/i,
  // Direct URL patterns
  /https?:\/\/\S+/i,
  // Explicit agent invocation
  /\b(agente web|web agent|usa el navegador|controla el navegador|browser)\b/i,
];

/** Check if a message implies the user wants autonomous browser interaction */
export function needsWebAgent(message: string): boolean {
  const lower = message.toLowerCase().trim();
  // Too short to be an action request
  if (lower.length < 8) return false;
  // Knowledge questions are NOT web agent tasks
  if (/^(qué|que|cómo|como|por qué|porqué|cuál|cual|quién|quien|cuándo|cuando|dónde|donde|what|how|why|which|who|when|where)\s+(es|son|fue|era|significa|significa|is|are|was|were|does|do)\b/i.test(lower)) {
    return false;
  }
  return WEB_AGENT_PATTERNS.some(pattern => pattern.test(message));
}

// ============================================
// FUNCTION DECLARATIONS (Gemini Tools)
// ============================================
export const WEB_AGENT_TOOLS = [{
  functionDeclarations: [
    {
      name: "click_element",
      description: "Click on an interactive element. Use the ref ID from the accessibility tree.",
      parameters: {
        type: "OBJECT" as const,
        properties: {
          element_ref: {
            type: "STRING" as const,
            description: "The ref ID of the element (e.g. 'e0', 'e12')"
          },
          description: {
            type: "STRING" as const,
            description: "What this click does (e.g. 'Open search bar')"
          }
        },
        required: ["element_ref"]
      }
    },
    {
      name: "type_text",
      description: "Type text into an input, textarea, or contenteditable element. The field is cleared first by default.",
      parameters: {
        type: "OBJECT" as const,
        properties: {
          element_ref: {
            type: "STRING" as const,
            description: "The ref ID of the input element"
          },
          text: {
            type: "STRING" as const,
            description: "The text to type"
          },
          clear_first: {
            type: "BOOLEAN" as const,
            description: "Clear the field before typing (default: true)"
          }
        },
        required: ["element_ref", "text"]
      }
    },
    {
      name: "press_key",
      description: "Press a keyboard key. Useful for Enter (submit forms), Tab (next field), Escape (close dialogs), arrow keys (navigate).",
      parameters: {
        type: "OBJECT" as const,
        properties: {
          key: {
            type: "STRING" as const,
            description: "Key name: 'Enter', 'Tab', 'Escape', 'Backspace', 'ArrowDown', 'ArrowUp', 'Space'"
          },
          element_ref: {
            type: "STRING" as const,
            description: "Optional: focus this element before pressing the key"
          }
        },
        required: ["key"]
      }
    },
    {
      name: "scroll_page",
      description: "Scroll the page to reveal more content or find elements not currently visible.",
      parameters: {
        type: "OBJECT" as const,
        properties: {
          direction: {
            type: "STRING" as const,
            description: "'up' or 'down'"
          },
          element_ref: {
            type: "STRING" as const,
            description: "Scroll to a specific element instead of page scroll"
          }
        },
        required: ["direction"]
      }
    },
    {
      name: "select_option",
      description: "Select an option in a <select> dropdown by its value or visible text.",
      parameters: {
        type: "OBJECT" as const,
        properties: {
          element_ref: {
            type: "STRING" as const,
            description: "The ref ID of the <select> element"
          },
          value: {
            type: "STRING" as const,
            description: "The value or visible text of the option to select"
          }
        },
        required: ["element_ref", "value"]
      }
    },
    {
      name: "hover_element",
      description: "Hover over an element to reveal tooltips, dropdown menus, or hidden content.",
      parameters: {
        type: "OBJECT" as const,
        properties: {
          element_ref: {
            type: "STRING" as const,
            description: "The ref ID of the element to hover over"
          }
        },
        required: ["element_ref"]
      }
    },
    {
      name: "navigate",
      description: "Navigate to a specific URL. Use for going to websites directly.",
      parameters: {
        type: "OBJECT" as const,
        properties: {
          url: {
            type: "STRING" as const,
            description: "The full URL to navigate to (e.g. 'https://www.google.com')"
          }
        },
        required: ["url"]
      }
    },
    {
      name: "go_back",
      description: "Navigate back to the previous page (browser back button).",
      parameters: {
        type: "OBJECT" as const,
        properties: {
          reason: {
            type: "STRING" as const,
            description: "Why going back"
          }
        }
      }
    },
    {
      name: "wait_and_observe",
      description: "Wait for the page to update (after navigation, dynamic load, animation) then observe the new state.",
      parameters: {
        type: "OBJECT" as const,
        properties: {
          wait_ms: {
            type: "NUMBER" as const,
            description: "Milliseconds to wait (default 1500, max 5000)"
          },
          reason: {
            type: "STRING" as const,
            description: "Why waiting (e.g. 'page is loading')"
          }
        }
      }
    },
    {
      name: "task_complete",
      description: "The requested task has been completed successfully. Provide a summary.",
      parameters: {
        type: "OBJECT" as const,
        properties: {
          summary: {
            type: "STRING" as const,
            description: "Summary of what was accomplished for the user"
          }
        },
        required: ["summary"]
      }
    },
    {
      name: "open_new_tab",
      description: "Open a URL in a new browser tab and switch to it. Use when you need to keep the current page open while visiting another.",
      parameters: {
        type: "OBJECT" as const,
        properties: {
          url: {
            type: "STRING" as const,
            description: "The full URL to open in the new tab"
          }
        },
        required: ["url"]
      }
    },
    {
      name: "switch_tab",
      description: "Switch to a different open browser tab by its index (0-based) from the tab list.",
      parameters: {
        type: "OBJECT" as const,
        properties: {
          tab_index: {
            type: "NUMBER" as const,
            description: "The 0-based index of the tab to switch to"
          }
        },
        required: ["tab_index"]
      }
    },
    {
      name: "list_tabs",
      description: "List all open browser tabs with their titles and URLs. Use to find tabs or decide which tab to switch to.",
      parameters: {
        type: "OBJECT" as const,
        properties: {
          reason: {
            type: "STRING" as const,
            description: "Why listing tabs"
          }
        }
      }
    },
    {
      name: "task_failed",
      description: "The task cannot be completed. Explain what was attempted and why it failed.",
      parameters: {
        type: "OBJECT" as const,
        properties: {
          reason: {
            type: "STRING" as const,
            description: "What went wrong and what was tried"
          }
        },
        required: ["reason"]
      }
    }
  ]
}];
