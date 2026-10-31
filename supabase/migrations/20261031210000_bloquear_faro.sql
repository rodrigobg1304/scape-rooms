-- El caso del faro queda bloqueado hasta que se complete su historia.
-- Para volver a abrirlo: update public.casos set validado = true where id = 'faro_cabo';
update public.casos set validado = false where id = 'faro_cabo';
