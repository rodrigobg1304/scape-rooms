# Salas Secretas

Escape room web: casos de cuatro salas, 30 minutos por caso, pistas con penalización y ranking por áreas (matemáticas, lógica, literatura, arte…).

- **Frontend:** Vite + JavaScript, publicado en GitHub Pages.
- **Backend:** Supabase (Postgres, autenticación anónima, funciones RPC).
- **Seguridad del juego:** el navegador nunca recibe soluciones. Cada sala se entrega cuando llegas a ella, las respuestas se validan en la base de datos y el tiempo lo marca el servidor.

```
index.html, src/          Motor del juego (src/main.js) y acceso a Supabase (src/api.js)
src/data/casos.json       Portadas de los casos (generado, público)
scripts/contenido.py      Valida los casos y genera el JSON público y el SQL secreto
scripts/validar.py        Validador de casos (referencias, linealidad, duración)
supabase/migrations/      Esquema, seguridad (RLS), funciones de juego y analítica
supabase/tests/           Pruebas del esquema contra un Postgres local
.github/workflows/        Publicar web, migraciones, mantener Supabase activo, copia cifrada
```

## Dónde vive el contenido

`contenido/casos.json` es la fuente de verdad de los casos **y contiene las soluciones**, así que está en `.gitignore`. La copia de referencia está en el proyecto de Claude "Apps y Juegos" (`salas-secretas/`). Para trabajar en local, colócala en `contenido/casos.json`.

`npm run contenido` la valida y genera:

| Archivo | Qué lleva | ¿Se sube? |
|---|---|---|
| `src/data/casos.json` | Título, descripción, tema visual, avisos y nombres de las salas | Sí |
| `supabase/contenido.sql` | Contenido de cada sala, soluciones, pistas, recompensas, desenlace, categorías | No |

El script se para si un caso no es válido o si alguna solución o pista aparece en el JSON público.

### Categorías

Cada sala toma su categoría del campo `tipo` del mecanismo. Si una sala mezcla áreas, se añade `categorias` con pesos (de 0 a 1):

```json
{ "id": "m_3", "tipo": "matematica", "categorias": { "matematica": 0.6, "logica": 0.4 }, ... }
```

Categorías válidas: `matematica`, `logica`, `literatura`, `arte`, `musica`, `orientacion`, `creatividad`, `narrativa` (se añaden en `CATEGORIAS`, dentro de `scripts/contenido.py`).

Si cambias la solución de una sala que ya se ha jugado, sube `premisa.version` del caso.

## Puesta en marcha

### 1. Supabase

1. Proyecto en región **UE** (p. ej. `eu-west-1` o `eu-central-1`).
2. *Authentication → Sign In / Providers*: activa **Allow anonymous sign-ins**.
3. *Project Settings → API*: copia la URL y la clave `anon` (públicas).
4. *Connect → Session pooler*: copia la cadena de conexión (privada). Usa el pooler: los runners de GitHub no tienen IPv6.

### 2. GitHub (repositorio `scape-rooms`)

- *Settings → Pages → Source*: **GitHub Actions**.
- *Settings → Secrets and variables → Actions*:
  - Variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
  - Secretos: `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE` (frase larga; guárdala, sin ella no se puede abrir la copia)

### 3. Primer despliegue

```bash
cp .env.example .env.local        # rellena los valores
npm ci
set -a; source .env.local; set +a
npx supabase db push --db-url "$SUPABASE_DB_URL"   # o lanza el workflow "Migraciones"
npm run db:contenido                                # carga casos y soluciones (necesita psql)
git push                                            # publica la web
```

La web queda en `https://rodrigobg1304.github.io/scape-rooms/`.

### Desarrollo local

```bash
npm run dev    # usa .env.local
```

## Workflows

| Workflow | Cuándo | Qué hace |
|---|---|---|
| Publicar web | push a `main` | Compila y publica en Pages |
| Migraciones | cambios en `supabase/migrations/` | `supabase db push` |
| Mantener Supabase activo | cada 3 días | Consulta la API para que el plan gratuito no pause el proyecto |
| Copia de seguridad | domingos | Volcado de esquema y datos, cifrado con AES-256, guardado 90 días |

Para recuperar una copia: `gpg -d copia.tar.gz.gpg > copia.tar.gz`.

GitHub desactiva los workflows programados si el repositorio pasa 60 días sin actividad. Si ocurre, se reactivan desde la pestaña *Actions*.

## Modelo de datos

- `casos`, `salas`, `categorias`, `sala_categoria`: contenido público.
- `privado.*` (esquema no expuesto por la API): `soluciones`, `pistas`, `contenido_sala`, `recompensas`, `desenlaces`.
- `perfiles`: uno por usuario (se crea al registrarse). `alias` para el ranking.
- `partidas`: una por intento. `es_primera` marca el primer intento de cada caso; solo esa partida puntúa.
- `eventos`: `inicio`, `entrar`, `fallo`, `acierto`, `pista`, `fin`, `abandono`, con hora del servidor.

Funciones RPC (solo usuarios con sesión): `iniciar_partida`, `estado_partida`, `comprobar_respuesta`, `pedir_pista`, `reiniciar_partida`, `mis_casos`, `poner_alias`, `ranking`, `mis_categorias`, `resumen_caso`.

### Puntuación

Para cada sala, la puntuación es el percentil inverso del tiempo ajustado (tiempo en la sala + penalizaciones), calculado solo con primeras partidas: el más rápido saca 100. La puntuación por categoría es la media ponderada por `peso`. El ranking exige alias y un mínimo de salas; `resumen_caso` no da medias con menos de 5 jugadores.

### Analítica (SQL editor de Supabase)

```sql
select * from privado.v_tiempos_sala;          -- tiempo, pistas y fallos por sala y partida
select * from privado.v_puntuacion_categoria;  -- puntuación por jugador y categoría
select * from privado.v_activacion;            -- tiempo desde el registro hasta la primera partida
```

## Pruebas

Contra un Postgres 15+ local con la extensión `unaccent`:

```bash
createdb salas_test
psql -d salas_test -f supabase/tests/stub_supabase.sql \
  -f supabase/migrations/*.sql -f supabase/contenido.sql \
  -f supabase/tests/prueba_juego.sql
```

`prueba_juego.sql` juega una partida completa y comprueba que las soluciones no se pueden leer, que no se pueden crear partidas sin pasar por las funciones, que un jugador no ve ni toca partidas ajenas y que las penalizaciones se aplican.

## Limitaciones conocidas

- El tiempo es de reloj: si alguien deja el caso a medias y vuelve otro día, su tiempo lo refleja. Es deliberado: pausar desde el cliente sería fácil de falsear.
- La sesión anónima vive en el navegador. Si se borran los datos del navegador, se pierde el progreso. Falta vincular la cuenta a un email (fase 2).
- Una cuenta anónima por navegador: no impide que alguien cree varias para practicar. Las repeticiones con la misma cuenta no puntúan, pero con cuentas nuevas sí.
