CREATE TABLE IF NOT EXISTS public.user_provider_key_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid NOT NULL,
 key_id uuid NOT NULL REFERENCES public.user_provider_api_keys(id) ON DELETE CASCADE,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 action text NOT NULL CHECK (action IN ('request', 'test')),
 response_code integer NOT NULL
);
GRANT ALL ON public.user_provider_key_events TO service_role;
REVOKE ALL ON public.user_provider_key_events FROM PUBLIC, anon, authenticated;
ALTER TABLE public.user_provider_key_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS user_provider_key_events_user_time_idx ON public.user_provider_key_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS user_provider_key_events_key_time_idx ON public.user_provider_key_events (key_id, occurred_at DESC);