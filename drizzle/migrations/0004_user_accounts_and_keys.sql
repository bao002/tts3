CREATE TABLE public.user_provider_api_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 service text NOT NULL CHECK (service IN ('openrouter', 'lovable', 'gemini', 'openai', 'elevenlabs')),
 fingerprint text NOT NULL,
 ciphertext text NOT NULL,
 status text NOT NULL DEFAULT 'unknown',
 code integer,
 failures integer NOT NULL DEFAULT 0,
 in_flight integer NOT NULL DEFAULT 0,
 last_used timestamptz,
 quarantined_until timestamptz,
 rotation_order bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (user_id, service, fingerprint)
);
GRANT ALL ON public.user_provider_api_keys TO service_role;
ALTER TABLE public.user_provider_api_keys ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_api_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE,
 label text NOT NULL DEFAULT 'External agent',
 created_at timestamptz NOT NULL DEFAULT now(),
 last_used timestamptz,
 revoked_at timestamptz
);
GRANT ALL ON public.user_api_tokens TO service_role;
ALTER TABLE public.user_api_tokens ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.reserve_user_provider_key(owner_id uuid, service_name text, excluded_keys uuid[] DEFAULT '{}')
RETURNS SETOF public.user_provider_api_keys
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
 chosen_id uuid;
 next_order bigint;
