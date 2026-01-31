# Lia Extension - Project Documentation

## Overview

Lia Extension is a Chrome extension that serves as an AI-powered productivity assistant. It integrates with Google's Gemini models to provide:

- **Real-time chat** with AI using text and voice
- **Meeting transcription** for Google Meet with speaker detection
- **Web browsing assistance** with page content analysis
- **Image generation** and analysis
- **Maps integration** with location-based queries

## Tech Stack

- **Frontend**: React 18 + TypeScript
- **Build**: Vite
- **Backend**: Supabase (Auth, Database, Storage)
- **AI**: Google Gemini API (2.5/3.0 models)
- **Manifest**: Chrome Extension Manifest V3

## Project Structure

```
src/
├── popup/                    # Main extension popup UI
│   ├── App.tsx              # Main application component
│   ├── SettingsModal.tsx    # User settings
│   └── FeedbackModal.tsx    # Feedback collection
├── components/
│   ├── MeetingPanel.tsx     # Meeting transcription UI
│   ├── MapViewer.tsx        # Google Maps integration
│   └── Auth.tsx             # Authentication component
├── services/
│   ├── gemini.ts            # Core Gemini API service
│   ├── live-api.ts          # Live API WebSocket for voice
│   ├── meeting-manager.ts   # Meeting session orchestration
│   ├── gemini-transcription.ts  # Audio transcription service
│   ├── meet-speaker-detector.ts # Google Meet DOM scraping
│   ├── mixed-audio-capture.ts   # Tab audio capture
│   ├── meeting-storage.ts   # Supabase meeting data
│   └── pdf-export.ts        # PDF generation
├── content/
│   └── index.ts             # Content script for page interaction
├── background/
│   └── index.ts             # Service worker
├── contexts/
│   └── AuthContext.tsx      # Authentication state
├── lib/
│   └── supabase.ts          # Supabase client
├── prompts/
│   └── utils.ts             # System prompts
└── config.ts                # API keys and model config
```

## Key Features

### 1. Meeting Agent (Google Meet)

The meeting agent provides real-time transcription and AI assistance during video calls.

**Flow:**
```
1. User opens Google Meet
2. Extension detects meeting via content script
3. User clicks "Agente de Reuniones"
4. Audio captured via getDisplayMedia (tab selection)
5. Audio sent to Gemini 2.5 Native Audio for transcription
6. Text cleaned up by Gemini 2.5 Flash
7. Speaker detected via DOM scraping
8. Transcription displayed with speaker names
9. User can invoke Lia for questions (voice response)
```

**Key Files:**
- `meeting-manager.ts` - Central orchestration
- `gemini-transcription.ts` - Audio-to-text
- `meet-speaker-detector.ts` - Speaker identification
- `MeetingPanel.tsx` - UI component

**Speaker Detection:**
```typescript
// Scrapes Google Meet DOM for:
// - Participant names from video tiles
// - Active speaker indicator (blue border)
// - data-is-speaking attribute
// - Speaking animation classes
```

### 2. Live Voice Chat

Real-time voice conversation with Lia using WebSocket connection.

**Flow:**
```
1. User clicks microphone button
2. WebSocket connects to Gemini Live API
3. Audio captured from user microphone
4. PCM audio (16kHz) sent via WebSocket
5. Lia responds with text + audio
6. Audio played back via AudioContext
```

### 3. Web Agent

Automated web interactions via content script.

**Capabilities:**
- Click elements
- Type text
- Scroll pages
- Extract page content
- Execute searches

### 4. Maps Integration

Location-aware queries using Google Maps grounding.

**Features:**
- Current location detection
- Place search
- Route planning
- Map visualization

## Configuration

### Environment Variables (.env)

```env
VITE_GOOGLE_API_KEY=your_google_api_key
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_key
```

### Model Configuration (config.ts)

```typescript
export const MODELS = {
  PRIMARY: "gemini-3-flash-preview",      // Main chat model
  FALLBACK: "gemini-2.5-flash",           // Stable fallback
  LIVE: "gemini-2.5-flash-native-audio-latest", // Voice/Audio
  IMAGE_GENERATION: "gemini-2.5-flash-image",
  MAPS: "gemini-2.5-flash",               // Maps grounding
  PRO: "gemini-3-pro-preview",            // Complex reasoning
};
```

