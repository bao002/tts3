CREATE TABLE public.provider_api_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 service text NOT NULL CHECK (service IN ('openrouter', 'lovable')),
 fingerprint text NOT NULL,
 ciphertext text NOT NULL,
 source text NOT NULL DEFAULT 'saved',
 status text NOT NULL DEFAULT 'unknown',
 code integer,
 failures integer NOT NULL DEFAULT 0,
 in_flight integer NOT NULL DEFAULT 0,
 last_used timestamptz,
 quarantined_until timestamptz,
 rotation_order bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (service, fingerprint)
);
INSERT INTO public.provider_api_keys (service, fingerprint, ciphertext, source, status, code, failures, last_used, quarantined_until, rotation_order, created_at)
 SELECT 'openrouter', fingerprint, ciphertext, source, status, code, failures, last_used, quarantined_until, rotation_order, created_at
 FROM public.openrouter_keys
 ON CONFLICT (service, fingerprint) DO NOTHING;
GRANT ALL ON public.provider_api_keys TO service_role;
ALTER TABLE public.provider_api_keys ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.provider_key_rotation (
 service text PRIMARY KEY CHECK (service IN ('openrouter', 'lovable')),
 cursor bigint NOT NULL DEFAULT 0
);
GRANT ALL ON public.provider_key_rotation TO service_role;
ALTER TABLE public.provider_key_rotation ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.provider_usage_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 method text NOT NULL,
 service text NOT NULL,
 status integer NOT NULL,
 duration_ms integer NOT NULL DEFAULT 0,
 audio_bytes integer NOT NULL DEFAULT 0,
 input_chars integer NOT NULL DEFAULT 0,
 output_chars integer NOT NULL DEFAULT 0,
 estimated_input_tokens integer NOT NULL DEFAULT 0,
 provider_input_tokens integer,
 provider_output_tokens integer,
 cached boolean NOT NULL DEFAULT false
);
CREATE INDEX provider_usage_events_occurred_at_idx ON public.provider_usage_events (occurred_at DESC);
CREATE INDEX provider_usage_events_service_time_idx ON public.provider_usage_events (service, occurred_at DESC);
GRANT ALL ON public.provider_usage_events TO service_role;
ALTER TABLE public.provider_usage_events ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.reserve_provider_key(service_name text, excluded_keys uuid[] DEFAULT '{}') RETURNS SETOF public.provider_api_keys
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
 chosen_id uuid;
 next_order bigint;
BEGIN
 INSERT INTO public.provider_key_rotation(service, cursor) VALUES (service_name, 1)
 ON CONFLICT (service) DO UPDATE SET cursor = provider_key_rotation.cursor + 1
 RETURNING cursor INTO next_order;
 SELECT id INTO chosen_id FROM public.provider_api_keys
 WHERE service = service_name AND id <> ALL(excluded_keys)
 AND (quarantined_until IS NULL OR quarantined_until <= now())
 ORDER BY in_flight, rotation_order, created_at, id
 FOR UPDATE SKIP LOCKED LIMIT 1;
 IF chosen_id IS NULL THEN RETURN; END IF;
 RETURN QUERY UPDATE public.provider_api_keys
 SET in_flight = in_flight + 1, last_used = now(), rotation_order = next_order
 WHERE id = chosen_id RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.reserve_provider_key(text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_provider_key(text, uuid[]) TO service_role;

CREATE FUNCTION public.mark_provider_key(key_id uuid, response_code integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 UPDATE public.provider_api_keys SET
 in_flight = greatest(in_flight - 1, 0),
 failures = CASE WHEN response_code < 300 THEN 0 ELSE failures + 1 END,
 status = CASE WHEN response_code < 300 THEN 'ok' WHEN failures + 1 >= 10 THEN 'quarantined'
 WHEN response_code IN (401,402,403,429) THEN 'blocked' ELSE 'error' END,
 quarantined_until = CASE WHEN response_code >= 300 AND failures + 1 >= 10 THEN now() + interval '15 minutes' ELSE NULL END,
 code = response_code,
 rotation_order = CASE WHEN response_code >= 300 THEN (SELECT coalesce(max(rotation_order),0) + 1 FROM public.provider_api_keys WHERE service = provider_api_keys.service) ELSE rotation_order END
 WHERE id = key_id;
END $$;
REVOKE ALL ON FUNCTION public.mark_provider_key(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_provider_key(uuid, integer) TO service_role;

CREATE FUNCTION public.provider_usage_report(window_hours integer DEFAULT 24) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 WITH scoped AS (
  SELECT * FROM public.provider_usage_events
  WHERE occurred_at >= now() - make_interval(hours => greatest(1, least(window_hours, 720)))
 ), totals AS (
  SELECT count(*) AS requests,
   count(*) FILTER (WHERE status >= 200 AND status < 300) AS successful,
   count(*) FILTER (WHERE status < 200 OR status >= 300) AS failed,
   count(*) FILTER (WHERE cached) AS cached,
   coalesce(sum(audio_bytes), 0) AS audio_bytes,
   coalesce(sum(estimated_input_tokens), 0) AS estimated_input_tokens,
   coalesce(sum(provider_input_tokens), 0) AS provider_input_tokens,
   coalesce(sum(provider_output_tokens), 0) AS provider_output_tokens,
   coalesce(round(avg(duration_ms)), 0) AS avg_duration_ms
  FROM scoped
 ), services AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'service', service, 'requests', requests, 'successful', successful, 'failed', failed,
   'cached', cached, 'audio_bytes', audio_bytes, 'estimated_input_tokens', estimated_input_tokens,
   'provider_input_tokens', provider_input_tokens, 'provider_output_tokens', provider_output_tokens,
   'avg_duration_ms', avg_duration_ms
  ) ORDER BY requests DESC), '[]'::jsonb) AS rows
  FROM (
   SELECT service, count(*) AS requests,
    count(*) FILTER (WHERE status >= 200 AND status < 300) AS successful,
    count(*) FILTER (WHERE status < 200 OR status >= 300) AS failed,
    count(*) FILTER (WHERE cached) AS cached,
    coalesce(sum(audio_bytes), 0) AS audio_bytes,
    coalesce(sum(estimated_input_tokens), 0) AS estimated_input_tokens,
    coalesce(sum(provider_input_tokens), 0) AS provider_input_tokens,
    coalesce(sum(provider_output_tokens), 0) AS provider_output_tokens,
    coalesce(round(avg(duration_ms)), 0) AS avg_duration_ms
   FROM scoped GROUP BY service
  ) grouped
 )
 SELECT jsonb_build_object('window_hours', greatest(1, least(window_hours, 720)),
  'totals', (SELECT to_jsonb(totals) FROM totals), 'services', services.rows)
 FROM services
$$;
REVOKE ALL ON FUNCTION public.provider_usage_report(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_usage_report(integer) TO service_role;