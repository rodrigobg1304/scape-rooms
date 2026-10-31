-- Salas Secretas · esquema inicial
-- Contenido público (casos, salas, categorías), contenido secreto (soluciones, pistas),
-- jugadores, partidas, eventos y funciones RPC. Las respuestas se validan aquí, nunca en el cliente.

create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- Contenido público
-- ---------------------------------------------------------------------------
create table public.casos (
  id          text primary key,
  titulo      text not null,
  orden       int  not null,
  version     int  not null default 1,
  limite_seg  int  not null default 1800,
  publicado   boolean not null default true,
  creado_at   timestamptz not null default now()
);

create table public.salas (
  id               text primary key,               -- '<caso>/<mecanismo>'
  caso_id          text not null references public.casos on delete cascade,
  orden            smallint not null check (orden >= 1),
  nombre           text not null,
  penal_fallo_seg  int not null default 0,          -- p. ej. acusación equivocada
  unique (caso_id, orden)
);

create table public.categorias (
  id      text primary key,
  nombre  text not null
);

create table public.sala_categoria (
  sala_id       text not null references public.salas on delete cascade,
  categoria_id  text not null references public.categorias,
  peso          numeric(3,2) not null default 1 check (peso > 0 and peso <= 1),
  primary key (sala_id, categoria_id)
);

-- ---------------------------------------------------------------------------
-- Contenido secreto: esquema no expuesto por la API
-- ---------------------------------------------------------------------------
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;

create table privado.soluciones (
  sala_id         text primary key references public.salas on delete cascade,
  respuesta_norm  text not null
);

create table privado.pistas (
  sala_id    text not null references public.salas on delete cascade,
  nivel      smallint not null check (nivel between 1 and 3),
  texto      text not null,
  penal_seg  int not null,
  primary key (sala_id, nivel)
);

-- Contenido de cada sala (escena, pista, reto, widget, "lo que has aprendido").
-- Se entrega sala a sala: los textos de una sala suelen delatar las respuestas de las anteriores.
create table privado.contenido_sala (
  sala_id    text primary key references public.salas on delete cascade,
  contenido  jsonb not null
);

-- Lo que se obtiene al resolver cada sala (su nombre suele delatar la respuesta).
create table privado.recompensas (
  sala_id  text primary key references public.salas on delete cascade,
  nombre   text not null
);

-- Final del caso: epílogo, hora, objeto final… solo se entrega con la partida resuelta.
create table privado.desenlaces (
  caso_id    text primary key references public.casos on delete cascade,
  contenido  jsonb not null
);

-- Normalización de respuestas: sin tildes, minúsculas, sin espacios ni '#', coma decimal = punto.
create or replace function privado.norm(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select regexp_replace(
           replace(
             regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, ''))), '[\s#]', '', 'g'),
             ',', '.'),
           '[^a-z0-9.]', '', 'g');
$$;

-- ---------------------------------------------------------------------------
-- Jugadores, partidas y eventos
-- ---------------------------------------------------------------------------
create table public.perfiles (
  id         uuid primary key references auth.users on delete cascade,
  alias      text unique check (alias is null or char_length(alias) between 3 and 24),
  creado_at  timestamptz not null default now()
);

create or replace function privado.crear_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function privado.crear_perfil();

create table public.partidas (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.perfiles on delete cascade,
  caso_id          text not null references public.casos,
  version_caso     int  not null,
  es_primera       boolean not null,
  estado           text not null default 'en_curso' check (estado in ('en_curso', 'resuelta', 'abandonada')),
  salas_resueltas  smallint not null default 0,
  penal_seg        int not null default 0,
  inicio           timestamptz not null default now(),
  fin              timestamptz
);
create unique index partidas_una_activa on public.partidas (user_id, caso_id) where estado = 'en_curso';
create unique index partidas_una_primera on public.partidas (user_id, caso_id) where es_primera;

