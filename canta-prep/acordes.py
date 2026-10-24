# -*- coding: utf-8 -*-
"""
acordes.py - Detecta los acordes de un paquete Canta a partir de la pista de
musica (music.m4a, sin voz) y los guarda en canta.json como "acordes":
[{"s": inicio, "e": fin, "c": "Fm"}, ...] en segundos y en cifrado americano
(sostenidos, como SB.music).

Metodo: chroma CQT de la parte armonica (HPSS), promediada por pulso; se
compara cada pulso contra plantillas de acordes mayores, menores y de septima
de dominante, con un pequeno premio a los acordes de la tonalidad del
paquete; un Viterbi con alta probabilidad de quedarse en el mismo acorde
suaviza la secuencia. Es un punto de partida: lo fino se corrige a mano en
el Cancionero (los acordes de la cancion vinculada mandan sobre estos).

Uso:
  acordes.py <carpeta-del-paquete> [--imprimir]

Salida de consola en ASCII (consolas Windows cp1252).
"""

import argparse
import json
import os
import sys

import numpy as np

NOTAS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
SR = 22050
HOP = 512
QUEDARSE = 0.90           # prob. de que el pulso siguiente siga en el mismo acorde
PREMIO_TONALIDAD = 0.06   # se suma a la similitud de los acordes diatonicos
MIN_SIN_ACORDE = 0.08     # energia del chroma bajo la cual el pulso es "N"
MIN_PULSOS = 2            # tramos mas cortos se funden con el vecino


def plantillas():
    """(nombres, matriz 12xK normalizada). Mayor, menor y 7 de cada raiz."""
    tipos = (('', (0, 4, 7), (1.0, 0.8, 0.9)),
             ('m', (0, 3, 7), (1.0, 0.8, 0.9)),
             ('7', (0, 4, 7, 10), (1.0, 0.7, 0.8, 0.55)))
    nombres, cols = [], []
    for r in range(12):
        for suf, ivs, pesos in tipos:
            v = np.zeros(12)
            for iv, p in zip(ivs, pesos):
                v[(r + iv) % 12] = p
            cols.append(v / np.linalg.norm(v))
            nombres.append(NOTAS[r] + suf)
    return nombres, np.array(cols).T


def diatonicos(key):
    """Acordes de la tonalidad (y la dominante mayor en menor)."""
    if not key:
        return set()
    menor = key.endswith('m')
    raiz = key[:-1] if menor else key
    raiz = {'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#'}.get(raiz, raiz)
    if raiz not in NOTAS:
        return set()
    t = NOTAS.index(raiz)
    if menor:   # i iv v(V) bIII bVI bVII
        grados = ((0, 'm'), (5, 'm'), (7, 'm'), (7, ''), (7, '7'), (3, ''), (8, ''), (10, ''), (10, '7'), (0, '7'))
    else:       # I ii iii IV V vi
        grados = ((0, ''), (2, 'm'), (4, 'm'), (5, ''), (7, ''), (7, '7'), (9, 'm'), (2, '7'), (4, '7'), (0, '7'))
    return {NOTAS[(t + g) % 12] + s for g, s in grados}


def cargar(ruta):
    """Audio mono a SR. El m4a (AAC) se decodifica con ffmpeg: soundfile no lo lee."""
    import subprocess
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', ruta, '-ac', '1', '-ar', str(SR),
                          '-f', 'f32le', '-'], check=True, stdout=subprocess.PIPE).stdout
    return np.frombuffer(pcm, dtype=np.float32).copy(), SR


