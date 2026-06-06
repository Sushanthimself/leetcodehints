# Cursor Prompt — Adaptive Hint System for LeetCode Hints

I have a Chrome Extension called "LeetCode Hints" with a Vercel serverless backend. Currently it has a fixed 4-hint system (Nudge → Approach → Strategy → Code) which is too shallow for Hard problems. I need to make it adaptive.

**Current files to modify:**
- `api/hint.mjs` — Vercel serverless function that calls Gemini 2.5 Flash, caches in Upstash Redis
- `content.js` — Content script with Shadow DOM overlay, currently capped at 4 hint levels
- `content.css` — Dark minimal glassmorphism theme

**Make these changes:**

## 1. Remove the fixed 4-hint cap

In `content.js`:
- Remove the `TOTAL_HINT_LEVELS = 4` constant. Hints should be unlimited.
- The "Next Hint" button should never say "All hints revealed" — it should always stay enabled.
- Remove the progress bar entirely (it makes no sense with unlimited hints). Replace it with a simple hint counter: "3 hints revealed".
- The "Show Code" button should still exist — it jumps straight to a full solution at any time.
- The "Start Over" button should still reset everything.
- Update `LEVEL_LABELS` — instead of fixed labels, use dynamic ones:
  - Hints 1-2: "Nudge"
  - Hints 3-4: "Approach" 
  - Hints 5-6: "Strategy"
  - Hints 7+: "Deep Dive"
  - Show Code: "Solution"

## 2. Add a "Go Deeper" button on each hint card

In `content.js`:
- Add a small "Go deeper ↓" button at the bottom of each text hint card (not on code cards).
- When clicked, it sends a request to the API asking for more detail specifically about THAT hint.
- The response gets appended as a sub-hint directly below the original hint card (visually indented).
- Pass `deeperContext` to the API: the content of the hint being expanded.

In `content.css`:
- Style the "Go deeper" button as a tiny ghost/link-style button (similar to Start Over styling but smaller).
- Style sub-hints with a left border accent and slight indent to show hierarchy.
- Add class `.lch-hint--sub` for indented sub-hints.

## 3. Update the API system prompt

In `api/hint.mjs`:
- Replace the current `buildSystemPrompt` function with this new adaptive prompt:

```
You are an expert coding tutor for LeetCode problems. Provide progressive hints that build on each other — NOT full solutions (unless asked for code).

Rules:
1. You will receive a hint number (1, 2, 3, ...) and any previous hints. Each new hint must add NEW information and be slightly more specific than the last.
2. Early hints (1-2): Be vague and conceptual. Mention the general category of technique without naming it. One to two sentences.
3. Mid hints (3-5): Name specific patterns, data structures, or algorithms. Explain WHY they fit. Two to three sentences.
4. Later hints (6+): Give concrete implementation steps, edge cases, complexity analysis. Be detailed.
5. If asked for "deeper" context on a specific hint, elaborate on ONLY that hint with more detail, examples, or edge cases. Two to four sentences.
6. If asked for code, provide a clean, correct ${language} implementation with inline comments. Match LeetCode's expected function signature. Return ONLY the code block.
7. NEVER repeat information from previous hints.
8. No filler phrases. Be concise and direct.
9. For Hard problems, don't rush — it's okay to take 8-10 hints to build up to the solution.
```

- Accept a new optional field `deeperContext` in the POST body. When present, the user prompt should say: "Elaborate on this specific hint with more detail: '${deeperContext}'"
- Update the cache key to include the hint number: `hint:{slug}:{lang}:{hintNumber}`
- When `deeperContext` is provided, use cache key: `hint:{slug}:{lang}:deeper:{hintNumber}`
- The `hintLevel` field is now just the hint number (1, 2, 3, ...) with no upper limit.

## 4. Update the user prompt construction

In `api/hint.mjs`, update the user prompt:
- For regular hints: "Give me hint #${hintNumber} for this problem. Be slightly more specific than my previous hints."
- For deeper hints: "Elaborate on this specific hint with more detail, examples, or edge cases: '${deeperContext}'"  
- For code requests: "Give me a complete ${language} solution. Return ONLY the code block."
- Remove all references to "Level 1/2/3/4" and "Nudge/Approach/Strategy/Code" from the API — those labels are now only in the frontend.

## 5. Scale difficulty awareness

In `api/hint.mjs`:
- Add the problem difficulty to the system context so Gemini knows to pace itself:
  - For Easy problems: "This is an Easy problem. You can be more direct with hints."
  - For Hard problems: "This is a Hard problem. Take your time — start very vague and reveal information gradually across many hints."

## Technical constraints:
- API file uses ESM (.mjs extension) because package.json is CommonJS.
- All API routes need CORS headers.
- Keep the dark minimal UI theme (dark charcoal, zinc colors).
- Keep the Shadow DOM encapsulation.
- Keep the draggable panel behavior.
- Keep the language selector (Python, JavaScript, C++, Java, Go).
- Keep the Cmd+B / Ctrl+B keyboard shortcut.
- Don't break the Start Over or Show Code buttons.