create table public.eventos (
  id          bigint generated always as identity primary key,
  partida_id  uuid not null references public.partidas on delete cascade,
  sala_id     text references public.salas,
  tipo        text not null check (tipo in ('inicio', 'entrar', 'fallo', 'acierto', 'pista', 'fin', 'abandono')),
  detalle     jsonb,
  creado_at   timestamptz not null default now()
);
create index eventos_partida on public.eventos (partida_id, creado_at);
create index eventos_sala_tipo on public.eventos (sala_id, tipo);

-- ---------------------------------------------------------------------------
-- Seguridad: lectura pública del contenido, cada jugador solo ve lo suyo.
-- Toda escritura de partidas y eventos pasa por las funciones RPC.
-- ---------------------------------------------------------------------------
alter table public.casos          enable row level security;
alter table public.salas          enable row level security;
alter table public.categorias     enable row level security;
alter table public.sala_categoria enable row level security;
alter table public.perfiles       enable row level security;
alter table public.partidas       enable row level security;
alter table public.eventos        enable row level security;

create policy casos_lectura on public.casos for select to anon, authenticated using (publicado);
create policy salas_lectura on public.salas for select to anon, authenticated
  using (exists (select 1 from public.casos c where c.id = caso_id and c.publicado));
create policy categorias_lectura on public.categorias for select to anon, authenticated using (true);
create policy sala_categoria_lectura on public.sala_categoria for select to anon, authenticated using (true);

