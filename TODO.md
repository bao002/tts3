summary:
  title: "Multi-Provider Auth & Client-Side Playback Speed Plan"
  
  issue:
    description: "Saved provider keys (Gemini, OpenAI, ElevenLabs, Deepgram, OpenRouter) are valid in user settings, but 'Generate with all providers' and 'ProviderCompare' fail."
    root_cause: "Client-side comparison requests to /api/public/tts were sent as unauthenticated fetch calls without the Supabase access token, causing the backend to treat the session as anonymous and skip user provider key lookup."

  planned_changes:
    - area: "Authentication & Authorization"
      files:
        - "src/components/provider-compare.tsx"
        - "src/routes/index.tsx"
      actions:
        - "Retrieve active session via supabase.auth.getSession() before firing requests."
        - "Add 'Authorization: Bearer <access_token>' to request headers when user is signed in."
        - "Surface an explicit warning if signed out: only anonymous Google TTS will succeed until the user signs in."

    - area: "Audio Speed Handling"
      files:
        - "src/components/provider-compare.tsx"
        - "src/routes/index.tsx"
      actions:
        - "Omit 'speed' parameter from provider synthesis request bodies to always generate standard 1.0x audio."
        - "Attach the client speed slider directly to HTMLAudioElement.playbackRate (supporting 0.25x - 4x) for playback."
        - "Ensure preservesPitch remains active (browser default) so tone and pitch remain natural."

  important_notes:
    auth_and_session:
      - token_refresh: "supabase.auth.getSession() handles automatic token refresh; stale tokens won't break long-running comparison sessions."
      - key_encryption: "User provider keys are encrypted with OPENROUTER_KEY_ENCRYPTION_SECRET; the server decrypts them only when a verified user JWT is present."
      - anonymous_fallback: "Unauthenticated requests only allow Google Translate TTS. All other providers require either a user session with saved keys or an inline api_key."
      - personal_tokens: "Requests from external tools can alternatively use personal API tokens (pat_...) in the Authorization header."

    provider_compatibility:
      - voice_mismatch: "Comparison requests must not pass cross-provider voice names (e.g. Gemini's 'Kore' sent to OpenRouter will trigger HTTP 400). Each provider must use its respective default or mapped voice."
      - openrouter_free_models: "OpenRouter rate limits or free model availability (e.g. Fish Audio) may return transient 429/503 errors distinct from authentication failures."
      - lovable_provider: "The 'lovable' provider relies on platform AI gateway configuration; if unconfigured on the backend, it reports failure independently of user keys."

    audio_and_performance:
      - pitch_preservation: "Client-side playbackRate maintains clean pitch and tempo without provider-side resampling artifacts."
      - api_backward_compatibility: "The HTTP API will retain support for the 'speed' parameter for external API callers; only the frontend stops sending it."
      - memory_management: "Each comparison run allocates Object URLs for audio blobs; all previous URLs must be revoked with URL.revokeObjectURL to avoid browser memory leaks."
      - parallel_vs_sequential: "ProviderCompare executes requests in parallel via Promise.all, while 'Play with all providers' runs sequentially to allow immediate listening."

  next_steps:
    - "Switch to Build mode to patch src/components/provider-compare.tsx and src/routes/index.tsx."
    - "Test 'Generate with all providers' with your saved keys while signed in."
