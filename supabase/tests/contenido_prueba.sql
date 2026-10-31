-- Contenido mínimo para probar (no es el real)
insert into public.categorias values ('matematica','Matemáticas'),('logica','Lógica'),('literatura','Literatura');
insert into public.casos (id,titulo,orden,validado) values ('faro_cabo','La última guardia de Punta do Cabo',2,true),('reloj_praga','El reloj que se paró en Praga',1,true);
insert into public.salas (id,caso_id,orden,nombre) values
 ('faro_cabo/a','faro_cabo',1,'Muelle'),('faro_cabo/b','faro_cabo',2,'Caseta'),
 ('reloj_praga/a','reloj_praga',1,'Taller'),('reloj_praga/b','reloj_praga',2,'Torre');
insert into public.sala_categoria values ('faro_cabo/a','matematica',1),('faro_cabo/b','literatura',1),('faro_cabo/b','logica',0.5),
 ('reloj_praga/a','matematica',1),('reloj_praga/b','logica',1);
insert into privado.soluciones values ('faro_cabo/a','315'),('faro_cabo/b','mar'),('reloj_praga/a','12'),('reloj_praga/b','karel');
insert into privado.pistas values ('faro_cabo/a',1,'p1',60),('faro_cabo/a',2,'p2',120),('faro_cabo/b',1,'p',60),('reloj_praga/a',1,'p',60),('reloj_praga/b',1,'p',60);
insert into privado.contenido_sala select id, '{"puzzle":"x"}'::jsonb from public.salas;
insert into privado.recompensas select id, 'obj '||id from public.salas;
