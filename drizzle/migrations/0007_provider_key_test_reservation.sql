CREATE OR REPLACE FUNCTION public.mark_user_provider_key(
 owner_id uuid,
 key_id uuid,
 response_code integer,
 action_name text DEFAULT 'request'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 UPDATE public.user_provider_api_keys SET
  in_flight = CASE WHEN action_name = 'request' THEN greatest(in_flight - 1, 0) ELSE in_flight END,
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
