# LeetCode Hints

A Chrome extension that gives you **step-wise, progressive hints** for LeetCode problems — without spoiling the solution.

Instead of jumping straight to the answer, LeetCode Hints nudges you through the thought process: from a vague conceptual push, to the right approach, to a concrete strategy, and finally a code snippet if you need it.

---

## Features

- **Step-wise progressive hints** — each click reveals the next level of help:
  1. **Nudge** — a gentle conceptual push
  2. **Approach** — the right technique/data structure
  3. **Strategy** — specific implementation guidance
  4. **Code Hint** — a Python code snippet with copy-to-clipboard
- **Hint history** — all previous hints stay visible as numbered cards
- **"Show Code" shortcut** — jump straight to the code snippet when you're stuck
- **Auto-detects problems** — scrapes the title, difficulty, and description from the page
- **SPA-aware** — automatically refreshes when you navigate to a different problem
- **Draggable overlay** — float the panel anywhere on the screen
- **Translucent glassmorphism UI** — clean, professional black & white design that blends with the page
- **Shadow DOM isolation** — styles never conflict with LeetCode's UI
- **Vercel Serverless Backend** — calls Gemini 2.5 Flash for high-quality hints
- **Upstash Redis Caching** — caches hint responses to optimize performance and reduce API costs

## Installation

1. Clone or download this repository:
   ```bash
   git clone https://github.com/Sushanthimself/leetcodehints.git
   ```
2. Open **`chrome://extensions`** in Chrome
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `leetcodehints` folder

The extension icon will appear in your toolbar.

## Usage

1. Navigate to any LeetCode problem page (e.g. [Two Sum](https://leetcode.com/problems/two-sum/))
2. **Click the extension icon** in the toolbar — a translucent overlay appears
3. Click **"Next Hint"** to reveal hints one at a time
4. Click **"Show Code"** to jump directly to the code snippet
5. **Drag** the panel by its header to reposition it
6. Click the **✕** button or the extension icon again to close

The overlay **automatically resets** when you navigate to a different problem.

## Project Structure

```
leetcodehints/
├── api/
│   └── hint.js        # Vercel Serverless Function (Gemini + Redis)
├── manifest.json      # Chrome Extension Manifest V3
├── background.js      # Service worker — toggles overlay on icon click
├── content.js         # Content script — DOM scraping, API requests, overlay UI
├── content.css        # Overlay styles (loaded into Shadow DOM)
├── vercel.json        # Vercel routing configuration
├── .env.example       # Example environment variables template
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## How It Works

┌──────────────────┐   click icon   ┌──────────────────┐   message    ┌──────────────────┐
│   Chrome Action  │ ─────────────▶ │  background.js   │ ──────────▶ │   content.js     │
│   (toolbar icon) │                │  (service worker) │             │  (in-page script) │
└──────────────────┘                └──────────────────┘             └──────┬───────────┘
                                                                            │
                                                               ┌────────────┴────────────┐
                                                               │                         │
                                                           Scrapes DOM            Injects overlay
                                                           (title, desc,          (Shadow DOM with
                                                            difficulty)            glassmorphism UI)
                                                               │                         │
                                                               └────────┬────────────────┘
                                                                        │
                                                                  Makes POST request
                                                                        │
                                                                        ▼
                                                               ┌──────────────────┐
                                                               │  Vercel Backend  │
                                                               │   (/api/hint)    │
                                                               └────────┬─────────┘
                                                                        │
                                                      ┌─────────────────┴─────────────────┐
                                                      │                                   │
                                            Check Cache (Redis)                   Miss? Call Gemini
                                             [Upstash Redis]                     [Gemini 2.5 Flash]
                                                      │                                   │
                                                      └─────────────────┬─────────────────┘
                                                                        ▼
                                                                 Returns Hint

- **Gemini 2.5 Flash API** — generates tailored step-wise hints dynamically based on the problem title, description, and difficulty.
- **Upstash Redis Caching** — caches hints to ensure near-instant response times for subsequent requests of the same hint levels.
- **Shadow DOM** — the overlay UI is encapsulated so it never leaks styles into or absorbs styles from LeetCode.
- **SPA detection** — intercepts `pushState`/`replaceState` and polls for URL changes to handle LeetCode's client-side navigation.

## Tech Stack

- **Manifest V3** — Chrome's latest extension platform
- **Vanilla JS** — no frameworks, no build step
- **Shadow DOM** — style isolation
- **CSS Glassmorphism** — `backdrop-filter: blur()` with translucent backgrounds

## License

MIT
