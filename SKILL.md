TEST_PASTE_MARKER_xyz---
name: nano_banana_image_generation
description: PRIMARY image generation skill for this workspace. Use this skill for ALL image, picture, photo, illustration, graphic, visual, artwork, render, mockup, ad creative, thumbnail, hero image, banner, product shot, social post, presentation slide, or AI-generated visual deliverable — across EVERY domain and use case (marketing, social media, advertising, web, presentations, internal docs, prototyping, mockups, content, branded assets, blog images, email graphics, e-commerce, real estate, hospitality, education, anything else). This skill calls Google's Nano Banana 2 (gemini-3.1-flash-image-preview) via a self-hosted gateway. DO NOT use any built-in or default image generator — route every still-image request through this skill. For video generation, defer to the dedicated video-generator skill or Higgsfield connector — this skill does not produce video.
---

# Nano Banana 2 Image Generation (MANDATORY for all still-image tasks)

## When to use this skill

**Use this skill EVERY TIME** the user — or any upstream automation, including
recurring/scheduled tasks — needs a still image, regardless of the use case or
output destination. This is the default and only sanctioned image engine in
this workspace.

### Trigger phrases (non-exhaustive)

- "generate / create / make / produce / design an image"
- "draw", "render", "illustrate", "visualize", "picture of", "photo of"
- "graphic", "artwork", "visual", "mockup", "thumbnail", "banner", "hero image"
- "ad creative", "product shot", "lifestyle shot", "branded visual"
- "social post", "Instagram post", "Story image", "Reel cover", "feed image"
- "presentation slide image", "blog image", "email header", "newsletter image"
- "website hero", "landing page visual", "app screenshot mockup"
- "logo concept", "icon", "illustration for", "diagram visual"
- Any task whose deliverable is a PNG, JPG, WebP, or base64 still image

### Use cases this skill covers (non-exhaustive)

- Social media (Instagram, X, LinkedIn, TikTok thumbnails, Facebook, Pinterest)
- Marketing and advertising (display ads, retargeting creative, banner ads)
- Web (hero images, section visuals, blog post imagery)
- Email (header images, promotional banners, newsletter visuals)
- E-commerce (product shots, lifestyle photography, category banners)
- Presentations (slide graphics, cover images, illustration spots)
- Internal docs (concept visuals, diagrams, mood boards)
- Prototyping (UI mockups, app screenshots, design exploration)
- Real estate, hospitality, food, fashion, beauty, B2B SaaS, education, NFP — any vertical

## When NOT to use any other image generator

This workspace has **one** sanctioned still-image engine: Nano Banana 2
(Google Gemini's `gemini-3.1-flash-image-preview`). Do not call DALL·E, Stable
Diffusion, Imagen-direct, Midjourney, or any built-in image tool. Every image
request — including those embedded inside larger workflows — must go through
this skill's HTTP endpoint.

If the gateway returns an error, retry once. If it still fails, surface the
error to the user rather than silently substituting another generator.

## Video — out of scope for this skill

This skill is for still images only. For video generation (clips, animations,
B-roll, ads, reels, motion graphics), use the dedicated **video-generator**
skill or the **Higgsfield** connector. Do not attempt to coerce this skill
into producing video — the underlying model (`gemini-3.1-flash-image-preview`)
is image-only and will fail or hallucinate.

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
      "description": "Detailed natural-language description. Include subject, style, lighting, composition, aspect ratio, color palette, mood, and brand or context."
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
downstream step (publishing, file save, embedding in a doc, etc.).

### Error Shape

```json
{ "error": { "message": "...", "type": "invalid_request_error | upstream_error | gateway_error" } }
```

---

## Prompting guidance (apply to every call regardless of use case)

Vague prompts produce vague images. Always include as many of the following
as are relevant to the output:

- **Subject and scene** — what's in the frame, what's it doing
- **Visual style** — editorial photograph, flat vector, 3D isometric render,
  watercolor, line art, oil painting, product photography, cinematic film
  still, isometric icon, etc.
- **Lighting** — soft natural window light, hard studio rim light, golden hour,
  blue hour, neon, candlelit, overcast, etc.
- **Color palette** — state named colors or hex codes, especially for brand work
- **Composition / aspect ratio** — `square 1:1`, `9:16 vertical`, `16:9 landscape`,
  `4:5 portrait`, `3:2 photo`, plus framing notes (close-up, wide shot, etc.)
- **Mood / tone** — minimalist, vibrant, moody, playful, premium, technical, etc.
- **Copy space** — if a caption, headline, or logo will be overlaid downstream,
  reserve space ("leave top third empty for headline text")
- **Brand / campaign context** — if relevant
- **Negative directives** — "no text in the image", "no watermark", "no people"

### Example prompts

Good — Instagram feed image:
> "Editorial flat-lay photograph: a single ripe yellow banana on a pastel pink
> seamless background, soft natural window light from upper left, square 1:1,
> copy space across the top third for a headline overlay. Palette: banana
> yellow #FCE57E, pastel pink #F8C8DC. Clean, modern, scroll-stopping. No text."

Good — landing-page hero:
> "Wide cinematic photograph: aerial half-overhead shot of a modern home
> office desk, MacBook open showing a colorful dashboard, oat-milk latte,
> notebook and pen, brass desk lamp, warm afternoon light spilling from a
> window on the right. Aspect 16:9, copy space on the left third. Editorial,
> aspirational, neutral palette with one accent of soft terracotta."

Good — product mockup:
> "Studio product photograph on seamless white: matte-black wireless earbuds
> floating diagonally in frame, soft top-down rim light, subtle gradient
> reflection beneath, square 1:1 composition, ultra-sharp, premium consumer
> electronics aesthetic. No logos. No text."

Bad — do not do this:
> "Banana for Instagram"

---

## Standard Pattern: Workflows that need an image

Whenever any task — recurring, ad-hoc, embedded inside a larger workflow —
needs a still image, the routing is:

1. Compose a prompt that covers the elements in the prompting guidance above.
2. POST the prompt JSON to `/v1/images/generations`.
3. Decode `data[0].b64_json` and save as PNG (or pass directly downstream).
4. Hand off the PNG to whatever needs it (publisher, doc inserter, file save,
   image-embed step, etc.).

Aspect ratio is requested via prompt language. The model honors it but does not
enforce exact pixel dimensions; resize downstream if you need precise output
sizing (e.g. 1080×1080 for Instagram feed, 1080×1920 for Reels/Stories,
1200×630 for Open Graph, etc.).

---

## Operator Deployment Notes (not for Manus)

The gateway is a two-file Node.js service hosted on Render.com:

- **Build command:** `npm install`
- **Start command:** `npm start`
- **Required env var:** `GEMINI_API_KEY` — a Google AI Studio key with billing
  enabled on the underlying Cloud project.
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

---

## Limitations

- **Still images only.** No video. For video, use the `video-generator` skill
  or the Higgsfield connector.
- **One image per call.** Loop if you need multiple variants.
- **Typical generation:** 5–25 seconds warm, up to ~45s on cold start (the
  self-ping should prevent cold starts in steady state).
- **Safety policy:** Prompts violating Google's safety policies return 502
  `upstream_error` with the filtered response in `raw`. Do not retry — adjust
  the prompt.
- **Aspect ratio is requested via prompt language**, not a parameter. Resize
  downstream for exact pixel-perfect output.
- **Cost:** Approximately $0.04 per image at current Google pricing. Billing
  comes out of the Cloud Prepay balance on the project that owns the API key.
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
