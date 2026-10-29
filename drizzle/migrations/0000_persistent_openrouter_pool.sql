CREATE TABLE public.openrouter_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 fingerprint text NOT NULL UNIQUE,
 ciphertext text NOT NULL,
 source text NOT NULL DEFAULT 'saved',
 status text NOT NULL DEFAULT 'unknown',
 code integer,
 failures integer NOT NULL DEFAULT 0,
 last_used timestamptz,
 quarantined_until timestamptz,
 rotation_order bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.openrouter_keys TO service_role;
ALTER TABLE public.openrouter_keys ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.openrouter_rotation (
 id integer PRIMARY KEY DEFAULT 1,
 cursor bigint NOT NULL DEFAULT 0
);
GRANT ALL ON public.openrouter_rotation TO service_role;
ALTER TABLE public.openrouter_rotation ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.reserve_openrouter_keys() RETURNS SETOF public.openrouter_keys
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_cursor bigint;
BEGIN
 INSERT INTO public.openrouter_rotation(id, cursor) VALUES (1, 1)
 ON CONFLICT (id) DO UPDATE SET cursor = openrouter_rotation.cursor + 1
 RETURNING cursor - 1 INTO next_cursor;
 RETURN QUERY WITH live AS (
 SELECT k.*, row_number() OVER (ORDER BY rotation_order, created_at, id) - 1 AS pos,
 count(*) OVER () AS total FROM public.openrouter_keys k
 WHERE quarantined_until IS NULL OR quarantined_until <= now()
 ) SELECT id, fingerprint, ciphertext, source, status, code, failures, last_used,
 quarantined_until, rotation_order, created_at FROM live
 ORDER BY (pos - (next_cursor % total) + total) % total;
END $$;
REVOKE ALL ON FUNCTION public.reserve_openrouter_keys() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_openrouter_keys() TO service_role;
CREATE FUNCTION public.mark_openrouter_key(key_id uuid, response_code integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 UPDATE public.openrouter_keys SET
 failures = CASE WHEN response_code < 300 THEN 0 ELSE failures + 1 END,
 status = CASE WHEN response_code < 300 THEN 'ok' WHEN failures + 1 >= 10 THEN 'quarantined'
 WHEN response_code IN (401,402,403,429) THEN 'blocked' ELSE 'error' END,
 quarantined_until = CASE WHEN response_code >= 300 AND failures + 1 >= 10 THEN now() + interval '15 minutes' ELSE NULL END,
 code = response_code, last_used = now(),
 rotation_order = CASE WHEN response_code >= 300 THEN (SELECT coalesce(max(rotation_order),0) + 1 FROM public.openrouter_keys) ELSE rotation_order END
 WHERE id = key_id;
END $$;
REVOKE ALL ON FUNCTION public.mark_openrouter_key(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_openrouter_key(uuid, integer) TO service_role;