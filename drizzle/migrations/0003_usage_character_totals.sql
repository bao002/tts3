CREATE OR REPLACE FUNCTION public.provider_usage_report(window_hours integer DEFAULT 24) RETURNS jsonb
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
