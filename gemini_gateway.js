/**
 * gemini_gateway.js
 *
 * Unified gateway for Google's highest-quality visual generation:
 *   POST /v1/images/generations   -> Nano Banana 2 (gemini-3.1-flash-image-preview)
 *   POST /v1/videos/generations   -> Veo (veo-3 preferred, auto-falls back, long-running)
 *   GET  /v1/videos/download      -> auth-proxy that streams a Veo MP4 with the key attached
 *
 * Image responses return base64 PNG. Video responses return both the raw
 * Google file URI AND a key-free download_url pointing at this gateway's
 * own /v1/videos/download proxy, so callers never need the API key.
 *
 * Env vars:
 *   GEMINI_API_KEY (required), GEMINI_MODEL (optional), VEO_MODEL (optional),
 *   PORT (optional, defaults 10000), SELF_PING_URL, SELF_PING_INTERVAL_MS.
 */

const express = require('express');
const https = require('https');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PREFERRED_IMAGE_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-image-preview';
const PREFERRED_VIDEO_MODEL = process.env.VEO_MODEL || 'veo-3.0-generate-preview';
const GEMINI_HOST = 'generativelanguage.googleapis.com';
const PUBLIC_URL = (process.env.RENDER_EXTERNAL_URL || process.env.SELF_PING_URL || '').replace(/\/$/, '');

const IMAGE_MODEL_CHAIN = [
  PREFERRED_IMAGE_MODEL,
  'gemini-3.1-flash-image-preview',
  'gemini-3-flash-image-preview',
  'gemini-3-flash-image',
  'gemini-2.5-flash-image-preview',
  'gemini-2.5-flash-image',
];

const VIDEO_MODEL_CHAIN = [
  PREFERRED_VIDEO_MODEL,
  'veo-3.0-generate-preview',
  'veo-3.0-fast-generate-preview',
  'veo-3-generate-preview',
  'veo-2.0-generate-001',
];

let ACTIVE_IMAGE_MODEL = PREFERRED_IMAGE_MODEL;
let ACTIVE_VIDEO_MODEL = PREFERRED_VIDEO_MODEL;

if (!GEMINI_API_KEY) {
  console.error('FATAL: GEMINI_API_KEY env var not set.');
  process.exit(1);
}

/* ---------- HTTPS helper ---------- */

function httpsRequest({ hostname, path, method = 'GET', headers = {}, body = null, timeoutMs = 120000 }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Upstream timeout after ${timeoutMs}ms`)));
    if (body) req.write(body);
    req.end();
  });
}

/* ---------- Model auto-discovery ---------- */

async function listAvailableModels() {
  try {
    const { status, body } = await httpsRequest({
      hostname: GEMINI_HOST,
      path: `/v1beta/models?key=${encodeURIComponent(GEMINI_API_KEY)}&pageSize=500`,
      timeoutMs: 15000,
    });
    if (status !== 200) {
      console.warn(`ListModels returned ${status}`);
      return null;
    }
    const parsed = JSON.parse(body);
    return new Set((parsed.models || []).map((m) => (m.name || '').replace(/^models\//, '')));
  } catch (e) {
    console.warn(`ListModels error: ${e.message}`);
    return null;
  }
}

function pickFromChain(chain, available, kindKeyword) {
  if (!available) return chain[0];
  for (const c of chain) if (available.has(c)) return c;
  for (const name of available) if (name.toLowerCase().includes(kindKeyword)) return name;
  return chain[0];
}

/* ---------- Image generation (Nano Banana 2) ---------- */

async function callImageOnce(model, prompt) {
  const payload = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  });
  const { status, body } = await httpsRequest({
    hostname: GEMINI_HOST,
    path: `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    body: payload,
    timeoutMs: 90000,
  });
  if (status < 200 || status >= 300) {
    const err = new Error(`Image upstream ${status}: ${body.slice(0, 500)}`);
    err.status = status;
    throw err;
  }
  return JSON.parse(body);
}

async function callImage(prompt) {
  try {
    return await callImageOnce(ACTIVE_IMAGE_MODEL, prompt);
  } catch (err) {
    if (err.status === 404) {
      const avail = await listAvailableModels();
      ACTIVE_IMAGE_MODEL = pickFromChain(IMAGE_MODEL_CHAIN, avail, 'image');
      return await callImageOnce(ACTIVE_IMAGE_MODEL, prompt);
    }
    if (!err.status || err.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500));
      return await callImageOnce(ACTIVE_IMAGE_MODEL, prompt);
    }
    throw err;
  }
}

