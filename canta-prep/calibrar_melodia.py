# -*- coding: utf-8 -*-
"""Afina los umbrales del detector de melodia sin volver a correr pyin cada vez.

pyin tarda ~90 s por cancion, asi que probar un umbral a la vez es inviable. Esto
lo corre UNA vez por cancion y guarda lo caro (f0, vflag, rms, dominancia) en un
.npz. Despues, evaluar cualquier combinacion de umbrales cuesta milisegundos, y se
puede barrer el espacio completo y ver el intercambio real entre las dos metricas
que se pelean:

  cobertura : % del tiempo cantado que queda con nota      (subir)
  fuera     : % del tiempo de las notas que cae sin letra   (bajar)

    calibrar-melodia.bat --preparar              cachea todas las canciones
    calibrar-melodia.bat --actual                mide los umbrales de hoy
    calibrar-melodia.bat --barrer                explora combinaciones y ordena

Ojo: "fuera" depende de que la letra este completa. Una cancion con un fade-out
sin transcribir la infla sin que el detector tenga la culpa; por eso se informa
por cancion y no solo el promedio.
"""
import argparse
import itertools
import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
PAQUETES = os.path.join(AQUI, '..', 'app', 'canta-media')
CACHE = os.path.join(AQUI, 'cache-melodia')


def preparar(carpeta, destino):
    """Corre la parte cara (pyin + rms + dominancia) y la guarda."""
    import numpy as np
    import librosa
    import prep

    j = json.load(open(os.path.join(carpeta, 'canta.json'), encoding='utf-8'))
    vocals = os.path.join(carpeta, j['files']['vocals'])
    music = os.path.join(carpeta, j['files']['music'])

    y, sr = librosa.load(vocals, sr=prep.SR_MELODIA, mono=True)
    # OJO: esta llamada tiene que ser identica a la de prep.extraer_melodia, o el
    # barrido termina afinando umbrales contra un detector que no es el que corre.
    f0, vflag, _ = librosa.pyin(
        y, fmin=librosa.note_to_hz(prep.NOTA_MIN), fmax=librosa.note_to_hz(prep.NOTA_MAX),
        sr=sr, frame_length=prep.FRAME, hop_length=prep.HOP,
        no_trough_prob=prep.NO_TROUGH_PROB, beta_parameters=prep.BETA_PYIN)
    with np.errstate(invalid='ignore', divide='ignore'):
        midi = librosa.hz_to_midi(f0)
    rms = librosa.feature.rms(y=y, frame_length=prep.FRAME, hop_length=prep.HOP)[0]
    n = min(len(midi), len(rms))
    midi, vflag, rms = midi[:n], vflag[:n], rms[:n]
    dom = prep._dominancia_voz(vocals, music, n)
    if dom is None:
        dom = np.ones(n)

    dtf = prep.HOP / prep.SR_MELODIA
    t = np.arange(n) * dtf
    cantando = np.zeros(n, dtype=bool)
    for l in j.get('lines', []):
        cantando |= (t >= l['s']) & (t <= l['e'])

    np.savez_compressed(destino, midi=midi, vflag=vflag, rms=rms, dom=dom,
                        cantando=cantando, duration=j['duration'])
    return int(n)


def evaluar(datos, rms_rel, rms_abs, dom_min):
    """Aplica unos umbrales al cache y devuelve (cobertura, fuera, notas)."""
    import numpy as np
    import prep

    midi, vflag, rms = datos['midi'], datos['vflag'], datos['rms']
    dom, cantando = datos['dom'], datos['cantando']
    n = len(midi)

    umbral = max(rms_abs, rms_rel * float(np.percentile(rms, 90)))
    valido = vflag & np.isfinite(midi) & (rms >= umbral) & (dom >= dom_min)
    indices = np.where(valido)[0]
    if len(indices) < 10:
        return 0.0, 0.0, 0

    m = np.zeros(n)
    m[indices] = prep._corregir_octavas(midi[indices])
    m_seg = prep._mediana_por_tramo(m, indices, prep.MED_CONTORNO)
    notas = prep._segmentar_notas(m_seg, indices)

    dtf = prep.HOP / prep.SR_MELODIA
    t = np.arange(n) * dtf
    cubierto = np.zeros(n, dtype=bool)
    for nt in notas:
        cubierto |= (t >= nt['s']) & (t <= nt['e'])

    tot_cantado = int(cantando.sum())
    cobertura = 100.0 * (cantando & cubierto).sum() / tot_cantado if tot_cantado else 0.0
    tot_notas = int(cubierto.sum())
    fuera = 100.0 * (cubierto & ~cantando).sum() / tot_notas if tot_notas else 0.0
    return cobertura, fuera, len(notas)