## Meeting Transcription Architecture

### Audio Capture

```typescript
// Uses getDisplayMedia for tab audio capture
navigator.mediaDevices.getDisplayMedia({
  video: true,  // Required but not used
  audio: {
    channelCount: 1,
    sampleRate: 16000,
  }
});
```

### Transcription Pipeline

```
Tab Audio (PCM 16kHz)
       ↓
GeminiTranscriptionService
       ↓
Gemini 2.5 Native Audio (raw transcription)
       ↓
Gemini 2.5 Flash (text cleanup + speaker labels)
       ↓
MeetingManager (adds DOM-detected speaker)
       ↓
MeetingPanel UI
```

### Speaker Detection (meet-speaker-detector.ts)

```typescript
// Detection methods:
1. data-is-speaking="true" attribute
2. Blue border color (rgb(26, 115, 232))
3. CSS classes containing "speaking"
4. Animation styles on participant tiles
```

## Lia Voice Response

When Lia is invoked during a meeting:

```typescript
// MeetingManager.invokeLia()
1. Mode changes to 'interactive'
2. Audio sent to Live API WebSocket
3. Lia processes and generates response
4. Response includes text + PCM audio
5. Audio played via AudioContext (24kHz)
6. Mode returns to 'transcription'
```

## Database Schema (Supabase)

### conversations
- id, user_id, title, messages, created_at, updated_at, folder_id

### meeting_sessions
- id, user_id, platform, title, start_time, end_time
- participants, detected_language, metadata
- summary, action_items

### meeting_transcripts
- id, session_id, speaker, text, timestamp
- relative_time_ms, is_lia_response, is_lia_invocation

## Development

### Build Commands

```bash
npm run build    # Production build
npm run dev      # Development with watch
```

### Loading Extension

1. Build the project
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `dist` folder

### Testing Meeting Agent

1. Open Google Meet and join a meeting
2. Click Lia extension icon
3. Click "Agente de Reuniones"
4. Select the meeting tab when prompted
5. Speak to test transcription
6. Click "Invocar a Lia" to test voice response

## Known Limitations

1. **Speaker Detection**: DOM selectors may break with Google Meet UI updates
2. **Audio Latency**: ~10 second buffer for transcription quality
3. **Live API Session**: 15-minute timeout requires reconnection
4. **Tab Audio**: Only captures tab audio, not user microphone in meetings

## Troubleshooting

### "Live API not connected"
- Check VITE_GOOGLE_API_KEY is valid
- Check network/firewall settings
- Try reconnecting

### Transcription not appearing
- Ensure tab audio is being captured (check console logs)
- Verify audio level is sufficient
- Wait for 10-second buffer to fill

### Speaker shows as "Participante"
- DOM selectors may need updating
- Check if participant tiles have data-participant-id
- Verify speaker detection is starting (check console)

## API Reference

### MeetingManager

```typescript
// Start a meeting session
await meetingManager.startSession(tabId, platform, userId, title, url);

// Invoke Lia for voice response
await meetingManager.invokeLia(prompt?);

// End session and generate summary
await meetingManager.endSession(generateSummary);

// Get current status
meetingManager.getStatus(); // 'idle' | 'connecting' | 'transcribing' | 'lia_responding'
```

### GeminiTranscriptionService

```typescript
// Initialize
const transcription = new GeminiTranscriptionService(apiKey, { language: 'español' });

// Start listening
transcription.start(onTranscription, onError);

// Add audio data
transcription.addAudioData(base64PCM);

// Stop
transcription.stop();
```

### MeetSpeakerDetector

```typescript
// Initialize and start
const detector = new MeetSpeakerDetector();
detector.start({
  onSpeakerChange: (event) => console.log(event.currentSpeaker),
  onParticipantsUpdate: (participants) => console.log(participants)
});

// Get current speaker
detector.getCurrentSpeaker();

// Stop
detector.stop();
```
