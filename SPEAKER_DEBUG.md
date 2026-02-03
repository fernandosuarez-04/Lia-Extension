# 🔍 Guía de Debugging: Speaker Detection

El sistema de detección de hablantes no está funcionando correctamente (todos aparecen como "Participante"). Esta guía te ayudará a diagnosticar el problema.

## 📋 Pasos para Debuggear

### 1. Recargar la Extensión

1. Abre `chrome://extensions/`
2. Busca "SOFLIA Agent" o "Lia Extension"
3. Click en el botón de **Reload** (↻)
4. Cierra todas las pestañas de Google Meet abiertas

### 2. Abrir Consola de Google Meet

1. Abre una nueva pestaña de Google Meet
2. Únete a una reunión (o crea una)
3. Presiona `F12` para abrir DevTools
4. Ve a la pestaña **Console**
5. **MUY IMPORTANTE**: Mantén la consola abierta durante toda la prueba

### 3. Iniciar Transcripción

1. Click en el ícono de Lia Extension
2. Click en "Agente de Reuniones"
3. Click en "Iniciar Transcripción"
4. Selecciona la pestaña de la reunión cuando te lo pida

### 4. Verificar los Logs

En la consola deberías ver logs como estos:

#### ✅ **Logs Esperados (Funcionando):**

```
SOFLIA: Starting speaker detection...
MeetSpeakerDetector: Starting...
MeetSpeakerDetector: Found 3 participant tiles
MeetSpeakerDetector: Tile xxx -> name: "Fernando Suarez"
MeetSpeakerDetector: Tile yyy -> name: "Pedro Alexis"
MeetSpeakerDetector: ✅ Speaker changed: null -> "Fernando Suarez" (confidence: 90%, method: blue-border)
MeetingManager: ✅ Active speaker changed: null -> "Fernando Suarez" confidence: 0.9
MeetingManager: ✅ Adding transcript segment: { speaker: "Fernando Suarez", text: "Hola, ¿cómo están?" }
```

#### ❌ **Logs de Problema (No Funcionando):**

```
MeetSpeakerDetector: Found 0 participant tiles
MeetSpeakerDetector: Method 1 (data-is-speaking) found no elements
MeetSpeakerDetector: Method 2 (audio indicators) found 0 indicators
MeetSpeakerDetector: Method 3 (blue border) checking 0 tiles
MeetSpeakerDetector: No speaker detected (all methods failed)
```

### 5. Qué Buscar en los Logs

**Pregunta 1: ¿Se está iniciando el detector?**
- Busca: `SOFLIA: Starting speaker detection...`
- Si NO aparece: El content script no está cargado

**Pregunta 2: ¿Encuentra participant tiles?**
- Busca: `MeetSpeakerDetector: Found X participant tiles`
- Si X = 0: Los selectores DOM están desactualizados

**Pregunta 3: ¿Extrae nombres correctamente?**
- Busca: `MeetSpeakerDetector: Tile xxx -> name: "XXX"`
- Si todos son `null`: La extracción de nombres está fallando

**Pregunta 4: ¿Detecta al hablante activo?**
- Busca: `MeetSpeakerDetector: ✅ Speaker changed`
- Si NO aparece: Los métodos de detección están fallando

**Pregunta 5: ¿Llegan los mensajes al manager?**
- Busca: `MeetingManager: ✅ Active speaker changed`
- Si NO aparece: Los mensajes no están llegando

**Pregunta 6: ¿Se usa el speaker correcto en transcripción?**
- Busca logs de `MeetingManager: ✅ Adding transcript segment`
- Verifica que `speaker` no sea "Participante"

## 🐛 Problemas Comunes y Soluciones

### Problema 1: "Found 0 participant tiles"

**Causa**: Google Meet cambió los selectores DOM

**Solución**: Necesitas inspeccionar el DOM de Meet:
1. En la consola de Meet, escribe:
```javascript
document.querySelectorAll('[data-participant-id]').length
```
2. Si devuelve 0, los selectores están mal
3. Inspecciona un tile de participante en DevTools (click derecho > Inspeccionar)
4. Manda screenshot del HTML del tile

### Problema 2: "Extracting name from tile... Could not extract name"

**Causa**: Los atributos de nombre han cambiado

**Solución**:
1. Inspecciona un tile de participante
2. Busca atributos como: `data-tooltip`, `aria-label`, `data-self-name`
3. Manda screenshot del elemento HTML completo

### Problema 3: "No speaker detected (all methods failed)"

**Causa**: Los indicadores de "speaking" cambiaron

**Solución**:
1. Haz que alguien hable en la reunión
2. Observa el DOM del tile mientras habla
3. Busca:
   - Atributos que cambien: `data-is-speaking="true"`
   - Bordes azules: `border-color: rgb(26, 115, 232)`
   - Clases CSS que se agreguen: `speaking`, `active-speaker`
4. Manda screenshot del tile mientras alguien está hablando

### Problema 4: Los logs no se reciben en MeetingManager

**Causa**: Los mensajes no se envían/reciben correctamente

**Solución**:
1. En la consola de Meet, busca errores relacionados con `chrome.runtime`
2. Verifica que no haya errores de `chrome.runtime.lastError`

## 📤 Qué Enviarme para Ayudarte

Por favor copia y envía:

1. **Todos los logs de la consola** que contengan:
   - `MeetSpeakerDetector:`
   - `MeetingManager:`
   - `SOFLIA:`

2. **Screenshot del HTML** de un tile de participante:
   - Click derecho en el video de un participante
   - Inspeccionar
   - Screenshot del elemento HTML completo

3. **Screenshot del tile mientras alguien habla**:
   - Haz que alguien hable
   - Inspecciona el tile mientras habla
   - Screenshot mostrando cambios visuales y DOM

4. **Resultado de estos comandos en la consola de Meet**:
```javascript
// Copia y pega estos comandos en la consola y envía los resultados:

// 1. Cantidad de tiles
document.querySelectorAll('[data-participant-id]').length

// 2. Atributos de tiles
Array.from(document.querySelectorAll('[data-participant-id]')).map(t => ({
  id: t.getAttribute('data-participant-id'),
  selfName: t.getAttribute('data-self-name'),
  ariaLabel: t.getAttribute('aria-label'),
  tooltip: t.querySelector('[data-tooltip]')?.getAttribute('data-tooltip'),
  text: t.textContent?.substring(0, 50)
}))

// 3. Detectar elementos "speaking"
{
  dataSpeaking: document.querySelectorAll('[data-is-speaking="true"]').length,
  speakingClasses: document.querySelectorAll('[class*="speaking"]').length,
  audioIndicators: document.querySelectorAll('[role="progressbar"]').length
}
```

## 🔧 Soluciones Temporales

Mientras debuggeamos, puedes:

1. **Usar la transcripción sin speaker detection**
   - Los textos se guardarán como "Participante"
   - Puedes editarlos manualmente después

2. **Agregar speaker manualmente en el resumen**
   - Al final de la reunión, el resumen mostrará la transcripción completa
   - Puedes identificar quién dijo qué por el contexto

## 📞 Contacto

Una vez que tengas la información anterior, envíamela y podré:
1. Actualizar los selectores DOM
2. Mejorar los métodos de detección
3. Crear selectores más robustos

---

**Versión del detector**: 2.0 con logging mejorado
**Última actualización**: 2026-02-03
