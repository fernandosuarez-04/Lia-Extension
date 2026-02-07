# Asistente de IA en Reuniones con LIA

(API en Vivo)

**Objetivo:** Utilizar la función de **API en vivo** de la extensión LIA para que
un asistente de IA participe en videoreuniones (Google Meet, Zoom), _transcribiendo_
la conversación en tiempo real, generando un **resumen** (y guardándolo en
PDF), y respondiendo con voz en vivo cuando se le formule una pregunta. A
continuación se detalla cómo lograr esto basándose en la información del
repositorio LIA.

## [Función de API en Vivo en LIA (Live API)]()

La extensión LIA integra la **API Generativa de Google (Gemini)** en
modo _streaming_ bidireccional para interacciones en tiempo real. Al
activar el modo “Conversación en vivo”, LIA abre una conexión WebSocket al
endpoint **BidiGenerateContent** de Google[[1]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/gemini3.md#L2-L5)[[2]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/config.ts#L20-L23). Esto permite enviar audio en vivo y recibir tanto texto como audio de
respuesta del modelo generativo:

- **Configuración de la sesión:** Al
  conectarse, LIA envía un mensaje de _setup_ que indica qué modelo
  usar (ej. gemini-2.5-flash-native-audio-latest)
  y que la respuesta debe incluir audio (se especifica responseModalities: ["AUDIO"]). También fija una voz predefinida ( **“Aoede”** ) para las
  respuestas habladas y proporciona una instrucción de sistema con el rol y
  el idioma del asistente[[3]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L151-L159)[[4]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L159-L163). En el repositorio se ve que la instrucción por defecto dice: _“Eres
  Lia, una asistente... Responde siempre en español de forma concisa...”_[[4]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L159-L163) (esto se puede ajustar para soportar otros idiomas, como
  explicaremos más adelante).
- **Comunicación en tiempo real:** La clase LiveClient maneja la conexión
  WebSocket. Cada vez que haya audio del usuario, LIA lo envía como
  fragmentos de audio PCM base64 mediante mensajes realtimeInput[[5]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L445-L453). A su vez, el modelo devuelve _streaming_ respuestas que
  pueden incluir texto transcrito y audio sintetizado. El código de LIA
  demuestra cómo se procesan estos datos: si llega texto, se invoca onTextResponse; si llega audio (base64
  PCM), se invoca onAudioResponse y el audio se
  reproduce automáticamente en la máquina local[[6]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L291-L300). En otras palabras, LIA convierte la voz del usuario en texto
  para el modelo y convierte la respuesta del modelo en voz que se escucha
  por los altavoces del usuario.

## [Configuración en Google Cloud (API Key y Permisos)]()

Para usar la Live API es **indispensable** configurar correctamente
Google Cloud: 1. **Habilitar la API de Lenguaje Generativo** en el proyecto
de Google Cloud (Google AI generative language API).

2. **Obtener una API key válida** con acceso a los modelos _Live_ . No
   todas las claves incluyen acceso a esta funcionalidad en vivo; suele requerir
   estar en un plan con facturación (por ejemplo, Google AI Ultra o similar) y
   usar la versión adecuada de la API (v1beta)[[7]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/gemini3.md#L8-L15)[[8]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/popup/App.tsx#L116-L124).

En el repositorio, la extensión contempla errores comunes de permisos:
si la clave no tiene acceso o la API no está habilitada, LIA muestra un mensaje
de error indicando que faltan permisos para Live API y sugiere _“Verifica que
tu key tenga acceso a modelos Live”_ y asegurarse de habilitar **Generative
Language API** en Google Cloud[[8]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/popup/App.tsx#L116-L124). Por lo tanto, el primer paso es ir a Google Cloud Console (o AI
Studio) para activar la API generativa, luego generar una API key y colocarla
en la configuración de LIA (archivo _.env_ o en la variable GOOGLE_API_KEY del proyecto).

## [Captura de Audio y Transcripción en Tiempo Real]()

**¿Cómo “escucha” LIA la reunión?** La extensión
utiliza la clase AudioCapture para acceder al micrófono y
obtener audio en vivo. En el código se solicita el micrófono con 16 kHz mono,
cancelación de eco y supresión de ruido, ideal para capturar voz humana en
reuniones. El audio crudo del micrófono se procesa en fragmentos pequeños (por
ejemplo, buffers de 4096 muestras) y se convierte a formato **PCM 16-bit 16
kHz mono** codificado en base64[[9]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L548-L557). Estos fragmentos se envían continuamente por WebSocket al modelo
generativo usando la función sendAudioChunk()[[5]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L445-L453).

- **Transcripción de lo que se dice:** Al
  recibir audio, el modelo genera texto internamente. Según cómo esté
  configurado el prompt del asistente, este texto puede ser usado como
  entrada conversacional o simplemente como transcripción. De fábrica, LIA
  tratará el audio del usuario como una _consulta_ para que el
  asistente responda. Sin embargo, si el objetivo es **transcribir todo el
  diálogo de la reunión** (no solo las preguntas al asistente), se podría
  emplear un prompt especial de transcripción. En el repositorio existe un
  ejemplo llamado AUDIO_TRANSCRIPTION_PROMPT que
  instruye al modelo a _“SOLO TRANSCRIBIR”_ exactamente lo que oye, sin
  interpretaciones[[10]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/prompts/utils.ts#L14-L22). Con este prompt, el modelo actuaría únicamente como
  transcriptor, devolviendo texto literal de lo hablado (en el idioma
  correspondiente) en lugar de intentar responder. Implementar esto podría
  requerir modificar la instrucción de sistema o la lógica para que cuando
  LIA “escuche” a los participantes de la reunión, vuelque la transcripción
  en texto plano en lugar de formular una respuesta.
- **Capturar audio de todos los participantes:** Un desafío es que la extensión por defecto captura el **micrófono
  local** (lo que _usted_ dice). En una videollamada, querrá
  transcribir también lo que dicen **otros** . Para lograrlo, hay varias
  opciones:

·
Usar el mismo micrófono si los
parlantes están reproduciendo el audio de la llamada. Si utiliza altavoces (no
auriculares), el micrófono con cancelación de eco puede aún captar algo de las
voces remotas. No es lo ideal ya que puede perder calidad o filtrar el audio de
otros.

·
**Captura del audio del sistema o
pestaña:** Una solución más robusta es
modificar/expandir LIA para capturar el audio de la reunión directamente. En
Chrome, esto podría lograrse con la API chrome.tabCapture o mediaDevices.getDisplayMedia({ audio: true }) para obtener el audio de la pestaña de Meet/Zoom. Actualmente la
extensión no lo implementa explícitamente (no tiene permisos de captura de
audio en manifest), pero es técnicamente factible añadirlo. Capturando el audio
de la llamada, LIA podría alimentarlo al modelo igual que hace con el
micrófono.

·
**Uso de subtítulos/captions del
meeting:** En Google Meet, por ejemplo, se pueden
activar subtítulos en tiempo real. Una forma no intrusiva de transcribir es que
LIA (vía un content script) lea el texto de los subtítulos mostrados en la
página y los almacene. Esto evitaría problemas de audio directo, aunque
dependería de la precisión de los captions de Meet. No hay una implementación
directa en el repo, pero es una idea de integración.

En cualquier caso, para tener un registro completo de la reunión,
habría que recolectar continuamente el texto transcrito (sea vía modelo
generativo o servicio de STT separado) y guardarlo en una variable o base de
datos. **LIA** utiliza Supabase para guardar historiales de chat; de forma
similar podríamos almacenar la transcripción completa para post-procesarla.

## [Respuestas de Voz en Vivo durante la Reunión]()

La otra parte de la ecuación es que **LIA responda con voz** en la
reunión cuando se le hacen preguntas. Gracias a la Live API, esto ocurre de
forma automática para las consultas que _sí_ esperan respuesta del
asistente. Cuando usted (o cualquier participante, si su micrófono capta la
pregunta) habla invocando a LIA, el flujo es: el audio se envía al modelo, el
modelo lo interpreta y genera una respuesta, y LIA **reproduce en voz alta**
esa respuesta usando síntesis de voz. En el código se evidencia que cada turno
del modelo puede traer audio generado (campo inlineData); LIA encola ese audio y lo
envía a la tarjeta de sonido para su reproducción continua sin cortes[[6]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L291-L300)[[11]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L419-L428). La voz “Aoede” configurada es una voz femenina clara y conversacional
(parte de la familia de voces de Google Cloud TTS).

**¿Cómo escuchan la respuesta los demás participantes?** Puesto que LIA reproduce el audio por los altavoces de su computadora,
los demás lo oirán de la misma manera que oirían cualquier sonido que usted
reproduzca en la reunión. Hay que asegurarse de compartir ese audio con ellos:

- Si está en Google Meet, por lo general el audio de su sistema **no** se
  retransmite a menos que usted use alguna función de “compartir pantalla con
  audio” o simplemente el sonido salga por sus altavoces y se cuele en el
  micrófono. Una opción es mantener un volumen suficiente y el micrófono abierto
  para que la voz de LIA se oiga (aunque la cancelación de eco podría intentar
  suprimirlo). Alternativamente, puede usar la función de Meet de _Compartir
  una pestaña con audio_ si LIA tuviera una interfaz web separada. - En Zoom u
  otras plataformas, podría emplear una herramienta de _virtual audio cable_
  que envíe el audio de LIA como entrada de micrófono. Por ejemplo, configurar
  LIA para reproducir por un dispositivo de audio virtual que esté seleccionado
  como micrófono en Zoom. Este tipo de configuración es avanzada pero
  garantizaría que todos oyen claramente la respuesta de la IA.

En resumen, técnicamente LIA **sí genera audio de respuesta
automáticamente** (gracias a la API en vivo) y lo reproduce localmente[[12]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L299-L305). Integrarlo a la reunión significa asegurarse de que ese audio local
sea audible para los demás. Muchas personas en la práctica optan por subir el
volumen y acercar el micrófono a los altavoces, o usar opciones de compartir
audio del software de videollamada.

## [Soporte Multilingüe (Español, Inglés, Portugués)]()

El modelo generativo de Google es _multilingüe_ , capaz de entender
y generar varios idiomas, incluidos español, inglés y portugués. No obstante,
la configuración inicial de LIA en el código fuerza las respuestas en **español**
(como vimos, la instrucción de sistema explícita "Responde siempre en
español"[[4]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L159-L163)). Para un asistente trilingüe más flexible, se recomienda:

- **Modificar o eliminar la restricción de idioma en la instrucción de
  sistema.** Se puede cambiar a algo como _"Responde
  en el mismo idioma usado por el usuario"_ o simplemente quitar esa
  línea. Así, si en la reunión le hablan en inglés, LIA contestará en
  inglés; si le hablan en portugués, contestará en portugués, etc.,
  utilizando el modelo generativo que identifica el idioma de entrada.
- **Seleccionar voces adecuadas por idioma.**
  La voz “Aoede” funciona muy bien en inglés y también habla español con
  acento neutral, pero Google ofrece voces específicas por idioma/región
  (por ejemplo, voces en portugués de Brasil). La API de generación en vivo
  permite especificar una voz preconstruida con voiceName. En el repositorio se fija _Aoede_
  por defecto[[13]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L152-L160), pero podríamos hacer que, según el idioma detectado del usuario,
  LIA envíe un nuevo mensaje de setup cambiando la voz. _(Nota:
  Alternativamente, usar siempre Aoede podría ser suficiente; sin embargo,
  para mayor naturalidad en portugués quizás convenga otra voz)._
- **Comprensión multilingüe:** No hace falta un
  cambio especial para que el modelo _entienda_ distintos idiomas; los
  modelos Gemini de Google han sido entrenados multilingüe. Simplemente, al
  no tener la instrucción "responde en español siempre", el
  asistente tenderá a responder en el idioma en que se le habló, manteniendo
  la conversación coherente. Si la reunión mezcla idiomas, LIA podría
  cambiar de uno a otro adaptándose a cada hablante.

En pruebas, debería verificarse que la transcripción es correcta en los
tres idiomas. Google ofrece alta calidad de reconocimiento especialmente para
inglés y español; para portugués también es buena, aunque menos usada.
Opcionalmente, para mejorar la **transcripción multilingüe** , se podría
integrar la API dedicada de Speech-to-Text de Google Cloud con el parámetro languageCode apropiado, pero esto sería
fuera del ámbito de LIA (sería una integración adicional combinando servicios).

## [Resumen de la Reunión y Exportación a PDF]()

Una de las metas es obtener un **resumen escrito** de todo lo
discutido. Una vez que se haya capturado la transcripción completa de la
reunión (ya sea acumulando la salida del modelo en modo transcripción pura, o
leyendo subtítulos), se puede proceder a generar un resumen con la misma IA:

- **Uso de prompts de resumen:** El repositorio
  de LIA ya incluye plantillas para resumir texto. Por ejemplo, SUMMARY_PROMPTS.detailed pide _"Proporciona
  un resumen detallado del siguiente contenido..."_ , o SUMMARY_PROMPTS.bullet resume en
  viñetas[[14]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/prompts/utils.ts#L48-L56). Se puede tomar todo el texto transcrito de la reunión y pasarlo
  (quizá en trozos si es muy largo) al modelo con uno de estos prompts. El
  modelo producirá un resumen coherente, destacando puntos clave,
  conclusiones y tareas mencionadas.
- **Generación del PDF:** LIA actualmente no
  genera PDFs por sí sola (no hay una función explícita en el código para
  PDF). Sin embargo, una vez obtenido el resumen en texto, es sencillo
  guardarlo. Algunas ideas:

·
Copiar el texto del resumen y
pegarlo en un documento (Google Docs, Word) y exportar a PDF manualmente.

·
Integrar una biblioteca en la
extensión (por ejemplo **jsPDF** o **PDFMake** ) que tome el texto y
construya un PDF automáticamente cuando termine la reunión. Esto requeriría
desarrollo adicional, pero es factible. Por ejemplo, tras generar el resumen,
el usuario podría hacer clic en un botón "Exportar PDF" que use dicha
librería para formatear el texto e iniciar una descarga de un archivo PDF.

·
Aprovechar que la mayoría de
navegadores pueden “Imprimir -> Guardar como PDF”. Se podría mostrar el
resumen en una página de resultados y pedir al usuario que use esa función.

En cualquier caso, la **almacenación de la transcripción completa**
también es valiosa. Además del resumen, quizá quiera guardar un log detallado.
LIA ya maneja historiales de chat guardados (usa Supabase para guardar sesiones
de conversación con sus mensajes[[15]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/popup/App.tsx#L60-L68)[[16]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/popup/App.tsx#L82-L90)); ese mecanismo podría reutilizarse para guardar la transcripción de
la reunión como una “sesión” especial. Luego, tanto la transcripción como el
resumen podrían recuperarse y guardarse.

## [Pasos

de Implementación]()

Para resumir, estos son los **pasos clave** para implementar un
asistente LIA en reuniones con transcripción, resumen y voz en vivo:

1. **Configurar
   las credenciales y acceso en Google Cloud:**
   Habilite la _Generative Language API_ en su proyecto y obtenga una
   API Key con permisos para modelos en vivo (streaming). Configure esa key
   en la extensión LIA (variable GOOGLE_API_KEY). Asegúrese de estar
   usando la versión adecuada de la API (v1beta para funciones Live)[[2]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/config.ts#L20-L23). Si su cuenta no tiene acceso a la Live API, es posible que
   necesite solicitarlo o activar un plan de pago[[8]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/popup/App.tsx#L116-L124).
2. **Iniciar LIA
   en modo “Live” durante la reunión:** Abra la
   extensión LIA y autentíquese si es necesario. Cuando esté en la
   videoconferencia, active la _Conversación en vivo_ (hay un botón o
   toggle en la UI de LIA). La extensión iniciará la conexión WebSocket y le
   indicará _“Conversación en vivo activada... Ahora puedes hablar conmigo
   en tiempo real.”_[[17]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/popup/App.tsx#L98-L105). Esto significa que el asistente está **escuchando** vía
   micrófono y listo para responder con voz.
3. **Capturar el
   audio de todos los interlocutores:** Hable
   normalmente y permita que LIA escuche sus preguntas. Para captar a otros,
   considere activar altavoces o usar un método de captura de audio de la
   llamada (como se discutió arriba). Si está usando solo el micrófono,
   repita las preguntas de otros para que LIA las oiga, o utilice los
   subtítulos como entrada de texto para LIA (como si fueran preguntas
   escritas). _Este paso puede requerir ajustes técnicos adicionales si
   desea automatismo completo._
4. **Transcripción
   en vivo (opcional/modo pasivo):** Si desea una
   transcripción continua, puede configurar LIA para que _no responda
   automáticamente_ a menos que se le llame. Por ejemplo, podría dejar la
   conexión Live abierta pero con LIA "silenciada" salvo que
   escuche su nombre clave. Otra opción es grabar la reunión por otro medio y
   luego transcribirla con LIA posteriormente usando el prompt de
   transcripción[[10]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/prompts/utils.ts#L14-L22). En cualquier caso, trate de obtener un registro escrito de todo
   lo dicho.
5. **Interacción
   de la IA con voz:** Cuando alguien haga una
   pregunta directa al asistente (por ejemplo, _"LIA, ¿qué opinas de
   X?"_ ), active el micrófono de LIA (en la extensión) para esa
   pregunta. LIA enviará el audio al modelo y en unos instantes emitirá una
   respuesta hablada. Los demás escucharán la voz de LIA a través de sus
   altavoces/compartición de audio. Observe en la extensión el texto de la
   respuesta también, por claridad. (El texto aparece en la ventana de LIA
   gracias a onTextResponse antes/después de la
   locución[[6]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L291-L300)).
6. **Soporte de
   idioma durante la reunión:** Según el idioma en que
   le hablen, LIA responderá. Si ajustó la configuración multilingüe, esto
   ocurrirá de forma natural. Verifique que LIA entiende correctamente; de
   ser necesario, puede indicarle _"responde en inglés"_ si
   detecta que respondió en otro idioma por error. Para portugués, pruebe
   algunos ejemplos. Si la voz suena poco natural en un idioma (e.g. acento
   extraño), considere cambiar la voz en la configuración (punto que
   requerirá modificar el código voiceName en el mensaje de setup).
7. **Generar
   resumen y PDF al final:** Concluida la reunión,
   compile toda la transcripción acumulada. Abra LIA y solicítele un resumen:
   por ejemplo, _"Resúmeme la conversación de la reunión"_ y
   pegue el texto (si es muy extenso, quizás divídalo o use la plantilla de _resumen
   ejecutivo_ para priorizar puntos clave[[14]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/prompts/utils.ts#L48-L56)). LIA (usando Gemini) generará un texto resumen. Revíselo y luego
   guárdelo. Si tiene integrada la función para PDF, usela; sino, copie el
   resumen a un documento y expórtelo. Tendrá así un PDF con el resumen de la
   reunión, complementado con la transcripción si lo desea.

**Conclusión:** En esencia, la extensión LIA ya
provee la infraestructura para un **asistente de IA conversacional con voz**
usando la API en vivo de Google. Aprovechando esas capacidades –y ajustando la
forma en que se captura el audio de la reunión– es posible lograr que LIA _escuche_
todo lo que se habla, lo transcriba, y esté lista para _responder en voz alta_
cuando se le consulta, todo ello en español, inglés o portugués según
corresponda. La clave está en la correcta configuración de la API y en adaptar
los prompts/voz para el caso de uso de reuniones. Con estos pasos y referencias
del repositorio, se puede implementar un asistente virtual que actúe casi como
un participante más de sus videoconferencias: tomando notas por usted y
aportando respuestas inteligentes en vivo. ¡Una poderosa herramienta de
productividad![[3]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L151-L159)[[6]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L291-L300)

**Fuentes:** Se han utilizado fragmentos del
código fuente de la extensión LIA y su documentación interna para respaldar
cada punto, incluyendo la configuración del WebSocket de _Live API_[[2]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/config.ts#L20-L23)[[3]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L151-L159), manejo de audio y voz[[5]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L445-L453)[[6]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L291-L300), y plantillas de prompts para transcripción y resumen[[10]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/prompts/utils.ts#L14-L22)[[14]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/prompts/utils.ts#L48-L56), entre otros. Todas las referencias provienen del repositorio fernandosuarez-04/Lia-Extension.

---

[[1]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/gemini3.md#L2-L5)
[[7]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/gemini3.md#L8-L15)
gemini3.md

[https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/gemini3.md](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/gemini3.md)

[[2]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/config.ts#L20-L23)
config.ts

[https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/config.ts](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/config.ts)

[[3]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L151-L159)
[[4]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L159-L163)
[[5]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L445-L453)
[[6]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L291-L300)
[[9]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L548-L557)
[[11]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L419-L428)
[[12]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L299-L305)
[[13]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts#L152-L160)
live-api.ts

[https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/services/live-api.ts)

[[8]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/popup/App.tsx#L116-L124)
[[15]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/popup/App.tsx#L60-L68)
[[16]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/popup/App.tsx#L82-L90)
[[17]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/popup/App.tsx#L98-L105)
App.tsx

[https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/popup/App.tsx](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/popup/App.tsx)

[[10]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/prompts/utils.ts#L14-L22)
[[14]](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/prompts/utils.ts#L48-L56)
utils.ts

[https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/prompts/utils.ts](https://github.com/fernandosuarez-04/Lia-Extension/blob/46785b02e3c5878b5f39121c5c97c6572f5f5be9/src/prompts/utils.ts)