def cargar_caches():
    import numpy as np
    if not os.path.isdir(CACHE):
        sys.exit('No hay cache. Corre primero: calibrar-melodia.bat --preparar')
    out = {}
    for f in sorted(os.listdir(CACHE)):
        if f.endswith('.npz'):
            out[f[:-4]] = dict(np.load(os.path.join(CACHE, f)))
    if not out:
        sys.exit('El cache esta vacio. Corre: calibrar-melodia.bat --preparar')
    return out


def medir_todo(caches, rms_rel, rms_abs, dom_min):
    filas = {}
    for ident, datos in caches.items():
        filas[ident] = evaluar(datos, rms_rel, rms_abs, dom_min)
    return filas


def imprimir(filas, titulo):
    print('\n%s' % titulo)
    print('%-28s %10s %8s %7s' % ('cancion', 'cobertura', 'fuera', 'notas'))
    for ident, (c, f, k) in sorted(filas.items()):
        print('%-28s %9.1f%% %7.1f%% %7d' % (ident[:28], c, f, k))
    cs = [c for c, _, _ in filas.values()]
    fs = [f for _, f, _ in filas.values()]
    print('%-28s %9.1f%% %7.1f%%' % ('PROMEDIO', sum(cs) / len(cs), sum(fs) / len(fs)))


if __name__ == '__main__':
    import prep
    p = argparse.ArgumentParser(description='Afina los umbrales del detector de melodia.')
    p.add_argument('--preparar', action='store_true', help='cachea el analisis caro')
    p.add_argument('--actual', action='store_true', help='mide con los umbrales de hoy')
    p.add_argument('--barrer', action='store_true', help='explora combinaciones')
    args = p.parse_args()

    if args.preparar:
        os.makedirs(CACHE, exist_ok=True)
        for d in sorted(os.listdir(PAQUETES)):
            carpeta = os.path.join(PAQUETES, d)
            if not os.path.exists(os.path.join(carpeta, 'canta.json')):
                continue
            destino = os.path.join(CACHE, d + '.npz')
            if os.path.exists(destino):
                print('ya estaba: %s' % d)
                continue
            print('analizando %s ...' % d, flush=True)
            n = preparar(carpeta, destino)
            print('   %d frames' % n, flush=True)
        print('\nCache listo en %s' % CACHE)

    if args.actual or args.barrer:
        caches = cargar_caches()
        base = (prep.RMS_MIN_REL, prep.RMS_MIN_ABS, prep.DOMINANCIA_MIN)
        actual = medir_todo(caches, *base)
        imprimir(actual, 'UMBRALES DE HOY  (rms_rel=%.3f rms_abs=%.4f dom=%.2f)' % base)

    if args.barrer:
        cs = [c for c, _, _ in actual.values()]
        fs = [f for _, f, _ in actual.values()]
        cob0, fue0 = sum(cs) / len(cs), sum(fs) / len(fs)
        print('\nBARRIDO (cada fila: promedio de las %d canciones)' % len(caches))
        print('%8s %6s %6s %10s %8s %8s' % ('rms_rel', 'dom', '', 'cobertura', 'fuera', 'peor-cob'))
        res = []
        for rr, dm in itertools.product([0.005, 0.01, 0.02, 0.03, 0.05],
                                        [0.0, 0.10, 0.20, 0.30, 0.40]):
            filas = medir_todo(caches, rr, prep.RMS_MIN_ABS, dm)
            cs = [c for c, _, _ in filas.values()]
            fs = [f for _, f, _ in filas.values()]
            res.append((rr, dm, sum(cs) / len(cs), sum(fs) / len(fs), min(cs)))
        # ordenar por lo que de verdad importa: ganar cobertura sin regalar "fuera"
        res.sort(key=lambda r: -(r[2] - cob0) + 1.0 * max(0.0, r[3] - fue0))
        for rr, dm, c, f, peor in res:
            marca = '  <-- hoy' if (abs(rr - prep.RMS_MIN_REL) < 1e-9 and abs(dm - prep.DOMINANCIA_MIN) < 1e-9) else ''
            print('%8.3f %6.2f %6s %9.1f%% %7.1f%% %7.1f%%%s'
                  % (rr, dm, '', c, f, peor, marca))
        print('\nReferencia de hoy: cobertura %.1f%%, fuera %.1f%%' % (cob0, fue0))
        print('"peor-cob" es la cancion peor parada: un promedio bonito con una cancion')
        print('hundida no sirve, porque el corpus va a crecer.')