function extractImageB64(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part?.inlineData?.data) return part.inlineData.data;
    if (part?.inline_data?.data) return part.inline_data.data;
  }
  const pred = response?.predictions?.[0];
  if (pred?.bytesBase64Encoded) return pred.bytesBase64Encoded;
  return null;
}

/* ---------- Video generation (Veo, long-running) ---------- */

async function startVeoOperation(model, prompt, opts = {}) {
  const payload = JSON.stringify({
    instances: [{ prompt }],
    parameters: {
      aspectRatio: opts.aspectRatio || '16:9',
      durationSeconds: opts.durationSeconds || 5,
      personGeneration: opts.personGeneration || 'allow_all',
    },
  });
  const { status, body } = await httpsRequest({
    hostname: GEMINI_HOST,
    path: `/v1beta/models/${model}:predictLongRunning?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    body: payload,
    timeoutMs: 60000,
  });
  if (status < 200 || status >= 300) {
    const err = new Error(`Veo start ${status}: ${body.slice(0, 500)}`);
    err.status = status;
    throw err;
  }
  return JSON.parse(body).name;
}

async function pollVeoOperation(opName, opts = {}) {
  const maxAttempts = opts.maxAttempts || 36;
  const intervalMs = opts.intervalMs || 5000;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const { status, body } = await httpsRequest({
      hostname: GEMINI_HOST,
      path: `/v1beta/${opName}?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      timeoutMs: 30000,
    });
    if (status < 200 || status >= 300) {
      console.warn(`Veo poll ${i}: ${status}`);
      continue;
    }
    const parsed = JSON.parse(body);
    if (parsed.done) {
      if (parsed.error) throw new Error(`Veo failed: ${JSON.stringify(parsed.error).slice(0, 400)}`);
      return parsed.response;
    }
  }
  throw new Error(`Veo poll timed out after ${maxAttempts * intervalMs / 1000}s`);
}

function extractVideoUri(veoResponse) {
  const samples =
    veoResponse?.generateVideoResponse?.generatedSamples ||
    veoResponse?.generated_samples ||
    veoResponse?.candidates ||
    [];
  for (const s of samples) {
    const uri = s?.video?.uri || s?.video?.url || s?.uri;
    if (uri) return uri;
  }
  const pred = veoResponse?.predictions?.[0];
  if (pred?.videoUri) return pred.videoUri;
  if (pred?.bytesBase64Encoded) return `data:video/mp4;base64,${pred.bytesBase64Encoded}`;
  return null;
}

/* ---------- Routes ---------- */

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'gemini-cloud-gateway',
    engines: { image: 'Nano Banana 2', video: 'Veo' },
    active_image_model: ACTIVE_IMAGE_MODEL,
    active_video_model: ACTIVE_VIDEO_MODEL,
    endpoints: {
      image: 'POST /v1/images/generations',
      video: 'POST /v1/videos/generations',
      video_download: 'GET /v1/videos/download?uri=...',
    },
    time: new Date().toISOString(),
  });
});

app.get('/healthz', (req, res) => res.status(200).send('ok'));

app.post('/v1/images/generations', async (req, res) => {
  const prompt = req.body?.prompt;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: { message: 'Field "prompt" (string) is required.', type: 'invalid_request_error' } });
  }
  try {
    const r = await callImage(prompt);
    const b64 = extractImageB64(r);
    if (!b64) {
      return res.status(502).json({ error: { message: 'Gemini returned no image data.', type: 'upstream_error', raw: r } });
    }
    res.json({
      created: Math.floor(Date.now() / 1000),
      model: ACTIVE_IMAGE_MODEL,
      data: [{ b64_json: b64, revised_prompt: prompt }],
    });
  } catch (err) {
    console.error('Image gateway error:', err.message);
    res.status(500).json({ error: { message: err.message, type: 'gateway_error', model_attempted: ACTIVE_IMAGE_MODEL } });
  }
});

app.post('/v1/videos/generations', async (req, res) => {
  const prompt = req.body?.prompt;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: { message: 'Field "prompt" (string) is required.', type: 'invalid_request_error' } });
  }
  const opts = {
    aspectRatio: req.body?.aspect_ratio || req.body?.aspectRatio,
    durationSeconds: req.body?.duration_seconds || req.body?.durationSeconds,
    personGeneration: req.body?.person_generation,
  };
  try {
    const t0 = Date.now();
    const opName = await startVeoOperation(ACTIVE_VIDEO_MODEL, prompt, opts);
    console.log(`[video] started operation ${opName}`);
    const veoResp = await pollVeoOperation(opName);
    const videoUri = extractVideoUri(veoResp);
    if (!videoUri) {
      return res.status(502).json({ error: { message: 'Veo returned no video URI.', type: 'upstream_error', raw: veoResp } });
    }
    const elapsed = Math.round((Date.now() - t0) / 1000);
    let downloadUrl = null;
    if (PUBLIC_URL && videoUri.startsWith('https://' + GEMINI_HOST)) {
      downloadUrl = `${PUBLIC_URL}/v1/videos/download?uri=${encodeURIComponent(videoUri)}`;
    } else if (videoUri.startsWith('data:')) {
      downloadUrl = videoUri;
    }
    res.json({
      created: Math.floor(Date.now() / 1000),
      model: ACTIVE_VIDEO_MODEL,
      duration_s: elapsed,
      data: [{ video_uri: videoUri, download_url: downloadUrl, revised_prompt: prompt }],
    });
  } catch (err) {
    console.error('Video gateway error:', err.message);
    res.status(500).json({ error: { message: err.message, type: 'gateway_error', model_attempted: ACTIVE_VIDEO_MODEL } });
  }
});

