# Ray-Ban Display Presenter Web App

A hands-free presenter controller for Google Slides, powered by Meta Ray-Ban smart glasses and the Neural Band.

## Purpose

This web app runs on Meta Ray-Ban Display and lets you advance through a Google Slides deck, hands-free, using Neural Band gestures (pinches and swipes). It also displays a private teleprompter HUD showing:
- Slide number (e.g., "3 / 12")
- Elapsed presentation time
- Speaker notes from the slide (pulled from Google Slides Presenter View)

The glasses app joins a Socket.IO relay that bridges communication with a Chrome extension running on your laptop, which drives the actual slide deck and extracts the notes.

## Architecture

```
Neural Band (gestures)
    ↓
Glasses App (this web app)
    ├→ emits `intent` to relay room
    └← receives `hud` from relay room
    ↓
Socket.IO Relay (server)
    ↓
Chrome Extension (laptop)
    ├← receives `intent` & drives Google Slides
    └→ emits `hud` (slide state + notes) back to relay
```

### Message Contracts

**`intent` — Glasses → Relay Room**
```json
{ "action": "next" | "prev" }
```
Emitted when a Neural Band gesture triggers a slide navigation.

**`hud` — Chrome Extension → Relay Room**
```json
{
  "index": 0,
  "total": 12,
  "notes": "Remember to emphasize the key insight here",
  "startedAt": 1720706400000
}
```
- `index`: 0-based slide index (displayed as "1-based" to the user)
- `total`: Total number of slides
- `notes`: Speaker notes for the current slide (or empty)
- `startedAt`: Unix epoch (milliseconds) when the presentation started

## Gesture Mapping

These mappings apply while **presenting** (the HUD screen). The **pairing screen** interprets the same gestures differently — see [Installation](#installation-on-ray-ban-display) step 3 (left/right change a character, up/down move the cursor, pinch confirms).

| Gesture | Keyboard Event | Action |
|---------|---|---|
| **Pinch / Tap** | `Enter` | Next slide |
| **Swipe Right** | `ArrowRight` | Next slide |
| **Swipe Left** | `ArrowLeft` | Previous slide |
| **Swipe Up** | `ArrowUp` | Scroll notes up |
| **Swipe Down** | `ArrowDown` | Scroll notes down |

> **Note:** Neural Band gestures are delivered to the glasses web app as keyboard events by the Meta AI phone app.

## Installation on Ray-Ban Display

1. **Deploy the server:** Make sure `https://<host>/glasses` is reachable (the relay server must be deployed with a public HTTPS endpoint).

2. **Add as a Web App in Meta AI app:**
   - On your phone, open the **Meta AI** app
   - Tap **App Connections** (or similar menu)
   - Select **Web Apps**
   - Tap **+ Add** and enter `https://<host>/glasses`

3. **Pair with the Chrome extension:**
   - On your laptop, open Google Slides in Presenter View and start the Chrome extension
   - The extension displays a **room code** (6 characters, e.g., `ABCXYZ`)
   - On the Ray-Ban Display pairing screen:
     - Swipe **left/right** to change each character digit-by-digit
     - Swipe **up/down** to move the cursor to the next character
     - **Pinch** to confirm once all characters match
   - The glasses app will connect and show the HUD
   - The **last room code** is saved in browser local storage (`aircontrol.room`) for next time

4. **Ready to present:** The HUD displays your current slide, timer, and notes. Use Neural Band gestures to advance.

## Development & Testing

The glasses app runs in any modern browser. Neural Band gestures are simulated with keyboard shortcuts:

```bash
# Start the relay server
node server.js

# Open the glasses app in your browser
# http://localhost:3000/glasses?room=<ROOM_CODE>

# Focus the browser tab and press keys to simulate gestures:
# Enter, ArrowRight   → next slide
# ArrowLeft           → previous slide
# ArrowUp, ArrowDown  → scroll notes
```

### Quick Test

1. Start the server: `node server.js`
2. Open the Chrome extension on `http://localhost:3000/show?room=ABCXYZ`
3. Open the glasses app: `http://localhost:3000/glasses?room=ABCXYZ`
4. Focus the glasses tab, press `Enter` to connect
5. Verify the HUD displays the current slide state (or "connecting…" if the extension hasn't started)
6. Press arrow keys to simulate Neural Band gestures

## Display Constraints

- **Resolution:** 600×600 pixels (Ray-Ban Display native)
- **Theme:** Dark mode (black background with white text)
- **Font:** System UI, sans-serif
- **Readable at a glance:** Large, high-contrast typography for legibility during a live presentation

## Architecture Details

The glasses app uses a lightweight Socket.IO client (`miniSocket.js`) with no external dependencies at runtime. It:
1. Renders a **pairing screen** if no room code is provided (via URL or local storage)
2. Joins the relay room on confirmation
3. Listens for `hud` messages and renders them to the HUD display
4. Emits `intent` messages when Neural Band gestures are detected
5. Shows a disconnected state on drop; reload the page to reconnect (no auto-reconnect in v1)

The HUD view (`hudView.js`) formats the relay state into human-readable strings (e.g., elapsed time, 1-based slide labels).

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Room code not found | Extension isn't running or room code mismatch | Double-check the code on the extension; restart the extension |
| HUD shows "presenter left" | Extension crashed or closed | Restart the extension and re-pair |
| No notes appear | Slide has no notes in Google Slides | Add notes in Presenter View on the laptop |
| Gestures not responding | Glasses web app not connected or focused | Tap the HUD to refocus; check browser console for errors |
| HUD stuck on "disconnected" | Relay connection dropped | Reload the `/glasses` page to reconnect |

## See Also

- [AirControl main README](../../README.md)
- Chrome Extension documentation (in the main repo)
- Ray-Ban Display & Neural Band API: [Meta Developer docs](https://developers.meta.com)
