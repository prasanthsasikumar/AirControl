# AirControl Desktop App

Native macOS/Windows desktop application for controlling presentations with hand gestures.

## Features

- 🖐️ **Control ANY app**: PowerPoint, Keynote, Google Slides, PDFs, etc.
- 🔑 **System-wide keyboard**: Sends LEFT/RIGHT arrow keys to active application
- 📱 **QR code UI**: Scan with phone to connect instantly
- 🔄 **Hand swapping**: Switch left/right hand actions
- 🌐 **Self-contained**: No need to keep Chrome extension tabs open

## Requirements

- macOS 10.13+ or Windows 10+
- Node.js 16+ (for development)
- Phone with camera (for hand tracking via `/read` page)

## Installation

```bash
cd desktop-app
npm install
```

## Running in Development

```bash
npm start
```

This opens the AirControl window with:
- Auto-generated room code
- QR code to scan with your phone
- Start/Stop controls
- Settings (server URL, hand swap)

## Building for Distribution

### Build for Mac (.dmg)
```bash
npm run build:mac
```
Output: `dist/AirControl-1.0.0.dmg`

### Build for Windows (.exe)
```bash
npm run build:win
```
Output: `dist/AirControl Setup 1.0.0.exe`

### Build for All Platforms
```bash
npm run build:all
```

## How to Use

1. **Launch the app**
   - Run `npm start` or open the built `.dmg`/`.exe`

2. **Click "Start Listening"**
   - App creates a room and shows QR code

3. **Scan QR code with your phone**
   - Opens `/read` page with MediaPipe hand tracking
   - Status changes to "Connected ✓"

4. **Open your presentation**
   - PowerPoint, Keynote, Google Slides, any app
   - Make sure it's in **slideshow/presentation mode**

5. **Control with hand gestures**
   - **Right hand tap** → Next slide
   - **Left hand tap** → Previous slide
   - Tap = pinch (thumb + index finger) then release

## Permissions

### macOS
On first run, macOS will ask for **Accessibility permissions**:

1. System Preferences → Security & Privacy → Privacy → Accessibility
2. Click the lock to make changes
3. Add `AirControl.app` or `Electron.app` (if dev mode)
4. Enable the checkbox

This allows the app to send keyboard events system-wide.

### Windows
No special permissions needed - keyboard simulation works out of the box.

## Settings

- **Server URL**: Default is `https://aircontrol.flowsxr.com` (can use `http://localhost:3000` for local dev)
- **Swap hands**: Toggle to switch left/right hand actions

## Troubleshooting

**"App can't be opened" (macOS)**
- Right-click app → Open → confirm

**Keyboard not working**
- Check Accessibility permissions (macOS)
- Make sure presentation is in **slideshow mode** (not edit mode)
- Try clicking into the presentation window first

**Connection fails**
- Check server URL in settings
- Verify phone and computer on same network (if using localhost)
- Check firewall settings

## Architecture

```
┌─────────────┐     Socket.IO      ┌──────────────┐
│   Phone     │ ─────hand data────→ │  Desktop App │
│  /read page │                     │   (Electron) │
└─────────────┘                     └──────┬───────┘
                                           │
                                    System Keyboard
                                           │
                                           ↓
                                    ┌──────────────┐
                                    │ Presentation │
                                    │  (any app)   │
                                    └──────────────┘
```

- **Electron**: Cross-platform desktop framework
- **Socket.IO**: Real-time hand data from phone
- **@nut-tree/nut-js**: System-level keyboard simulation
- Same gesture detection as Chrome extension

## Differences vs Chrome Extension

| Feature | Chrome Extension | Desktop App |
|---------|-----------------|-------------|
| Target | Web-based slides only | **Any application** |
| Platform | Chrome browser | Native macOS/Windows |
| Setup | Install from Chrome Store | Download + install |
| Keyboard | DOM events only | **System-wide keys** |
| Works with | Google Slides, PowerPoint Online | **PowerPoint, Keynote, PDFs, etc.** |

## License

MIT
