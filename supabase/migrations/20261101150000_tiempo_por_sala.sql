-- Tiempo activo por sala.
--
-- Antes, el tiempo de una partida (y de cada sala) era la hora de reloj entre el inicio y el final:
-- seguía corriendo aunque el jugador cerrara la pestaña o saliera de la sala.
-- Ahora cada sala tiene su propio contador (public.tiempo_sala) y solo suma mientras se juega:
--   · el navegador manda un latido cada pocos segundos mientras la sala está abierta y visible;
--   · cada latido suma al contador de la sala el tiempo transcurrido desde el anterior,
--     siempre que no hayan pasado más de 15 s (si hubo un hueco, ese hueco no cuenta);
--   · al salir, ocultar la pestaña o quedarse inactivo, el navegador manda un latido de pausa;
--   · la partida suma el tiempo activo de todas sus salas (+ penalizaciones).
-- El tiempo nunca puede superar al de reloj, porque cada tramo entre dos latidos se cuenta una sola vez.
-- Las partidas anteriores a esta migración conservan su tiempo de reloj (no hay datos mejores).

-- ---------------------------------------------------------------------------
-- 1. Contador por sala
-- ---------------------------------------------------------------------------
create table if not exists public.tiempo_sala (
  partida_id     uuid not null references public.partidas on delete cascade,
  sala_id        text not null references public.salas,
  activo_seg     double precision not null default 0 check (activo_seg >= 0),
  ultimo_latido  timestamptz,                -- null = contador en pausa
  primary key (partida_id, sala_id)
);
comment on table public.tiempo_sala is 'Segundos de juego activo en cada sala de cada partida. Solo lo escriben las funciones RPC.';

alter table public.tiempo_sala enable row level security;
create policy tiempo_sala_propio on public.tiempo_sala for select to authenticated
  using (exists (select 1 from public.partidas p where p.id = partida_id and p.user_id = (select auth.uid())));
revoke insert, update, delete on public.tiempo_sala from anon, authenticated;

-- Hueco máximo entre dos latidos que se da por tiempo jugado.
create or replace function privado.hueco_max() returns interval
language sql immutable parallel safe set search_path = '' as $$ select interval '15 seconds' $$;

-- Segundos que aporta un tramo abierto desde `desde` hasta ahora (0 si está en pausa o se perdió el hilo).
create or replace function privado.tramo_seg(desde timestamptz) returns double precision
language sql stable set search_path = '' as $$
  select case when desde is not null and now() - desde <= privado.hueco_max()
              then greatest(extract(epoch from now() - desde), 0)::double precision
              else 0 end;
$$;

