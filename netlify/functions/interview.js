// PEACE Interviewing Module — interview backend (with diagnostics)
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-3-5-sonnet-latest";
const MAX_PROMPT_CHARS = 24000;
const MAX_TOKENS = 1024;

function findApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  for (const name in process.env) {
    if (/^anthropic[_-]?api[_-]?key$/i.test(name) && process.env[name]) {
      return process.env[name];
    }
  }
  return "";
}

exports.handler = async (event) => {
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const apiKey = findApiKey();
  const hasKey = !!apiKey;

  if (event.httpMethod === "GET") {
    return json(200, { status: "alive", hasKey, model, node: process.version });
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }
  if (!hasKey) {
    console.error("NO API KEY FOUND in environment");
    return json(500, { error: "Server is missing the Anthropic API key." });
  }

  let prompt = "";
  try {
    prompt = (JSON.parse(event.body || "{}").prompt || "").toString();
  } catch (e) {
    console.error("BAD BODY:", String(e));
    return json(400, { error: "Bad request body." });
  }
  if (!prompt) return json(400, { error: "Missing prompt." });
  if (prompt.length > MAX_PROMPT_CHARS) return json(413, { error: "Prompt too long." });

  if (typeof fetch !== "function") {
    console.error("NO GLOBAL FETCH on node", process.version);
    return json(500, { error: "Runtime has no fetch", node: process.version });
  }

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const raw = await res.text();
    if (!res.ok) {
      console.error("ANTHROPIC ERROR", res.status, raw.slice(0, 500));
      return json(502, { error: "Upstream error", status: res.status, detail: raw.slice(0, 500) });
    }
    const data = JSON.parse(raw);
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    return json(200, { text });
  } catch (e) {
    console.error("REQUEST FAILED:", String(e));
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
