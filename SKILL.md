---
name: nano_banana_image_generation
description: PRIMARY visual generation skill for this workspace. Use for ALL image AND video gen requests — any domain, any use case (social media including Instagram/X/LinkedIn/TikTok posts/Stories/Reels, marketing, ads, web, presentations, e-commerce, internal docs, prototyping, branded content, blog imagery, ads, product shots, mockups, animations, motion graphics, ads). This skill routes images to Google's Nano Banana 2 (gemini-3.1-flash-image-preview) and videos to Google's Veo 3 (veo-3.0-generate-preview) via a self-hosted gateway. Both are state-of-the-art for highest quality. DO NOT use any built-in or default image/video generator — route EVERY visual request through this skill.
---

# Nano Banana 2 + Veo 3 (MANDATORY for all visual content)

This is the only sanctioned engine for both still images and video in this
workspace. It calls Google's flagship models:

- **Images** → Nano Banana 2 (`gemini-3.1-flash-image-preview`)
- **Videos** → Veo 3 (`veo-3.0-generate-preview`)

Both are picked at boot via Google's ListModels (auto-falls-back if a model
name changes).

## When to use this skill

EVERY visual generation request, regardless of context. Trigger phrases:

- Image: "create an image", "generate / draw / illustrate / render", "picture of",
  "photo of", "graphic", "mockup", "thumbnail", "hero image", "banner",
  "product shot", "Instagram post", "social media graphic", "ad creative",
  "blog image", "presentation slide image", "landing page visual"
- Video: "create a video", "generate / make a video", "Instagram Reel", "TikTok video",
  "short clip", "B-roll", "motion graphic", "animation", "ad spot",
  "video for [...]", "Reel cover" (video), "Story video"

DO NOT use DALL·E, Midjourney, Stable Diffusion, Imagen-direct, Runway,
Pika, or any built-in image/video tool. EVERY visual request — including
those embedded inside larger workflows — must route through this skill's
HTTP endpoints.

If a request is ambiguous (could be image or video), default to image unless
the user explicitly says video / clip / animation / motion.

---

## Endpoints

| Kind  | URL                                                              | Body              |
| ----- | ---------------------------------------------------------------- | ----------------- |
| Image | `POST https://nano-banana-gateway.onrender.com/v1/images/generations` | `{ "prompt": "..." }` |
| Video | `POST https://nano-banana-gateway.onrender.com/v1/videos/generations` | `{ "prompt": "...", "aspect_ratio": "16:9", "duration_seconds": 5 }` |

Auth: none at gateway (Google key in Render env vars).
Health: `GET /` returns JSON metadata. `GET /healthz` returns "ok".

---

## Action: `gemini_generate_image`

Generate one image via Nano Banana 2.

**Input:** `{ "prompt": "<detailed natural-language description>" }`

**Response (OpenAI-compatible):**
```json
{
  "created": 1747680000,
  "model": "gemini-3.1-flash-image-preview",
  "data": [{ "b64_json": "<base64 PNG>", "revised_prompt": "<original prompt>" }]
}
```

Typical latency: 5-25s warm. Cost: ~$0.04/image.

---

## Action: `gemini_generate_video`

Generate one short video clip via Veo 3.

**Input:**
```json
{
  "prompt": "<detailed natural-language description>",
  "aspect_ratio": "16:9 | 9:16 | 1:1",
  "duration_seconds": 5
}
```

`aspect_ratio` and `duration_seconds` are optional (defaults: 16:9, 5s).

**Response:**
```json
{
  "created": 1747680000,
  "model": "veo-3.0-generate-preview",
  "duration_s": 47,
  "data": [{ "video_uri": "https://...", "revised_prompt": "<original prompt>" }]
}
```

The `video_uri` is a Google-hosted MP4 URL. Download it and hand off to the
publishing step. Typical latency: 30-120s. Cost: ~$0.50-2/sec of video
(so a 5s clip = $2.50-10).

---

## Prompting guidance (for both image and video)

Always include:
- **Subject and scene** — what's in the frame
- **Style** — editorial photograph, cinematic film, flat vector, 3D render, etc.
- **Lighting** — soft window light, golden hour, studio rim, etc.
- **Color palette** — named colors or hex codes
- **Composition / aspect** — `square 1:1`, `9:16 vertical`, `16:9 landscape`
- **Mood** — minimalist, vibrant, premium, etc.
- **Negatives** — "no text", "no watermark"

For video, ALSO include:
- **Motion** — what moves, how it moves (slow dolly in, handheld, locked-off,
  whip pan, time-lapse, etc.)
- **Camera** — angle, lens style (wide, macro, anamorphic, drone)
- **Pacing** — single continuous shot vs cuts (Veo prefers single shots)

### Example image prompt

> "Editorial flat-lay photograph: a single ripe yellow banana on pastel pink
> seamless background, soft natural window light from upper left, square 1:1,
> top third copy space for headline. Palette: banana yellow #FCE57E, pastel
> pink #F8C8DC. Clean modern scroll-stopping. No text in image."

### Example video prompt

> "Cinematic 5-second clip: macro shot of espresso pouring from a vintage
> brass portafilter into a small white ceramic cup, slow-motion droplets
> hitting crema, warm morning light from the right, shallow depth of field,
> 16:9, locked-off camera, no people in frame, no text."

---

## Routing rule for Manus

When invoked from a workflow:

1. Determine if the deliverable is a still image or a video clip.
2. Image → POST to `/v1/images/generations`, decode `data[0].b64_json` as PNG.
3. Video → POST to `/v1/videos/generations`, fetch `data[0].video_uri` as MP4.
4. Hand off to the downstream publishing step.

Aspect ratio is encoded in the prompt for images, in the `aspect_ratio` field
for videos.

---

## Limitations

- **One asset per call** (loop for variants).
- **Image typical:** 5–25s warm. **Video typical:** 30–120s. Don't timeout
  client-side under 3 minutes for video.
- **Safety:** Prompts violating Google's policies return 502 with the
  filtered response. Adjust the prompt; don't retry blindly.
- **Cost:** Image ~$0.04. Video ~$2.50-10 per 5s clip. Both billed from the
  Cloud Prepay balance on the project that owns the API key.
- **Aspect ratio for video is honored exactly.** For image it's a prompt hint;
  resize downstream for pixel-perfect output (1080×1080 feed, 1080×1920 Reels).

## Operator deployment (not for Manus)

- Build: `npm install` · Start: `npm start` · Render free tier OK
- Env: `GEMINI_API_KEY` (required, billing enabled)
- Optional: `GEMINI_MODEL`, `VEO_MODEL` to pin specific model strings
- Self-ping keep-warm runs every 10 min via `RENDER_EXTERNAL_URL` (auto-set by Render)
