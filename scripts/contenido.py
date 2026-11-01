#!/usr/bin/env python3
"""Divide contenido/casos.json en dos partes:

  src/data/casos.json     público: lo que el navegador necesita para pintar las salas.
                          Sin soluciones, sin pistas, sin recompensas ni desenlace.
  supabase/contenido.sql  secreto: casos, salas, categorías, soluciones, pistas y desenlaces,
                          como upserts idempotentes. Se carga con `npm run db:contenido`.

Antes valida cada caso con validar.py y comprueba que el caso es lineal (una sala por mecanismo).

Uso: python3 scripts/contenido.py [contenido/casos.json]
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from validar import validar  # noqa: E402

RAIZ = pathlib.Path(__file__).resolve().parent.parent
SALIDA_PUBLICA = RAIZ / "src" / "data" / "casos.json"
SALIDA_SQL = RAIZ / "supabase" / "contenido.sql"

CATEGORIAS = {
    "matematica": "Matemáticas",
    "logica": "Lógica",
    "literatura": "Literatura",
    "arte": "Arte",
    "musica": "Música",
    "orientacion": "Orientación",
    "creatividad": "Creatividad",
    "narrativa": "Narrativa",
}
NIVELES = [("sutil", 1, 60), ("directa", 2, 120), ("solucion", 3, 300)]  # nivel, penalización en segundos
PENAL_FALLO = {"cartas": 60, "ordenes": 60}  # widgets en los que fallar penaliza (acusaciones)
LIMITE_SEG = 30 * 60
DESENLACE = ("epilogo", "epilogo_tarde", "historia", "hora", "final")


def q(v):
    """Literal SQL."""
    if v is None:
        return "null"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def comprobar_lineal(j):
    errores = []
    ids_esc = [e["id"] for e in j["escenarios"]]
    for k, e in enumerate(j["escenarios"]):
        if len(e.get("mecanismos", [])) != 1 or len(e.get("items", [])) != 1:
            errores.append(f"escenario '{e['id']}' debe tener exactamente un mecanismo y una pista")
    if [m["escenario"] for m in j["mecanismos"]] != ids_esc:
        errores.append("los mecanismos deben ir en el mismo orden que los escenarios")
    for m in j["mecanismos"]:
        cats = m.get("categorias") or {m.get("tipo"): 1}
        for c, peso in cats.items():
            if c not in CATEGORIAS:
                errores.append(f"mecanismo '{m['id']}': categoría desconocida '{c}'")
            if not 0 < peso <= 1:
                errores.append(f"mecanismo '{m['id']}': peso fuera de (0, 1] en '{c}'")
        if not str(m.get("solucion", "")).strip():
            errores.append(f"mecanismo '{m['id']}' sin solución")
    return errores


def publico(j):
    """Solo la portada del caso y los nombres de las salas. Todo lo demás llega sala a sala desde Supabase."""
    pr = {k: v for k, v in j["premisa"].items() if k not in DESENLACE}
    return {"premisa": pr, "salas": [{"orden": n, "nombre": e["nombre"]} for n, e in enumerate(j["escenarios"], 1)]}


def contenido_sala(j, e, m):
    items = {i["id"]: i for i in j["items"]}
    pista = items[e["items"][0]]
    c = {"intro": e.get("intro", ""), "descripcion": e["descripcion"],
         "pista": {"nombre": pista["nombre"], "descripcion": pista["descripcion"]},
         "puzzle": m["puzzle"], "aprende": m.get("aprende", "")}
    if m.get("widget"):
        c["widget"] = m["widget"]
    return c


def sql(juegos):
    out = ["-- Generado por scripts/contenido.py. No editar a mano. Contiene soluciones: no se versiona.",
           "begin;", ""]
    out.append("insert into public.categorias (id, nombre) values")
    out.append(",\n".join(f"  ({q(k)}, {q(v)})" for k, v in CATEGORIAS.items()))
    out.append("on conflict (id) do update set nombre = excluded.nombre;\n")

    for orden, j in enumerate(juegos, 1):
        pr = j["premisa"]
        cid = pr["id"]
        items = {i["id"]: i for i in j["items"]}
        out.append(f"-- {pr['titulo']}")
        out.append(
            "insert into public.casos (id, titulo, orden, version, limite_seg, publicado) values "
            f"({q(cid)}, {q(pr['titulo'])}, {orden}, {int(pr.get('version', 1))}, {int(pr.get('limite_seg', LIMITE_SEG))}, true)\n"
            "on conflict (id) do update set titulo = excluded.titulo, orden = excluded.orden, "
            "version = excluded.version, limite_seg = excluded.limite_seg, publicado = true;")
        sala_ids = []
        for n, (e, m) in enumerate(zip(j["escenarios"], j["mecanismos"]), 1):
            sid = f"{cid}/{m['id']}"
            sala_ids.append(sid)
            penal = PENAL_FALLO.get((m.get("widget") or {}).get("tipo"), 0)
            out.append(
                f"insert into public.salas (id, caso_id, orden, nombre, penal_fallo_seg) values "
                f"({q(sid)}, {q(cid)}, {n}, {q(e['nombre'])}, {penal})\n"
                "on conflict (id) do update set caso_id = excluded.caso_id, orden = excluded.orden, "
                "nombre = excluded.nombre, penal_fallo_seg = excluded.penal_fallo_seg;")
            out.append(
                f"insert into privado.soluciones (sala_id, respuesta_norm) values ({q(sid)}, privado.norm({q(m['solucion'])}))\n"
                "on conflict (sala_id) do update set respuesta_norm = excluded.respuesta_norm;")
            pista = items[e["items"][0]]
            for clave, nivel, seg in NIVELES:
                out.append(
                    f"insert into privado.pistas (sala_id, nivel, texto, penal_seg) values "
                    f"({q(sid)}, {nivel}, {q(pista['pistas'][clave])}, {seg})\n"
                    "on conflict (sala_id, nivel) do update set texto = excluded.texto, penal_seg = excluded.penal_seg;")
            cont = json.dumps(contenido_sala(j, e, m), ensure_ascii=False)
            out.append(
                f"insert into privado.contenido_sala (sala_id, contenido) values ({q(sid)}, {q(cont)}::jsonb)\n"
                "on conflict (sala_id) do update set contenido = excluded.contenido;")
            premio = items[m["produce"][0]]["nombre"]
            out.append(
                f"insert into privado.recompensas (sala_id, nombre) values ({q(sid)}, {q(premio)})\n"
                "on conflict (sala_id) do update set nombre = excluded.nombre;")
        lista = ", ".join(q(s) for s in sala_ids)
        out.append(f"delete from public.sala_categoria where sala_id in ({lista});")
        filas = []
        for m in j["mecanismos"]:
            for c, peso in (m.get("categorias") or {m["tipo"]: 1}).items():
                filas.append(f"  ({q(cid + '/' + m['id'])}, {q(c)}, {peso})")
        out.append("insert into public.sala_categoria (sala_id, categoria_id, peso) values\n" + ",\n".join(filas) + ";")
        objetivo = items[j["objetivo"]["requiere"][0]]["nombre"]
        desenlace = {"objeto": objetivo, **{k: pr[k] for k in DESENLACE if k in pr}}
        out.append(
            f"insert into privado.desenlaces (caso_id, contenido) values ({q(cid)}, {q(json.dumps(desenlace, ensure_ascii=False))}::jsonb)\n"
            "on conflict (caso_id) do update set contenido = excluded.contenido;\n")

    activos = ", ".join(q(j["premisa"]["id"]) for j in juegos)
    out.append(f"update public.casos set publicado = false where id not in ({activos});")
    out.append("commit;")
    return "\n".join(out) + "\n"


def main(ruta):
    juegos = json.loads(pathlib.Path(ruta).read_text(encoding="utf-8"))
    fallos = 0
    ids = [j["premisa"]["id"] for j in juegos]
    if len(ids) != len(set(ids)):
        print("ERROR: ids de caso duplicados")
        fallos += 1
    for j in juegos:
        errores, avisos, _ = validar(j)
        errores += comprobar_lineal(j)
        estado = "OK" if not errores else "NO VÁLIDO"
        print(f"{estado:9} {j['premisa']['id']}")
        for e in errores:
            print("   ERROR:", e)
        for a in avisos:
            print("   aviso:", a)
        fallos += bool(errores)
    if fallos:
        print(f"\n{fallos} caso(s) con errores. No se genera nada.")
        return 1

    SALIDA_PUBLICA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA_PUBLICA.write_text(json.dumps([publico(j) for j in juegos], ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    SALIDA_SQL.write_text(sql(juegos), encoding="utf-8")
    print(f"\n{len(juegos)} casos → {SALIDA_PUBLICA.relative_to(RAIZ)} y {SALIDA_SQL.relative_to(RAIZ)}")

    # Comprobación de fugas: ninguna solución ni pista debe aparecer en el JSON público.
    texto = SALIDA_PUBLICA.read_text(encoding="utf-8")
    for j in juegos:
        for m in j["mecanismos"]:
            opciones = (m.get("widget") or {}).get("sospechosos", [])  # en un desplegable la respuesta es una opción
            if len(m["solucion"]) >= 4 and m["solucion"] not in opciones and f'"{m["solucion"]}"' in texto:
                print(f"ERROR: la solución de {j['premisa']['id']}/{m['id']} aparece en el JSON público")
                return 1
        for i in j["items"]:
            for v in (i.get("pistas") or {}).values():
                if len(v) >= 12 and v in texto:
                    print(f"ERROR: una pista de {j['premisa']['id']}/{i['id']} aparece en el JSON público")
                    return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else RAIZ / "contenido" / "casos.json"))
