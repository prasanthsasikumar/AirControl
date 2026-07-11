# AirControl for Meta Ray-Ban Display — Presenter v1 Design

**Date:** 2026-07-11
**Status:** Approved design, ready for implementation planning
**Author:** Prasanth Sasikumar (with Claude)

## Goal

Extend AirControl so a presenter wearing **Meta Ray-Ban Display** glasses can:

1. **Advance / reverse slides hands-free** using Neural Band gestures (no phone, no clicker).
2. See a **private teleprompter** in the glasses HUD — current slide number, an elapsed timer, and that slide's speaker notes — visible only to the presenter, never to the audience.

This is the first concrete step toward the README goal of "Meta Ray-Ban glasses support," and it strictly extends the existing presentation use case rather than replacing it.

## Non-goals (deliberately deferred)

- Camera / POV capture / OCR (Ray-Ban Display **web apps have no camera access** — would require the native mobile SDK path).
- Voice commands / dictation / live captions (no microphone in web apps).
- General system-wide desktop control (arrows/scroll/media in any app).
- Presentation platforms other than **Google Slides** (PowerPoint Online, Canva, PDF).
- Multi-device targets beyond Ray-Ban Display. The design keeps the relay seam generic so other glasses can be added later, but only Ray-Ban Display is built now.

## Platform facts this design relies on

Meta opened the Ray-Ban Display to third-party developers (2026) via the **Wearables Device Access Toolkit**. We use the **standalone Web App path**:

- **HUD render**: a **600×600px** dark/high-contrast web view (HTML/CSS/JS) shown in the presenter's eye.
- **Input**: Neural Band swipes (up/down/left/right) + index **pinch/tap**, delivered to the web app as **arrow-key / enter (D-pad)** events.
- **Also available**: IMU (accel/gyro/compass), phone GPS, local storage.
- **Networking**: `fetch` and **WebSocket** to an external, publicly-reachable **HTTPS** server are allowed. This is the key enabler that lets the glasses app reach the existing relay.
- **Not available in web apps**: camera and microphone (privacy restriction).
- **Tooling**: an official Claude Code plugin / skills toolkit (`facebookincubator/meta-wearables-webapp`) scaffolds these apps (D-pad nav, sensors, `connect-api`). Apps are installed by adding a public HTTPS **URL** in the Meta AI phone app (App Connections → Web Apps).

Sources: <https://developers.meta.com/blog/build-for-display-glasses/>, <https://wearables.developer.meta.com/docs/develop/webapps/>, <https://github.com/facebookincubator/meta-wearables-webapp>.

**Implication:** the Neural Band replaces the phone camera + MediaPipe hand-tracking entirely — it already emits clean discrete gestures, so no hand tracking runs on the glasses.

## Architecture

Reuse the existing Socket.IO relay (`server.js`) unchanged in spirit. The glasses web app is a new capture + display surface in place of the phone; the Chrome extension gains a notes-out channel.

```
┌─────────────────────┐   intent{next/prev}    ┌───────────┐   intent    ┌──────────────────┐
│  Glasses Web App     │ ─────────────────────▶ │  Relay     │ ──────────▶ │ Chrome extension │
│  (Ray-Ban Display)   │                        │ server.js  │             │  (Google Slides) │
│  • Neural Band → intent                        │  (rooms,   │             │  • ArrowRight/Left│
│  • 600×600 HUD:      │ ◀───────────────────── │ WebSocket) │ ◀────────── │  • scrape notes + │
│    slide#, timer,    │   hud{index,total,notes}└───────────┘   hud        │    slide index   │
│    speaker notes     │                                                     └──────────────────┘
```

Two new room-scoped, bidirectional message types are added to the relay alongside the existing `hand` / `msg` handlers:

- `intent` — glasses → room. Payload: `{ action: 'next' | 'prev' }`.
- `hud` — extension → room. Payload: `{ index: number, total: number, notes: string, startedAt?: number }`.

## Components

Each component has one clear responsibility, a defined interface, and can be tested independently.

### 1. `glasses-app/` (new) — the Ray-Ban Display web app

- **Responsibility:** read Neural Band input, emit `intent`; render incoming `hud` state in the 600×600 HUD.
- **Served from:** the existing server (new route, e.g. `GET /glasses` → `public/glasses.html`), which is already deployed over HTTPS. No new hosting.
- **Files:**
  - `index.html` (or `public/glasses.html`) — dark 600×600 HUD: large slide number, elapsed timer, scrollable speaker-notes region, connection-status dot. Uses `.focusable` D-pad conventions from Meta's toolkit.
  - `glassesClient.js` — WebSocket client: joins a room, maps Neural Band input → `intent` emits, renders `hud` payloads, manages reconnect and pairing state.
