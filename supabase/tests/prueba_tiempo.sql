-- Tiempo activo por sala: cada sala tiene su contador y solo suma mientras se juega.
-- Uso: psql -v ON_ERROR_STOP=1 -f supabase/tests/prueba_tiempo.sql
--      (tras stub_supabase.sql + migraciones + contenido_prueba.sql)
-- El paso del tiempo se simula retrasando ultimo_latido como superusuario.
\set QUIET on
\set ON_ERROR_STOP on

-- Ayudante de pruebas (solo existe en la base de pruebas)
create or replace function public.t_chk(ok boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLO: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;

insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b')
on conflict do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select (public.iniciar_partida('faro_cabo')->>'partida') as pid \gset
select set_config('t.pid', :'pid', false);

-- 1. El primer latido crea el contador de la sala 1 a cero
select public.latido(:'pid', true) as r \gset
select public.t_chk((select count(*) from public.tiempo_sala where partida_id = :'pid') = 1, 'el primer latido crea una fila por sala');

-- 2. Cinco segundos jugando suman cinco segundos
reset role;
update public.tiempo_sala set ultimo_latido = now() - interval '5 seconds' where partida_id = :'pid';
set role authenticated;
select (public.latido(:'pid', true)->>'sala_activo_seg')::float as s1 \gset
select public.t_chk(abs(:s1 - 5) < 1, format('5 s de juego suman 5 s (%s)', :s1));

-- 3. Un hueco de más de 15 s (pestaña cerrada, sin pausa) no suma nada
reset role;
update public.tiempo_sala set ultimo_latido = now() - interval '10 minutes' where partida_id = :'pid';
set role authenticated;
select (public.latido(:'pid', true)->>'sala_activo_seg')::float as s2 \gset
select public.t_chk(abs(:s2 - :s1) < 0.5, format('un hueco de 10 min no cuenta (%s)', :s2));

-- 4. Pausa: suma lo jugado hasta ahora y deja el contador parado
reset role;
update public.tiempo_sala set ultimo_latido = now() - interval '4 seconds' where partida_id = :'pid';
set role authenticated;
select (public.latido(:'pid', false)->>'sala_activo_seg')::float as s3 \gset
select public.t_chk(abs(:s3 - (:s1 + 4)) < 1, format('la pausa suma el último tramo (%s)', :s3));
select public.t_chk((select ultimo_latido is null from public.tiempo_sala where partida_id = :'pid'), 'tras la pausa el contador queda parado');

-- 5. En pausa no corre: ni con el reloj ni en el estado de la partida
select pg_sleep(1.2);
select (public.estado_partida(:'pid')->>'activo_seg')::float as e1,
       (public.estado_partida(:'pid')->>'sala_activo_seg')::float as e2 \gset
select public.t_chk(abs(:e1 - :s3) < 0.01 and abs(:e2 - :s3) < 0.01, 'en pausa el estado no avanza aunque pase el reloj');

-- 6. Reanudar tras la pausa no suma el rato parado
select public.latido(:'pid', true) as r \gset
select (public.latido(:'pid', true)->>'activo_seg')::float as s4 \gset
select public.t_chk(abs(:s4 - :s3) < 0.5, format('reanudar no suma el rato parado (%s vs %s)', :s4, :s3));

-- 7. Cada sala tiene su contador: al acertar se cierra la sala 1 y arranca la 2 desde cero
reset role;
update public.tiempo_sala set ultimo_latido = now() - interval '3 seconds' where partida_id = :'pid';
set role authenticated;
select public.comprobar_respuesta(:'pid', '315') as r \gset
select (activo_seg)::float as a1 from public.tiempo_sala where partida_id = :'pid' and sala_id = 'faro_cabo/a' \gset
select public.t_chk(abs(:a1 - (:s3 + 3)) < 1.5, format('la sala 1 se cierra con lo jugado (%s)', :a1));
select public.t_chk((select ultimo_latido is null from public.tiempo_sala where partida_id = :'pid' and sala_id = 'faro_cabo/a'), 'la sala 1 queda cerrada');
select public.t_chk((select ultimo_latido is not null and activo_seg = 0 from public.tiempo_sala where partida_id = :'pid' and sala_id = 'faro_cabo/b'), 'la sala 2 arranca con su propio contador a cero');

-- 8. Los latidos suman a la sala actual y no tocan la anterior
reset role;
update public.tiempo_sala set ultimo_latido = now() - interval '6 seconds' where partida_id = :'pid' and sala_id = 'faro_cabo/b';
set role authenticated;
select (public.latido(:'pid', true)->>'sala_activo_seg')::float as b1 \gset
select (activo_seg)::float as a2 from public.tiempo_sala where partida_id = :'pid' and sala_id = 'faro_cabo/a' \gset
select public.t_chk(abs(:b1 - 6) < 1, format('la sala 2 suma lo suyo (%s)', :b1));
select public.t_chk(abs(:a2 - :a1) < 0.001, format('la sala 1 no cambia (%s)', :a2));

-- 9. Final: el tiempo total es la suma de las salas, no la hora de reloj
reset role;
update public.partidas set inicio = now() - interval '3 hours' where id = :'pid';   -- 3 h de reloj
update public.tiempo_sala set ultimo_latido = now() - interval '2 seconds' where partida_id = :'pid' and sala_id = 'faro_cabo/b';
set role authenticated;
select public.comprobar_respuesta(:'pid', 'mar') as r \gset
select (public.estado_partida(:'pid')->>'activo_seg')::float as total,
       public.estado_partida(:'pid')->>'estado' as est \gset
select public.t_chk(:'est' = 'resuelta', 'partida resuelta');
select public.t_chk(abs(:total - (:a1 + :b1 + 2)) < 2, format('total = suma de las salas (%s)', :total));
select public.t_chk(:total < 60, 'el total no incluye las 3 h de reloj');
select public.t_chk((select ultimo_latido is null from public.tiempo_sala where partida_id = :'pid' and sala_id = 'faro_cabo/b'), 'la sala 2 queda cerrada al terminar');
select public.mis_estadisticas() as st \gset
select public.t_chk(abs((:'st'::jsonb->>'tiempo_total_seg')::int - :total) <= 1, 'perfil: tiempo jugado = tiempo activo');
select public.t_chk((:'st'::jsonb->'partidas'->>'a_tiempo')::int = 1, 'perfil: a tiempo (3 h de reloj, segundos de juego)');
select public.t_chk((select abs((x->>'segundos')::int - :total) <= 1 and (x->>'mejor_seg')::int < 60
                       from jsonb_array_elements(:'st'::jsonb->'casos') x where x->>'caso' = 'faro_cabo'), 'perfil: el caso usa tiempo activo');
select public.t_chk((select abs((x->'salas'->0->>'mejor_seg')::int - :a1) <= 1 and abs((x->'salas'->1->>'mejor_seg')::int - (:b1 + 2)) <= 1
                       from jsonb_array_elements(:'st'::jsonb->'casos') x where x->>'caso' = 'faro_cabo'), 'perfil: cada sala con su propio tiempo');
select public.t_chk((select (x->>'mejor_seg')::int < 60 from jsonb_array_elements(public.mis_casos()) x where x->>'caso' = 'faro_cabo'), 'índice: mejor tiempo activo');

-- 10. Una partida terminada ya no suma
select (public.latido(:'pid', true)->>'activo_seg')::float as t2 \gset
select public.t_chk(abs(:t2 - :total) < 0.01, 'tras terminar no suma');

-- 11. Seguridad
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  perform public.latido(current_setting('t.pid')::uuid, true);
  raise exception 'FALLO: B puede dar latidos en la partida de A';
exception when sqlstate 'P0002' then raise notice 'ok: nadie da latidos en partidas ajenas'; end $$;
select public.t_chk((select count(*) from public.tiempo_sala) = 0, 'B no ve los contadores de A');
do $$ begin
  insert into public.tiempo_sala (partida_id, sala_id) values (current_setting('t.pid')::uuid, 'faro_cabo/a');
  raise exception 'FALLO: se puede escribir en tiempo_sala';
exception when insufficient_privilege then raise notice 'ok: tiempo_sala solo se escribe por RPC'; end $$;
reset role;
set role anon;
do $$ begin perform public.latido('00000000-0000-0000-0000-000000000000', true); raise exception 'FALLO: anon puede llamar';
exception when insufficient_privilege then raise notice 'ok: anon no puede dar latidos'; end $$;
reset role;

-- 12. Partidas anteriores (sin contadores) conservan su tiempo de reloj
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select (public.iniciar_partida('reloj_praga')->>'partida') as pid2 \gset
reset role;
update public.eventos set creado_at = now() - interval '10 minutes' where partida_id = :'pid2' and tipo in ('inicio', 'entrar');
update public.partidas set inicio = now() - interval '10 minutes' where id = :'pid2';
set role authenticated;
select public.comprobar_respuesta(:'pid2', '12') as r \gset
reset role;
delete from public.tiempo_sala where partida_id = :'pid2';      -- como si nunca hubiera habido contador
select public.t_chk((select not medido and abs(activo_seg - 600) < 5 from privado.v_sala_tiempo where partida_id = :'pid2' and sala_id = 'reloj_praga/a'),
                    'lo anterior conserva el tiempo de reloj');

-- 13. Reiniciar abandona la partida sin dejar contadores corriendo
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select public.latido(:'pid2', true) as r \gset
select (public.reiniciar_partida(:'pid2')->>'partida') as pid3 \gset
reset role;
select public.t_chk(:'pid3' <> :'pid2' and (select count(*) from privado.v_activo_sala where partida_id = :'pid2' and activo_seg > 5) = 0,
                    'reiniciar abandona sin dejar contadores abiertos');
