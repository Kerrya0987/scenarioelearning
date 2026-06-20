// PEACE Interviewing Module — interview backend
// Uses YOUR Anthropic key (read case-insensitively from the environment).
// Picks a valid model automatically by asking your account what's available,
// so it won't break when model names change. You can still force a specific
// model by setting an ANTHROPIC_MODEL environment variable.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODELS_URL = "https://api.anthropic.com/v1/models";
const MAX_PROMPT_CHARS = 24000;
const MAX_TOKENS = 1024;

let cachedModel = null;

function findApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  for (const name in process.env) {
    if (/^anthropic[_-]?api[_-]?key$/i.test(name) && process.env[name]) {
      return process.env[name];
    }
  }
  return "";
}

async function listModels(apiKey) {
  try {
    const res = await fetch(MODELS_URL, {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map((m) => m.id).filter(Boolean);
  } catch (e) {
    console.error("LIST MODELS FAILED:", String(e));
    return [];
  }
}

// Prefer a Sonnet (good balance for a fast chat sim), then Haiku, then anything.
function pickModel(ids) {
  return (
    ids.find((id) => /sonnet/i.test(id)) ||
    ids.find((id) => /haiku/i.test(id)) ||
    ids[0] ||
    null
  );
}

async function resolveModel(apiKey) {
  if (process.env.ANTHROPIC_MODEL) return process.env.ANTHROPIC_MODEL;
  if (cachedModel) return cachedModel;
  const ids = await listModels(apiKey);
  cachedModel = pickModel(ids);
  return cachedModel;
}

exports.handler = async (event) => {
  const apiKey = findApiKey();
  const hasKey = !!apiKey;

  if (event.httpMethod === "GET") {
    const ids = hasKey ? await listModels(apiKey) : [];
    return json(200, {
      status: "alive",
      hasKey,
      resolvedModel: hasKey ? await resolveModel(apiKey) : null,
      availableModels: ids,
      node: process.version,
    });
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

  const model = await resolveModel(apiKey);
  if (!model) {
    console.error("NO MODEL AVAILABLE for this account");
    return json(502, { error: "No model available for this account." });
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
      // If the chosen model was rejected, clear the cache so the next call re-picks.
      if (res.status === 404) cachedModel = null;
      console.error("ANTHROPIC ERROR", res.status, "model:", model, raw.slice(0, 400));
      return json(502, { error: "Upstream error", status: res.status, detail: raw.slice(0, 400) });
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
