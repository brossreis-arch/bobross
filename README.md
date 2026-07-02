# REIS · Messaging Module

A self-contained, single-file messaging / feedback UI — the first slice of a
REIS-style client portal. No build step, no server, no dependencies: open
`messaging.html` in any modern browser and it works.

---

## Quick start

1. Open `messaging.html` in a browser (double-click, or drag it into a tab).
2. Type a message and press **Enter** to send.

That's it. Messages are stored locally in your browser and reappear on reload.

To host it, drop `messaging.html` on any static host (GitHub Pages, S3,
Netlify, or a plain file server) — it's one file.

---

## Features

- **Send** — Enter to send, Shift+Enter for a new line. Empty / whitespace-only
  messages are blocked; the textarea auto-grows as you type.
- **Persistence** — messages are saved to `localStorage` and survive reloads.
- **Edit** — edit your own messages inline; edited messages show a subtle
  `· edited` marker with an "edited at" tooltip.
- **Delete** — remove a message (with confirmation). Replies to a deleted
  message keep their context and display *"In reply to a deleted message."*
- **Reply threading** — reply to any message; a quoted reference appears above
  the reply and a "Replying to …" banner appears above the composer.
- **Export / Import** — export the whole conversation to JSON; import replaces
  the current conversation (after confirmation). Imported data is validated the
  same way stored data is, so a malformed file can't corrupt your state.
- **Theming** — automatic light / dark via `prefers-color-scheme`.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Enter` | Send message |
| `Shift` + `Enter` | Insert a new line |
| `Tab` / `Shift+Tab` | Move between controls (fully keyboard-operable) |

---

## Data & security

- **All data stays in your browser.** Nothing is sent anywhere — there is no
  network code and no backend. Messages live in `localStorage` under the key
  `reis.messages.v1`.
- **XSS-safe by construction.** All user content is rendered with `textContent`
  only — never `innerHTML`. Pasting markup such as
  `<img src=x onerror=alert(1)>` renders as literal text and never executes.
  This is enforced structurally: a single render layer is the only code that
  writes message content to the DOM.
- **Corruption-safe loading.** If stored data is unreadable, the app starts
  clean and warns you rather than silently wiping data.
- **No auth in this slice.** It assumes a single local user. Multi-user auth
  belongs to a later portal slice with a real backend (see below).

---

## Architecture

One file, four layers (a single IIFE — nothing leaks to global scope):

| Layer | Responsibility |
| --- | --- |
| **Store** | The only code that touches persistence. `load` / `save` / `importJSON`, with shared validation so on-disk and imported data are treated identically. |
| **Model** | Pure functions — create / edit / delete / validate. No DOM, no storage; returns new arrays rather than mutating. |
| **Render** | The only code that writes to the message log. `textContent`-only for user data (the XSS chokepoint). |
| **Controller** | Wires events → Model → Store → Render. |

The log is fully re-rendered on each change, which eliminates an entire class of
state-vs-DOM desync bugs at portal-message scale.

### Swapping in a real backend

`Store` is the seam. To move from `localStorage` to a server or a service like
Supabase, reimplement `Store.load` / `Store.save` (and add whatever fetch logic
you need) — the Model, Render, and Controller layers don't change. `Message`
records already carry a `schemaVersion` for forward-compatible migrations.

---

## Testing

An end-to-end harness runs the app in a real (headless) browser and asserts
behavior — no test framework to install beyond Playwright.

```bash
node tests/messaging.test.mjs
```

25 assertions cover send, reload persistence, XSS inertness, keyboard flow,
edit, delete + orphaned-reply handling, import validation, export, and
accessibility structure. The runner exits non-zero on any failure (CI-friendly).

> Requires Playwright + a Chromium build available to it. Point the harness at a
> specific Chromium via the `PW_CHROMIUM` environment variable if needed.

---

## Future extensions

- **Real-time, multi-user backend** (Supabase / WebSocket) via the `Store` seam.
- **Authentication & identity** so messages carry real authors, not just "You".
- **Attachments** (images, files) with the same safe-render discipline.
- **Search / filter** across the conversation.
- **Read receipts & typing indicators** once a backend exists.
- **Portal shell** around this module: project status timeline and deliverable
  approvals (the next slices of the client portal).

---

## Project layout

```
.
├── messaging.html            # The app — open this
├── tests/
│   └── messaging.test.mjs    # End-to-end test harness
└── README.md
```
