/**
 * LeetCode Hints — Vercel Serverless API (Adaptive Hints)
 *
 * POST /api/hint
 *
 * Accepts:
 *   { problemTitle, difficulty, problemDescription, hintNumber, previousHints, language, deeperContext, isCodeRequest }
 *
 * Returns:
 *   { hint: "...", cached: true|false }
 *
 * Calls Gemini 2.5 Flash via the Generative Language API.
 * Caches responses in Upstash Redis to avoid redundant API calls.
 * API key is read from process.env.GEMINI_API_KEY (never hardcoded).
 */

import { Redis } from "@upstash/redis";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ─── Redis (lazy init) ───────────────────────────────────────
let redis = null;

function getRedis() {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

/**
 * Build a deterministic cache key.
 */
function cacheKey(problemTitle, hintNumber, language = "Python", isDeeper = false) {
  const slug = problemTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const lang = language.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const prefix = isDeeper ? "deeper" : "hint";
  return `${prefix}:${slug}:${lang}:${hintNumber}`;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function buildSystemPrompt(language = "Python", difficulty = "Unknown") {
  const pacing = difficulty.toLowerCase() === "hard"
    ? "This is a Hard problem. Take your time — start very vague and reveal information gradually across many hints. It's okay to take 8-10 hints to build up to the solution."
    : difficulty.toLowerCase() === "easy"
      ? "This is an Easy problem. You can be somewhat more direct with hints, but still don't give away the answer too quickly."
      : "This is a Medium problem. Pace yourself — build up gradually over 4-6 hints.";

  return `You are an expert coding tutor for LeetCode problems. Provide progressive hints that build on each other — NOT full solutions (unless asked for code).

${pacing}

Rules:
1. You will receive a hint number (1, 2, 3, ...) and any previous hints. Each new hint must add NEW information and be slightly more specific than the last.
2. Early hints (1-2): Be vague and conceptual. Mention the general category of technique without naming it explicitly. One to two sentences.
3. Mid hints (3-5): Name specific patterns, data structures, or algorithms. Explain WHY they fit. Two to three sentences.
4. Later hints (6+): Give concrete implementation steps, edge cases, complexity analysis. Be detailed. Three to five sentences.
5. If asked for "deeper" context on a specific hint, elaborate on ONLY that hint with more detail, examples, or edge cases. Two to four sentences.
6. If asked for code, provide a clean, correct ${language} implementation with inline comments. Match LeetCode's expected function signature. Return ONLY the code block.
7. NEVER repeat information from previous hints.
8. No filler phrases. Be concise and direct.`;
}

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // Only accept POST
  if (req.method !== "POST") {
    return res
      .writeHead(405, { ...CORS_HEADERS, "Content-Type": "application/json" })
      .end(JSON.stringify({ error: "Method not allowed" }));
  }

  // Validate API key exists
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res
      .writeHead(500, { ...CORS_HEADERS, "Content-Type": "application/json" })
      .end(JSON.stringify({ error: "GEMINI_API_KEY is not configured on the server." }));
  }

  try {
    const {
      problemTitle,
      difficulty,
      problemDescription,
      hintNumber,
      previousHints,
      language: rawLang,
      deeperContext,
      isCodeRequest,
    } = req.body;

    const language = rawLang || "Python";
    const hintNum = hintNumber || 1;

    // Validate required fields
    if (!problemTitle || !problemDescription) {
      return res
        .writeHead(400, { ...CORS_HEADERS, "Content-Type": "application/json" })
        .end(JSON.stringify({ error: "Missing required fields: problemTitle, problemDescription" }));
    }

    // Build the user prompt
    let userPrompt = `Problem: ${problemTitle}\nDifficulty: ${difficulty || "Unknown"}\n\nDescription:\n${problemDescription}\n\n`;

    if (previousHints && previousHints.length > 0) {
      userPrompt += `Previous hints I already received:\n`;
      previousHints.forEach((h, i) => {
        userPrompt += `${i + 1}. [${h.label}]: ${h.content}\n`;
      });
      userPrompt += `\n`;
    }

    if (isCodeRequest) {
      userPrompt += `Give me a complete ${language} solution. Respond with ONLY the code block, no extra text.`;
    } else if (deeperContext) {
      userPrompt += `Elaborate on this specific hint with more detail, examples, or edge cases: "${deeperContext}"\nRespond with ONLY the elaboration text, no extra formatting or labels.`;
    } else {
      userPrompt += `Give me hint #${hintNum} for this problem. Be slightly more specific than my previous hints. Respond with ONLY the hint text, no extra formatting or labels.`;
    }

    // ─── Cache check ─────────────────────────────────────────
    const redisClient = getRedis();
    const isDeeper = !!deeperContext;
    const key = cacheKey(problemTitle, isCodeRequest ? "code" : hintNum, language, isDeeper);

    if (redisClient) {
      try {
        const cached = await redisClient.get(key);
        if (cached) {
          return res
            .writeHead(200, { ...CORS_HEADERS, "Content-Type": "application/json" })
            .end(JSON.stringify({ hint: cached, cached: true }));
        }
      } catch (cacheErr) {
        // Redis failure is non-fatal — fall through to Gemini
        console.warn("Redis GET failed, skipping cache:", cacheErr.message);
      }
    }

    // Call Gemini
    const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: buildSystemPrompt(language, difficulty) }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      }),
    });

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text();
      console.error("Gemini API error:", geminiRes.status, errBody);
      return res
        .writeHead(502, { ...CORS_HEADERS, "Content-Type": "application/json" })
        .end(JSON.stringify({ error: "Failed to get response from Gemini API." }));
    }

    const geminiData = await geminiRes.json();
    const hint =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "Sorry, I couldn't generate a hint for this problem.";

    // ─── Cache write ─────────────────────────────────────────
    if (redisClient) {
      try {
        await redisClient.set(key, hint);
      } catch (cacheErr) {
        console.warn("Redis SET failed, hint not cached:", cacheErr.message);
      }
    }

    return res
      .writeHead(200, { ...CORS_HEADERS, "Content-Type": "application/json" })
      .end(JSON.stringify({ hint, cached: false }));
  } catch (err) {
    console.error("Handler error:", err);
    return res
      .writeHead(500, { ...CORS_HEADERS, "Content-Type": "application/json" })
      .end(JSON.stringify({ error: "Internal server error." }));
  }
}
