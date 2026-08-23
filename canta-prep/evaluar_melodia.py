# -*- coding: utf-8 -*-
"""Mide la calidad de la melodia extraida, para poder mejorarla sin ir a ciegas.

El extractor no tiene una "respuesta correcta" contra la cual compararse, pero
si tiene senales que delatan cuando se equivoca. Esto las cuenta sobre los
paquetes ya preparados y deja un numero con el que comparar dos versiones del
detector.

    evaluar-melodia.bat                      todos los paquetes
    evaluar-melodia.bat --contra <carpeta>   compara con una tanda anterior
    evaluar-melodia.bat --guardar <carpeta>  copia los canta.json como referencia

Que se mide (por cancion):

  en-canto   % del tiempo con letra que tiene una nota. Lo que le falta es
             melodia que el detector no vio: el carril se queda vacio mientras
             el cantante canta. Sube = mejor.
  8vas/min   saltos de +-una octava entre notas seguidas. Es el error clasico
             de pyin en voces graves y el que mas se nota: la linea se va de
             golpe a otro registro. Baja = mejor.
  fuera      % del tiempo de las notas que cae donde NO hay letra. Suele ser
             el detector siguiendo un instrumento que Demucs dejo en la pista
             de voz. Baja = mejor.
  cortas     % de notas de menos de 0.12 s. Muchas = contorno picado en
             pedazos en vez de notas sostenidas. Baja = mejor.
  saltos     mediana del salto entre notas seguidas, en semitonos. Una melodia
             cantada se mueve por grados; una cifra alta delata inestabilidad.
"""
import argparse
import json
import os
import shutil
import statistics as st
import sys

CARPETA_PAQUETES = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                '..', 'app', 'canta-media')


def metricas(j):
    ns = j.get('notes') or []
    dur = j.get('duration') or 0
    lines = j.get('lines') or []
    if not ns or not dur:
        return None

    cantado = sum(max(0.0, l['e'] - l['s']) for l in lines)
    con_nota = 0.0
    en_letra = 0.0
    for n in ns:
        for l in lines:
            a, b = max(l['s'], n['s']), min(l['e'], n['e'])
            if b > a:
                con_nota += b - a
                en_letra += b - a
    total_notas = sum(n['e'] - n['s'] for n in ns)

    seguidas = [(a, b) for a, b in zip(ns, ns[1:]) if b['s'] - a['e'] < 0.25]
    octavas = sum(1 for a, b in seguidas if 10.5 < abs(b['m'] - a['m']) < 13.5)
    saltos = [abs(b['m'] - a['m']) for a, b in seguidas]
    durs = [n['e'] - n['s'] for n in ns]

    # Un vocalizo o un ejercicio no tiene letra: las dos metricas que se apoyan
    # en los versos no aplican, y meterlas en el promedio como cero lo falsea.
    # Las otras (saltos de octava, notas cortas) siguen siendo validas y de hecho
    # un ejercicio de nota larga es material limpio para juzgar al detector.
    return {
        'notas': len(ns),
        'en_canto': (100.0 * con_nota / cantado) if cantado else None,
        'oct_min': octavas / (dur / 60.0),
        'fuera': (100.0 * (1 - en_letra / total_notas)) if (total_notas and cantado) else None,
        'cortas': 100.0 * sum(1 for x in durs if x < 0.12) / len(durs),
        'salto_med': st.median(saltos) if saltos else 0.0,
    }


def leer(carpeta):
    """Devuelve {id: metricas} para una carpeta de paquetes o de copias."""
    out = {}
    if not os.path.isdir(carpeta):
        sys.exit('ERROR: no existe la carpeta %s' % carpeta)
    for nombre in sorted(os.listdir(carpeta)):
        ruta = os.path.join(carpeta, nombre)
        if os.path.isdir(ruta):
            ruta, ident = os.path.join(ruta, 'canta.json'), nombre
        elif nombre.endswith('.json') and nombre != 'index.json':
            ident = nombre[:-5]
        else:
            continue
        if not os.path.exists(ruta):
            continue
        try:
            with open(ruta, encoding='utf-8') as fh:
                m = metricas(json.load(fh))
        except Exception:
            continue
        if m:
            out[ident] = m
    return out


COLS = [('notas', 'notas', '%5d', 0), ('en_canto', 'en-canto', '%7.0f%%', +1),
        ('oct_min', '8vas/min', '%8.1f', -1), ('fuera', 'fuera', '%6.0f%%', -1),
        ('cortas', 'cortas', '%6.0f%%', -1), ('salto_med', 'saltos', '%6.1f', -1)]


def imprimir(actual, previo=None):
    print('%-26s' % 'cancion' + ''.join('%9s' % c[1] for c in COLS))
    print('-' * (26 + 9 * len(COLS)))
    for ident in sorted(actual):
        m = actual[ident]
        fila = '%-26s' % ident[:26]
        for clave, _, fmt, signo in COLS:
            if m[clave] is None:
                fila += '%9s' % '  -'      # sin letra: la metrica no aplica
                continue
            celda = fmt % m[clave]
            if previo and ident in previo and previo[ident][clave] is not None:
                d = m[clave] - previo[ident][clave]
                if signo and abs(d) > 0.05:
                    celda += '+' if d * signo > 0 else '-'
                else:
                    celda += ' '
            fila += '%9s' % celda
        print(fila)

    if len(actual) > 1:
        print('-' * (26 + 9 * len(COLS)))
        prom = '%-26s' % 'PROMEDIO'
        for clave, _, fmt, signo in COLS:
            vals = [m[clave] for m in actual.values() if m[clave] is not None]
            if not vals:
                prom += '%9s' % '  -'
                continue
            v = st.mean(vals)
            celda = fmt % v
            if previo:
                # solo las canciones comparables en AMBAS tandas
                comunes = [i for i in actual if i in previo
                           and actual[i][clave] is not None and previo[i][clave] is not None]
                if comunes:
                    d = v - st.mean(previo[i][clave] for i in comunes)
                    if signo and abs(d) > 0.05:
                        celda += '+' if d * signo > 0 else '-'
            prom += '%9s' % celda
        print(prom)
        sin_letra = [i for i, m in actual.items() if m['en_canto'] is None]
        if sin_letra:
            print('\n(- = no aplica: %s no tiene letra, asi que no hay con que medir'
                  % ', '.join(sin_letra))
            print(' cobertura ni notas fuera de los versos; queda fuera del promedio)')
    if previo:
        print('\n(+ mejor que la referencia, - peor)')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description='Mide la calidad de la melodia extraida.')
    p.add_argument('--paquetes', default=CARPETA_PAQUETES, help='carpeta de paquetes')
    p.add_argument('--contra', help='carpeta de referencia para comparar')
    p.add_argument('--guardar', help='copia los canta.json actuales como referencia')
    args = p.parse_args()

    actual = leer(args.paquetes)
    if not actual:
        sys.exit('No encontre paquetes con notas en %s' % args.paquetes)

    if args.guardar:
        os.makedirs(args.guardar, exist_ok=True)
        for ident in actual:
            origen = os.path.join(args.paquetes, ident, 'canta.json')
            if os.path.exists(origen):
                shutil.copyfile(origen, os.path.join(args.guardar, ident + '.json'))
        print('Referencia guardada en %s (%d canciones)\n' % (args.guardar, len(actual)))

    imprimir(actual, leer(args.contra) if args.contra else None)
