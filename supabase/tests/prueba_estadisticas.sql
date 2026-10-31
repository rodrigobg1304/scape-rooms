\set QUIET on
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ declare e jsonb; begin
  e := public.iniciar_partida('faro_cabo');
  perform public.comprobar_respuesta((e->>'partida')::uuid, '315');
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
-- Sin partidas
do $$ declare s jsonb := public.mis_estadisticas(); begin
  assert (s->'partidas'->>'jugadas')::int = 0, 'sin partidas';
  assert s->'respuestas'->>'pct_acierto' is null, 'pct nulo sin respuestas';
  assert jsonb_array_length(s->'casos') = 0 and jsonb_array_length(s->'categorias') = 0, 'listas vacías';
  raise notice 'ok: jugador nuevo';
end $$;
do $$ declare e jsonb; pid uuid; s jsonb; c jsonb; begin
  e := public.iniciar_partida('faro_cabo'); pid := (e->>'partida')::uuid;
  perform public.comprobar_respuesta(pid, '300');           -- fallo
  perform public.pedir_pista(pid);                          -- pista
  perform public.comprobar_respuesta(pid, '315');           -- acierto
  perform public.comprobar_respuesta(pid, 'tierra');        -- fallo
  perform public.comprobar_respuesta(pid, 'mar');           -- acierto -> resuelta
  e := public.iniciar_partida('reloj_praga'); pid := (e->>'partida')::uuid;
  perform public.comprobar_respuesta(pid, '12');            -- acierto, sigue en curso
  s := public.mis_estadisticas();
  raise notice '%', jsonb_pretty(s);
  assert (s->'partidas'->>'jugadas')::int = 2, 'jugadas';
  assert (s->'partidas'->>'resueltas')::int = 1 and (s->'partidas'->>'en_curso')::int = 1, 'estados';
  assert (s->'partidas'->>'a_tiempo')::int = 1, 'a tiempo';
  assert (s->'respuestas'->>'aciertos')::int = 3 and (s->'respuestas'->>'fallos')::int = 2, 'respuestas';
  assert (s->'respuestas'->>'pct_acierto')::int = 60, 'pct global';
  select x into c from jsonb_array_elements(s->'categorias') x where x->>'categoria' = 'matematica';
  assert (c->>'aciertos')::int = 2 and (c->>'fallos')::int = 1 and (c->>'pct_acierto')::int = 67, 'categoría matemáticas';
  select x into c from jsonb_array_elements(s->'categorias') x where x->>'categoria' = 'literatura';
  assert (c->>'pct_acierto')::int = 50, 'literatura';
  select x into c from jsonb_array_elements(s->'casos') x where x->>'caso' = 'faro_cabo';
  assert (c->>'resueltas')::int = 1 and c->>'mejor_seg' is not null and jsonb_array_length(c->'salas') = 2, 'caso faro';
  assert (c->'salas'->0->>'fallos')::int = 1 and (c->'salas'->0->>'pistas')::int = 1, 'sala muelle';
  raise notice 'ok: estadísticas del jugador A';
end $$;
-- B no ve lo de A
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ declare s jsonb := public.mis_estadisticas(); begin
  assert (s->'partidas'->>'jugadas')::int = 1 and (s->'respuestas'->>'aciertos')::int = 1, 'B solo ve lo suyo';
  raise notice 'ok: aislamiento entre jugadores';
end $$;
reset role;
set role anon;
do $$ begin perform public.mis_estadisticas(); raise exception 'FALLO: anon puede llamar';
exception when insufficient_privilege then raise notice 'ok: anon no puede'; end $$;
