-- Estadísticas del jugador para la pantalla de perfil.
-- Solo lectura: no crea tablas ni cambia datos. Cada jugador ve únicamente lo suyo (auth.uid()).
--
-- Devuelve:
--   miembro_desde, alias
--   partidas   { jugadas, resueltas, en_curso, abandonadas, a_tiempo, primeras_resueltas }
--   respuestas { aciertos, fallos, pistas, pct_acierto }
--   tiempo_total_seg   tiempo real dentro de las partidas (sin penalizaciones)
--   categorias [{ categoria, nombre, aciertos, fallos, pistas, pct_acierto, salas, segundos, puntuacion }]
--   casos      [{ caso, titulo, partidas, resueltas, segundos, mejor_seg, aciertos, fallos, pistas,
--                 salas: [{ sala, orden, nombre, veces, mejor_seg, medio_seg, fallos, pistas }] }]
--
-- pct_acierto = aciertos / (aciertos + fallos). Una sala con varias categorías cuenta en cada una.

create or replace function public.mis_estadisticas() returns jsonb
language sql stable security definer set search_path = '' as $$
  with
  mis_partidas as (
    select p.*, c.limite_seg,
      -- Fin real: cierre de la partida o, si sigue abierta, el último movimiento registrado.
      coalesce(p.fin, (select max(e.creado_at) from public.eventos e where e.partida_id = p.id), p.inicio) as hasta
    from public.partidas p join public.casos c on c.id = p.caso_id
    where p.user_id = auth.uid()
  ),
  mis_eventos as (
    select e.* from public.eventos e join mis_partidas p on p.id = e.partida_id
  ),
  por_sala as (
    select e.sala_id,
      count(*) filter (where e.tipo = 'acierto') as aciertos,
      count(*) filter (where e.tipo = 'fallo')   as fallos,
      count(*) filter (where e.tipo = 'pista')   as pistas
    from mis_eventos e where e.sala_id is not null
    group by e.sala_id
  ),
  tiempos as (
    select v.* from privado.v_tiempos_sala v where v.user_id = auth.uid()
  ),
  cat as (
    select sc.categoria_id, ct.nombre,
      sum(ps.aciertos)::int as aciertos, sum(ps.fallos)::int as fallos, sum(ps.pistas)::int as pistas,
      count(*) filter (where ps.aciertos > 0)::int as salas,
      coalesce((select sum(t.segundos) from tiempos t join public.sala_categoria s2 on s2.sala_id = t.sala_id
                where s2.categoria_id = sc.categoria_id), 0)::int as segundos
    from por_sala ps
    join public.sala_categoria sc on sc.sala_id = ps.sala_id
    join public.categorias ct on ct.id = sc.categoria_id
    group by sc.categoria_id, ct.nombre
  ),
  tot as (
    select coalesce(sum(aciertos), 0)::int as aciertos, coalesce(sum(fallos), 0)::int as fallos,
           coalesce(sum(pistas), 0)::int as pistas
    from por_sala
  )
  select jsonb_build_object(
    'alias', (select pf.alias from public.perfiles pf where pf.id = auth.uid()),
    'miembro_desde', (select pf.creado_at from public.perfiles pf where pf.id = auth.uid()),
    'partidas', (select jsonb_build_object(
        'jugadas', count(*),
        'resueltas', count(*) filter (where estado = 'resuelta'),
        'en_curso', count(*) filter (where estado = 'en_curso'),
        'abandonadas', count(*) filter (where estado = 'abandonada'),
        'a_tiempo', count(*) filter (where estado = 'resuelta'
                                     and extract(epoch from fin - inicio) + penal_seg <= limite_seg),
        'primeras_resueltas', count(*) filter (where estado = 'resuelta' and es_primera))
      from mis_partidas),
    'respuestas', (select jsonb_build_object(
        'aciertos', aciertos, 'fallos', fallos, 'pistas', pistas,
        'pct_acierto', case when aciertos + fallos > 0 then round(100.0 * aciertos / (aciertos + fallos))::int end)
      from tot),
    'tiempo_total_seg', (select coalesce(sum(extract(epoch from hasta - inicio)), 0)::int from mis_partidas),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object(
        'categoria', c.categoria_id, 'nombre', c.nombre,
        'aciertos', c.aciertos, 'fallos', c.fallos, 'pistas', c.pistas,
        'pct_acierto', case when c.aciertos + c.fallos > 0 then round(100.0 * c.aciertos / (c.aciertos + c.fallos))::int end,
        'salas', c.salas, 'segundos', c.segundos,
        'puntuacion', (select pc.puntuacion from privado.v_puntuacion_categoria pc
                       where pc.user_id = auth.uid() and pc.categoria_id = c.categoria_id))
        order by c.nombre) from cat c), '[]'::jsonb),
    'casos', coalesce((select jsonb_agg(y.x order by y.orden) from (
        select cs.orden, jsonb_build_object(
          'caso', cs.id, 'titulo', cs.titulo,
          'partidas', count(p.id),
          'resueltas', count(p.id) filter (where p.estado = 'resuelta'),
          'segundos', coalesce(sum(extract(epoch from p.hasta - p.inicio)), 0)::int,
          'mejor_seg', min(extract(epoch from p.fin - p.inicio) + p.penal_seg) filter (where p.estado = 'resuelta')::int,
          'aciertos', coalesce((select sum(ps.aciertos) from por_sala ps join public.salas s on s.id = ps.sala_id where s.caso_id = cs.id), 0)::int,
          'fallos',   coalesce((select sum(ps.fallos)   from por_sala ps join public.salas s on s.id = ps.sala_id where s.caso_id = cs.id), 0)::int,
          'pistas',   coalesce((select sum(ps.pistas)   from por_sala ps join public.salas s on s.id = ps.sala_id where s.caso_id = cs.id), 0)::int,
          'salas', coalesce((select jsonb_agg(jsonb_build_object(
              'sala', s.id, 'orden', s.orden, 'nombre', s.nombre,
              'veces', (select count(*) from tiempos t where t.sala_id = s.id),
              'mejor_seg', (select min(t.segundos) from tiempos t where t.sala_id = s.id),
              'medio_seg', (select round(avg(t.segundos))::int from tiempos t where t.sala_id = s.id),
              'fallos', coalesce((select ps.fallos from por_sala ps where ps.sala_id = s.id), 0),
              'pistas', coalesce((select ps.pistas from por_sala ps where ps.sala_id = s.id), 0))
              order by s.orden) from public.salas s where s.caso_id = cs.id), '[]'::jsonb)
        ) as x
        from public.casos cs join mis_partidas p on p.caso_id = cs.id
        group by cs.id, cs.orden, cs.titulo
      ) y(orden, x)), '[]'::jsonb)
  );
$$;

revoke execute on function public.mis_estadisticas() from public, anon;
grant execute on function public.mis_estadisticas() to authenticated;
