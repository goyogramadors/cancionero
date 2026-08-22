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
        origen, destino = i2 - i1, j2 - j1
        if etiqueta == 'equal':
            exactas += destino
            for k in range(destino):
                tiempos[j1 + k] = (reconocidas[i1 + k][0], reconocidas[i1 + k][1])
        else:
            # 'replace': Whisper oyo otra cosa aqui. Se reparte el INTERVALO
            # completo del bloque entre las palabras de la letra. Darles a
            # todas el instante de la misma palabra oida las amontonaba en
            # 0.2 s y dejaba la siguiente estirada 30 s.
            ini, fin = reconocidas[i1][0], reconocidas[i2 - 1][1]
            ancho = (fin - ini) / destino if destino else 0
            for k in range(destino):
                tiempos[j1 + k] = (ini + ancho * k, ini + ancho * (k + 1))
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
    partidos = sanear_versos(datos['lines'])

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
    if partidos:
        print('Se re-anclaron %d verso(s) que habian quedado partidos en dos.' % partidos)
    revisar_versos(datos['lines'])
    return pct


def sanear_versos(lineas, max_hueco=4.0):
    """Las palabras de un mismo verso se cantan seguidas, nunca con decenas de
    segundos entre medio.

    Cuando una palabra de la letra no existe en lo cantado (un "Well," que el
    cantante no dice), el alineador la puede anclar a una repeticion lejana y
    el verso queda partido en dos mitades separadas por medio minuto. Aqui se
    detecta ese corte y se re-reparte el verso completo en el rango del grupo
    mayoritario, que es el que de verdad corresponde.
    """
    arreglados = 0
    for L in lineas:
        ws = L.get('words') or []
        if len(ws) < 2:
            continue
        grupos, actual = [], [ws[0]]
        for k in range(1, len(ws)):
            if ws[k]['s'] - ws[k - 1]['e'] > max_hueco:
                grupos.append(actual)
                actual = []
            actual.append(ws[k])
        grupos.append(actual)
        if len(grupos) < 2:
            # Sin cortes, pero puede estar estirado: si ninguna palabra del
            # verso consiguio ancla, la interpolacion lo reparte por todo el
            # hueco y cada palabra "dura" diez segundos. Se comprime a algo
            # cantable al inicio del hueco.
            if L['e'] - L['s'] > len(ws) * 2.5:
                ini, ancho = L['s'], 0.5
                for k, w in enumerate(ws):
                    w['s'] = round(ini + ancho * k, 3)
                    w['e'] = round(ini + ancho * (k + 1), 3)
                L['s'], L['e'] = ws[0]['s'], ws[-1]['e']
                arreglados += 1
            continue
        mayor = max(grupos, key=len)
        ini, fin = mayor[0]['s'], mayor[-1]['e']
        ancho = (fin - ini) / len(ws) if fin > ini else 0.25
        for k, w in enumerate(ws):
            w['s'] = round(ini + ancho * k, 3)
            w['e'] = round(ini + ancho * (k + 1), 3)
        L['s'], L['e'] = ws[0]['s'], ws[-1]['e']
        arreglados += 1
    return arreglados


def revisar_versos(lineas, max_dur=12.0, max_hueco=4.0):
    """Avisa que versos quedaron mal, en vez de darlos por buenos.

    Un porcentaje alto de calce no garantiza que TODOS los versos quedaran
    bien: basta que la cancion repita un estribillo mas veces que la letra
    para que un verso se estire por decenas de segundos.
    """
    sospechosos = []
    for i, L in enumerate(lineas):
        motivos = []
        if L['e'] - L['s'] > max_dur:
            motivos.append('dura %.0f s' % (L['e'] - L['s']))
        # versos aplastados: pasa cuando la letra trae MAS versos de los que la
        # cancion canta, y los que sobran se amontonan todos en el ultimo
        # instante. Sin este chequeo se reportaban como "razonables".
        if L['e'] - L['s'] < 0.4 * max(1, len(L.get('words') or [1])) * 0.25:
            motivos.append('dura %.1f s, no alcanza a cantarse' % (L['e'] - L['s']))
        ws = L.get('words') or []
        hueco = max([ws[k]['s'] - ws[k - 1]['e'] for k in range(1, len(ws))] or [0])
        if hueco > max_hueco:
            motivos.append('salto de %.0f s entre sus palabras' % hueco)
        if motivos:
            sospechosos.append((i, ' y '.join(motivos), L['text'][:44]))

    if not sospechosos:
        print('Revision: los %d versos quedaron con tiempos razonables.' % len(lineas))
        return sospechosos

    print('\nOJO: %d de %d versos quedaron mal sincronizados:' % (len(sospechosos), len(lineas)))
    for i, motivo, texto in sospechosos[:10]:
        print('  verso %d (%s): "%s"' % (i, motivo, texto))
    if len(sospechosos) > 10:
        print('  ...y %d mas.' % (len(sospechosos) - 10))
    print('Suele pasar cuando la cancion repite un estribillo mas veces que tu\n'
          'letra: agrega esas repeticiones al .txt y vuelve a correr esto.')
    return sospechosos


