-- Recorre una partida completa como jugador autenticado y comprueba la seguridad.
-- Uso: psql -v ON_ERROR_STOP=1 -f supabase/tests/prueba_juego.sql (tras stub + migración + contenido)
\set QUIET on
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b')
on conflict do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

-- Lo secreto no se puede leer
do $$ begin
  perform 1 from privado.soluciones;
  raise exception 'FALLO: se pueden leer las soluciones';
exception when insufficient_privilege then raise notice 'ok: soluciones protegidas';
end $$;
do $$ begin
  insert into public.partidas (user_id, caso_id, version_caso, es_primera)
  values ('00000000-0000-0000-0000-00000000000a', 'faro_cabo', 1, true);
  raise exception 'FALLO: se puede insertar una partida sin RPC';
exception when insufficient_privilege then raise notice 'ok: partidas solo por RPC';
end $$;

do $$
declare e jsonb; r jsonb; pid uuid;
begin
  e := public.iniciar_partida('faro_cabo');
  pid := (e->>'partida')::uuid;
  assert e->'sala'->>'nombre' = 'Muelle', 'sala inicial';
  assert e->'sala' ? 'puzzle' and not (e->'sala' ? 'aprende'), 'contenido de sala sin "aprende"';
  assert (public.iniciar_partida('faro_cabo')->>'partida')::uuid = pid, 'reanuda la misma partida';

  r := public.comprobar_respuesta(pid, '300');
  assert not (r->>'correcto')::boolean, 'respuesta mala';
  e := public.pedir_pista(pid);
  assert jsonb_array_length(e->'pistas') = 1 and (e->>'penal_seg')::int = 60, 'pista 1 con 60 s';
  r := public.comprobar_respuesta(pid, ' 315 ');
  assert (r->>'correcto')::boolean, 'respuesta buena con espacios';
  assert jsonb_array_length(r->'estado'->'pistas') = 0, 'pistas de la sala nueva vacías';
  assert r->'estado'->'objetos'->>0 like 'Llave de la caseta%', 'objeto ganado';
  r := public.comprobar_respuesta(pid, '03:30');
  r := public.comprobar_respuesta(pid, '48');
  assert r->'estado'->'desenlace' is null or r->'estado'->'desenlace' = 'null'::jsonb, 'sin desenlace antes de terminar';
  r := public.comprobar_respuesta(pid, '225');
  assert r->'estado'->>'estado' = 'resuelta', 'partida resuelta';
  assert r->'estado'->'desenlace'->>'objeto' like 'Diario%', 'desenlace al terminar';
  raise notice 'ok: partida completa (%)', r->'estado'->>'salas_resueltas';

  -- Repetir: nueva partida, ya no es la primera
  e := public.iniciar_partida('faro_cabo');
  assert not (e->>'es_primera')::boolean, 'segunda partida no es primera';
  e := public.reiniciar_partida((e->>'partida')::uuid);
  raise notice 'ok: reinicio';

  -- Acusación equivocada penaliza 60 s
  e := public.iniciar_partida('reloj_praga');
  pid := (e->>'partida')::uuid;
  perform public.comprobar_respuesta(pid, '30');
  perform public.comprobar_respuesta(pid, '144');
  r := public.comprobar_respuesta(pid, 'Pavel');
  assert (r->>'penal_seg')::int = 60, 'acusación falsa +60';
  r := public.comprobar_respuesta(pid, 'elena');
  assert (r->>'correcto')::boolean and r->>'aprende' like 'Razonar%', 'acierto con "aprende"';
  raise notice 'ok: penalización por acusación';
end $$;

-- Otro jugador no ve ni toca las partidas ajenas
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$
declare pid uuid;
begin
  assert (select count(*) from public.partidas) = 0, 'no ve partidas ajenas';
  reset role;
  select id into pid from public.partidas where caso_id = 'reloj_praga' and estado = 'en_curso';
  set role authenticated;
  begin
    perform public.comprobar_respuesta(pid, 'x');
    raise exception 'FALLO: puede jugar una partida ajena';
  exception when no_data_found then raise notice 'ok: partida ajena inaccesible';
  end;
  perform public.poner_alias('Jugadora B');
  perform public.comprobar_respuesta((public.iniciar_partida('faro_cabo')->>'partida')::uuid, '315');
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.poner_alias('Rodrigo');
\echo '--- ranking global (mín. 1 sala)'
select * from public.ranking(null, 1);
\echo '--- ranking orientación'
select * from public.ranking('orientacion', 1);
\echo '--- mis categorías'
select * from public.mis_categorias();
\echo '--- mis casos (2 primeros)'
select jsonb_path_query(public.mis_casos(), '$[0 to 1]');
\echo '--- resumen faro (menos de 5 jugadores: sin medias)'
select public.resumen_caso('faro_cabo');
reset role;
\echo '--- anon no puede iniciar partidas'
set role anon;
do $$ begin
  perform public.iniciar_partida('faro_cabo');
  raise exception 'FALLO: anon puede jugar';
exception when insufficient_privilege then raise notice 'ok: anon sin acceso a RPC de juego';
end $$;
reset role;
\echo '--- tiempos por sala (vista privada)'
select caso_id, sala_id, segundos, segundos_ajustados, pistas, fallos from privado.v_tiempos_sala order by caso_id, sala_id limit 6;
