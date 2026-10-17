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

# Lo que los titulos de YouTube agregan y estorba para buscar
RUIDO = re.compile(r'\[[^\]]*\]|\([^)]*\)|\|.*$|\b(letra|lyrics?|video oficial|'
                   r'official video|audio oficial|full hd|hd|4k)\b', re.I)
LRC = re.compile(r'\[(\d+):(\d+(?:\.\d+)?)\]')


def candidatos(titulo):
    """'CANCION - Artista [Full HD] | Letra' -> busquedas a probar, en orden."""
    limpio = re.sub(r'\s+', ' ', RUIDO.sub(' ', titulo)).strip(' -–—')
    partes = [p.strip() for p in re.split(r'\s[-–—]\s', limpio) if p.strip()]
    busq = []
    if len(partes) >= 2:
        a, b = partes[0], partes[1]
        busq += [{'track_name': a, 'artist_name': b}, {'track_name': b, 'artist_name': a}]
    busq.append({'q': limpio})
    return busq


def _consultar(params):
    url = API + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': AGENTE})
    for intento in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code != 503 or intento == 2:
                raise
            time.sleep(3)   # LRCLIB da 503 pasajeros
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


def buscar(titulo, duracion):
    """Busca la letra en LRCLIB. Devuelve {'track','artist','sincronizada',
    'versos'} o None. Nunca corta el proceso: sin red o sin resultado, se sigue
    solo con Whisper."""
    mejor = None
    try:
        for params in candidatos(titulo):
            for x in _consultar(params) or []:
                d = x.get('duration') or 0
                if abs(d - duracion) > TOL_DURACION:
                    continue
                if not (x.get('syncedLyrics') or x.get('plainLyrics')):
                    continue
                # preferir la sincronizada (trae los coros repetidos) y la de
                # duracion mas parecida (misma version/grabacion)
                clave = (0 if x.get('syncedLyrics') else 1, abs(d - duracion))
                if mejor is None or clave < mejor[0]:
                    mejor = (clave, x)
            if mejor:
                break
    except Exception as e:
        print('      AVISO: no se pudo consultar LRCLIB (%s); sigo solo con Whisper.' % e)
        return None
    if not mejor:
        return None
    x = mejor[1]
    if x.get('syncedLyrics'):
        versos, sinc = versos_lrc(x['syncedLyrics']), True
    else:
        versos = [l.strip() for l in x['plainLyrics'].splitlines() if l.strip()]
        sinc = False
    if not versos:
        return None
    return {'track': x.get('trackName'), 'artist': x.get('artistName'),
            'sincronizada': sinc, 'versos': versos}


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


if __name__ == '__main__':
    # Autoprueba sin red (texto inventado, no letra real).
    c = candidatos('MI CANCION DE PRUEBA - Artista Uno [Full HD] | Letra')
    assert c[0] == {'track_name': 'MI CANCION DE PRUEBA', 'artist_name': 'Artista Uno'}, c
    assert c[-1] == {'q': 'MI CANCION DE PRUEBA - Artista Uno'}, c

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
    print('autoprueba OK  (cobertura %.0f%%)' % (cob * 100))
