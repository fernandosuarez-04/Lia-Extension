# 🔷 Lia-Extension

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg) ![React](https://img.shields.io/badge/React-18.0-61DAFB.svg?logo=react) ![Gemini](https://img.shields.io/badge/AI-Gemini%20Multimodal-8E75B2.svg) ![Live API](https://img.shields.io/badge/Live-Enabled-red.svg)

> **Asistente de Desarrollo & Curaduría Potenciado por IA**
> _Más que un chat: Una IA viva, conectada y contextual._

**Lia-Extension** redefine la asistencia virtual integrando la **Multimodal Live API** de Google y un stack de herramientas de "Grounding" que conectan a la IA con el mundo real (Mapas, Búsquedas y más).

---

## ⚡ Live API & Capacidades en Tiempo Real

Lia no solo lee texto, **escucha y habla** con latencia ultra-baja gracias a la integración WebSocket directa.

### 🔴 Multimodal Live Experience

Interactúa con Lia como si fuera una llamada real.

- **Voz Bidireccional**: Conversación fluida sin esperas de "generando...".
- **Interrupción Natural**: Puedes hablar sobre Lia y ella ajustará su atención, simulando una dinámica humana.
- **Configuración de Voz**: Utiliza la voz predefinida "Aoede" para una personalidad amigable y profesional.

### 🛠️ Herramientas Integradas (Tool Use)

La IA tiene acceso a herramientas reales para resolver dudas complejas:

- **🌍 Google Search Grounding**:
  ¿Preguntas sobre noticias de hoy? Lia consulta la web en tiempo real para darte respuestas actualizadas y verificadas con fuentes.
- **📍 Google Maps Integration (Automático)**:
  Lia detecta automáticamente cuándo necesitas información geográfica y muestra un mapa minimalista (CartoDB Dark) con lugares, direcciones y detalles sin que tengas que activar modos manuales.

- **🖥️ Computer Use (Beta)**:
  Capacidad experimental para interactuar con elementos de la interfaz web, permitiendo a la IA navegar y realizar acciones simples por ti.

---

## ✨ Características Core

### 🧠 Project Context Engine

- **Inyección de Memoria**: Lia analiza tus conversaciones activas en una carpeta para entender el contexto completo de tu proyecto.
- **Continuidad Temática**: Mantiene el hilo de decisiones técnicas tomadas en otros chats vinculados.

### 📂 Espacios de Trabajo & Organización

- **Gestión de Proyectos**: Nueva funcionalidad para organizar chats en carpetas (proyectos).
- **Mover Conversaciones**: Opción integrada para trasladar chats existentes a proyectos específicos, manteniendo tu espacio de trabajo limpio y organizado.

### 🔎 Curaduría "Lesson-Centric"

- **Deep Research Agent**: Un modo dedicado para investigaciones profundas que navega, lee y sintetiza información compleja automáticamente.
- **Validación Activa**: Verificación en segundo plano de todos los recursos generados.

### 🎨 Experiencia de Usuario Refinada

- **Generación "Typewriter"**: Animación de escritura suave tipo máquina de escribir con cursor parpadeante para una lectura más natural.
- **Regeneración de Respuestas**: Capacidad de regenerar respuestas insatisfactorias con un solo clic.
- **Interfaz Minimalista**: Eliminación de modos manuales innecesarios, apostando por la detección de intención automática.
- **Puntuación de Feedback**: Botones de Like/Dislike integrados para mejorar las respuestas futuras.

---

## 🎨 Design System: SOFIA

Implementación estricta del sistema visual **SOFIA**:

- **Estética Glassmorphism**: Paneles translúcidos y degradados sutiles.
- **Paleta Premium**: `Azul #0A2540` y `Aqua #00D4B3`.
- **Mapas Dark Mode**: Integración visual de mapas oscuros para no romper la inmersión de la interfaz.

---

## 🏗️ Arquitectura Técnica

```text
src/
├── services/
│   ├── live-api.ts      # WebSocket Client para Multimodal Live API de Google
│   ├── gemini.ts        # Cliente REST con Tool Use (Maps, Search) y Grounding
│   └── supabase.ts      # Persistencia de datos
├── components/          # UI Kit (SOFIA Design System)
├── prompts/             # System Instructions & Tool Definitions
└── background/          # Service Workers de la extensión
```

---

## 🚀 Guía de Instalación

### 1. Configuración de Entorno

Clona y crea tu archivo `.env`:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_GEMINI_API_KEY=...       # Requiere acceso a modelos Live/Flash 2.5
VITE_LIVE_API_URL=...         # Endpoint WSS de Google (ej. wss://generativelanguage...)
```

### 2. Base de Datos

Ejecuta las migraciones SQL en Supabase:

1.  `supabase_schema.sql`
2.  `create_folders_schema.sql`

### 3. Ejecución

```bash
# Modo Desarrollo Web
npm run dev

# Modo Extensión Chrome
npm run build
# -> Cargar carpeta /dist en chrome://extensions
```

---

## 🔧 Solución de Problemas

- **Error de WebSocket**: Si la Live API no conecta, verifica que tu API Key tenga habilitados los servicios "Generative Language API" en Google Cloud.
- **Mapas no carga**: Asegúrate de que el prompt incluya palabras clave como "donde", "cerca", "ubicación" para activar el trigger de herramientas.

---

_Desarrollado con ❤️ por Fernando Suarez._
