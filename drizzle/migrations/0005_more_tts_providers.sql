ALTER TABLE public.provider_api_keys DROP CONSTRAINT IF EXISTS provider_api_keys_service_check;
ALTER TABLE public.provider_api_keys ADD CONSTRAINT provider_api_keys_service_check CHECK (service IN ('openrouter', 'lovable', 'gemini', 'openai', 'elevenlabs', 'deepgram', 'azure', 'googlecloud'));
ALTER TABLE public.provider_key_rotation DROP CONSTRAINT IF EXISTS provider_key_rotation_service_check;
ALTER TABLE public.provider_key_rotation ADD CONSTRAINT provider_key_rotation_service_check CHECK (service IN ('openrouter', 'lovable', 'gemini', 'openai', 'elevenlabs', 'deepgram', 'azure', 'googlecloud'));
ALTER TABLE public.user_provider_api_keys DROP CONSTRAINT IF EXISTS user_provider_api_keys_service_check;
ALTER TABLE public.user_provider_api_keys ADD CONSTRAINT user_provider_api_keys_service_check CHECK (service IN ('openrouter', 'lovable', 'gemini', 'openai', 'elevenlabs', 'deepgram', 'azure', 'googlecloud'));
CREATE OR REPLACE FUNCTION public.reserve_any_provider_key(excluded_keys uuid[] DEFAULT '{}')
RETURNS SETOF public.provider_api_keys
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
 chosen_id uuid;
 chosen_service text;
 next_order bigint;
BEGIN
 WITH available_services AS (
  SELECT DISTINCT service
  FROM public.provider_api_keys
  WHERE id <> ALL(excluded_keys)
    AND status NOT IN ('blocked', 'quarantined')
    AND (quarantined_until IS NULL OR quarantined_until <= now())
 ), randomized_services AS (
  SELECT service, row_number() OVER (ORDER BY random()) AS priority
  FROM available_services
 )
 SELECT keys.id, keys.service INTO chosen_id, chosen_service
 FROM public.provider_api_keys AS keys
 JOIN randomized_services ON randomized_services.service = keys.service
 WHERE keys.id <> ALL(excluded_keys)
   AND keys.status NOT IN ('blocked', 'quarantined')
   AND (keys.quarantined_until IS NULL OR keys.quarantined_until <= now())
 ORDER BY randomized_services.priority, keys.in_flight, keys.rotation_order, keys.created_at, keys.id
 FOR UPDATE OF keys SKIP LOCKED
 LIMIT 1;
 IF chosen_id IS NULL THEN RETURN; END IF;

 INSERT INTO public.provider_key_rotation(service, cursor) VALUES (chosen_service, 1)
 ON CONFLICT (service) DO UPDATE SET cursor = provider_key_rotation.cursor + 1
 RETURNING cursor INTO next_order;

 SELECT id INTO chosen_id FROM public.provider_api_keys
 WHERE service = chosen_service AND id <> ALL(excluded_keys)
   AND status NOT IN ('blocked', 'quarantined')
   AND (quarantined_until IS NULL OR quarantined_until <= now())
 ORDER BY in_flight, rotation_order, created_at, id
 FOR UPDATE SKIP LOCKED
 LIMIT 1;
 IF chosen_id IS NULL THEN RETURN; END IF;

 RETURN QUERY UPDATE public.provider_api_keys
 SET in_flight = in_flight + 1, last_used = now(), rotation_order = next_order
 WHERE id = chosen_id RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.reserve_any_provider_key(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_any_provider_key(uuid[]) TO service_role;