def detectar(music, key=None):
    import librosa
    y, sr = cargar(music)
    dur = len(y) / float(sr)
    yh = librosa.effects.harmonic(y, margin=3.0)
    chroma = librosa.feature.chroma_cqt(y=yh, sr=sr, hop_length=HOP, bins_per_octave=36)
    _, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=HOP, trim=False)
    beats = librosa.util.fix_frames(beats, x_min=0, x_max=chroma.shape[1])
    cs = librosa.util.sync(chroma, beats, aggregate=np.median)
    t = librosa.frames_to_time(beats, sr=sr, hop_length=HOP)
    t = np.append(t, dur) if t[-1] < dur else t
    n = cs.shape[1]
    energia = cs.sum(axis=0)
    energia = energia / (energia.max() or 1.0)

    nombres, T = plantillas()
    norma = np.linalg.norm(cs, axis=0)
    norma[norma == 0] = 1.0
    sim = (T.T @ (cs / norma))                    # K x n, coseno
    dia = diatonicos(key)
    premio = np.array([PREMIO_TONALIDAD if nm in dia else 0.0 for nm in nombres])
    sim = sim + premio[:, None]
    # estado extra "N" (sin acorde): gana cuando casi no hay senal
    simN = np.where(energia < MIN_SIN_ACORDE, 1.0, 0.0)
    obs = np.vstack([sim, simN[None, :]])
    obs = np.exp(obs * 12.0)
    obs /= obs.sum(axis=0, keepdims=True)
    K = obs.shape[0]
    trans = np.full((K, K), (1 - QUEDARSE) / (K - 1))
    np.fill_diagonal(trans, QUEDARSE)
    camino = librosa.sequence.viterbi(obs, trans)
    etiquetas = [nombres[k] if k < len(nombres) else 'N' for k in camino]

    # tramos
    tramos = []
    for i, c in enumerate(etiquetas):
        if tramos and tramos[-1][2] == c:
            tramos[-1][1] = i + 1
        else:
            tramos.append([i, i + 1, c])
    # fundir tramos muy cortos con el vecino mas largo
    cambio = True
    while cambio and len(tramos) > 1:
        cambio = False
        for j, (a, b, c) in enumerate(tramos):
            if b - a >= MIN_PULSOS:
                continue
            izq = tramos[j - 1] if j > 0 else None
            der = tramos[j + 1] if j + 1 < len(tramos) else None
            vec = izq if (der is None or (izq and izq[1] - izq[0] >= der[1] - der[0])) else der
            if vec is izq:
                izq[1] = b
            else:
                der[0] = a
            del tramos[j]
            cambio = True
            break
        # volver a unir vecinos iguales
        k = 1
        while k < len(tramos):
            if tramos[k][2] == tramos[k - 1][2]:
                tramos[k - 1][1] = tramos[k][1]
                del tramos[k]
            else:
                k += 1
    salida = []
    for a, b, c in tramos:
        if c == 'N':
            continue
        salida.append({'s': round(float(t[a]), 3), 'e': round(float(t[min(b, len(t) - 1)]), 3), 'c': c})
    return salida


def main():
    ap = argparse.ArgumentParser(description='Detecta acordes de un paquete Canta.')
    ap.add_argument('paquete', help='carpeta con canta.json y music.m4a')
    ap.add_argument('--imprimir', action='store_true', help='muestra los acordes sin guardar')
    a = ap.parse_args()
    ruta = os.path.join(a.paquete, 'canta.json')
    with open(ruta, 'r', encoding='utf-8') as f:
        pkg = json.load(f)
    music = os.path.join(a.paquete, (pkg.get('files') or {}).get('music', 'music.m4a'))
    acordes = detectar(music, pkg.get('key'))
    if a.imprimir:
        for x in acordes:
            print('%7.2f %7.2f  %s' % (x['s'], x['e'], x['c']))
    print('%d acordes, %d distintos' % (len(acordes), len({x['c'] for x in acordes})))
    if not a.imprimir:
        pkg['acordes'] = acordes
        pkg['acordes_fuente'] = 'auto'
        with open(ruta, 'w', encoding='utf-8') as f:
            json.dump(pkg, f, ensure_ascii=False)
        print('guardado en', ruta)


if __name__ == '__main__':
    sys.exit(main())
