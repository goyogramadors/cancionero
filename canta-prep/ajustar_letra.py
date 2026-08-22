# -*- coding: utf-8 -*-
"""Ajusta la letra de un paquete Canta con la letra correcta escrita a mano.

Whisper acierta los TIEMPOS pero se equivoca en las PALABRAS. Esto toma la
letra buena (un .txt, una linea por verso, lineas en blanco separan estrofas)
y la monta sobre los tiempos que Whisper ya encontro, alineando las dos
secuencias de palabras con difflib.

    ajustar_letra.bat ..\\app\\canta-media\\<id> letra.txt

No toca las notas ni la curva de tono: solo reescribe "lines".
"""
import argparse
import difflib
import json
import os
import re
import shutil
import sys
import unicodedata


def normalizar(palabra):
    """Forma comparable: sin tildes, sin puntuacion, en minusculas."""
    txt = unicodedata.normalize('NFD', palabra.lower())
    txt = ''.join(c for c in txt if unicodedata.category(c) != 'Mn')
    return re.sub(r"[^\w']", '', txt)


def leer_letra(ruta):
    """Devuelve [[palabra, ...], ...]: una lista de palabras por verso."""
    with open(ruta, encoding='utf-8') as fh:
        crudo = fh.read()
    versos = []
    for linea in crudo.splitlines():
        palabras = linea.split()
        if palabras:
            versos.append(palabras)
    if not versos:
        sys.exit('ERROR: la letra esta vacia.')
    return versos


def palabras_del_paquete(datos):
    """Aplana lines[].words[] a [(inicio, fin, texto), ...]."""
    plano = []
    for linea in datos.get('lines', []):
        for w in linea.get('words', []):
            if w.get('w', '').strip():
                plano.append((w['s'], w['e'], w['w']))
    return plano