create policy perfil_propio_lectura on public.perfiles for select to authenticated using (id = (select auth.uid()));
create policy partidas_propias on public.partidas for select to authenticated using (user_id = (select auth.uid()));
create policy eventos_propios on public.eventos for select to authenticated
  using (exists (select 1 from public.partidas p where p.id = partida_id and p.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Funciones de juego
-- ---------------------------------------------------------------------------

-- Partida del usuario actual, o error si no es suya.
create or replace function privado.mi_partida(p_partida uuid) returns public.partidas
language plpgsql stable security definer set search_path = '' as $$
declare r public.partidas;
begin
  select * into r from public.partidas where id = p_partida and user_id = auth.uid();
  if not found then raise exception 'Partida no encontrada' using errcode = 'P0002'; end if;
  return r;
end $$;

create or replace function privado.sala_actual(p public.partidas) returns public.salas
language sql stable security definer set search_path = '' as $$
  select s.* from public.salas s where s.caso_id = p.caso_id and s.orden = p.salas_resueltas + 1;
$$;

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

-- Devuelve la partida en curso del caso o crea una nueva.
create or replace function public.iniciar_partida(p_caso text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c public.casos;
  p public.partidas;
begin
  if uid is null then raise exception 'Sin sesión' using errcode = '42501'; end if;
  select * into c from public.casos where id = p_caso and publicado;
  if not found then raise exception 'Caso no encontrado' using errcode = 'P0002'; end if;

  select * into p from public.partidas where user_id = uid and caso_id = p_caso and estado = 'en_curso';
  if not found then
    insert into public.partidas (user_id, caso_id, version_caso, es_primera)
    values (uid, p_caso, c.version,
            not exists (select 1 from public.partidas where user_id = uid and caso_id = p_caso))
    returning * into p;
    insert into public.eventos (partida_id, tipo) values (p.id, 'inicio');
    insert into public.eventos (partida_id, sala_id, tipo) values (p.id, (privado.sala_actual(p)).id, 'entrar');
  end if;
  return public.estado_partida(p.id);
end $$;

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
  select count(*) into total from public.salas where caso_id = p.caso_id;
  update public.partidas set salas_resueltas = salas_resueltas + 1 where id = p.id returning * into p;

  if p.salas_resueltas >= total then
    update public.partidas set estado = 'resuelta', fin = now() where id = p.id;
    insert into public.eventos (partida_id, tipo) values (p.id, 'fin');
  else
    insert into public.eventos (partida_id, sala_id, tipo) values (p.id, (privado.sala_actual(p)).id, 'entrar');
  end if;
  return jsonb_build_object('correcto', true, 'penal_seg', 0,
    'aprende', (select cs.contenido->>'aprende' from privado.contenido_sala cs where cs.sala_id = s.id),
    'estado', public.estado_partida(p.id));
end $$;

create or replace function public.pedir_pista(p_partida uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.partidas := privado.mi_partida(p_partida);
  s public.salas;
  n int;
  pi privado.pistas;
begin
  if p.estado <> 'en_curso' then raise exception 'La partida no está en curso' using errcode = '22023'; end if;
  s := privado.sala_actual(p);
  select count(*) into n from public.eventos where partida_id = p.id and sala_id = s.id and tipo = 'pista';
  select * into pi from privado.pistas where sala_id = s.id and nivel = n + 1;
  if found then
    insert into public.eventos (partida_id, sala_id, tipo, detalle)
    values (p.id, s.id, 'pista', jsonb_build_object('nivel', pi.nivel, 'penal_seg', pi.penal_seg));
    update public.partidas set penal_seg = penal_seg + pi.penal_seg where id = p.id;
  end if;
  return public.estado_partida(p.id);
end $$;

-- Abandona la partida en curso y empieza otra (las repeticiones no puntúan en el ranking).
create or replace function public.reiniciar_partida(p_partida uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.partidas := privado.mi_partida(p_partida);
begin
  if p.estado = 'en_curso' then
    update public.partidas set estado = 'abandonada', fin = now() where id = p.id;
    insert into public.eventos (partida_id, tipo) values (p.id, 'abandono');
  end if;
  return public.iniciar_partida(p.caso_id);
end $$;

-- Progreso del jugador en cada caso, para el índice.
create or replace function public.mis_casos() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x.orden), '[]'::jsonb) from (
    select c.id as caso, c.orden,
      (select count(*) from public.salas s where s.caso_id = c.id) as total_salas,
      (select jsonb_build_object('partida', p.id, 'salas_resueltas', p.salas_resueltas, 'inicio', p.inicio, 'penal_seg', p.penal_seg)
         from public.partidas p where p.user_id = auth.uid() and p.caso_id = c.id and p.estado = 'en_curso') as en_curso,
      (select count(*) from public.partidas p where p.user_id = auth.uid() and p.caso_id = c.id and p.estado = 'resuelta') as resueltas,
      (select min(extract(epoch from p.fin - p.inicio) + p.penal_seg)::int
         from public.partidas p where p.user_id = auth.uid() and p.caso_id = c.id and p.estado = 'resuelta') as mejor_seg
    from public.casos c where c.publicado
  ) x;
$$;

create or replace function public.poner_alias(p_alias text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sin sesión' using errcode = '42501'; end if;
  update public.perfiles set alias = nullif(trim(p_alias), '') where id = auth.uid();
exception when unique_violation then
  raise exception 'Ese alias ya está en uso' using errcode = '23505';
end $$;

-- ---------------------------------------------------------------------------
-- Analítica (esquema privado; se consulta con SQL o a través de funciones públicas)
-- ---------------------------------------------------------------------------

-- Tiempo por sala y partida, con penalizaciones de esa sala.
create or replace view privado.v_tiempos_sala as
with tramos as (
  select e.partida_id, e.sala_id,
    min(e.creado_at) filter (where e.tipo = 'entrar')  as entrada,
    min(e.creado_at) filter (where e.tipo = 'acierto') as salida,
    count(*) filter (where e.tipo = 'fallo')           as fallos,
    count(*) filter (where e.tipo = 'pista')           as pistas,
    coalesce(sum((e.detalle->>'penal_seg')::int) filter (where e.tipo in ('pista', 'fallo')), 0) as penal_seg
  from public.eventos e
  where e.sala_id is not null
  group by e.partida_id, e.sala_id
)
select t.partida_id, p.user_id, p.caso_id, p.es_primera, t.sala_id, t.fallos, t.pistas, t.penal_seg,
  extract(epoch from t.salida - t.entrada)::int                 as segundos,
  extract(epoch from t.salida - t.entrada)::int + t.penal_seg   as segundos_ajustados
from tramos t join public.partidas p on p.id = t.partida_id
where t.salida is not null;

-- Puntuación 0-100 en cada sala: percentil inverso del tiempo ajustado, solo primeras partidas.
create or replace view privado.v_puntuacion_sala as
select v.*,
  round(100 * (1 - percent_rank() over (partition by v.sala_id order by v.segundos_ajustados)))::int as puntuacion,
  count(*) over (partition by v.sala_id) as jugadores_sala
from privado.v_tiempos_sala v
where v.es_primera;

-- Media ponderada por categoría y jugador.
create or replace view privado.v_puntuacion_categoria as
select ps.user_id, sc.categoria_id,
  round(sum(ps.puntuacion * sc.peso) / sum(sc.peso))::int as puntuacion,
  count(*) as salas
from privado.v_puntuacion_sala ps
join public.sala_categoria sc on sc.sala_id = ps.sala_id
group by ps.user_id, sc.categoria_id;

-- Activación: tiempo desde el registro hasta la primera partida.
create or replace view privado.v_activacion as
select pf.id as user_id, pf.creado_at as registro,
  min(p.inicio) as primera_partida,
  extract(epoch from min(p.inicio) - pf.creado_at)::int as segundos_hasta_primera
from public.perfiles pf left join public.partidas p on p.user_id = pf.id
group by pf.id, pf.creado_at;

-- Ranking global o por categoría. Solo jugadores con alias y un mínimo de salas.
create or replace function public.ranking(p_categoria text default null, p_min_salas int default 3)
returns table (posicion int, alias text, puntuacion int, salas int, soy_yo boolean)
language sql stable security definer set search_path = '' as $$
  with base as (
    select ps.user_id, round(avg(ps.puntuacion))::int as puntuacion, count(*)::int as salas
    from privado.v_puntuacion_sala ps
    where p_categoria is null
    group by ps.user_id
    union all
    select pc.user_id, pc.puntuacion, pc.salas::int
    from privado.v_puntuacion_categoria pc
    where p_categoria is not null and pc.categoria_id = p_categoria
  )
  select (rank() over (order by b.puntuacion desc))::int, pf.alias, b.puntuacion, b.salas, b.user_id = auth.uid()
  from base b join public.perfiles pf on pf.id = b.user_id
  where pf.alias is not null and b.salas >= greatest(p_min_salas, 1)
  order by 1, 2
  limit 100;
$$;

create or replace function public.mis_categorias()
returns table (categoria text, nombre text, puntuacion int, salas int)
language sql stable security definer set search_path = '' as $$
  select pc.categoria_id, c.nombre, pc.puntuacion, pc.salas::int
  from privado.v_puntuacion_categoria pc join public.categorias c on c.id = pc.categoria_id
  where pc.user_id = auth.uid()
  order by pc.puntuacion desc;
$$;

-- Estadísticas públicas de un caso (solo primeras partidas). Sin datos si hay menos de 5 jugadores.
create or replace function public.resumen_caso(p_caso text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with r as (
    select extract(epoch from p.fin - p.inicio) + p.penal_seg as seg, c.limite_seg
    from public.partidas p join public.casos c on c.id = p.caso_id
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
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.estado_partida(uuid), public.iniciar_partida(text), public.comprobar_respuesta(uuid, text),
  public.pedir_pista(uuid), public.reiniciar_partida(uuid), public.mis_casos(), public.poner_alias(text),
  public.ranking(text, int), public.mis_categorias(), public.resumen_caso(text)
to authenticated;
grant execute on function public.ranking(text, int), public.resumen_caso(text) to anon;
