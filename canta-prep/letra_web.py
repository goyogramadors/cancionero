# -*- coding: utf-8 -*-
"""Letra de referencia desde LRCLIB, alineada contra lo que oyo Whisper.

LRCLIB (lrclib.net) es una base abierta de letras con API publica, muchas
SINCRONIZADAS por linea. letras.com no sirve: bloquea el acceso automatizado
(HTTP 403) y no corresponde saltarse ese bloqueo.

La letra de referencia aporta el QUE (texto y cortes de linea correctos);
Whisper aporta el CUANDO (tiempos medidos sobre NUESTRO audio). No se le pasa
la letra a Whisper como pista: con condition_on_previous_text=False la pista
solo vale para la primera ventana de 30 s, y pasarla como hotwords le hace
"cantar" la letra en los tramos instrumentales. Alinear es mas seguro, y el
alineador es el mismo de ajustar_letra.py (un solo alineador en el repo).
"""
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

import ajustar_letra

API = 'https://lrclib.net/api/search'
AGENTE = 'canta-prep (cancionero personal; github.com/goyogramadors/cancionero)'
TOL_DURACION = 8.0    # s: la version de LRCLIB debe durar casi lo mismo que nuestro audio
MIN_COBERTURA = 0.25  # misma vara que ajustar_letra: menos = probablemente otra cancion
TOL_APROX = 60.0      # s: si no hay version de la misma duracion, se prueba una parecida...
MIN_COBERTURA_APROX = 0.5  # ...pero exigiendo que Whisper confirme la mitad de la letra

# Lo que los titulos de YouTube agregan y estorba para buscar
RUIDO = re.compile(r'\[[^\]]*\]|\([^)]*\)|\|.*$|\b(letra|lyrics?|video oficial|'
                   r'official video|audio oficial|full hd|hd|4k)\b', re.I)
LRC = re.compile(r'\[(\d+):(\d+(?:\.\d+)?)\]')


def separar_titulo(titulo):
    """'Manu Chao - La Despedida (HQ)' -> ('La Despedida', 'Manu Chao').
    Convencion de YouTube: "Artista - Cancion". Sin guion: (titulo limpio, None)."""
    limpio = re.sub(r'\s+', ' ', RUIDO.sub(' ', titulo)).strip(' -–—')
    partes = [p.strip() for p in re.split(r'\s[-–—]\s', limpio) if p.strip()]
    if len(partes) >= 2:
        return partes[1], partes[0]
    return limpio or titulo, None


def candidatos(titulo):
    """'CANCION - Artista [Full HD] | Letra' -> busquedas a probar, en orden."""
    limpio = re.sub(r'\s+', ' ', RUIDO.sub(' ', titulo)).strip(' -–—')
    partes = [p.strip() for p in re.split(r'\s[-–—]\s', limpio) if p.strip()][:3]
    busq = []
    # cancion/artista en cualquier orden: "Artista - Cancion", "Cancion -
    # Artista" o con una tercera parte ("Pelicula - Cancion - Artista")
    for i in range(len(partes)):
        for j in range(len(partes)):
            if i != j and abs(i - j) == 1:
                busq.append({'track_name': partes[i], 'artist_name': partes[j]})
    for i in range(len(partes)):
        for j in range(len(partes)):
            if abs(i - j) > 1:
                busq.append({'track_name': partes[i], 'artist_name': partes[j]})
    if len(partes) > 1:
        busq += [{'track_name': p} for p in partes]
    busq.append({'q': limpio})
    return busq


def _consultar(params):
    url = API + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': AGENTE})
    # LRCLIB da 503 pasajeros, a veces por varios segundos seguidos: con 3
    # intentos de 3 s se perdio una letra. Espera creciente, ~30 s en total.
    esperas = [2, 4, 8, 16]
    for intento in range(len(esperas) + 1):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code != 503 or intento == len(esperas):
                raise
            time.sleep(esperas[intento])
    return []


def versos_lrc(texto):
    """'[01:23.45] verso' -> versos en el orden en que se cantan. Una linea con
    varias marcas (coro repetido) aparece una vez por marca: asi la letra trae
    TODAS las repeticiones, que es lo que necesita el alineador."""
    out = []
    for linea in texto.splitlines():
        verso = LRC.sub('', linea).strip()
        for m, s in LRC.findall(linea):
            if verso:
                out.append((int(m) * 60 + float(s), verso))
    out.sort(key=lambda x: x[0])
    return [v for _, v in out]


