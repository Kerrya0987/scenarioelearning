// PEACE Interviewing Module — interview backend
// Relays one prompt to the Anthropic Messages API using YOUR key.
// The key is read from the ANTHROPIC_API_KEY environment variable you set in
// Netlify (Site settings → Environment variables). It is NEVER sent to the browser.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Model can be overridden with an ANTHROPIC_MODEL env var without editing code.
const DEFAULT_MODEL = "claude-3-5-sonnet-latest";

// Cheap abuse guards (see README for stronger, account-level limits).
const MAX_PROMPT_CHARS = 24000; // a single turn's prompt is well under this
const MAX_TOKENS = 1024;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return json(500, { error: "Server is missing ANTHROPIC_API_KEY." });
  }

  let prompt = "";
  try {
    prompt = (JSON.parse(event.body || "{}").prompt || "").toString();
  } catch (e) {
    return json(400, { error: "Bad request body." });
  }
  if (!prompt) return json(400, { error: "Missing prompt." });
  if (prompt.length > MAX_PROMPT_CHARS) {
    return json(413, { error: "Prompt too long." });
  }

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return json(502, { error: "Upstream error", detail: detail.slice(0, 500) });
    }

    const data = await res.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    return json(200, { text });
  } catch (e) {
    return json(502, { error: "Request failed", detail: String(e).slice(0, 300) });
  }
};

function json(status, obj) {
  return {
    statusCode: status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj),
  };
}
