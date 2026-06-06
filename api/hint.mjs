/**
 * LeetCode Hints — Vercel Serverless API
 *
 * POST /api/hint
 *
 * Accepts:
 *   { problemTitle, difficulty, problemDescription, hintLevel, previousHints, language }
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
 * Build a deterministic cache key from the problem title and hint level.
 * Normalizes the title to lowercase, strips non-alphanumeric chars.
 */
function cacheKey(problemTitle, hintLevel, language = "Python") {
  const slug = problemTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const lang = language.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `hint:${slug}:${lang}:${hintLevel}`;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function buildSystemPrompt(language = "Python") {
  return `You are an expert coding tutor specializing in data structures and algorithms. Your role is to help students solve LeetCode problems by providing progressive, step-wise hints — NOT full solutions.

Rules:
1. You will receive a hint level (1-4). Adjust your response depth accordingly:
   - Level 1 (Nudge): Give a vague, conceptual push. Mention the general category of technique without naming it explicitly. One to two sentences max.
   - Level 2 (Approach): Name the specific data structure or algorithm pattern. Explain WHY it fits this problem. Two to three sentences.
   - Level 3 (Strategy): Give a concrete, step-by-step strategy for implementing the solution. Include time/space complexity. Three to five sentences.
   - Level 4 (Code): Provide a clean, correct ${language} implementation with brief inline comments. Use idiomatic ${language}. Include the function signature matching LeetCode's expected format.
2. You will also receive any previous hints you gave. Do NOT repeat them. Each hint must build on the last and add new information.
3. Never reveal information from a higher level than requested. A level 1 hint must NOT mention specific algorithms by name.
4. For level 4 (code), return ONLY the code block — no prose before or after it.
5. Keep hints concise and focused. No filler phrases like "Great question!" or "Let's think about this."
6. If the problem is ambiguous, hint toward the most common/expected LeetCode interpretation.`;
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
    const { problemTitle, difficulty, problemDescription, hintLevel, previousHints, language: rawLang } = req.body;
    const language = rawLang || "Python";

    // Validate required fields
    if (!problemTitle || !problemDescription || !hintLevel) {
      return res
        .writeHead(400, { ...CORS_HEADERS, "Content-Type": "application/json" })
        .end(JSON.stringify({ error: "Missing required fields: problemTitle, problemDescription, hintLevel" }));
    }

    const levelLabels = { 1: "Nudge", 2: "Approach", 3: "Strategy", 4: "Code" };
    const levelLabel = levelLabels[hintLevel] || "Hint";

    // Build the user prompt
    let userPrompt = `Problem: ${problemTitle}\nDifficulty: ${difficulty || "Unknown"}\n\nDescription:\n${problemDescription}\n\n`;

    if (previousHints && previousHints.length > 0) {
      userPrompt += `Previous hints I already received:\n`;
      previousHints.forEach((h, i) => {
        userPrompt += `${i + 1}. [${h.label}]: ${h.content}\n`;
      });
      userPrompt += `\n`;
    }

    userPrompt += `Now give me a Level ${hintLevel} (${levelLabel}) hint. ${
      hintLevel === 4
        ? `Respond with ONLY a ${language} code block, no extra text.`
        : "Respond with ONLY the hint text, no extra formatting or labels."
    }`;

    // ─── Cache check ─────────────────────────────────────────
    const redisClient = getRedis();
    const key = cacheKey(problemTitle, hintLevel, language);

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
          parts: [{ text: buildSystemPrompt(language) }],
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
