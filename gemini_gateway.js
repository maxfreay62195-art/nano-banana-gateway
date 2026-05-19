/**
 * gemini_gateway.js
 *
 * OpenAI-compatible proxy bridge for Google Gemini image generation
 * ("Nano Banana 2" — gemini-3.1-flash-image-preview, with auto-fallback).
 *
 * Inbound :  POST /v1/images/generations   { "prompt": "..." }
 * Outbound:  POST https://generativelanguage.googleapis.com
 *                 /v1beta/models/<MODEL>:generateContent?key=<KEY>
 * Response:  { created, data: [{ b64_json, revised_prompt }] }   (OpenAI shape)
 *
 * Environment variables:
 *   GEMINI_API_KEY  (required)  - Google AI Studio key. Set in Render dashboard.
 *   GEMINI_MODEL    (optional)  - preferred model. Defaults to nano-banana-2.
 *   PORT            (optional)  - defaults to 10000 (Render injects this)
 *
 * Resilience features:
 *   - On boot, queries Google's ListModels and picks the best image-capable
 *     Gemini model from a priority chain. If the configured model 404s, the
 *     gateway still works.
 *   - One automatic retry on transient (5xx / network) upstream failures.
 *   - Generous request timeout (90s) so cold-started downstream models finish.
 *   - /healthz endpoint always returns 200 so keepalive pings succeed.
 *   - SELF-PING KEEP-WARM: the gateway pings its own public URL every
 *     10 minutes so Render's free-tier dyno never sleeps. No external service
 *     required. Uses RENDER_EXTERNAL_URL (set automatically by Render).
 */

const express = require('express');
const https = require('https');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PREFERRED_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-image-preview';
const GEMINI_HOST = 'generativelanguage.googleapis.com';

// Priority chain. Auto-discovery on boot trims this to what's actually available.
const MODEL_FALLBACK_CHAIN = [
  PREFERRED_MODEL,
  'gemini-3.1-flash-image-preview',
  'gemini-3-flash-image-preview',
  'gemini-3-flash-image',
  'gemini-2.5-flash-image-preview',
  'gemini-2.5-flash-image',
  'gemini-2.0-flash-preview-image-generation',
];

let ACTIVE_MODEL = PREFERRED_MODEL; // overwritten by discoverModel() on boot

if (!GEMINI_API_KEY) {
  console.error('FATAL: GEMINI_API_KEY environment variable is not set.');
  console.error('In Render: Service -> Environment -> Add Environment Variable.');
  process.exit(1);
}

/* ---------- HTTPS helper ---------- */

function httpsRequest({ hostname, path, method = 'GET', headers = {}, body = null, timeoutMs = 90000 }) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path, method, headers };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: buf });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Upstream timeout after ${timeoutMs}ms`));
    });
    if (body) req.write(body);
    req.end();
  });
}

/* ---------- Model auto-discovery ---------- */

async function discoverModel() {
  try {
    const { status, body } = await httpsRequest({
      hostname: GEMINI_HOST,
      path: `/v1beta/models?key=${encodeURIComponent(GEMINI_API_KEY)}&pageSize=200`,
      method: 'GET',
      timeoutMs: 15000,
    });
    if (status !== 200) {
      console.warn(`Model discovery returned ${status}; keeping configured model: ${PREFERRED_MODEL}`);
      return PREFERRED_MODEL;
    }
    const parsed = JSON.parse(body);
    const availableNames = new Set(
      (parsed.models || []).map((m) => (m.name || '').replace(/^models\//, ''))
    );
    for (const candidate of MODEL_FALLBACK_CHAIN) {
      if (availableNames.has(candidate)) {
        console.log(`Model discovery picked: ${candidate}`);
        return candidate;
      }
    }
    // Last-resort: scan for any *image* model
    for (const name of availableNames) {
      if (name.includes('image') && name.startsWith('gemini-')) {
        console.log(`Model discovery fallback to scanned: ${name}`);
        return name;
      }
    }
    console.warn(`No image-capable model found via discovery; using configured ${PREFERRED_MODEL}`);
    return PREFERRED_MODEL;
  } catch (e) {
    console.warn(`Model discovery error (${e.message}); using configured ${PREFERRED_MODEL}`);
    return PREFERRED_MODEL;
  }
}

/* ---------- Gemini call with retry ---------- */

async function callGeminiOnce(model, prompt) {
  const payload = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  });
  const { status, body } = await httpsRequest({
    hostname: GEMINI_HOST,
    path: `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
    body: payload,
  });
  if (status < 200 || status >= 300) {
    const err = new Error(`Gemini upstream ${status}: ${body.slice(0, 500)}`);
    err.status = status;
    err.body = body;
    throw err;
  }
  return JSON.parse(body);
}

