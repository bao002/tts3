# Speak API

A text-to-speech web service with optional translation. Type text, pick a voice
provider, and get audio back — through the web playground or a public HTTP API.

- **Live app:** https://tts3.lovable.app
- **API reference (human-readable):** https://tts3.lovable.app/docs
- **OpenAPI document (machine-readable):** https://tts3.lovable.app/api/public/openapi.json

## What it does

- Converts text (1–5000 characters) into spoken audio.
- Optionally translates the text into another language before speaking.
- Supports multiple speech providers: Google, Lovable, OpenRouter, Gemini,
  OpenAI, ElevenLabs, and Deepgram. `auto` picks a configured provider that
  has not recently failed.
- Tracks usage (requests, characters, tokens, audio bytes) and keeps a
  playable history of generated audio for signed-in users.

## Using the web app

1. Open https://tts3.lovable.app and use the playground: enter text, choose a
   language and provider, and press play. Google voices work without an
   account.
2. To use the other providers, sign up (email confirmation is disabled, so
   accounts are ready instantly), then open the **Account** page and add your
   provider API keys. Keys are stored encrypted and can be tested before
   saving.
3. The **History** page replays your past audio; **Reports** shows usage
   totals; **Tokens** manages personal API tokens for programmatic access.

## Using the HTTP API

The main endpoint is `POST /api/public/tts` (a `GET` variant accepts the same
fields as query parameters).

```sh
curl -X POST https://tts3.lovable.app/api/public/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world", "lang": "en", "provider": "google"}' \
  --output hello.mp3
```

Request body fields:

| Field | Required | Description |
| --- | --- | --- |
| `text` | yes | Text to speak, 1–5000 characters. |
| `lang` | yes | Source language code, e.g. `en`, `es-419`, `pt-BR`. |
| `provider` | no | `auto`, `google`, `lovable`, `openrouter`, `gemini`, `openai`, `elevenlabs`, or `deepgram`. |
| `target_lang` | no | Translate the text into this language before speaking. |
| `voice` | no | Provider-specific voice name or ID. |
| `speed` | no | Speech rate multiplier, 0.25–4 (default 1). |
| `options` | no | Provider-specific settings (model, encoding, etc.). |
| `format` | no | `binary` (raw audio, default) or `json` (base64 audio). |
| `api_key` | no | Per-request provider key; takes precedence over saved keys and is never stored. |

The response is the audio file. Useful response headers:

- `X-Provider` — which provider generated the audio (important when using `auto`).
- `X-Response-Time-Ms` — server-side duration.
- `X-Provider-Input-Tokens` / `X-Provider-Output-Tokens` — provider-reported usage, when available.

### Authentication

Most endpoints work anonymously with per-request keys. For saved keys and
usage history, create a personal API token on the **Tokens** page and send it
as a bearer header:

```sh
curl -X POST https://tts3.lovable.app/api/public/tts \
  -H "Authorization: Bearer <your-personal-token>" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello", "lang": "en", "provider": "auto"}' \
  --output hello.mp3
```

### Other endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/public/info` | Public service information. |
| `GET /api/public/usage` | Anonymous usage aggregates. |
| `POST /api/public/access-token` | Create a temporary access token. |
| `GET/POST/DELETE /api/public/openrouter-keys` | Manage shared provider keys (bearer auth). |
| `GET /api/report/usage` | Authenticated usage report (`?hours=` window, 1–720). |
| `GET/POST/DELETE /api/user/token` | Manage personal API tokens. |
| `GET/POST/DELETE /api/user/provider-keys` | Manage your saved provider keys. |

Full request and response schemas are in the
[OpenAPI document](https://tts3.lovable.app/api/public/openapi.json) and the
[API reference](https://tts3.lovable.app/docs), which also includes a form to
try a speech request directly from the browser.

## Development

Built with [Lovable](https://lovable.dev). Continue developing in the
[Lovable editor](https://lovable.dev/projects/0acfa575-7aed-498f-b60c-6d05c69509f1);
changes sync to the connected GitHub repository, and a GitHub Actions workflow
deploys the main branch to Vercel.

To work locally you need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating):

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

The backend is an external Supabase project. Set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` (from the Supabase project's API settings) in
your environment; see `.github/workflows/deploy-vercel.yml` for the variables
the deployment expects. Provider API keys (OpenRouter, Gemini, OpenAI,
ElevenLabs, Deepgram) are added per user through the Account page rather than
through environment variables.

More engineering documentation lives in [docs/README.md](docs/README.md).