def _ref(x, cob_min):
    if x.get('syncedLyrics'):
        versos, sinc = versos_lrc(x['syncedLyrics']), True
    else:
        versos = [l.strip() for l in x['plainLyrics'].splitlines() if l.strip()]
        sinc = False
    return {'track': x.get('trackName'), 'artist': x.get('artistName'),
            'sincronizada': sinc, 'versos': versos, 'cob_min': cob_min}


def buscar(titulo, duracion, maximo=6):
    """Busca la letra en LRCLIB. Devuelve una lista de candidatas (puede ir
    vacia), la mas probable primero; elegir() decide cual calza de verdad.
    Nunca corta el proceso: sin red o sin resultado, se sigue con Whisper."""
    exactas, aprox, fallos = [], [], 0
    for params in candidatos(titulo):
        try:
            resultados = _consultar(params) or []
        except Exception:
            fallos += 1          # una busqueda caida no cancela las demas
            continue
        for x in resultados:
            if not (x.get('syncedLyrics') or x.get('plainLyrics')):
                continue
            d = abs((x.get('duration') or 0) - duracion)
            if d <= TOL_DURACION:
                # misma grabacion: preferir la sincronizada (trae los coros repetidos)
                exactas.append(((0 if x.get('syncedLyrics') else 1, d), x))
            elif d <= TOL_APROX:
                # otro corte del video (otra intro, otro final): la mas parecida primero
                aprox.append(((d, 0 if x.get('syncedLyrics') else 1), x))
        if exactas:
            break
    if fallos and not (exactas or aprox):
        print('      AVISO: LRCLIB no respondio a %d busqueda(s); sigo solo con Whisper.' % fallos)
    refs, vistas = [], set()
    for lista, cob_min in ((exactas, MIN_COBERTURA), (aprox, MIN_COBERTURA_APROX)):
        for _, x in sorted(lista, key=lambda p: p[0]):
            texto = (x.get('plainLyrics') or x.get('syncedLyrics') or '')[:300]
            if texto in vistas:
                continue          # la misma letra subida varias veces
            vistas.add(texto)
            r = _ref(x, cob_min)
            if r['versos']:
                refs.append(r)
    return refs[:maximo]


def elegir(refs, lines_whisper, duracion):
    """Alinea cada candidata contra lo que oyo Whisper y se queda con la que mas
    calza (y supera su exigencia). Asi se distingue la version latina de la
    espanola, o la letra de otra cancion con el mismo titulo, sin adivinar.
    Devuelve (ref, lines, cobertura) o (None, None, mejor_cobertura_vista)."""
    mejor, tope = None, 0.0
    for ref in refs:
        lines, cob = alinear(ref['versos'], lines_whisper, duracion)
        tope = max(tope, cob)
        if cob >= ref['cob_min'] and (mejor is None or cob > mejor[2]):
            mejor = (ref, lines, cob)
    return mejor or (None, None, tope)


def alinear(versos_ref, lines_whisper, duracion):
    """Monta la letra de referencia sobre los tiempos que oyo Whisper.
    Devuelve (lines en formato canta.json, fraccion de palabras confirmadas)."""
    reconocidas = [(w['s'], w['e'], w['w']) for L in lines_whisper
                   for w in (L.get('words') or []) if (w.get('w') or '').strip()]
    versos = [v.split() for v in versos_ref if v.split()]
    correctas = [p for v in versos for p in v]
    if not reconocidas or not correctas:
        return [], 0.0
    tiempos, exactas = ajustar_letra.asignar_tiempos(reconocidas, correctas)
    if not any(tiempos):
        return [], 0.0
    lines = ajustar_letra.armar_lineas(versos, ajustar_letra.interpolar(tiempos, duracion))
    ajustar_letra.sanear_versos(lines)
    return lines, exactas / float(len(correctas))


