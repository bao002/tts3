# Product backlog

These are user-reported product issues. Keep implementation status and
verification evidence in [the task ledger](./tasks.md). The completed items
below are retained as backlog history. All items here are complete; read this
file only when changing provider-key management or API testing.

## Provider keys and API testing

### 5. Show token and provider-key activity — Done

- Add a signed-in `/tokens` dashboard for personal API token status and all of
  the user's saved provider keys; do not expose shared server-managed keys.
- Show current routing availability, recent per-key synthesis/test history,
  masked key suffixes, and provider-specific billing/quota visibility limits.
- Record only timestamps, action type, and HTTP result for future key attempts;
  never store provider response bodies or credentials. Existing provider-level
  aggregates are not attributable to individual keys, so historical per-key
  activity begins after this change.
- Verification: 47 unit tests, 15 Docker-backed E2E tests, production build,
  Drizzle migration checks, targeted lint, and local Docker app/Auth health
  checks pass.

### 1. Show useful saved-key status and test keys — Done

- Replace `unknown` in the OpenRouter saved-key row with a masked suffix (last
  four characters only); never return or render the full secret after save.
- Add an explicit **Test key** action for each saved keyed provider. Use
  provider-specific authentication endpoints, display OpenRouter token/credit
  details when available, and distinguish invalid credentials, unavailable
  status information, and provider/network failures.
- Keep secrets encrypted at rest; do not put keys in URLs, browser logs, or
  server logs. Test response shapes and key-redaction behavior.

### 2. Use saved OpenRouter keys for speech generation — Done

- Resolve the signed-in user's saved OpenRouter key for OpenRouter speech
  requests when no per-request key is supplied.
- Preserve precedence: explicit per-request key, then the user's saved key,
  then server-configured keys. Do not require a separate environment key when
  the user already has a valid saved key.
- Add coverage for resolution, adapter authorization, and safe errors when no
  usable key exists. Verify a successful mocked OpenRouter synthesis request.

### 3. Keep Auto available when no provider keys are usable — Done

- Do not remove or reset the `auto` provider selection after a failed request
  or a no-available-keys response.
- Keep Auto selectable and show a useful error explaining that no configured,
  healthy provider key is available, with guidance for configuring one.
- Add UI regression tests for selection persistence and the no-key state.

### 4. Use personal access tokens in the `/docs` API tester — Done

- Add an authorization input to the interactive API tester so a user can paste
  a personal access token and apply it to eligible requests as a bearer token.
- Make clear that the token is held only in the current browser session unless
  the user explicitly opts into persistence; never include it in URLs or logs.
- Verify authenticated API calls succeed, unauthenticated calls retain current
  behavior, and token values are redacted from errors and telemetry.
