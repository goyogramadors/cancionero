# -*- coding: utf-8 -*-
"""
prep.py - Prepara "paquetes Canta" para la sub-herramienta Canta del Cancionero.

Toma una cancion (URL de YouTube o archivo local), separa la voz del
instrumental (Demucs), transcribe la letra con tiempos por palabra
(faster-whisper), extrae la melodia de la voz (librosa/pyin) y estima la
tonalidad. Deja el paquete en <out>/<id>/ (vocals.m4a, music.m4a, canta.json)
y actualiza <out>/index.json.

Uso:
  prep.py <url-de-youtube> [opciones]
  prep.py --file cancion.mp4 [opciones]

La salida de consola es ASCII puro a proposito (consolas Windows cp1252).
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
import warnings

# ---- Parametros del analisis de melodia (contrato con la app web) ----
SR_MELODIA = 22050          # sr de trabajo para pyin / chroma
HOP = 256                   # hop de pyin y RMS
FRAME = 2048                # frame_length de pyin y RMS
SUBMUESTREO = 4             # f0.v lleva 1 de cada 4 frames de pyin
DT_F0 = round(HOP * SUBMUESTREO / SR_MELODIA, 5)   # ~0.04644 s
RMS_MIN = 0.006             # frames con RMS menor se descartan
PROB_MIN = 0.5              # prob. de voz minima de pyin
HUECO_CORTE = 0.06          # s sin voz que cortan una nota
SALTO_CORTE = 0.8           # semitonos vs. mediana del segmento en curso
DUR_MIN_NOTA = 0.09         # s: notas mas cortas se descartan
HUECO_FUSION = 0.05         # s: notas iguales mas cercanas que esto se funden

# Perfiles de Krumhansl-Schmuckler para estimar tonalidad
PERFIL_MAYOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
PERFIL_MENOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
NOTAS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

EXT_AUDIO_OK = {'.mp4', '.mp3', '.m4a', '.wav', '.webm', '.mkv', '.ogg', '.opus', '.flac', '.aac'}


def morir(msg):
    print('ERROR: ' + msg, file=sys.stderr)
    sys.exit(1)


class Etapa:
    """Imprime '[n/6] nombre...' al entrar y el tiempo al salir."""
    tiempos = []  # [(nombre, segundos)]

    def __init__(self, num, total, nombre):
        self.num, self.total, self.nombre = num, total, nombre

    def __enter__(self):
        print('[%d/%d] %s...' % (self.num, self.total, self.nombre), flush=True)
        self.t0 = time.time()
        return self

    def __exit__(self, exc_type, exc, tb):
        dt = time.time() - self.t0
        if exc_type is None:
            print('      listo en %.1f s' % dt, flush=True)
            Etapa.tiempos.append((self.nombre, dt))
        return False


def slugificar(texto):
    """minusculas, sin acentos (NFD), no-alfanumerico -> '-', colapsa '-'."""
    t = unicodedata.normalize('NFD', texto)
    t = ''.join(c for c in t if not unicodedata.combining(c))
    t = t.lower()
    t = re.sub(r'[^a-z0-9]+', '-', t)
    t = re.sub(r'-+', '-', t).strip('-')
    return t or 'cancion'


def revisar_ffmpeg():
    if shutil.which('ffmpeg') is None:
        morir('no se encontro ffmpeg en el PATH. Instalalo con:\n'
              '       winget install Gyan.FFmpeg\n'
              '       y abre una consola nueva.')


def correr_ffmpeg(args, descripcion):
    cmd = ['ffmpeg', '-hide_banner', '-y'] + args
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        cola = r.stderr.decode('utf-8', errors='replace').strip().splitlines()[-8:]
        morir('fallo ffmpeg al %s:\n%s' % (descripcion, '\n'.join(cola)))


# ---------------------------------------------------------------- entrada ----

def audio_desde_youtube(url, workdir):
    """Descarga bestaudio y lo deja como wav crudo. Devuelve (wav, meta)."""
    try:
        import yt_dlp
    except ImportError:
        morir('falta yt-dlp. Corre setup.bat para instalar las dependencias.')
    plantilla = os.path.join(workdir, 'origen.%(ext)s')
    opts = {
        'format': 'bestaudio/best',
        'outtmpl': plantilla,
        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'wav'}],
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'noprogress': True,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except yt_dlp.utils.DownloadError as e:
        morir('no se pudo descargar el audio de YouTube.\n'
              '       Revisa la URL y tu conexion. Detalle: %s' % str(e).splitlines()[-1])
    if info is None:
        morir('yt-dlp no devolvio informacion del video.')
    if 'entries' in info:  # por si llega una playlist igual
        info = info['entries'][0]
    wav = os.path.join(workdir, 'origen.wav')
    if not os.path.exists(wav):
        morir('yt-dlp no dejo el wav esperado (revisa que ffmpeg este en el PATH).')
    meta = {
        'title': info.get('track') or info.get('title') or 'Sin titulo',
        'artist': info.get('artist') or info.get('uploader') or '',
    }
    return wav, meta


def audio_desde_archivo(ruta, workdir):
    """Extrae/copia el audio de un archivo local a wav crudo."""
    if not os.path.exists(ruta):
        morir('no existe el archivo: %s' % ruta)
    ext = os.path.splitext(ruta)[1].lower()
    if ext not in EXT_AUDIO_OK:
        print('AVISO: extension %s no reconocida, se intenta leer igual con ffmpeg.' % ext)
    wav = os.path.join(workdir, 'origen.wav')
    correr_ffmpeg(['-i', ruta, '-vn', wav], 'extraer el audio del archivo')
    nombre = os.path.splitext(os.path.basename(ruta))[0]
    meta = {'title': nombre, 'artist': ''}
    return wav, meta


def normalizar_wav(wav_crudo, workdir):
    """Deja el audio como wav 44100 Hz estereo (el formato de trabajo)."""
    wav = os.path.join(workdir, 'audio.wav')
    correr_ffmpeg(['-i', wav_crudo, '-vn', '-ac', '2', '-ar', '44100', wav],
                  'convertir a wav 44100 Hz estereo')
    return wav


def duracion_wav(wav):
    import soundfile as sf
    return float(sf.info(wav).duration)


# ------------------------------------------------------------- separacion ----

def separar_voz(wav, workdir):
    """Corre Demucs (htdemucs, two-stems) y devuelve (vocals.wav, no_vocals.wav)."""
    env = dict(os.environ)
    env['PYTHONIOENCODING'] = 'utf-8'   # las barras de progreso no son cp1252
    # Con torch >= 2.6 algunos checkpoints necesitan esto para cargar:
    env.setdefault('TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD', '1')
    cmd = [sys.executable, '-m', 'demucs', '--two-stems', 'vocals',
           '-n', 'htdemucs', '-o', workdir, wav]
    r = subprocess.run(cmd, env=env)
    if r.returncode != 0:
        morir('fallo la separacion con Demucs (codigo %d). Si es la primera vez,\n'
              '       revisa tu conexion: Demucs descarga su modelo (~80 MB) al primer uso.'
              % r.returncode)
    nombre = os.path.splitext(os.path.basename(wav))[0]
    base = os.path.join(workdir, 'htdemucs', nombre)
    vocals = os.path.join(base, 'vocals.wav')
    music = os.path.join(base, 'no_vocals.wav')
    if not (os.path.exists(vocals) and os.path.exists(music)):
        morir('Demucs termino pero no se encontraron los stems en %s' % base)
    return vocals, music


# ----------------------------------------------------------- transcripcion ----

def transcribir(vocals, modelo, idioma):
    """faster-whisper sobre la voz. Devuelve (lines, lang)."""
    from faster_whisper import WhisperModel
    wm = WhisperModel(modelo, device='cpu', compute_type='int8')
    segmentos, info = wm.transcribe(vocals, word_timestamps=True,
                                    vad_filter=True, language=idioma)
    lines = []
    for seg in segmentos:
        texto = (seg.text or '').strip()
        if not texto:
            continue
        palabras = []
        for w in (seg.words or []):
            pw = (w.word or '').strip()
            if pw:
                palabras.append({'s': round(float(w.start), 3),
                                 'e': round(float(w.end), 3),
                                 'w': pw})
        lines.append({'s': round(float(seg.start), 3),
                      'e': round(float(seg.end), 3),
                      'text': texto,
                      'words': palabras})
    lang = idioma or getattr(info, 'language', None)
    return lines, lang


# ----------------------------------------------------------------- melodia ----

def _tramos_contiguos(indices):
    """Divide un array de indices crecientes en tramos consecutivos."""
    if len(indices) == 0:
        return []
    import numpy as np
    cortes = np.where(np.diff(indices) > 1)[0] + 1
    return np.split(indices, cortes)


def extraer_melodia(vocals):
    """pyin sobre la voz. Devuelve (notes, f0) segun el contrato de canta.json."""
    import numpy as np
    import librosa
    from scipy.ndimage import median_filter

    y, sr = librosa.load(vocals, sr=SR_MELODIA, mono=True)
    if len(y) == 0:
        return [], {'dt': DT_F0, 'v': []}

    f0, vflag, vprob = librosa.pyin(
        y, fmin=librosa.note_to_hz('C2'), fmax=librosa.note_to_hz('C6'),
        sr=sr, frame_length=FRAME, hop_length=HOP)
    with np.errstate(invalid='ignore', divide='ignore'):
        midi = librosa.hz_to_midi(f0)
    rms = librosa.feature.rms(y=y, frame_length=FRAME, hop_length=HOP)[0]

    n = min(len(midi), len(rms))
    midi, vflag, vprob, rms = midi[:n], vflag[:n], vprob[:n], rms[:n]

    # Estabilizacion: solo frames con voz, probables, con energia y f0 finito
    valido = vflag & (vprob >= PROB_MIN) & (rms >= RMS_MIN) & np.isfinite(midi)

    # Filtro de mediana (ancho 5) por tramo voiced contiguo
    mstab = np.zeros(n)
    indices = np.where(valido)[0]
    for tramo in _tramos_contiguos(indices):
        mstab[tramo] = median_filter(midi[tramo], size=5, mode='nearest')

    dtf = HOP / SR_MELODIA

    # Segmentacion en notas
    crudas = []   # {'t_ini','t_fin','vals':[...]}
    cur = None
    for i in indices:
        t = i * dtf
        v = float(mstab[i])
        if cur is not None:
            hueco = t - cur['t_fin']
            if hueco > HUECO_CORTE or abs(v - float(np.median(cur['vals']))) > SALTO_CORTE:
                crudas.append(cur)
                cur = None
        if cur is None:
            cur = {'t_ini': t, 't_fin': t, 'vals': [v]}
        else:
            cur['t_fin'] = t
            cur['vals'].append(v)
    if cur is not None:
        crudas.append(cur)

    # Descarta notas muy cortas
    notas = []
    for c in crudas:
        s, e = c['t_ini'], c['t_fin'] + dtf
        if e - s < DUR_MIN_NOTA:
            continue
        notas.append({'s': s, 'e': e, 'vals': c['vals']})

    # Fusiona notas consecutivas del mismo semitono redondeado con hueco chico
    fundidas = []
    for nt in notas:
        if fundidas:
            prev = fundidas[-1]
            if (int(round(float(np.median(prev['vals'])))) ==
                    int(round(float(np.median(nt['vals']))))
                    and nt['s'] - prev['e'] < HUECO_FUSION):
                prev['e'] = nt['e']
                prev['vals'].extend(nt['vals'])
                continue
        fundidas.append(nt)

    notes = [{'s': round(nt['s'], 3),
              'e': round(nt['e'], 3),
              'm': round(float(np.median(nt['vals'])), 1)} for nt in fundidas]

    # Pista f0 continua submuestreada x4 (0 = sin voz)
    v = []
    for i in range(0, n, SUBMUESTREO):
        v.append(round(float(mstab[i]), 1) if valido[i] else 0)

    return notes, {'dt': DT_F0, 'v': v}


# -------------------------------------------------------------- tonalidad ----

def estimar_tonalidad(no_vocals):
    """Krumhansl-Schmuckler sobre el chroma promedio del instrumental."""
    import numpy as np
    import librosa
    try:
        y, sr = librosa.load(no_vocals, sr=SR_MELODIA, mono=True)
        if len(y) == 0 or float(np.max(np.abs(y))) < 1e-4:
            return None
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        cm = chroma.mean(axis=1)
        if float(np.std(cm)) < 1e-9:
            return None
        mejor_r, mejor_nombre = -2.0, None
        for p in range(12):
            for perfil, sufijo in ((PERFIL_MAYOR, ''), (PERFIL_MENOR, 'm')):
                r = float(np.corrcoef(np.roll(perfil, p), cm)[0, 1])
                if r > mejor_r:
                    mejor_r, mejor_nombre = r, NOTAS[p] + sufijo
        return mejor_nombre
    except Exception as e:
        print('AVISO: no se pudo estimar la tonalidad (%s); queda en null.' % e)
        return None


# ----------------------------------------------------------------- paquete ----

def codificar_m4a(wav, m4a):
    correr_ffmpeg(['-i', wav, '-c:a', 'aac', '-b:a', '160k', m4a],
                  'codificar %s' % os.path.basename(m4a))


def escribir_paquete(out_dir, paquete, vocals_wav, music_wav):
    destino = os.path.join(out_dir, paquete['id'])
    if os.path.isdir(destino):
        shutil.rmtree(destino)
    os.makedirs(destino, exist_ok=True)
    codificar_m4a(vocals_wav, os.path.join(destino, 'vocals.m4a'))
    codificar_m4a(music_wav, os.path.join(destino, 'music.m4a'))
    with open(os.path.join(destino, 'canta.json'), 'w', encoding='utf-8') as f:
        json.dump(paquete, f, ensure_ascii=False)
    return destino


def actualizar_indice(out_dir, entrada):
    ruta = os.path.join(out_dir, 'index.json')
    indice = []
    if os.path.exists(ruta):
        try:
            with open(ruta, 'r', encoding='utf-8') as f:
                indice = json.load(f)
            if not isinstance(indice, list):
                raise ValueError('index.json no es una lista')
        except Exception as e:
            print('AVISO: index.json ilegible (%s); se regenera solo con esta entrada.' % e)
            indice = []
    indice = [x for x in indice if x.get('id') != entrada['id']]
    indice.append(entrada)
    indice.sort(key=lambda x: str(x.get('title', '')).casefold())
    with open(ruta, 'w', encoding='utf-8') as f:
        json.dump(indice, f, ensure_ascii=False, indent=2)


# -------------------------------------------------------------------- main ----

def parsear_args():
    p = argparse.ArgumentParser(
        prog='prep.py',
        description='Prepara un paquete Canta (voz separada + letra + melodia) '
                    'desde YouTube o un archivo local.')
    p.add_argument('url', nargs='?', default=None, help='URL de YouTube')
    p.add_argument('--file', dest='archivo', default=None,
                   help='archivo local (mp4/mp3/m4a/wav/webm; de un mp4 se extrae el audio)')
    p.add_argument('--title', default=None, help='titulo de la cancion')
    p.add_argument('--artist', default=None, help='artista')
    p.add_argument('--model', default='small', choices=['tiny', 'base', 'small', 'medium'],
                   help='modelo de Whisper (default: small)')
    p.add_argument('--language', default=None,
                   help='idioma de la letra, ej. es (default: autodetectar)')
    p.add_argument('--out', default=None,
                   help='carpeta de salida (default: ../app/canta-media junto a este script)')
    p.add_argument('--keep-work', action='store_true',
                   help='no borrar la carpeta temporal de trabajo')
    args = p.parse_args()
    if bool(args.url) == bool(args.archivo):
        p.error('entrega exactamente una entrada: una URL de YouTube o --file <ruta>.')
    return args


def main():
    # Consolas Windows (cp1252): que un titulo exotico no tumbe el print
    for flujo in (sys.stdout, sys.stderr):
        try:
            flujo.reconfigure(errors='replace')
        except Exception:
            pass
    args = parsear_args()
    revisar_ffmpeg()
    warnings.filterwarnings('ignore')  # librosa/numba son ruidosos en consola

    out_dir = args.out or os.path.normpath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'canta-media'))
    os.makedirs(out_dir, exist_ok=True)

    workdir = tempfile.mkdtemp(prefix='canta-prep-')
    t_total = time.time()
    print('== Canta prep ==')
    print('Carpeta de trabajo: %s' % workdir)

    try:
        with Etapa(1, 6, 'Obteniendo audio'):
            if args.url:
                wav_crudo, meta = audio_desde_youtube(args.url, workdir)
            else:
                wav_crudo, meta = audio_desde_archivo(args.archivo, workdir)
            wav = normalizar_wav(wav_crudo, workdir)
            duracion = duracion_wav(wav)
            print('      duracion: %.1f s' % duracion)

        titulo = args.title or meta['title']
        artista = args.artist if args.artist is not None else meta['artist']
        ident = slugificar(titulo)
        print('Cancion: %s%s  (id: %s)' % (titulo, ' - ' + artista if artista else '', ident))

        with Etapa(2, 6, 'Separando voz e instrumental (Demucs, puede tardar varios minutos)'):
            vocals_wav, music_wav = separar_voz(wav, workdir)

        with Etapa(3, 6, 'Transcribiendo letra (Whisper %s)' % args.model):
            lines, lang = transcribir(vocals_wav, args.model, args.language)
            print('      lineas de letra: %d' % len(lines))
            if not lines:
                print('      AVISO: no se detecto letra; el paquete queda sin lines.')

        with Etapa(4, 6, 'Extrayendo melodia de la voz (pyin)'):
            notes, f0 = extraer_melodia(vocals_wav)
            print('      notas detectadas: %d' % len(notes))

        with Etapa(5, 6, 'Estimando tonalidad'):
            tonalidad = estimar_tonalidad(music_wav)
            print('      tonalidad: %s' % (tonalidad or 'desconocida'))

        with Etapa(6, 6, 'Codificando stems y escribiendo paquete'):
            paquete = {
                'version': 1,
                'id': ident,
                'title': titulo,
                'artist': artista,
                'youtube': args.url,
                'duration': round(duracion, 2),
                'key': tonalidad,
                'lang': lang,
                'files': {'vocals': 'vocals.m4a', 'music': 'music.m4a'},
                'lines': lines,
                'notes': notes,
                'f0': f0,
            }
            destino = escribir_paquete(out_dir, paquete, vocals_wav, music_wav)
            actualizar_indice(out_dir, {'id': ident, 'title': titulo,
                                        'artist': artista, 'duration': round(duracion, 2)})

        print('')
        print('Paquete listo: %s' % destino)
        print('Tiempos por etapa:')
        for nombre, dt in Etapa.tiempos:
            print('  %-70s %6.1f s' % (nombre[:70], dt))
        print('  %-70s %6.1f s' % ('TOTAL', time.time() - t_total))
    finally:
        if args.keep_work:
            print('Se conserva la carpeta de trabajo: %s' % workdir)
        else:
            shutil.rmtree(workdir, ignore_errors=True)


if __name__ == '__main__':
    main()
