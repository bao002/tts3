CREATE TABLE public.user_provider_key_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 key_id uuid NOT NULL REFERENCES public.user_provider_api_keys(id) ON DELETE CASCADE,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 action text NOT NULL CHECK (action IN ('request', 'test')),
 response_code integer NOT NULL
);
CREATE INDEX user_provider_key_events_user_time_idx
 ON public.user_provider_key_events (user_id, occurred_at DESC);
CREATE INDEX user_provider_key_events_key_time_idx
 ON public.user_provider_key_events (key_id, occurred_at DESC);
GRANT ALL ON public.user_provider_key_events TO service_role;
REVOKE ALL ON public.user_provider_key_events FROM PUBLIC, anon, authenticated;
ALTER TABLE public.user_provider_key_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.reserve_user_provider_key(owner_id uuid, service_name text, excluded_keys uuid[] DEFAULT '{}')
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
   AND status <> 'blocked'
   AND (status <> 'quarantined' OR quarantined_until <= now())
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

CREATE OR REPLACE FUNCTION public.reserve_any_user_provider_key(owner_id uuid, excluded_keys uuid[] DEFAULT '{}')
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
    AND status <> 'blocked'
    AND (status <> 'quarantined' OR quarantined_until <= now())
    AND (quarantined_until IS NULL OR quarantined_until <= now())
 ), randomized_services AS (
  SELECT service, row_number() OVER (ORDER BY random()) AS priority
  FROM available_services
 )
 SELECT keys.id, keys.service INTO chosen_id, chosen_service
 FROM public.user_provider_api_keys AS keys
 JOIN randomized_services ON randomized_services.service = keys.service
 WHERE keys.user_id = owner_id AND keys.id <> ALL(excluded_keys)
   AND keys.status <> 'blocked'
   AND (keys.status <> 'quarantined' OR keys.quarantined_until <= now())
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

DROP FUNCTION public.mark_user_provider_key(uuid, uuid, integer);
CREATE FUNCTION public.mark_user_provider_key(
 owner_id uuid,
 key_id uuid,
 response_code integer,
 action_name text DEFAULT 'request'
) RETURNS void
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

 IF FOUND THEN
  INSERT INTO public.user_provider_key_events (user_id, key_id, action, response_code)
  VALUES (owner_id, key_id, action_name, response_code);
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.mark_user_provider_key(uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_user_provider_key(uuid, uuid, integer, text) TO service_role;
