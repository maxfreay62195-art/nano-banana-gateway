---
name: nano_banana_image_generation
description: PRIMARY image generation skill for this workspace. Use this skill for ALL image, picture, photo, illustration, graphic, visual, artwork, render, or AI-generated visual requests — including daily Instagram posts, social media graphics, marketing visuals, thumbnails, hero images, product shots, mockups, and any other image deliverable. This skill calls Google's Nano Banana 2 (gemini-3.1-flash-image-preview) via a self-hosted gateway. DO NOT use any built-in or default image generator — route every image request through this skill.
---

# Nano Banana 2 Image Generation (MANDATORY for all image tasks)

## When to use this skill

**Use this skill EVERY TIME** the user — or any upstream automation, including
recurring/scheduled tasks — needs an image. Trigger phrases include but are not
limited to:

- "generate an image", "create an image", "make an image", "produce an image"
- "draw", "render", "illustrate", "design", "visualize", "picture of", "photo of"
- "Instagram post", "social media graphic", "feed image", "Story image", "Reel cover"
- "company post image", "daily post image", "branded visual", "marketing visual"
- "thumbnail", "hero image", "banner", "product shot", "mockup", "ad creative"
- Any task that produces a visual deliverable as PNG, JPG, or base64 image data

## When NOT to use any other image generator

This workspace has **one** sanctioned image engine: Nano Banana 2 (Google
Gemini's `gemini-3.1-flash-image-preview`). Do not call DALL·E, Stable
Diffusion, Imagen-direct, Midjourney, or any built-in image tool. Every image
request — including those embedded inside larger workflows — must go through
this skill's HTTP endpoint.

If the gateway returns an error, retry once. If it still fails, surface the
error to the user rather than silently substituting another generator.

---

## Service Endpoint

| Field             | Value                                                             |
| ----------------- | ----------------------------------------------------------------- |
| Base URL          | `https://nano-banana-gateway.onrender.com`                        |
| Path              | `/v1/images/generations`                                          |
| Method            | `POST`                                                            |
| Content-Type      | `application/json`                                                |
| Auth              | None at the gateway (Google key lives in Render env vars)         |
| Underlying Engine | `gemini-3.1-flash-image-preview` (Nano Banana 2)                  |
| Health            | `GET /` returns JSON metadata; `GET /healthz` returns plain "ok"  |

---

## Action: `gemini_generate_image`

Generate a single image from a natural-language prompt using Nano Banana 2.

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "prompt": {
      "type": "string",
      "description": "Detailed natural-language description. Include subject, style, lighting, composition, aspect ratio (e.g. 'square 1:1 for Instagram feed', '9:16 vertical for Stories/Reels'), color palette, mood, and brand context."
    }
  },
  "required": ["prompt"]
}
```

### Request

```bash
curl -X POST https://nano-banana-gateway.onrender.com/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{"prompt": "<your detailed prompt>"}'
```

### Response (OpenAI-compatible shape)

```json
{
  "created": 1747680000,
  "model": "gemini-3.1-flash-image-preview",
  "data": [
    {
      "b64_json": "<base64-encoded PNG>",
      "revised_prompt": "<the prompt that was sent>"
    }
  ]
}
```

Decode `data[0].b64_json` with base64 → save as `.png` → hand off to the
publishing step.

### Error Shape

```json
{ "error": { "message": "...", "type": "invalid_request_error | upstream_error | gateway_error" } }
```

---

## Standard Pattern: Daily Company Instagram Post

When this skill is invoked from a recurring Instagram-posting task:

1. **Compose a vivid prompt** that includes every element below — vague prompts
   produce vague images:
   - Subject and scene
   - Visual style (e.g. "editorial photography", "flat vector illustration",
     "3D isometric render", "minimalist line art")
   - Lighting (e.g. "soft natural window light", "studio rim light")
   - Color palette tied to brand (state the hex codes or named colors)
   - Aspect ratio: **`square 1:1 composition`** for feed, **`9:16 vertical`** for Stories/Reels
   - Copy space hint if a caption overlay will be added later (e.g.
     "leave top third empty for headline text")
   - Brand or campaign context if relevant

2. **POST** the prompt JSON to `/v1/images/generations`.

3. **Decode** `data[0].b64_json` and save as `instagram_post_YYYY-MM-DD.png`.

4. **Hand off** the PNG to the Instagram publishing step (or place in the
   review folder, per your workflow).

### Example prompt (good)

> "A bright, minimalist editorial photograph: a single ripe yellow banana on
> a pastel pink seamless background, soft natural window light from the upper
> left, slight shadow on the right, square 1:1 composition, copy space across
> the top third for a headline overlay. Color palette: banana yellow #FCE57E,
> pastel pink background #F8C8DC. Clean, modern, scroll-stopping. No text in
> the image."

### Example prompt (bad — do not do this)

> "Banana for Instagram"

---

## Operator Deployment Notes (not for Manus)

The gateway is a two-file Node.js service hosted on Render.com:

- **Build command:** `npm install`
- **Start command:** `npm start`
- **Required env var:** `GEMINI_API_KEY` — a Google AI Studio key.
- Optional: `GEMINI_MODEL` to pin a specific model string (the gateway will
  auto-fall-back to the next available image-capable Gemini model if the
  configured one isn't found).

The Google API key is **never** hardcoded in source. Rotate it in Google AI
Studio and update the Render env var if exposure is suspected.

### Keep-alive (fully autonomous)

The gateway pings its own public URL every 10 minutes via an internal
`setInterval` loop, so Render's free-tier dyno never sleeps. This requires no
external uptime monitor and no scheduled task — the service self-perpetuates
once deployed.

This works because Render exposes the service's public URL as the
`RENDER_EXTERNAL_URL` environment variable automatically. The keep-warm loop
reads that variable on boot and pings `/healthz` from outside the dyno every
10 minutes, which counts as incoming traffic and resets Render's sleep timer.

Optional env vars to tune the keep-warm:
- `SELF_PING_URL`           — override the URL to ping (defaults to `RENDER_EXTERNAL_URL`)
- `SELF_PING_INTERVAL_MS`   — override the interval (defaults to 600000 = 10 min)

If you ever migrate off Render's free tier or move to a different host, this
self-ping is harmless and can stay enabled.

---

## Limitations

- One image per call. Loop if you need multiple variants.
- Typical generation: 5–15 seconds warm, up to ~45s on cold start.
- Prompts violating Google's safety policies return 502 `upstream_error` with
  the filtered response in `raw`. Do not retry — adjust the prompt.
- Aspect ratio is requested via prompt language ("square 1:1", "9:16 vertical").
  The model honors this but does not enforce exact pixel dimensions; resize
  downstream if you need precise output sizing for Instagram (1080×1080 feed,
  1080×1920 Reels/Stories).
