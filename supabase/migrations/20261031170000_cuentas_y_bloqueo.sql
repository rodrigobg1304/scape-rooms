-- Cuentas de jugador (alias) y casos bloqueados hasta que se validen.

-- ---------------------------------------------------------------------------
-- 1. Casos validados: solo estos se pueden jugar. Los demás salen bloqueados en el índice.
--    contenido.sql nunca toca esta columna: la decide quien administra la base de datos.
--      update public.casos set validado = true  where id = 'kepler_9';
--      update public.casos set validado = false where id = 'kepler_9';
-- ---------------------------------------------------------------------------
alter table public.casos add column if not exists validado boolean not null default false;
comment on column public.casos.validado is 'Caso revisado y listo para jugar. Los no validados se ven bloqueados en el índice.';
update public.casos set validado = true where id in ('reloj_praga', 'faro_cabo');

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
  if not c.validado then raise exception 'Este caso aún no está disponible.' using errcode = '55000'; end if;

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

create or replace function public.mis_casos() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x.orden), '[]'::jsonb) from (
    select c.id as caso, c.orden, c.validado,
      (select count(*) from public.salas s where s.caso_id = c.id) as total_salas,
      (select jsonb_build_object('partida', p.id, 'salas_resueltas', p.salas_resueltas, 'inicio', p.inicio, 'penal_seg', p.penal_seg)
         from public.partidas p where p.user_id = auth.uid() and p.caso_id = c.id and p.estado = 'en_curso') as en_curso,
      (select count(*) from public.partidas p where p.user_id = auth.uid() and p.caso_id = c.id and p.estado = 'resuelta') as resueltas,
      (select min(extract(epoch from p.fin - p.inicio) + p.penal_seg)::int
         from public.partidas p where p.user_id = auth.uid() and p.caso_id = c.id and p.estado = 'resuelta') as mejor_seg
    from public.casos c where c.publicado
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- 2. Alias: único sin distinguir mayúsculas, y se toma de los datos del registro.
--    Si el alias ya está cogido o no es válido, la cuenta se crea igualmente sin alias.
-- ---------------------------------------------------------------------------
create unique index if not exists perfiles_alias_lower on public.perfiles (lower(alias));

create or replace function privado.crear_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.perfiles (id, alias)
    values (new.id, nullif(left(trim(coalesce(new.raw_user_meta_data ->> 'alias', '')), 24), ''))
    on conflict (id) do nothing;
  exception when unique_violation or check_violation then
    insert into public.perfiles (id) values (new.id) on conflict (id) do nothing;
  end;
  return new;
end $$;

create or replace function public.alias_disponible(p_alias text) returns boolean
language sql stable security definer set search_path = '' as $$
  select char_length(trim(coalesce(p_alias, ''))) between 3 and 24
     and not exists (select 1 from public.perfiles where lower(alias) = lower(trim(p_alias)));
$$;

create or replace function public.mi_perfil() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('alias', pf.alias) from public.perfiles pf where pf.id = auth.uid();
$$;

revoke execute on function public.alias_disponible(text), public.mi_perfil() from public, anon;
grant execute on function public.alias_disponible(text) to anon, authenticated;
grant execute on function public.mi_perfil() to authenticated;