- **Depends on:** the relay's WebSocket interface; Meta web-app skills (D-pad, `connect-api`); `localStorage` for room persistence.

### 2. `server.js` (existing) — relay

- **Responsibility:** unchanged — relay room-scoped messages. Add `intent` and `hud` handlers (~10 lines) mirroring the existing `msg` relay. No room-model changes.
- **Interface:** Socket.IO events `create-room`, `join-room`, `intent`, `hud` (plus existing `hand`/`msg`).

### 3. Chrome extension (existing, extended)

- **`background.js`** — on `intent` → reuse existing next/prev dispatch to the content script; forward `hud` payloads from the content script into the room.
- **`content.js`** — **new notes module** (isolated file/section): read current slide index, total, and the current slide's speaker notes from Google Slides, emit `hud` whenever they change. Existing keyboard-dispatch code is untouched.

## Data flow

**Control (glasses → PC):**
- Neural Band pinch/tap → `intent{action:'next'}` → relay → extension → `ArrowRight` → slide advances.
- Neural Band swipe-left → `intent{action:'prev'}` → `ArrowLeft`.

**Notes sync (PC → glasses):**
- The extension reads the **ground-truth current slide index from the Slides DOM** — it does **not** count its own keypresses (that drifts if the presenter clicks with the mouse or the deck auto-advances).
- On index change, it scrapes that slide's notes and emits `hud{index,total,notes}` → relay → HUD re-renders.

## Gesture mapping (default; retunable like today's `config.js`)

| Neural Band input | Action |
|---|---|
| Index **pinch / tap** | Next slide |
| Swipe **left** | Previous slide |
| Swipe **up / down** | Scroll notes when they overflow the HUD |

Swipe-right is reserved (no-op in v1) to avoid accidental double-advance.

## Error handling

- **Relay disconnect** → HUD shows a "disconnected" state; client auto-reconnects (Socket.IO reconnection).
- **Notes not found** for the current slide → HUD gracefully shows slide number + timer only.
- **Slide index drift** → avoided by reading the index from the DOM as ground truth each update.
- **Room not found / not paired** → HUD prompts to (re)enter a room code.

## Testing strategy

Meta's toolkit runs the web app in an **ordinary desktop browser**, with **arrow keys simulating Neural Band** swipes/taps. The whole loop — glasses app ↔ relay ↔ extension ↔ Google Slides — is therefore testable on a single laptop with two browser windows, **no glasses needed** until final on-device validation.

- **Unit:** intent-mapping (input event → `intent`), HUD render (given `hud` payload → DOM), notes-module selectors (given a Slides Presenter-View DOM fixture → correct `{index,total,notes}`).
- **Integration:** simulated Neural Band key → relay → extension → Google Slides advances; slide change → notes appear in the glasses-app HUD.
- **On-device:** final pass on real Ray-Ban Display hardware to confirm the WebSocket client runs in the glasses runtime and gesture latency is acceptable.

## Risks and mitigations

1. **Notes scraping fragility (primary risk).** During a live talk the presenter is in Google Slides fullscreen present mode, whose notes live in a separate **Presenter View** window, not the main editor DOM.
   - *Mitigation:* the content script targets **Presenter View**, which natively renders current-slide notes + current/next slide + slide number — the natural, comparatively stable source. All DOM selectors are isolated in one module so a Slides markup change is a single-file fix. A "loaded notes file" fallback is a known future escape hatch (not built in v1).

2. **WebSocket client in the glasses runtime.** The relay speaks Socket.IO; only `fetch`/WebSocket-to-external-server is confirmed available.
   - *Mitigation:* validate that `socket.io-client` loads and runs in the glasses web app early. If restricted, add a raw-WebSocket endpoint to the relay and use the browser-native `WebSocket` on the glasses side.

3. **Room pairing UX.** Text entry via Neural Band D-pad is awkward.
   - *Mitigation:* persist the last room code in the glasses app `localStorage`; provide a minimal D-pad code-entry screen for first pairing only.

## Open validation items (resolve during implementation, not blockers)

- Confirm Presenter-View DOM exposes notes text and current slide index in a scrapable form, and that a content script can run in that window/tab.
- Confirm `socket.io-client` vs. raw `WebSocket` on the glasses runtime.
- Confirm the existing deployed server can serve the new `/glasses` route over HTTPS for the Meta "add web app by URL" flow.

## Future (post-v1, out of scope now)

- Loaded notes-file fallback + PowerPoint/Canva/PDF support.
- Native mobile SDK path to unlock camera (POV scanning/OCR) and mic (voice/dictation/captions).
- General system-wide desktop remote via the Electron app.
- Device-agnostic glasses support (other display glasses reusing the same relay seam).
