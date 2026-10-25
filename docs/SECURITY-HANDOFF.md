# Gateway Access Handoff

The image, video and download routes now require `Authorization: Bearer <caller key>`. The health route stays public. The gateway returns 503 until `GATEWAY_API_KEY` is configured with a unique, printable 32 to 512 character value. Configure it only in the server's secret store; do not put the value in a repository, report or log.

Before an authorized rollout, give each approved caller the header through its own secret store and test it offline. Rollout is separate from this PR. Keep the source branch disabled until the caller configuration and independent review are accepted.

`GEMINI_API_KEY` remains the existing Google service credential. No key was generated, changed or deployed by this fix. Tests use synthetic values and do not call Google.