/* GET /v1/videos/download?uri=<google file uri>
 * Streams the MP4 back with the API key attached. The caller never sees
 * the key. Restricted to generativelanguage.googleapis.com URIs only so
 * this can't be abused as an open proxy. */
app.get('/v1/videos/download', (req, res) => {
  const uri = req.query.uri;
  if (!uri || typeof uri !== 'string') {
    return res.status(400).json({ error: { message: 'Query param "uri" is required.', type: 'invalid_request_error' } });
  }
  let u;
  try { u = new URL(uri); } catch (e) {
    return res.status(400).json({ error: { message: 'Invalid uri.', type: 'invalid_request_error' } });
  }
  if (u.protocol !== 'https:' || u.hostname !== GEMINI_HOST) {
    return res.status(403).json({ error: { message: `Only https://${GEMINI_HOST} URIs may be proxied.`, type: 'forbidden' } });
  }
  u.searchParams.set('key', GEMINI_API_KEY);
  const upstream = https.get(u.toString(), { timeout: 120000 }, (up) => {
    res.status(up.statusCode || 502);
    if (up.headers['content-type']) res.set('Content-Type', up.headers['content-type']);
    if (up.headers['content-length']) res.set('Content-Length', up.headers['content-length']);
    res.set('Content-Disposition', 'attachment; filename="video.mp4"');
    up.pipe(res);
  });
  upstream.on('error', (e) => {
    if (!res.headersSent) res.status(502).json({ error: { message: e.message, type: 'gateway_error' } });
  });
  upstream.on('timeout', () => upstream.destroy(new Error('download timeout')));
});

/* ---------- Self-ping keep-warm ---------- */

function startSelfPing() {
  const externalUrl = process.env.RENDER_EXTERNAL_URL || process.env.SELF_PING_URL;
  if (!externalUrl) {
    console.log('Self-ping disabled (RENDER_EXTERNAL_URL not set).');
    return;
  }
  const intervalMs = parseInt(process.env.SELF_PING_INTERVAL_MS, 10) || 10 * 60 * 1000;
  const target = `${externalUrl.replace(/\/$/, '')}/healthz`;
  let parsed;
  try { parsed = new URL(target); } catch (e) { console.warn(`Self-ping URL invalid: ${e.message}`); return; }
  const ping = () => {
    const reqLib = parsed.protocol === 'https:' ? https : require('http');
    const r = reqLib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        timeout: 15000,
        headers: { 'User-Agent': 'gemini-cloud-gateway-selfping/1.0' },
      },
      (res) => { res.resume(); console.log(`[selfping] ${target} -> HTTP ${res.statusCode}`); }
    );
    r.on('error', (e) => console.warn(`[selfping] error: ${e.message}`));
    r.on('timeout', () => r.destroy(new Error('selfping timeout')));
    r.end();
  };
  setTimeout(ping, 30 * 1000);
  setInterval(ping, intervalMs);
  console.log(`Self-ping enabled: ${target} every ${Math.round(intervalMs / 1000)}s`);
}

/* ---------- Boot ---------- */

(async () => {
  const available = await listAvailableModels();
  ACTIVE_IMAGE_MODEL = pickFromChain(IMAGE_MODEL_CHAIN, available, 'image');
  ACTIVE_VIDEO_MODEL = pickFromChain(VIDEO_MODEL_CHAIN, available, 'veo');
  app.listen(PORT, () => {
    console.log(`gemini-cloud-gateway listening on :${PORT}`);
    console.log(`Active image model: ${ACTIVE_IMAGE_MODEL}`);
    console.log(`Active video model: ${ACTIVE_VIDEO_MODEL}`);
    console.log('Endpoints: POST /v1/images/generations, POST /v1/videos/generations, GET /v1/videos/download');
    startSelfPing();
  });
})();
