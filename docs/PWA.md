# Install Chibako as an app

Chibako can open in its own window from your home screen or desktop. It still
requires a connection to your Chibako server; offline reading, offline editing,
and queued writes are not supported.

Use your deployment's HTTPS address. Localhost is allowed for development, but
an HTTP LAN address is not sufficient for installation on another device.
Installation uses the same deployment and server-side authentication as the
website. You may need to sign in again when opening the installed app for the
first time.

## Installation

- **Android Chrome:** open **Settings → Install app** in Chibako and select
  **Install Chibako** when available. Otherwise open Chrome's menu and choose
  **Add to Home screen** or **Install app**.
- **iPhone/iPad Safari:** open Chibako in Safari, tap **Share → Add to Home
  Screen**, keep **Open as Web App** enabled if shown, then tap **Add**.
- **Desktop Chrome/Edge:** use **Settings → Install app → Install Chibako**
  when available, the address-bar install icon, or the browser's install menu.

Browser wording varies. A browser can withhold its install prompt, including
after dismissal or when the app is already installed. Chibako shows the button
only when the browser supplies a usable prompt. Its absence is not a reliable
installed-state check. In the app window itself, Settings shows that you are
using the installed app.

The launch URL is `/`, which opens Home when signed in and otherwise follows
the existing login or first-time setup flow. Login and setup remain within the
app's URL scope. Updates use the existing server deployment and reload flow;
installation adds no automatic reload or service worker cache.

## Verification

`npm run test:e2e -- tests/e2e/pwa.spec.ts` uses the existing Playwright setup
with a temporary vault and a separate test build. It verifies public metadata
and icon sizes, authentication redirects, installation UI and event handling,
unsaved Settings preservation, iPhone/iPad instructions, and standalone states.
Browser installation events and Apple-device states are simulated in these
tests; they do not prove native installation works on those devices.

Before releasing, use an HTTPS test deployment with disposable data and check
real installation on Android Chrome, iPhone/iPad Safari, and desktop
Chrome/Edge. On each target:

1. Install, open the app icon, and check the icon and standalone window.
2. Sign in, close and reopen, then sign out and confirm login is required.
3. Open Home, Notes, Calendar, Finance, and Settings. Check scrolling, the
   on-screen keyboard, and controls near the top and bottom screen edges.
4. Edit a disposable Note and verify saving while online. Disconnect and
   confirm the app does not claim unsaved work reached the server; reconnect
   before relying on a save.

Real-device installation and safe-area behavior require this manual check even
when Playwright passes. No production deployment changes are needed for PWA
support beyond serving the existing app over HTTPS.