def autochequeo():
    """Comprueba el alineamiento con un caso armado a mano."""
    # Whisper oyo mal "caught"/"trap" y se comio "are"; la letra buena corrige.
    reconocidas = [(0.0, 0.5, 'we'), (0.6, 1.0, 'cot'), (1.0, 1.5, 'in'),
                   (1.5, 2.0, 'a'), (2.0, 2.5, 'trup')]
    correctas = ['We', 'are', 'caught', 'in', 'a', 'trap', 'baby']

    tiempos, exactas = asignar_tiempos(reconocidas, correctas)
    assert tiempos[0] == (0.0, 0.5), 'la palabra que calza conserva su tiempo'
    assert tiempos[3] == (1.0, 1.5), 'la palabra que calza conserva su tiempo'
    assert exactas == 3, 'solo we/in/a se oyeron igual, no las reemplazadas'
    # "cot" (0.6-1.0) se convierte en "are"+"caught": el intervalo se REPARTE,
    # no se le da el mismo instante a las dos. Este es el caso que amontonaba
    # versos en 0.2 s y estiraba el siguiente a 30 s.
    assert abs(tiempos[1][0] - 0.6) < 1e-9 and abs(tiempos[1][1] - 0.8) < 1e-9
    assert abs(tiempos[2][0] - 0.8) < 1e-9 and abs(tiempos[2][1] - 1.0) < 1e-9
    assert tiempos[1] != tiempos[2], 'dos palabras nunca pueden caer en el mismo instante'
    assert tiempos[5] != tiempos[6], 'dos palabras nunca pueden caer en el mismo instante'
    for k in range(1, len(tiempos)):
        if tiempos[k] and tiempos[k - 1]:
            assert tiempos[k][0] >= tiempos[k - 1][0] - 1e-9, 'no pueden ir hacia atras'

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

    # la revision tiene que delatar el verso estirado, no darlo por bueno
    sano = [{'s': 0.0, 'e': 2.0, 'text': 'ok',
             'words': [{'s': 0.0, 'e': 1.0, 'w': 'a'}, {'s': 1.0, 'e': 2.0, 'w': 'b'}]}]
    estirado = [{'s': 0.0, 'e': 60.0, 'text': 'malo',
                 'words': [{'s': 0.0, 'e': 1.0, 'w': 'a'}, {'s': 59.0, 'e': 60.0, 'w': 'b'}]}]
    assert revisar_versos(sano) == [], 'un verso normal no puede salir sospechoso'
    assert len(revisar_versos(estirado)) == 1, 'un verso de 60 s tiene que delatarse'

    # el verso partido en dos (una palabra suelta anclada medio minuto antes)
    # se re-ancla al grupo mayoritario y deja de estar roto
    partido = [{'s': 10.0, 'e': 70.0, 'text': 'Well dont you know', 'words': [
        {'s': 10.0, 'e': 10.5, 'w': 'Well'},      # anclada lejos, ella sola
        {'s': 68.0, 'e': 68.5, 'w': 'dont'},      # el grupo de verdad
        {'s': 68.5, 'e': 69.0, 'w': 'you'},
        {'s': 69.0, 'e': 70.0, 'w': 'know'}]}]
    assert sanear_versos(partido) == 1, 'tiene que detectar el verso partido'
    ws = partido[0]['words']
    assert ws[0]['s'] >= 67.0, 'la palabra suelta se mueve junto a las demas'
    assert partido[0]['e'] - partido[0]['s'] < 12.0, 'el verso deja de estar estirado'
    for k in range(1, len(ws)):
        assert ws[k]['s'] >= ws[k - 1]['s'], 'las palabras quedan en orden'
    assert revisar_versos(partido) == [], 'ya no debe salir sospechoso'
    assert sanear_versos(sano) == 0, 'un verso sano no se toca'

    # verso sin ninguna ancla: la interpolacion lo estira por todo el hueco,
    # con palabras contiguas de 15 s cada una (no hay "salto" que detectar)
    estirado2 = [{'s': 100.0, 'e': 160.0, 'text': 'a b c d', 'words': [
        {'s': 100.0, 'e': 115.0, 'w': 'a'}, {'s': 115.0, 'e': 130.0, 'w': 'b'},
        {'s': 130.0, 'e': 145.0, 'w': 'c'}, {'s': 145.0, 'e': 160.0, 'w': 'd'}]}]
    assert sanear_versos(estirado2) == 1, 'tiene que detectar el verso estirado'
    assert estirado2[0]['e'] - estirado2[0]['s'] <= 3.0, 'queda con duracion cantable'
    assert estirado2[0]['s'] == 100.0, 'arranca donde arrancaba'
    assert revisar_versos(estirado2) == [], 'ya no debe salir sospechoso'

    # versos aplastados al final: la letra traia mas repeticiones de las que la
    # cancion canta y los sobrantes cayeron todos en el ultimo instante
    aplastados = [{'s': 272.0, 'e': 272.0, 'text': 'x y z', 'words': [
        {'s': 272.0, 'e': 272.0, 'w': 'x'}, {'s': 272.0, 'e': 272.0, 'w': 'y'},
        {'s': 272.0, 'e': 272.0, 'w': 'z'}]}]
    assert len(revisar_versos(aplastados)) == 1, 'un verso de 0 s tiene que delatarse'

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
