<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Use shared browser-safe request-safety helpers for credential redaction and JSON-object checks so client and server logs apply the same safeguards.
- Decode Gemini direct-response PCM to a WAV Blob in the browser-safe audio helper; the provider returns JSON rather than a playable audio response.
- Treat an explicit TTS providers list as ordered fallback, with provider-scoped options overriding common options; this keeps requests within the caller's chosen services.