def asignar_tiempos(reconocidas, correctas):
    """Da (inicio, fin) a cada palabra correcta usando los tiempos de Whisper.

    Alinea ambas secuencias por su forma normalizada. Devuelve (tiempos, exactas):
    'exactas' cuenta solo las palabras que Whisper oyo IGUAL, que es la medida
    honesta de si la letra corresponde a esta cancion. Las que Whisper oyo
    distinto heredan el tiempo de lo que dijo en su lugar; las que se comio
    quedan sin ancla y se interpolan despues.
    """
    a = [normalizar(w[2]) for w in reconocidas]
    b = [normalizar(w) for w in correctas]
    tiempos = [None] * len(correctas)
    exactas = 0

    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    for etiqueta, i1, i2, j1, j2 in sm.get_opcodes():
        if etiqueta == 'delete':
            continue  # Whisper alucino palabras que no existen: se descartan
        if etiqueta == 'insert':
            continue  # faltan en Whisper: se interpolan mas abajo
        if etiqueta == 'equal':
            exactas += j2 - j1
        # 'equal' o 'replace': repartir los tiempos del bloque entre las palabras
        origen, destino = i2 - i1, j2 - j1
        for k in range(destino):
            # si los largos difieren, se estira proporcionalmente
            idx = i1 + min(origen - 1, k * origen // destino) if origen else None
            if idx is not None:
                tiempos[j1 + k] = (reconocidas[idx][0], reconocidas[idx][1])
    return tiempos, exactas


def interpolar(tiempos, duracion):
    """Rellena los huecos (palabras sin ancla) repartiendo el tiempo vecino."""
    n = len(tiempos)
    anclas = [i for i, t in enumerate(tiempos) if t is not None]
    if not anclas:
        sys.exit('ERROR: no se pudo alinear ninguna palabra. Revisa que la letra\n'
                 '       corresponda a esta cancion (y el idioma).')

    # bordes: antes de la primera ancla y despues de la ultima
    for i in range(anclas[0]):
        ini, fin = tiempos[anclas[0]]
        paso = 0.25
        tiempos[i] = (max(0.0, ini - paso * (anclas[0] - i)),
                      max(0.0, ini - paso * (anclas[0] - i - 1)))
    for i in range(anclas[-1] + 1, n):
        ini, fin = tiempos[anclas[-1]]
        paso = 0.25
        tiempos[i] = (min(duracion, fin + paso * (i - anclas[-1] - 1)),
                      min(duracion, fin + paso * (i - anclas[-1])))

    # huecos internos: repartir el silencio entre las dos anclas
    for izq, der in zip(anclas, anclas[1:]):
        hueco = der - izq - 1
        if hueco <= 0:
            continue
        desde, hasta = tiempos[izq][1], tiempos[der][0]
        if hasta <= desde:
            hasta = desde + 0.05 * hueco
        ancho = (hasta - desde) / hueco
        for k in range(hueco):
            tiempos[izq + 1 + k] = (desde + ancho * k, desde + ancho * (k + 1))
    return tiempos


def armar_lineas(versos, tiempos):
    """Reagrupa las palabras ya cronometradas en la estructura de versos."""
    lineas, cursor = [], 0
    for palabras in versos:
        items = []
        for palabra in palabras:
            ini, fin = tiempos[cursor]
            items.append({'s': round(ini, 3), 'e': round(fin, 3), 'w': palabra})
            cursor += 1
        lineas.append({
            's': items[0]['s'],
            'e': items[-1]['e'],
            'text': ' '.join(palabras),
            'words': items,
        })
    return lineas


def ajustar(carpeta, ruta_letra, respaldo=True):
    ruta_json = os.path.join(carpeta, 'canta.json')
    if not os.path.exists(ruta_json):
        sys.exit('ERROR: no existe %s' % ruta_json)
    with open(ruta_json, encoding='utf-8') as fh:
        datos = json.load(fh)

    versos = leer_letra(ruta_letra)
    correctas = [p for verso in versos for p in verso]
    reconocidas = palabras_del_paquete(datos)
    if not reconocidas:
        sys.exit('ERROR: el paquete no tiene palabras con tiempos que aprovechar.')

    tiempos, exactas = asignar_tiempos(reconocidas, correctas)
    tiempos = interpolar(tiempos, datos.get('duration', 0) or 0)
    datos['lines'] = armar_lineas(versos, tiempos)

    pct = 100.0 * exactas / len(correctas)
    if pct < 25:
        # con la letra equivocada el resultado seria un karaoke sin sentido
        sys.exit('ERROR: solo %d de %d palabras (%.0f%%) calzan con lo que se oye.\n'
                 '       La letra no parece ser la de esta cancion. No se toco nada.'
                 % (exactas, len(correctas), pct))

    if respaldo:
        shutil.copyfile(ruta_json, ruta_json + '.bak')
    with open(ruta_json, 'w', encoding='utf-8') as fh:
        json.dump(datos, fh, ensure_ascii=False)

    print('Letra ajustada: %d versos, %d palabras.' % (len(versos), len(correctas)))
    print('Calzaron exactamente con lo cantado: %d/%d (%.0f%%).' % (exactas, len(correctas), pct))
    print('El resto conserva el tiempo de lo que Whisper oyo en su lugar.')
    if respaldo:
        print('Respaldo del original en canta.json.bak')
    return pct


def autochequeo():
    """Comprueba el alineamiento con un caso armado a mano."""
    # Whisper oyo mal "caught"/"trap" y se comio "are"; la letra buena corrige.
    reconocidas = [(0.0, 0.5, 'we'), (0.6, 1.0, 'cot'), (1.0, 1.5, 'in'),
                   (1.5, 2.0, 'a'), (2.0, 2.5, 'trup')]
    correctas = ['We', 'are', 'caught', 'in', 'a', 'trap', 'baby']

    tiempos, exactas = asignar_tiempos(reconocidas, correctas)
    assert tiempos[0] == (0.0, 0.5), 'la palabra que calza conserva su tiempo'
    assert tiempos[3] == (1.0, 1.5), 'la palabra que calza conserva su tiempo'
    assert tiempos[2] == (0.6, 1.0), 'la mal oida hereda el tiempo de su reemplazo'
    assert tiempos[5] == (2.0, 2.5), 'la mal oida hereda el tiempo de su reemplazo'
    assert exactas == 3, 'solo we/in/a se oyeron igual, no las reemplazadas'

    # una palabra omitida por Whisper, rodeada de aciertos, queda sin ancla
    faltante, _ = asignar_tiempos(
        [(0.0, 0.5, 'we'), (1.0, 1.5, 'caught'), (1.5, 2.0, 'in')],
        ['we', 'are', 'caught', 'in'])
    assert faltante[1] is None, 'la palabra que Whisper no oyo queda sin ancla'
    assert faltante[2] == (1.0, 1.5), 'sus vecinas no se mueven'
    rellenas = interpolar(list(faltante), 10.0)
    assert 0.5 <= rellenas[1][0] and rellenas[1][1] <= 1.0, 'se interpola en el hueco'

    tiempos = interpolar(tiempos, 10.0)
    assert all(t is not None for t in tiempos), 'no pueden quedar huecos'
    for ini, fin in tiempos:
        assert fin >= ini, 'cada palabra dura cero o mas'
    seq = [t[0] for t in tiempos]
    assert seq == sorted(seq), 'las palabras deben quedar en orden creciente'

    versos = [['We', 'are', 'caught'], ['in', 'a', 'trap', 'baby']]
    lineas = armar_lineas(versos, tiempos)
    assert len(lineas) == 2, 'un verso por linea'
    assert lineas[1]['text'] == 'in a trap baby'
    assert lineas[0]['s'] <= lineas[0]['e'] <= lineas[1]['e']
    assert sum(len(l['words']) for l in lineas) == len(correctas)

    # una letra que no tiene nada que ver debe dar 0 calces exactos: asi la
    # deteccion de "esta no es la letra de esta cancion" no se puede burlar
    _, ninguna = asignar_tiempos(reconocidas, ['zzz', 'qqq'])
    assert ninguna == 0, 'sin coincidencias reales no puede reportar calces'

    print('autochequeo OK')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description='Ajusta la letra de un paquete Canta.')
    p.add_argument('carpeta', nargs='?', help='carpeta del paquete (con canta.json)')
    p.add_argument('letra', nargs='?', help='archivo .txt con la letra correcta')
    p.add_argument('--sin-respaldo', action='store_true', help='no dejar canta.json.bak')
    p.add_argument('--autochequeo', action='store_true', help='corre la prueba interna y sale')
    args = p.parse_args()
    if args.autochequeo:
        autochequeo()
    elif args.carpeta and args.letra:
        ajustar(args.carpeta, args.letra, respaldo=not args.sin_respaldo)
    else:
        p.error('faltan la carpeta del paquete y el archivo de letra')
