#!/usr/bin/env python3
"""Valida una partida (JSON): referencias, solvencia, redundancia y duración estimada."""
import json
import sys

MIN_POR_ESCENARIO = 3
MIN_POR_MECANISMO = 5
DURACION_MIN, DURACION_MAX = 30, 60


def duplicados(lista, etiqueta, errores):
    ids = [x.get("id") for x in lista]
    for d in sorted({i for i in ids if ids.count(i) > 1}):
        errores.append(f"{etiqueta} duplicado: '{d}'")


def chequear_referencias(p, errores):
    escenarios = p.get("escenarios", [])
    esc = {e["id"]: e for e in escenarios}
    items = {i["id"] for i in p.get("items", [])}
    mecs = {m["id"]: m for m in p.get("mecanismos", [])}
    duplicados(escenarios, "escenario", errores)
    duplicados(p.get("items", []), "item", errores)
    duplicados(p.get("mecanismos", []), "mecanismo", errores)

    def item(i, donde):
        if i not in items:
            errores.append(f"{donde}: item inexistente '{i}'")

    def escenario(e, donde):
        if e not in esc:
            errores.append(f"{donde}: escenario inexistente '{e}'")

    if not esc:
        errores.append("la partida no tiene escenarios")
    for e in esc.values():
        for i in e.get("items", []):
            item(i, f"escenario '{e['id']}'")
        for m in e.get("mecanismos", []):
            if m not in mecs:
                errores.append(f"escenario '{e['id']}': mecanismo inexistente '{m}'")
            elif mecs[m].get("escenario") != e["id"]:
                errores.append(f"mecanismo '{m}' no pertenece al escenario '{e['id']}'")
    for m in mecs.values():
        escenario(m.get("escenario"), f"mecanismo '{m['id']}'")
        for i in m.get("requiere", []) + m.get("produce", []):
            item(i, f"mecanismo '{m['id']}'")
        if not m.get("produce"):
            errores.append(f"mecanismo '{m['id']}' no produce nada")
    for k, c in enumerate(p.get("conexiones", [])):
        escenario(c.get("de"), f"conexión {k}")
        escenario(c.get("a"), f"conexión {k}")
        for i in c.get("requiere", []):
            item(i, f"conexión {k}")
    for i in p.get("objetivo", {}).get("requiere", []):
        item(i, "objetivo")
    return esc, items, mecs


def simular(p, esc, mecs, excluir=None):
    """Punto fijo: qué escenarios se visitan, qué objetos se tienen y qué mecanismos se activan.
    excluir: id de un mecanismo o índice de una conexión que se da por inexistente."""
    cons = p.get("conexiones", [])
    visitables = {p["escenarios"][0]["id"]}
    tiene, hechos = set(), set()
    cambio = True
    while cambio:
        cambio = False
        for e_id in list(visitables):
            e = esc[e_id]
            for i in e.get("items", []):
                if i not in tiene:
                    tiene.add(i)
                    cambio = True
            for m_id in e.get("mecanismos", []):
                if m_id in hechos or m_id == excluir:
                    continue
                m = mecs[m_id]
                if set(m["requiere"]) <= tiene:
                    hechos.add(m_id)
                    tiene.update(m["produce"])
                    cambio = True
        for k, c in enumerate(cons):
            if k == excluir or not set(c.get("requiere", [])) <= tiene:
                continue
            for origen, destino in ((c["de"], c["a"]), (c["a"], c["de"])):
                if origen in visitables and destino not in visitables:
                    visitables.add(destino)
                    cambio = True
    return visitables, tiene, hechos


def objetivo_ok(p, tiene):
    return set(p.get("objetivo", {}).get("requiere", [])) <= tiene


def validar(p):
    errores, avisos, info = [], [], {}
    esc, items, mecs = chequear_referencias(p, errores)
    if errores:
        return errores, avisos, info

    visitables, tiene, hechos = simular(p, esc, mecs)
    if not objetivo_ok(p, tiene):
        errores.append("objetivo inalcanzable: no hay forma de completar la partida")
    for e_id in esc:
        if e_id not in visitables:
            errores.append(f"escenario '{e_id}' inaccesible")
    for m_id in mecs:
        if m_id not in hechos:
            errores.append(f"mecanismo '{m_id}' nunca se activa (bloqueo circular o sin fuente)")
    for i_id in items:
        if i_id not in tiene:
            avisos.append(f"item '{i_id}' nunca se obtiene")
    for i in p.get("items", []):
        if i.get("tipo") == "pista":
            niveles = i.get("pistas", {})
            faltan = [n for n in ("sutil", "directa", "solucion") if not niveles.get(n)]
            if faltan:
                avisos.append(f"pista '{i['id']}' sin niveles: {', '.join(faltan)}")

    if errores:
        return errores, avisos, info

    # Redundancia: qué pasa si se quita cada mecanismo o conexión
    criticos = []
    for m_id in mecs:
        _, t, _ = simular(p, esc, mecs, excluir=m_id)
        if not objetivo_ok(p, t):
            criticos.append(m_id)
    for k, c in enumerate(p.get("conexiones", [])):
        _, t, _ = simular(p, esc, mecs, excluir=k)
        if not objetivo_ok(p, t):
            criticos.append(f"conexión {c['de']}-{c['a']}")
    total = len(mecs) + len(p.get("conexiones", []))
    alternativas = total - len(criticos)
    if alternativas != 0:
        errores.append(f"partida no lineal: {alternativas} paso(s) prescindibles; se espera una única solución")

    minutos = MIN_POR_ESCENARIO * len(esc) + MIN_POR_MECANISMO * len(mecs)
    if not DURACION_MIN <= minutos <= DURACION_MAX:
        avisos.append(f"duración estimada {minutos} min, fuera de {DURACION_MIN}-{DURACION_MAX}")

    info.update(criticos=criticos, alternativas=alternativas, total=total, minutos=minutos)
    return errores, avisos, info


def main(ruta):
    with open(ruta, encoding="utf-8") as f:
        p = json.load(f)
    errores, avisos, info = validar(p)
    print(f"== {p.get('premisa', {}).get('titulo', '(sin título)')} ==")
    print(f"escenarios: {len(p.get('escenarios', []))} · mecanismos: {len(p.get('mecanismos', []))} "
          f"· conexiones: {len(p.get('conexiones', []))}")
    for e in errores:
        print("ERROR:", e)
    for a in avisos:
        print("AVISO:", a)
    if info:
        print(f"pasos bloqueantes: {len(info['criticos'])} de {info['total']} "
              f"· alternativas: {info['alternativas']} · duración estimada: {info['minutos']} min")
    print("RESULTADO:", "VÁLIDA Y JUGABLE" if not errores else "NO VÁLIDA")
    return 1 if errores else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