-- Cierra el tramo abierto de una sala (sumando lo jugado) y lo deja abierto o en pausa.
create or replace function privado.tocar_tiempo(p_partida uuid, p_sala text, p_activo boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.tiempo_sala (partida_id, sala_id, activo_seg, ultimo_latido)
  values (p_partida, p_sala, 0, case when p_activo then now() end)
  on conflict (partida_id, sala_id) do update set
    activo_seg    = public.tiempo_sala.activo_seg + privado.tramo_seg(public.tiempo_sala.ultimo_latido),
    ultimo_latido = case when p_activo then now() end;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Vistas de tiempo (activo + el que ya llevaba el tramo abierto)
-- ---------------------------------------------------------------------------
create or replace view privado.v_activo_sala as
select t.partida_id, t.sala_id,
  t.activo_seg + case when p.estado = 'en_curso' then privado.tramo_seg(t.ultimo_latido) else 0 end as activo_seg
from public.tiempo_sala t join public.partidas p on p.id = t.partida_id;

-- Tiempo por sala y partida. Si la sala no tiene contador (partidas antiguas) se usa el tiempo de reloj.
create or replace view privado.v_sala_tiempo as
with tramos as (
  select e.partida_id, e.sala_id,
    min(e.creado_at) filter (where e.tipo = 'entrar')  as entrada,
    min(e.creado_at) filter (where e.tipo = 'acierto') as salida,
    max(e.creado_at)                                   as ultimo_evento
  from public.eventos e
  where e.sala_id is not null
  group by e.partida_id, e.sala_id
)
select tr.partida_id, tr.sala_id, tr.entrada, tr.salida,
  coalesce(a.activo_seg, extract(epoch from coalesce(tr.salida, tr.ultimo_evento) - tr.entrada))::double precision as activo_seg,
  (a.partida_id is not null) as medido
from tramos tr left join privado.v_activo_sala a on a.partida_id = tr.partida_id and a.sala_id = tr.sala_id;

create or replace view privado.v_activo_partida as
select partida_id, sum(activo_seg)::double precision as activo_seg
from privado.v_sala_tiempo
group by partida_id;

-- Tiempo por sala resuelta (mismas columnas que antes): ahora es tiempo activo.
create or replace view privado.v_tiempos_sala as
with tramos as (
  select e.partida_id, e.sala_id,
    count(*) filter (where e.tipo = 'fallo') as fallos,
    count(*) filter (where e.tipo = 'pista') as pistas,
    coalesce(sum((e.detalle->>'penal_seg')::int) filter (where e.tipo in ('pista', 'fallo')), 0) as penal_seg
  from public.eventos e
  where e.sala_id is not null
  group by e.partida_id, e.sala_id
)
select t.partida_id, p.user_id, p.caso_id, p.es_primera, t.sala_id, t.fallos, t.pistas, t.penal_seg,
  round(st.activo_seg)::int                as segundos,
  round(st.activo_seg)::int + t.penal_seg  as segundos_ajustados
from tramos t
join public.partidas p on p.id = t.partida_id
join privado.v_sala_tiempo st on st.partida_id = t.partida_id and st.sala_id = t.sala_id
where st.salida is not null;

-- ---------------------------------------------------------------------------
-- 3. Latido: el navegador avisa de que sigue jugando (o de que se pone en pausa)
-- ---------------------------------------------------------------------------
create or replace function public.latido(p_partida uuid, p_activo boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.partidas := privado.mi_partida(p_partida);
  s public.salas;
begin
  if p.estado = 'en_curso' then
    s := privado.sala_actual(p);
    if s.id is not null then perform privado.tocar_tiempo(p.id, s.id, coalesce(p_activo, true)); end if;
  end if;
  s := privado.sala_actual(p);
  return jsonb_build_object(
    'ahora', now(),
    'salas_resueltas', p.salas_resueltas,
    'activo_seg', round(coalesce((select ap.activo_seg from privado.v_activo_partida ap where ap.partida_id = p.id), 0)::numeric, 3),
    'sala_activo_seg', round(coalesce((select a.activo_seg from privado.v_activo_sala a where a.partida_id = p.id and a.sala_id = s.id), 0)::numeric, 3));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Estado de la partida: añade el tiempo activo total y el de la sala actual
-- ---------------------------------------------------------------------------
create or replace function public.estado_partida(p_partida uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.partidas := privado.mi_partida(p_partida);
  s public.salas := privado.sala_actual(p);
  c public.casos;
  total int;
begin
  select * into c from public.casos where id = p.caso_id;
  select count(*) into total from public.salas where caso_id = p.caso_id;
  return jsonb_build_object(
    'partida', p.id,
    'caso', p.caso_id,
    'estado', p.estado,
    'es_primera', p.es_primera,
    'salas_resueltas', p.salas_resueltas,
    'total_salas', total,
    'inicio', p.inicio,
    'fin', p.fin,
    'ahora', now(),
    'penal_seg', p.penal_seg,
    'limite_seg', c.limite_seg,
    'activo_seg', round(coalesce((select ap.activo_seg from privado.v_activo_partida ap where ap.partida_id = p.id), 0)::numeric, 3),
    'sala_activo_seg', round(coalesce((select a.activo_seg from privado.v_activo_sala a where a.partida_id = p.id and a.sala_id = s.id), 0)::numeric, 3),
    'sala', case when p.estado = 'en_curso' and s.id is not null then
      (select cs.contenido - 'aprende' || jsonb_build_object('id', s.id, 'orden', s.orden, 'nombre', s.nombre)
       from privado.contenido_sala cs where cs.sala_id = s.id) end,
    'objetos', coalesce((
      select jsonb_agg(r.nombre order by sa.orden)
      from public.salas sa join privado.recompensas r on r.sala_id = sa.id
      where sa.caso_id = p.caso_id and sa.orden <= p.salas_resueltas
    ), '[]'::jsonb),
    'desenlace', case when p.estado = 'resuelta'
      then (select d.contenido from privado.desenlaces d where d.caso_id = p.caso_id) end,
    'pistas', coalesce((
      select jsonb_agg(jsonb_build_object('nivel', pi.nivel, 'texto', pi.texto, 'penal_seg', pi.penal_seg) order by pi.nivel)
      from privado.pistas pi
      where s.id is not null and pi.sala_id = s.id
        and pi.nivel <= (select count(*) from public.eventos e where e.partida_id = p.id and e.sala_id = s.id and e.tipo = 'pista')
    ), '[]'::jsonb),
    'siguiente_penal_seg', (
      select pi.penal_seg from privado.pistas pi
      where s.id is not null and pi.sala_id = s.id
        and pi.nivel = 1 + (select count(*) from public.eventos e where e.partida_id = p.id and e.sala_id = s.id and e.tipo = 'pista'))
  );
end $$;

-- ---------------------------------------------------------------------------
-- 5. Responder: al acertar se cierra el contador de la sala y arranca el de la siguiente
-- ---------------------------------------------------------------------------
create or replace function public.comprobar_respuesta(p_partida uuid, p_respuesta text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.partidas := privado.mi_partida(p_partida);
  s public.salas;
  ok boolean;
  total int;
  recientes int;
begin
  if p.estado <> 'en_curso' then raise exception 'La partida no está en curso' using errcode = '22023'; end if;
  s := privado.sala_actual(p);

  -- Freno a la fuerza bruta: como mucho 15 fallos por minuto.
  select count(*) into recientes from public.eventos
   where partida_id = p.id and tipo = 'fallo' and creado_at > now() - interval '1 minute';
  if recientes >= 15 then raise exception 'Demasiados intentos. Espera un minuto.' using errcode = '54000'; end if;

  select privado.norm(p_respuesta) = so.respuesta_norm into ok from privado.soluciones so where so.sala_id = s.id;
  ok := coalesce(ok, false);

  if not ok then
    insert into public.eventos (partida_id, sala_id, tipo, detalle)
    values (p.id, s.id, 'fallo', jsonb_build_object('penal_seg', s.penal_fallo_seg));
    if s.penal_fallo_seg > 0 then
      update public.partidas set penal_seg = penal_seg + s.penal_fallo_seg where id = p.id;
    end if;
    return jsonb_build_object('correcto', false, 'penal_seg', s.penal_fallo_seg, 'estado', public.estado_partida(p.id));
  end if;

  insert into public.eventos (partida_id, sala_id, tipo) values (p.id, s.id, 'acierto');
  perform privado.tocar_tiempo(p.id, s.id, false);            -- se cierra el contador de la sala resuelta
  select count(*) into total from public.salas where caso_id = p.caso_id;
  update public.partidas set salas_resueltas = salas_resueltas + 1 where id = p.id returning * into p;

  if p.salas_resueltas >= total then
    update public.partidas set estado = 'resuelta', fin = now() where id = p.id;
    insert into public.eventos (partida_id, tipo) values (p.id, 'fin');
  else
    insert into public.eventos (partida_id, sala_id, tipo) values (p.id, (privado.sala_actual(p)).id, 'entrar');
    perform privado.tocar_tiempo(p.id, (privado.sala_actual(p)).id, true);  -- arranca el de la siguiente sala
  end if;
  return jsonb_build_object('correcto', true, 'penal_seg', 0,
    'aprende', (select cs.contenido->>'aprende' from privado.contenido_sala cs where cs.sala_id = s.id),
    'estado', public.estado_partida(p.id));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Índice de casos: tiempo activo de la partida en curso y mejor tiempo
-- ---------------------------------------------------------------------------
create or replace function public.mis_casos() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x.orden), '[]'::jsonb) from (
    select c.id as caso, c.orden, c.validado,
      (select count(*) from public.salas s where s.caso_id = c.id) as total_salas,
      (select jsonb_build_object('partida', p.id, 'salas_resueltas', p.salas_resueltas, 'inicio', p.inicio, 'penal_seg', p.penal_seg,
                                 'activo_seg', round(coalesce(ap.activo_seg, 0)::numeric, 3))
         from public.partidas p left join privado.v_activo_partida ap on ap.partida_id = p.id
         where p.user_id = auth.uid() and p.caso_id = c.id and p.estado = 'en_curso') as en_curso,
      (select count(*) from public.partidas p where p.user_id = auth.uid() and p.caso_id = c.id and p.estado = 'resuelta') as resueltas,
      (select min(coalesce(ap.activo_seg, 0) + p.penal_seg)::int
         from public.partidas p left join privado.v_activo_partida ap on ap.partida_id = p.id
         where p.user_id = auth.uid() and p.caso_id = c.id and p.estado = 'resuelta') as mejor_seg
    from public.casos c where c.publicado
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- 7. Perfil: tiempos activos
-- ---------------------------------------------------------------------------
create or replace function public.mis_estadisticas() returns jsonb
language sql stable security definer set search_path = '' as $$
  with
  mis_partidas as (
    select p.*, c.limite_seg, coalesce(ap.activo_seg, 0) as activo
    from public.partidas p
    join public.casos c on c.id = p.caso_id
    left join privado.v_activo_partida ap on ap.partida_id = p.id
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
        'a_tiempo', count(*) filter (where estado = 'resuelta' and activo + penal_seg <= limite_seg),
        'primeras_resueltas', count(*) filter (where estado = 'resuelta' and es_primera))
      from mis_partidas),
    'respuestas', (select jsonb_build_object(
        'aciertos', aciertos, 'fallos', fallos, 'pistas', pistas,
        'pct_acierto', case when aciertos + fallos > 0 then round(100.0 * aciertos / (aciertos + fallos))::int end)
      from tot),
    'tiempo_total_seg', (select coalesce(sum(activo), 0)::int from mis_partidas),
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
          'segundos', coalesce(sum(p.activo), 0)::int,
          'mejor_seg', min(p.activo + p.penal_seg) filter (where p.estado = 'resuelta')::int,
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

-- ---------------------------------------------------------------------------
-- 8. Estadísticas públicas de un caso: tiempo activo
-- ---------------------------------------------------------------------------
create or replace function public.resumen_caso(p_caso text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with r as (
    select coalesce(ap.activo_seg, 0) + p.penal_seg as seg, c.limite_seg
    from public.partidas p
    join public.casos c on c.id = p.caso_id
    left join privado.v_activo_partida ap on ap.partida_id = p.id
    where p.caso_id = p_caso and p.es_primera and p.estado = 'resuelta'
  ), j as (
    select count(*) as jugadores from public.partidas where caso_id = p_caso and es_primera
  )
  select jsonb_build_object(
    'jugadores', j.jugadores,
    'resueltas', (select count(*) from r),
    'tiempo_medio_seg', case when (select count(*) from r) >= 5 then (select round(avg(seg))::int from r) end,
    'tiempo_mediano_seg', case when (select count(*) from r) >= 5 then (select percentile_cont(0.5) within group (order by seg)::int from r) end,
    'pct_a_tiempo', case when (select count(*) from r) >= 5 then (select round(100.0 * count(*) filter (where seg <= limite_seg) / count(*))::int from r) end
  ) from j;
$$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
revoke execute on function public.latido(uuid, boolean) from public, anon;
grant execute on function public.latido(uuid, boolean) to authenticated;