def reletrar(carpeta):
    """Le pone la letra de LRCLIB a un paquete YA preparado (si la busqueda fallo
    al prepararlo). Usa las palabras con tiempo de Whisper que el paquete trae,
    asi que no rehace nada pesado. Deja respaldo en canta.json.bak."""
    import os
    import shutil
    ruta = os.path.join(carpeta, 'canta.json')
    with open(ruta, encoding='utf-8') as f:
        datos = json.load(f)
    if datos.get('letra_fuente') == 'lrclib':
        print('Este paquete ya tiene la letra de LRCLIB.')
        return
    consulta = datos['title'] + (' - ' + datos['artist'] if datos.get('artist') else '')
    refs = buscar(consulta, datos.get('duration') or 0)
    if not refs:
        print('LRCLIB no tiene esta cancion (o no respondio). No se toco nada.')
        return
    ref, lines, cob = elegir(refs, datos.get('lines') or [], datos.get('duration') or 0)
    if not ref:
        print('Ninguna de las %d letras de LRCLIB calza (la mejor: %.0f%%). No se toco nada.'
              % (len(refs), cob * 100))
        return
    shutil.copyfile(ruta, ruta + '.bak')
    datos.update({'lines': lines, 'letra_fuente': 'lrclib',
                  'title': ref['track'] or datos['title'],
                  'artist': ref['artist'] or datos.get('artist', '')})
    with open(ruta, 'w', encoding='utf-8') as f:
        json.dump(datos, f, ensure_ascii=False)
    print('Letra de LRCLIB puesta: %d versos, Whisper confirmo el %.0f%% (%s - %s).'
          % (len(lines), cob * 100, datos['title'], datos['artist']))


if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1:          # python letra_web.py <carpeta-del-paquete>
        reletrar(sys.argv[1])
        sys.exit(0)
    # Autoprueba sin red (texto inventado, no letra real).
    c = candidatos('MI CANCION DE PRUEBA - Artista Uno [Full HD] | Letra')
    assert c[0] == {'track_name': 'MI CANCION DE PRUEBA', 'artist_name': 'Artista Uno'}, c
    assert c[-1] == {'q': 'MI CANCION DE PRUEBA - Artista Uno'}, c

    assert separar_titulo('Artista Dos - Mi Cancion (HQ)') == ('Mi Cancion', 'Artista Dos')
    assert separar_titulo('Solo Titulo [Letra]') == ('Solo Titulo', None)

    v = versos_lrc('[00:10.00] uno dos tres\n[00:20.00][00:40.00] coro coro\n[00:30.00] cuatro cinco')
    assert v == ['uno dos tres', 'coro coro', 'cuatro cinco', 'coro coro'], v

    # Whisper confundio "cuatro" y no oyo el primer coro.
    whisper = [{'words': [{'s': 12.0, 'e': 12.3, 'w': 'Uno'}, {'s': 12.4, 'e': 12.7, 'w': 'dos,'},
                          {'s': 12.8, 'e': 13.1, 'w': 'tres'}]},
               {'words': [{'s': 32.0, 'e': 32.3, 'w': 'gato'}, {'s': 32.5, 'e': 32.9, 'w': 'cinco'}]},
               {'words': [{'s': 42.0, 'e': 42.3, 'w': 'coro'}, {'s': 42.5, 'e': 42.8, 'w': 'coro'}]}]
    lines, cob = alinear(v, whisper, 60.0)
    assert [L['text'] for L in lines] == v, lines
    assert lines[0]['s'] == 12.0                     # tiempo real de Whisper
    assert lines[2]['words'][0]['w'] == 'cuatro'     # el texto manda, no lo que oyo Whisper
    assert lines[3]['s'] == 42.0                     # el coro que si se oyo, en su lugar
    assert all(lines[k]['s'] <= lines[k + 1]['s'] for k in range(len(lines) - 1))

    # elegir: de dos versiones candidatas se queda con la que calza con lo oido,
    # aunque venga segunda en la lista
    otra = {'versos': ['siete ocho nueve', 'diez once'], 'cob_min': 0.5}
    buena = {'versos': v, 'cob_min': 0.5}
    elegida, _, cob2 = elegir([otra, buena], whisper, 60.0)
    assert elegida is buena, cob2
    assert elegir([otra], whisper, 60.0)[0] is None
    print('autoprueba OK  (cobertura %.0f%%)' % (cob * 100))
