# AirControl Chrome Extension — Gesture Slide Control

Control Google Slides, PowerPoint Online, and Canva presentations using hand gestures from your phone.

## How It Works

```
Phone (/read)  →  AirControl Server  →  Chrome Extension  →  Google Slides
  hand tracking       Socket.IO relay       gesture detection     keyboard events
```

1. **Phone** runs hand tracking via `/read` and streams landmark data to the server.
2. **Chrome Extension** connects to the same room and receives the hand data.
3. Extension detects **pinch + swipe** gestures and dispatches arrow-key events to control slides.

## Gestures

| Gesture | Action |
|---------|--------|
| **Right hand: tap** (pinch then release) | Next slide → |
| **Left hand: tap** (pinch then release) | ← Previous slide |

Each tap triggers **exactly one slide change**. The system enforces a 500ms cooldown between taps to prevent accidental multi-slide jumps.

## Setup

### 1. Start the AirControl server

```bash
cd ..
npm install
npm start
```

### 2. Load the extension in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select this `chrome-extension/` folder

### 3. Connect

1. Open **Google Slides** (or PowerPoint Online) in Chrome and enter presentation mode
2. Open `/show` on your laptop — note the **room code**
3. Open `/read` on your phone — enter the room code
4. Click the **AirControl extension icon** in Chrome toolbar
5. Enter the same **room code** and server URL (`http://localhost:3000`)
6. Click **Start**

The extension indicator will appear in the bottom-right corner of the presentation page.

## Supported Platforms

- **Google Slides** — `docs.google.com/presentation/*`
- **PowerPoint Online** — `officeapps.live.com/*`
- **Canva** — `canva.com/design/*`

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome Extension manifest (Manifest V3) |
| `background.js` | Service worker: WebSocket connection, gesture detection |
| `content.js` | Content script: keyboard dispatch + overlay UI |
| `popup.html` | Extension popup UI |
| `popup.js` | Popup logic |

## Tips

- **Tap** = pinch (bring thumb + index together) then release (separate them).
- **Slow, deliberate taps** work best — no need to rush.
- **Wait 0.5s between taps** to ensure clean gesture detection.
- **Left vs Right hand** is auto-detected from the camera — hold your hand naturally.
- The overlay in the bottom-right shows real-time feedback: ✋ idle, 👈/👉 pinching (shows which hand), → next, ← prev.
- **Presenter mode**: The extension dispatches keyboard events to the correct targets to work in Google Slides presenter view.