BEGIN
 INSERT INTO public.provider_key_rotation(service, cursor) VALUES (service_name, 1)
 ON CONFLICT (service) DO UPDATE SET cursor = provider_key_rotation.cursor + 1
 RETURNING cursor INTO next_order;
 SELECT id INTO chosen_id FROM public.user_provider_api_keys
 WHERE user_id = owner_id AND service = service_name AND id <> ALL(excluded_keys)
   AND status NOT IN ('blocked', 'quarantined')
   AND (quarantined_until IS NULL OR quarantined_until <= now())
 ORDER BY in_flight, rotation_order, created_at, id
 FOR UPDATE SKIP LOCKED LIMIT 1;
 IF chosen_id IS NULL THEN RETURN; END IF;
 RETURN QUERY UPDATE public.user_provider_api_keys
 SET in_flight = in_flight + 1, last_used = now(), rotation_order = next_order
 WHERE id = chosen_id AND user_id = owner_id RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.reserve_user_provider_key(uuid, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_user_provider_key(uuid, text, uuid[]) TO service_role;

CREATE FUNCTION public.reserve_any_user_provider_key(owner_id uuid, excluded_keys uuid[] DEFAULT '{}')
RETURNS SETOF public.user_provider_api_keys
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
 chosen_id uuid;
 chosen_service text;
 next_order bigint;
BEGIN
 WITH available_services AS (
  SELECT DISTINCT service
  FROM public.user_provider_api_keys
  WHERE user_id = owner_id AND id <> ALL(excluded_keys)
    AND status NOT IN ('blocked', 'quarantined')
    AND (quarantined_until IS NULL OR quarantined_until <= now())
 ), randomized_services AS (
  SELECT service, row_number() OVER (ORDER BY random()) AS priority
  FROM available_services
 )
 SELECT keys.id, keys.service INTO chosen_id, chosen_service
 FROM public.user_provider_api_keys AS keys
 JOIN randomized_services ON randomized_services.service = keys.service
 WHERE keys.user_id = owner_id AND keys.id <> ALL(excluded_keys)
   AND keys.status NOT IN ('blocked', 'quarantined')
   AND (keys.quarantined_until IS NULL OR keys.quarantined_until <= now())
 ORDER BY randomized_services.priority, keys.in_flight, keys.rotation_order, keys.created_at, keys.id
 FOR UPDATE OF keys SKIP LOCKED
 LIMIT 1;
 IF chosen_id IS NULL THEN RETURN; END IF;
 INSERT INTO public.provider_key_rotation(service, cursor) VALUES (chosen_service, 1)
 ON CONFLICT (service) DO UPDATE SET cursor = provider_key_rotation.cursor + 1
 RETURNING cursor INTO next_order;
 RETURN QUERY UPDATE public.user_provider_api_keys
 SET in_flight = in_flight + 1, last_used = now(), rotation_order = next_order
 WHERE id = chosen_id AND user_id = owner_id RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.reserve_any_user_provider_key(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_any_user_provider_key(uuid, uuid[]) TO service_role;

CREATE FUNCTION public.mark_user_provider_key(owner_id uuid, key_id uuid, response_code integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 UPDATE public.user_provider_api_keys SET
  in_flight = greatest(in_flight - 1, 0),
  failures = CASE WHEN response_code < 300 THEN 0 ELSE failures + 1 END,
  status = CASE WHEN response_code < 300 THEN 'ok' WHEN failures + 1 >= 10 THEN 'quarantined'
   WHEN response_code IN (401, 402, 403, 429) THEN 'blocked' ELSE 'error' END,
  quarantined_until = CASE WHEN response_code >= 300 AND failures + 1 >= 10 THEN now() + interval '15 minutes' ELSE NULL END,
  code = response_code,
  rotation_order = CASE WHEN response_code >= 300 THEN (
   SELECT coalesce(max(rotation_order), 0) + 1 FROM public.user_provider_api_keys
   WHERE user_id = owner_id AND service = user_provider_api_keys.service
  ) ELSE rotation_order END
 WHERE id = key_id AND user_id = owner_id;
END $$;
REVOKE ALL ON FUNCTION public.mark_user_provider_key(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_user_provider_key(uuid, uuid, integer) TO service_role;

ALTER TABLE public.provider_usage_events ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX provider_usage_events_user_time_idx ON public.provider_usage_events (user_id, occurred_at DESC);
DROP FUNCTION public.provider_usage_report(integer);
CREATE FUNCTION public.provider_usage_report(window_hours integer DEFAULT 24, report_user_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 WITH scoped AS (
  SELECT * FROM public.provider_usage_events
  WHERE occurred_at >= now() - make_interval(hours => greatest(1, least(window_hours, 720)))
    AND (report_user_id IS NULL OR user_id = report_user_id)
 ), totals AS (
  SELECT count(*) AS requests,
   count(*) FILTER (WHERE status >= 200 AND status < 300) AS successful,
   count(*) FILTER (WHERE status < 200 OR status >= 300) AS failed,
   count(*) FILTER (WHERE cached) AS cached,
   coalesce(sum(audio_bytes), 0) AS audio_bytes,
   coalesce(sum(input_chars), 0) AS input_chars,
   coalesce(sum(output_chars), 0) AS output_chars,
   coalesce(sum(estimated_input_tokens), 0) AS estimated_input_tokens,
   coalesce(sum(provider_input_tokens), 0) AS provider_input_tokens,
   coalesce(sum(provider_output_tokens), 0) AS provider_output_tokens,
   coalesce(round(avg(duration_ms)), 0) AS avg_duration_ms
  FROM scoped
 ), services AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'service', service, 'requests', requests, 'successful', successful, 'failed', failed,
   'cached', cached, 'audio_bytes', audio_bytes, 'input_chars', input_chars, 'output_chars', output_chars,
   'estimated_input_tokens', estimated_input_tokens, 'provider_input_tokens', provider_input_tokens,
   'provider_output_tokens', provider_output_tokens, 'avg_duration_ms', avg_duration_ms
  ) ORDER BY requests DESC), '[]'::jsonb) AS rows
  FROM (
   SELECT service, count(*) AS requests,
    count(*) FILTER (WHERE status >= 200 AND status < 300) AS successful,
    count(*) FILTER (WHERE status < 200 OR status >= 300) AS failed,
    count(*) FILTER (WHERE cached) AS cached,
    coalesce(sum(audio_bytes), 0) AS audio_bytes,
    coalesce(sum(input_chars), 0) AS input_chars,
    coalesce(sum(output_chars), 0) AS output_chars,
    coalesce(sum(estimated_input_tokens), 0) AS estimated_input_tokens,
    coalesce(sum(provider_input_tokens), 0) AS provider_input_tokens,
    coalesce(sum(provider_output_tokens), 0) AS provider_output_tokens,
    coalesce(round(avg(duration_ms)), 0) AS avg_duration_ms
   FROM scoped GROUP BY service
  ) grouped
 )
 SELECT jsonb_build_object(
  'window_hours', greatest(1, least(window_hours, 720)),
  'totals', (SELECT to_jsonb(totals) FROM totals),
  'services', services.rows
 )
 FROM services
$$;
REVOKE ALL ON FUNCTION public.provider_usage_report(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_usage_report(integer, uuid) TO service_role;