async function callGemini(prompt) {
  try {
    return await callGeminiOnce(ACTIVE_MODEL, prompt);
  } catch (err) {
    // 404 means our chosen model is wrong — rediscover and retry once.
    if (err.status === 404) {
      console.warn(`Model ${ACTIVE_MODEL} returned 404; re-running discovery...`);
      ACTIVE_MODEL = await discoverModel();
      return await callGeminiOnce(ACTIVE_MODEL, prompt);
    }
    // Transient 5xx / network error → one retry.
    if (!err.status || err.status >= 500) {
      console.warn(`Transient upstream error (${err.message}); retrying once.`);
      await new Promise((r) => setTimeout(r, 1500));
      return await callGeminiOnce(ACTIVE_MODEL, prompt);
    }
    throw err;
  }
}

/* ---------- Response parsing ---------- */

function extractImageB64(geminiResponse) {
  // Primary: Gemini :generateContent shape
  const parts = geminiResponse?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part?.inlineData?.data) return part.inlineData.data;
    if (part?.inline_data?.data) return part.inline_data.data;
  }
  // Fallback: Vertex / :predict-style shape
  const pred = geminiResponse?.predictions?.[0];
  if (pred?.bytesBase64Encoded) return pred.bytesBase64Encoded;
  return null;
}

/* ---------- Routes ---------- */

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'gemini-cloud-gateway',
    engine: 'Nano Banana 2',
    active_model: ACTIVE_MODEL,
    preferred_model: PREFERRED_MODEL,
    endpoint: 'POST /v1/images/generations',
    time: new Date().toISOString(),
  });
});

// Lightweight always-200 endpoint for keepalive pings (Render free tier).
app.get('/healthz', (req, res) => res.status(200).send('ok'));

app.post('/v1/images/generations', async (req, res) => {
  const prompt = req.body?.prompt;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({
      error: {
        message: 'Field "prompt" (string) is required in the request body.',
        type: 'invalid_request_error',
      },
    });
  }
  try {
    const gemini = await callGemini(prompt);
    const b64 = extractImageB64(gemini);
    if (!b64) {
      return res.status(502).json({
        error: {
          message: 'Gemini returned no image data. The prompt may have been filtered.',
          type: 'upstream_error',
          model_used: ACTIVE_MODEL,
          raw: gemini,
        },
      });
    }
    res.json({
      created: Math.floor(Date.now() / 1000),
      model: ACTIVE_MODEL,
      data: [{ b64_json: b64, revised_prompt: prompt }],
    });
  } catch (err) {
    console.error('Gateway error:', err.message);
    res.status(500).json({
      error: {
        message: err.message,
        type: 'gateway_error',
        model_attempted: ACTIVE_MODEL,
      },
    });
  }
});

/* ---------- Self-ping keep-warm ---------- */
/* Render's free tier sleeps the dyno after ~15 min of no incoming traffic.    */
/* Pinging our OWN public URL every 10 min counts as incoming traffic and      */
/* keeps the dyno hot 24/7 with no external dependency.                        */

function startSelfPing() {
  const externalUrl = process.env.RENDER_EXTERNAL_URL || process.env.SELF_PING_URL;
  if (!externalUrl) {
    console.log('Self-ping disabled (RENDER_EXTERNAL_URL not set). Service may cold-start.');
    return;
  }
  const intervalMs = parseInt(process.env.SELF_PING_INTERVAL_MS, 10) || 10 * 60 * 1000;
  const target = `${externalUrl.replace(/\/$/, '')}/healthz`;
  let parsed;
  try {
    parsed = new URL(target);
  } catch (e) {
    console.warn(`Self-ping URL invalid (${target}): ${e.message}`);
    return;
  }

  const ping = () => {
    const reqLib = parsed.protocol === 'https:' ? https : require('http');
    const req = reqLib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        timeout: 15000,
        headers: { 'User-Agent': 'gemini-cloud-gateway-selfping/1.0' },
      },
      (res) => {
        res.resume();
        console.log(`[selfping] ${target} -> HTTP ${res.statusCode}`);
      }
    );
    req.on('error', (e) => console.warn(`[selfping] error: ${e.message}`));
    req.on('timeout', () => req.destroy(new Error('selfping timeout')));
    req.end();
  };

  // Fire one immediately after boot, then on the interval.
  setTimeout(ping, 30 * 1000);
  setInterval(ping, intervalMs);
  console.log(`Self-ping enabled: ${target} every ${Math.round(intervalMs / 1000)}s`);
}

/* ---------- Boot ---------- */

(async () => {
  ACTIVE_MODEL = await discoverModel();
  app.listen(PORT, () => {
    console.log(`gemini-cloud-gateway listening on :${PORT}`);
    console.log(`Active model: ${ACTIVE_MODEL}`);
    console.log(`Upstream:     https://${GEMINI_HOST}/v1beta/models/${ACTIVE_MODEL}:generateContent`);
    console.log(`Endpoint:     POST /v1/images/generations`);
    startSelfPing();
  });
})();
