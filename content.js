/**
 * LeetCode Hints — Content Script (v3 — API-backed)
 *
 * Injects a floating, draggable overlay into LeetCode problem pages.
 * Features:
 *   - Step-wise progressive hints via Gemini API (nudge → approach → strategy → code)
 *   - Full hint history (all previous hints stay visible)
 *   - Code snippet hints with copy-to-clipboard
 *   - Translucent white glassmorphism UI inside Shadow DOM
 *   - Draggable panel
 *   - SPA-aware auto-refresh on problem navigation
 */

(() => {
  "use strict";

  // Prevent double-injection
  if (window.__leetcodeHintsInjected) return;
  window.__leetcodeHintsInjected = true;

  // ═══════════════════════════════════════════════════════════════
  // API CONFIGURATION
  // ═══════════════════════════════════════════════════════════════

  // ⚠️ UPDATE THIS after deploying your Vercel backend
  const API_URL = "https://leetcodehints.vercel.app/api/hint";

  // Dynamic label based on hint number
  function getHintLabel(n) {
    if (n <= 2) return "Nudge";
    if (n <= 4) return "Approach";
    if (n <= 6) return "Strategy";
    return "Deep Dive";
  }

  // ═══════════════════════════════════════════════════════════════
  // HINT ENGINE (API-backed)
  // ═══════════════════════════════════════════════════════════════

  let currentHintLevel = 0;
  let revealedHints = [];
  let isFetchingHint = false;
  let selectedLanguage = "Python";

  /**
   * Fetches a hint from the Vercel serverless backend.
   * @param {number} level - Hint level (1-4)
   * @returns {Promise<{level, type, label, content}>}
   */
  async function fetchHintFromAPI(hintNumber, { isCodeRequest = false, deeperContext = null } = {}) {
    const body = {
      problemTitle: problemData.title,
      difficulty: problemData.difficulty,
      problemDescription: problemData.description,
      hintNumber,
      language: selectedLanguage,
      isCodeRequest,
      deeperContext,
      previousHints: revealedHints.map((h) => ({
        label: h.label,
        content: h.content,
      })),
    };

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `API returned ${res.status}`);
    }

    const data = await res.json();
    const label = isCodeRequest ? "Solution" : getHintLabel(hintNumber);

    return {
      level: hintNumber,
      type: isCodeRequest ? "code" : "text",
      label,
      content: data.hint,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // DOM SCRAPING FUNCTIONS (preserved from v1)
  // ═══════════════════════════════════════════════════════════════

  function getProblemTitle() {
    const dataCy = document.querySelector('[data-cy="question-title"]');
    if (dataCy) return dataCy.textContent.trim();

    const descLink = document.querySelector(
      'a[href*="/problems/"][class*="title"]'
    );
    if (descLink) return descLink.textContent.trim();

    const headings = document.querySelectorAll(
      '[class*="title"], [class*="Title"]'
    );
    for (const h of headings) {
      const text = h.textContent.trim();
      if (/^\d+\.\s/.test(text)) return text;
    }

    const docTitle = document.title.replace(/ - LeetCode$/, "").trim();
    if (docTitle && docTitle !== "LeetCode") return docTitle;
    return null;
  }

  function getProblemDifficulty() {
    const badge = document.querySelector(
      '[class*="difficulty"], [diff], [class*="Difficulty"]'
    );
    if (badge) {
      const text = badge.textContent.trim();
      if (/easy|medium|hard/i.test(text)) return text;
    }

    const allEls = document.querySelectorAll("span, div");
    for (const el of allEls) {
      if (
        el.children.length === 0 &&
        /^(Easy|Medium|Hard)$/.test(el.textContent.trim())
      ) {
        return el.textContent.trim();
      }
    }
    return null;
  }

  function getProblemDescription() {
    const dataCy = document.querySelector('[data-cy="question-content"]');
    if (dataCy) return dataCy.innerText.trim();

    const candidates = document.querySelectorAll(
      '[class*="question-content"], [class*="content__"] div[class]'
    );
    for (const el of candidates) {
      const text = el.innerText.trim();
      if (text.length > 100) return text;
    }

    const panel = document.querySelector(
      '[data-track-load="description_content"]'
    );
    if (panel) return panel.innerText.trim();

    const meta = document.querySelector('meta[name="description"]');
    if (meta) return meta.content.trim();
    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // OVERLAY UI — Built entirely in JS, injected via Shadow DOM
  // ═══════════════════════════════════════════════════════════════

  let overlayHost = null;
  let shadowRoot = null;
  let overlayEl = null;
  let isVisible = false;
  let problemData = null;

  // DOM references inside shadow
  let problemTitleEl, problemDescEl, difficultyBadgeEl, problemSection;
  let statusEl, hintsListEl, hintCounterEl;
  let nextHintBtn, showCodeBtn, startOverBtn, langSelect;

  function createOverlay() {
    // Host element
    overlayHost = document.createElement("div");
    overlayHost.id = "leetcode-hints-host";
    document.body.appendChild(overlayHost);

    // Shadow DOM
    shadowRoot = overlayHost.attachShadow({ mode: "closed" });

    // Inject CSS
    const style = document.createElement("style");
    style.textContent = getCSS();
    shadowRoot.appendChild(style);

    // Build overlay HTML
    overlayEl = document.createElement("div");
    overlayEl.className = "lch-overlay lch-overlay--hidden";
    overlayEl.innerHTML = buildOverlayHTML();
    shadowRoot.appendChild(overlayEl);

    // Cache DOM refs
    problemTitleEl = shadowRoot.querySelector(".lch-problem__title");
    problemDescEl = shadowRoot.querySelector(".lch-problem__desc");
    difficultyBadgeEl = shadowRoot.querySelector(".lch-badge");
    problemSection = shadowRoot.querySelector(".lch-problem");
    statusEl = shadowRoot.querySelector(".lch-status");
    hintsListEl = shadowRoot.querySelector(".lch-hints");
    hintCounterEl = shadowRoot.querySelector(".lch-hint-counter");
    nextHintBtn = shadowRoot.querySelector("#lch-next-hint");
    showCodeBtn = shadowRoot.querySelector("#lch-show-code");
    startOverBtn = shadowRoot.querySelector("#lch-start-over");
    langSelect = shadowRoot.querySelector("#lch-lang-select");

    // Setup event listeners
    setupDragging();
    setupButtons();
  }

  function buildOverlayHTML() {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const shortcutKey = isMac ? '⌘B' : 'Ctrl+B';
    return `
      <!-- Header (draggable) -->
      <div class="lch-header" id="lch-drag-handle">
        <div class="lch-header__left">
          <div class="lch-header__title">
            LeetCode <span class="lch-header__title-accent">Hints</span>
          </div>
        </div>
        <button class="lch-close-btn" id="lch-close" title="Close">✕</button>
      </div>

      <!-- Scrollable body -->
      <div class="lch-body">
        <!-- Problem info (collapsible) -->
        <div class="lch-problem" id="lch-problem-toggle">
          <div class="lch-problem__header">
            <div class="lch-problem__title">Detecting problem…</div>
            <span class="lch-badge">—</span>
            <svg class="lch-problem__chevron" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/>
            </svg>
          </div>
          <div class="lch-problem__desc"></div>
        </div>

        <!-- Language selector -->
        <div class="lch-lang-row">
          <span class="lch-lang-label">Lang</span>
          <select class="lch-select" id="lch-lang-select">
            <option value="Python" selected>Python</option>
            <option value="JavaScript">JavaScript</option>
            <option value="C++">C++</option>
            <option value="Java">Java</option>
            <option value="Go">Go</option>
          </select>
        </div>

        <!-- Status -->
        <div class="lch-status"></div>

        <!-- Hint counter -->
        <div class="lch-hint-counter">0 hints revealed</div>

        <!-- Action buttons -->
        <div class="lch-actions">
          <button class="lch-btn lch-btn--primary" id="lch-next-hint" disabled>
            Next Hint
          </button>
          <button class="lch-btn lch-btn--outline" id="lch-show-code" disabled>
            Show Code
          </button>
        </div>

        <!-- Secondary actions -->
        <div class="lch-secondary-actions">
          <button class="lch-btn lch-btn--ghost" id="lch-start-over" disabled>
            ↺ Start Over
          </button>
        </div>

        <!-- Hints list (history) -->
        <div class="lch-hints"></div>
      </div>

      <!-- Footer -->
      <div class="lch-footer">
        <span class="lch-footer__text">${shortcutKey} to toggle</span>
      </div>
    `;
  }

  function getCSS() {
    return "";
  }

  /**
   * Load the external content.css into the Shadow DOM.
   */
  function loadShadowCSS() {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("content.css");
    shadowRoot.insertBefore(link, shadowRoot.firstChild);

    // Also load Inter font
    const fontLink = document.createElement("link");
    fontLink.rel = "stylesheet";
    fontLink.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
    shadowRoot.insertBefore(fontLink, shadowRoot.firstChild);
  }

  // ═══════════════════════════════════════════════════════════════
  // DRAGGING
  // ═══════════════════════════════════════════════════════════════

  function setupDragging() {
    const handle = shadowRoot.querySelector("#lch-drag-handle");
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener("mousedown", (e) => {
      // Don't drag if clicking the close button
      if (e.target.closest(".lch-close-btn")) return;

      isDragging = true;
      const rect = overlayEl.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;

      overlayEl.style.transition = "none";
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;

      let newX = e.clientX - offsetX;
      let newY = e.clientY - offsetY;

      // Clamp within viewport
      const w = overlayEl.offsetWidth;
      const h = overlayEl.offsetHeight;
      newX = Math.max(0, Math.min(window.innerWidth - w, newX));
      newY = Math.max(0, Math.min(window.innerHeight - h, newY));

      overlayEl.style.left = newX + "px";
      overlayEl.style.top = newY + "px";
      overlayEl.style.right = "auto";
    });

    document.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        overlayEl.style.transition = "";
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // BUTTON HANDLERS
  // ═══════════════════════════════════════════════════════════════

  function setupButtons() {
    // Close
    shadowRoot.querySelector("#lch-close").addEventListener("click", () => {
      hideOverlay();
    });

    // Collapsible problem statement
    shadowRoot.querySelector("#lch-problem-toggle").addEventListener("click", () => {
      problemSection.classList.toggle("lch-problem--expanded");
    });

    // Language selector
    langSelect.addEventListener("change", (e) => {
      selectedLanguage = e.target.value;
    });

    // Next Hint (unlimited)
    nextHintBtn.addEventListener("click", async () => {
      if (isFetchingHint || !problemData) return;
      const nextNum = currentHintLevel + 1;

      isFetchingHint = true;
      nextHintBtn.classList.add("lch-btn--loading");
      showCodeBtn.disabled = true;
      startOverBtn.disabled = true;

      try {
        const hint = await fetchHintFromAPI(nextNum);
        currentHintLevel = nextNum;
        revealedHints.push(hint);
        appendHintCard(hint);
        updateHintCounter();
        showCodeBtn.disabled = false;
        startOverBtn.disabled = false;
      } catch (err) {
        setStatus("Failed to fetch hint: " + err.message, true);
        startOverBtn.disabled = false;
      } finally {
        isFetchingHint = false;
        nextHintBtn.classList.remove("lch-btn--loading");
      }
    });

    // Show Code — requests a full solution
    showCodeBtn.addEventListener("click", async () => {
      if (isFetchingHint || !problemData) return;

      isFetchingHint = true;
      showCodeBtn.classList.add("lch-btn--loading");
      nextHintBtn.disabled = true;
      startOverBtn.disabled = true;

      try {
        const hint = await fetchHintFromAPI(currentHintLevel + 1, { isCodeRequest: true });
        revealedHints.push(hint);
        appendHintCard(hint);
        updateHintCounter();
        nextHintBtn.disabled = false;
        showCodeBtn.disabled = false;
        startOverBtn.disabled = false;
      } catch (err) {
        setStatus("Failed to fetch code: " + err.message, true);
        nextHintBtn.disabled = false;
        startOverBtn.disabled = false;
      } finally {
        isFetchingHint = false;
        showCodeBtn.classList.remove("lch-btn--loading");
      }
    });

    // Start Over — resets hints for the current problem
    startOverBtn.addEventListener("click", () => {
      if (isFetchingHint || !problemData) return;
      currentHintLevel = 0;
      revealedHints = [];
      hintsListEl.innerHTML = "";
      updateHintCounter();
      setStatus("");
      nextHintBtn.disabled = false;
      showCodeBtn.disabled = false;
      startOverBtn.disabled = true;
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDERING
  // ═══════════════════════════════════════════════════════════════

  function truncate(text, maxLen = 200) {
    if (!text || text.length <= maxLen) return text;
    return text.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
  }

  function setDifficultyBadge(difficulty) {
    const d = (difficulty || "").toLowerCase();
    difficultyBadgeEl.textContent = difficulty;
    difficultyBadgeEl.className = "lch-badge";
    if (d === "easy") difficultyBadgeEl.classList.add("lch-badge--easy");
    else if (d === "medium") difficultyBadgeEl.classList.add("lch-badge--medium");
    else if (d === "hard") difficultyBadgeEl.classList.add("lch-badge--hard");
  }

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.className = "lch-status" + (isError ? " lch-status--error" : "");
  }

  function updateHintCounter() {
    const count = revealedHints.length;
    hintCounterEl.textContent = count === 0 ? "0 hints revealed" : `${count} hint${count > 1 ? "s" : ""} revealed`;
  }

  function createHintCardElement(hint, index) {
    const card = document.createElement("div");
    card.className = `lch-hint lch-hint--${hint.type}`;

    const headerHTML = `
      <div class="lch-hint__header">
        <span class="lch-hint__step">${index + 1}</span>
        <span class="lch-hint__label">${hint.label}</span>
      </div>
    `;

    if (hint.type === "code") {
      card.innerHTML = `
        ${headerHTML}
        <div class="lch-hint__content">
          <pre class="lch-hint__code">${escapeHTML(hint.content)}</pre>
        </div>
        <button class="lch-copy-btn">Copy</button>
      `;
      // Copy handler
      const copyBtn = card.querySelector(".lch-copy-btn");
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(hint.content).then(() => {
          copyBtn.textContent = "Copied!";
          setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
        });
      });
    } else {
      card.innerHTML = `
        ${headerHTML}
        <div class="lch-hint__content">${escapeHTML(hint.content)}</div>
        <button class="lch-deeper-btn">Go deeper ↓</button>
      `;
      // Go Deeper handler
      const deeperBtn = card.querySelector(".lch-deeper-btn");
      deeperBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (deeperBtn.classList.contains("lch-deeper-btn--loading")) return;
        deeperBtn.classList.add("lch-deeper-btn--loading");
        deeperBtn.textContent = "Loading…";

        try {
          const deeper = await fetchHintFromAPI(hint.level, { deeperContext: hint.content });
          // Create sub-hint card
          const subCard = document.createElement("div");
          subCard.className = "lch-hint lch-hint--sub";
          subCard.innerHTML = `<div class="lch-hint__content">${escapeHTML(deeper.content)}</div>`;
          card.parentNode.insertBefore(subCard, card.nextSibling);
          subCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
          deeperBtn.remove();
        } catch (err) {
          deeperBtn.textContent = "Failed — retry ↓";
          deeperBtn.classList.remove("lch-deeper-btn--loading");
        }
      });
    }

    return card;
  }

  function appendHintCard(hint) {
    const index = revealedHints.indexOf(hint);
    const card = createHintCardElement(hint, index);
    hintsListEl.appendChild(card);

    // Scroll to the new card
    requestAnimationFrame(() => {
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function renderAllHints() {
    hintsListEl.innerHTML = "";
    revealedHints.forEach((hint, i) => {
      const card = createHintCardElement(hint, i);
      // Remove animation for already-seen cards
      card.style.animation = "none";
      hintsListEl.appendChild(card);
    });

    // Scroll to bottom
    requestAnimationFrame(() => {
      const lastCard = hintsListEl.lastElementChild;
      if (lastCard) {
        // Re-add animation only for the last card
        lastCard.style.animation = "";
        lastCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  }

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ═══════════════════════════════════════════════════════════════
  // URL CHANGE DETECTION (SPA navigation)
  // ═══════════════════════════════════════════════════════════════

  let lastKnownURL = window.location.href;

  /**
   * Resets the overlay state so a fresh problem can be loaded.
   * Called when the user navigates to a different problem.
   */
  function resetOverlay() {
    problemData = null;
    currentHintLevel = 0;
    revealedHints = [];
    isFetchingHint = false;

    if (hintsListEl) hintsListEl.innerHTML = "";
    if (hintCounterEl) hintCounterEl.textContent = "0 hints revealed";
    if (nextHintBtn) {
      nextHintBtn.disabled = true;
      nextHintBtn.classList.remove("lch-btn--loading");
    }
    if (showCodeBtn) {
      showCodeBtn.disabled = true;
      showCodeBtn.classList.remove("lch-btn--loading");
    }
    if (startOverBtn) {
      startOverBtn.disabled = true;
    }
    if (problemSection) {
      problemSection.classList.remove("lch-problem--expanded");
    }
  }

  /**
   * Checks if the URL has changed (SPA navigation) and
   * reloads problem data if it has.
   */
  function handleURLChange() {
    const currentURL = window.location.href;
    if (currentURL === lastKnownURL) return;
    lastKnownURL = currentURL;

    // Only care about problem pages
    if (!currentURL.includes("leetcode.com/problems/")) return;

    resetOverlay();

    // If the overlay is visible, reload data for the new problem
    if (isVisible) {
      // Wait for LeetCode's SPA to render the new problem
      setTimeout(() => loadProblemData(), 800);
    }
  }

  // --- Listeners for SPA navigation ---

  // 1. popstate fires on browser back/forward
  window.addEventListener("popstate", () => handleURLChange());

  // 2. LeetCode uses pushState/replaceState — intercept them
  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    handleURLChange();
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    handleURLChange();
  };

  // 3. Polling fallback — catches any edge cases every 2 seconds
  setInterval(handleURLChange, 2000);

  // ═══════════════════════════════════════════════════════════════
  // SHOW / HIDE
  // ═══════════════════════════════════════════════════════════════

  function showOverlay() {
    if (!overlayEl) {
      createOverlay();
      loadShadowCSS();
    }
    overlayEl.classList.remove("lch-overlay--hidden");
    isVisible = true;

    // Load problem data if not loaded yet
    if (!problemData) {
      loadProblemData();
    }
  }

  function hideOverlay() {
    if (overlayEl) {
      overlayEl.classList.add("lch-overlay--hidden");
    }
    isVisible = false;
  }

  function toggleOverlay() {
    if (isVisible) {
      hideOverlay();
    } else {
      showOverlay();
    }
  }

  async function loadProblemData() {
    setStatus("Detecting LeetCode problem…");
    nextHintBtn.disabled = true;
    showCodeBtn.disabled = true;

    // Small delay to let DOM settle
    await new Promise((r) => setTimeout(r, 300));

    const title = getProblemTitle();
    const difficulty = getProblemDifficulty();
    const description = getProblemDescription();

    if (title || description) {
      problemData = {
        title: title || "Unknown Title",
        difficulty: difficulty || "Unknown",
        description: description || "Could not extract description.",
      };

      problemTitleEl.textContent = problemData.title;
      problemDescEl.textContent = truncate(problemData.description);
      setDifficultyBadge(problemData.difficulty);
      setStatus("");

      currentHintLevel = 0;
      revealedHints = [];
      updateProgress();

      nextHintBtn.disabled = false;
      showCodeBtn.disabled = false;
    } else {
      setStatus("Could not extract problem data. Try refreshing the page.", true);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // MESSAGE LISTENER
  // ═══════════════════════════════════════════════════════════════

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === "toggleOverlay") {
      toggleOverlay();
      sendResponse({ success: true });
    }
    return true;
  });
})();
