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
  prep.py --remelodia <carpeta-del-paquete>   (recalcula solo notes/f0)

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
# Todos calibrados midiendo cobertura sobre voz real (bolero, voz masculina con
# vibrato y portamento) y sobre un canto sintetico de control. Ver README.
SR_MELODIA = 22050          # sr de trabajo para pyin / chroma
HOP = 256                   # hop de pyin y RMS: 11.6 ms de resolucion temporal
FRAME = 4096                # ventana de pyin (186 ms): con 2048 pyin declaraba
                            # "sin voz" 1 de cada 3 frames cantados; al doblarla
                            # entran ~7 periodos de una voz grave y la deteccion
                            # de voz sube de 62% a 82% del tiempo cantado
SUBMUESTREO = 4             # f0.v lleva 1 de cada 4 frames de pyin
DT_F0 = round(HOP * SUBMUESTREO / SR_MELODIA, 5)   # ~0.04644 s

NOTA_MIN = 'E2'             # 82 Hz: piso de un baritono/bajo. Mas abajo pyin
NOTA_MAX = 'C6'             # inventa saltos de octava hacia abajo
NO_TROUGH_PROB = 0.30       # pyin, prob. a priori de "no hay tono aqui". El 0.01
                            # por defecto es muy pesimista con voz procesada
                            # (comprimida y con reverb); 0.30 recupera ~7 puntos

# Nota: NO se usa la "voiced_probability" de pyin como umbral. En voz real su
# mediana es ~0.11 y el viejo PROB_MIN=0.5 descartaba el 80% de los frames
# cantados. La decision de voz la toma voiced_flag (Viterbi) + energia.
RMS_MIN_ABS = 0.004         # piso absoluto de energia (silencio digital)
RMS_MIN_REL = 0.03          # ...y 3% del percentil 90 del track, para adaptarse
                            # a mezclas mas o menos calientes
DOMINANCIA_MIN = 0.30       # voz/(voz+musica) minima. En los solos instrumentales
                            # Demucs filtra el instrumento lider a la pista de voz
                            # (ratio 0.06-0.27) mientras que cantando es ~0.43;
                            # este filtro baja los falsos positivos ~40%
DOM_VENTANA = 0.5           # s: se promedia y se dilata la dominancia para que un
                            # bajon puntual no parta una frase por la mitad

MED_F0 = 5                  # frames (58 ms) de mediana para la pista f0: limpia
                            # el jitter pero deja vivo el vibrato
MED_CONTORNO = 7            # frames (81 ms) de mediana para segmentar notas
OCT_VENTANA = 87            # frames (~1 s) de referencia para corregir octavas
OCT_MEJORA = 3.0            # semitonos: solo se mueve +-12 si acerca mucho al
                            # contorno local (evita "corregir" saltos reales)

TOL_NOTA = 1.3              # semitonos: mientras el contorno no se aleje mas que
                            # esto de la mediana de la nota, sigue siendo la misma
                            # nota (el vibrato de +-0.7 y el ataque caben dentro)
FRAMES_SALIDA = 9           # frames (105 ms) seguidos fuera de tolerancia para
                            # considerar que hubo cambio de nota y no vibrato:
                            # un vibrato de 5.5 Hz vuelve al centro en ~90 ms
SALTO_NOTA = 1.5            # semitonos: ademas, la mediana del tramo nuevo tiene
                            # que estar a mas de esto del centro anterior
FRAMES_ATAQUE = 4           # frames (46 ms) iniciales que no cuentan para el tono
                            # de la nota: ahi vive el portamento de entrada
HUECO_CORTE = 0.15          # s sin voz que cortan una nota. Con 0.06 cualquier
                            # consonante sorda ("t", "s") partia la silaba en dos
DUR_MIN_NOTA = 0.07         # s: una corchea rapida dura ~0.12 s, pero hay notas
                            # reales de 0.08 s; por debajo de 0.07 es basura
HUECO_FUSION = 0.12         # s: notas casi iguales mas cercanas que esto se funden
TOL_FUSION = 0.6            # semitonos de diferencia maxima para fundirlas

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
        # YouTube exige resolver un desafio JS: sin runtime da HTTP 403.
        # Se ofrecen los tres y yt-dlp usa el primero que encuentre instalado.
        'js_runtimes': {'deno': {}, 'node': {}, 'bun': {}},
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
              '       Revisa la URL y tu conexion. Si dice 403, falta un runtime\n'
              '       JavaScript: instala Node (winget install OpenJS.NodeJS).\n'
              '       Detalle: %s' % str(e).splitlines()[-1])
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

def silencio_wav(modelo, workdir):
    """Un wav mudo del mismo largo: es la 'voz original' de un ejercicio, que no
    existe. Asi la app conserva sus dos pistas y el control de voz queda inerte."""
    salida = os.path.join(workdir, 'silencio.wav')
    correr_ffmpeg(['-i', modelo, '-af', 'volume=0', salida], 'generar pista muda')
    return salida


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
    # Dos ajustes que en canciones cambian el resultado por completo:
    # - condition_on_previous_text=False: con el default (True) el modelo
    #   "recuerda" lo ya transcrito y se salta los coros y las repeticiones
    #   del final, dejando la segunda mitad sin letra ni tiempos.
    # - vad_filter=False: el VAD esta entrenado para habla y descarta la voz
    #   cantada (notas sostenidas, reverb). Medido en Suspicious Minds:
    #   138 palabras con VAD contra 291 sin el, sobre la misma voz separada.
    segmentos, info = wm.transcribe(vocals, word_timestamps=True,
                                    vad_filter=False, language=idioma,
                                    condition_on_previous_text=False)
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


def _mediana_por_tramo(valores, indices, ancho):
    """Mediana movil aplicada por separado a cada tramo continuo de voz."""
    import numpy as np
    from scipy.ndimage import median_filter
    out = np.zeros(len(valores))
    for tramo in _tramos_contiguos(indices):
        w = min(ancho, max(1, len(tramo)))
        out[tramo] = median_filter(valores[tramo], size=w, mode='nearest')
    return out


def _corregir_octavas(m):
    """Pega los saltos de +-12 semitonos al contorno local (error clasico de pyin
    en voces graves ricas en armonicos). m son solo los frames validos, en orden."""
    import numpy as np
    from scipy.ndimage import median_filter
    out = m.copy()
    for _ in range(2):   # dos pasadas: la referencia mejora con la primera
        ref = median_filter(out, size=min(OCT_VENTANA, max(1, len(out))), mode='nearest')
        d = ref - out
        k = np.round(d / 12.0)
        mejora = np.abs(d) - np.abs(d - 12 * k)
        out = np.where((k != 0) & (mejora > OCT_MEJORA), out + 12 * k, out)
    return out


def _pegar_octavas_sueltas(notas):
    """Baja (o sube) una octava las notas que quedaron descolgadas de su frase.

    _corregir_octavas ya limpia la curva, pero trabaja sobre los frames validos
    seguidos, que pueden venir de frases distintas separadas por silencios. A
    nivel de NOTA el contexto es mas honesto: se compara cada nota con la
    mediana de las que la rodean en el tiempo. Si esta a una octava de ese
    contexto y plegarla la acerca de verdad, se pliega. Un salto de octava
    cantado a proposito no se toca, porque arrastra a sus vecinas con el.
    """
    import numpy as np
    if len(notas) < 3:
        return notas
    VENTANA = 3.0        # s de contexto a cada lado
    CERCA_OCTAVA = 2.5   # semitonos de tolerancia alrededor de los 12
    GANANCIA = 4.0       # semitonos que debe acercar para justificar el pliegue
    centros = np.array([n['m'] for n in notas], dtype=float)
    tiempos = np.array([(n['s'] + n['e']) / 2 for n in notas], dtype=float)
    salida = centros.copy()
    for i in range(len(notas)):
        cerca = (np.abs(tiempos - tiempos[i]) <= VENTANA)
        cerca[i] = False
        if cerca.sum() < 2:
            continue
        ref = float(np.median(centros[cerca]))
        d = ref - salida[i]
        k = round(d / 12.0)
        if k == 0 or abs(abs(d) - 12 * abs(k)) > CERCA_OCTAVA:
            continue
        if abs(d) - abs(d - 12 * k) > GANANCIA:
            salida[i] = salida[i] + 12 * k
    for i, n in enumerate(notas):
        if salida[i] != centros[i]:
            n['m'] = float(salida[i])
            n['vals'] = n['vals'] + (salida[i] - centros[i])
    return notas


def _segmentar_notas(contorno, indices):
    """Agrupa frames en notas siguiendo el contorno con histeresis.

    Una nota "se mantiene" mientras el contorno no se aleje de su mediana mas de
    TOL_NOTA. Si se aleja, los frames quedan en espera: si vuelven (vibrato,
    portamento, un golpe de glotis) se absorben en la misma nota; si la excursion
    dura FRAMES_SALIDA frames y ademas su mediana esta a mas de SALTO_NOTA del
    centro, recien ahi se corta y empieza una nota nueva.
    """
    import numpy as np
    dtf = HOP / SR_MELODIA
    segs, cur, espera, prev = [], None, [], None

    def cerrar():
        """Vuelca los frames en espera en la nota en curso y la cierra."""
        if espera:
            cur['vals'].extend(v for _, v in espera)
            cur['i1'] = espera[-1][0]
        segs.append(cur)

    for i in indices:
        v = float(contorno[i])
        if cur is not None and (i - prev) * dtf > HUECO_CORTE:
            cerrar()
            cur, espera = None, []
        prev = i
        if cur is None:
            cur, espera = {'i0': i, 'i1': i, 'vals': [v]}, []
            continue
        centro = float(np.median(cur['vals']))
        if abs(v - centro) <= TOL_NOTA:
            if espera:                       # la excursion volvio: era vibrato
                cur['vals'].extend(x for _, x in espera)
                espera = []
            cur['vals'].append(v)
            cur['i1'] = i
            continue
        espera.append((i, v))
        if len(espera) < FRAMES_SALIDA:
            continue
        if abs(float(np.median([x for _, x in espera])) - centro) > SALTO_NOTA:
            segs.append(cur)                 # la nota anterior cierra donde se fue
            cur = {'i0': espera[0][0], 'i1': espera[-1][0],
                   'vals': [x for _, x in espera]}
        else:
            cur['vals'].extend(x for _, x in espera)
            cur['i1'] = espera[-1][0]
        espera = []
    if cur is not None:
        cerrar()

    # Duracion minima y tono de cada nota (mediana, robusta al vibrato)
    notas = []
    for s in segs:
        ini, fin = s['i0'] * dtf, (s['i1'] + 1) * dtf
        if fin - ini < DUR_MIN_NOTA:
            continue
        vals = np.asarray(s['vals'], dtype=float)
        tono = vals[FRAMES_ATAQUE:] if len(vals) > 3 * FRAMES_ATAQUE else vals
        notas.append({'s': ini, 'e': fin, 'm': float(np.median(tono)), 'vals': vals})

    notas = _pegar_octavas_sueltas(notas)

    # Fusiona notas contiguas practicamente iguales separadas por un hueco corto
    fundidas = []
    for nt in notas:
        if fundidas:
            p = fundidas[-1]
            if abs(p['m'] - nt['m']) <= TOL_FUSION and nt['s'] - p['e'] < HUECO_FUSION:
                p['vals'] = np.concatenate([p['vals'], nt['vals']])
                p['e'] = nt['e']
                p['m'] = float(np.median(p['vals']))
                continue
        fundidas.append(dict(nt))
    return fundidas


def _dominancia_voz(vocals, music, n):
    """Fraccion de la energia local que se llevo la pista de voz, por frame.

    Sirve para no confundir el instrumento lider que Demucs filtra a la pista de
    voz durante los solos con canto de verdad. Si no hay instrumental, devuelve
    None y el filtro no se aplica.
    """
    import numpy as np
    import librosa
    from scipy.ndimage import maximum_filter1d, uniform_filter1d
    if not music or not os.path.exists(music):
        return None
    try:
        yv, sr = librosa.load(vocals, sr=SR_MELODIA, mono=True)
        ym, _ = librosa.load(music, sr=SR_MELODIA, mono=True)
    except Exception as e:
        print('      AVISO: no se pudo medir la dominancia de la voz (%s).' % e)
        return None
    rv = librosa.feature.rms(y=yv, frame_length=FRAME, hop_length=HOP)[0]
    rm = librosa.feature.rms(y=ym, frame_length=FRAME, hop_length=HOP)[0]
    k = min(len(rv), len(rm))
    dom = rv[:k] / (rv[:k] + rm[:k] + 1e-9)
    w = max(1, int(round(DOM_VENTANA * SR_MELODIA / HOP)))
    dom = maximum_filter1d(uniform_filter1d(dom, size=w), size=w)
    out = np.zeros(n)
    out[:min(n, k)] = dom[:min(n, k)]
    return out


def extraer_melodia(vocals, music=None):
    """pyin sobre la voz. Devuelve (notes, f0) segun el contrato de canta.json."""
    import numpy as np
    import librosa

    y, sr = librosa.load(vocals, sr=SR_MELODIA, mono=True)
    if len(y) == 0:
        return [], {'dt': DT_F0, 'v': []}

    f0, vflag, vprob = librosa.pyin(
        y, fmin=librosa.note_to_hz(NOTA_MIN), fmax=librosa.note_to_hz(NOTA_MAX),
        sr=sr, frame_length=FRAME, hop_length=HOP,
        no_trough_prob=NO_TROUGH_PROB)
    with np.errstate(invalid='ignore', divide='ignore'):
        midi = librosa.hz_to_midi(f0)
    rms = librosa.feature.rms(y=y, frame_length=FRAME, hop_length=HOP)[0]

    n = min(len(midi), len(rms))
    midi, vflag, rms = midi[:n], vflag[:n], rms[:n]

    # Hay voz donde pyin encontro tono y la energia supera el piso del track
    umbral = max(RMS_MIN_ABS, RMS_MIN_REL * float(np.percentile(rms, 90)))
    valido = vflag & np.isfinite(midi) & (rms >= umbral)
    dom = _dominancia_voz(vocals, music, n)
    if dom is not None:
        valido &= dom >= DOMINANCIA_MIN

    indices = np.where(valido)[0]
    if len(indices) == 0:
        return [], {'dt': DT_F0, 'v': [0] * len(range(0, n, SUBMUESTREO))}

    m = np.zeros(n)
    m[indices] = _corregir_octavas(midi[indices])

    # Dos suavizados: uno fino para la pista f0 (deja el vibrato a la vista) y
    # uno mas ancho para decidir donde empieza y termina cada nota.
    m_f0 = _mediana_por_tramo(m, indices, MED_F0)
    m_seg = _mediana_por_tramo(m, indices, MED_CONTORNO)

    fundidas = _segmentar_notas(m_seg, indices)
    notes = [{'s': round(nt['s'], 3), 'e': round(nt['e'], 3),
              'm': round(nt['m'], 1)} for nt in fundidas]

    # Pista f0 continua submuestreada x4 (0 = sin voz)
    v = [round(float(m_f0[i]), 1) if valido[i] else 0
         for i in range(0, n, SUBMUESTREO)]

    return notes, {'dt': DT_F0, 'v': v}


# ------------------------------------------------------- metricas de melodia ----

def _union(intervalos):
    out = []
    for s, e in sorted((s, e) for s, e in intervalos if e > s):
        if out and s <= out[-1][1]:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return out


def _interseccion(a, b):
    out, i, j = [], 0, 0
    while i < len(a) and j < len(b):
        s, e = max(a[i][0], b[j][0]), min(a[i][1], b[j][1])
        if e > s:
            out.append([s, e])
        if a[i][1] < b[j][1]:
            i += 1
        else:
            j += 1
    return out


def resumen_melodia(notes, lines, duracion):
    """Imprime cuanto del canto quedo cubierto por notas (la metrica que importa)."""
    suma = lambda iv: sum(e - s for s, e in iv)
    nv = _union([(x['s'], x['e']) for x in notes])
    lv = _union([(l['s'], l['e']) for l in (lines or [])])
    cob, canto = suma(nv), suma(lv)
    dentro = suma(_interseccion(nv, lv))
    durs = sorted(x['e'] - x['s'] for x in notes) if notes else [0.0]
    print('      notas: %d   dur. media %.2f s / mediana %.2f s'
          % (len(notes), sum(durs) / len(durs), durs[len(durs) // 2]))
    print('      cobertura: %.1f s (%.1f%% de la cancion)'
          % (cob, 100 * cob / duracion if duracion else 0))
    if canto > 0:
        print('      dentro del canto: %.1f%% de %.1f s   fuera de la letra: %.1f%%'
              % (100 * dentro / canto, canto, 100 * (cob - dentro) / cob if cob else 0))


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
    # Se vacia el contenido en vez de borrar la carpeta: en Windows no se puede
    # borrar un directorio que algun proceso tenga abierto (el explorador, una
    # consola parada ahi), y perder el trabajo de 10 minutos en el ultimo paso
    # por eso es inaceptable.
    os.makedirs(destino, exist_ok=True)
    for nombre in os.listdir(destino):
        ruta = os.path.join(destino, nombre)
        try:
            shutil.rmtree(ruta) if os.path.isdir(ruta) else os.remove(ruta)
        except OSError as e:
            morir('no se pudo reemplazar "%s".\n'
                  '       Cierra lo que lo tenga abierto y vuelve a intentar.\n'
                  '       Detalle: %s' % (ruta, e))
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
    p.add_argument('--remelodia', dest='remelodia', default=None,
                   help='carpeta de un paquete ya hecho: recalcula solo notes y f0 '
                        '(no descarga, no corre Demucs ni Whisper)')
    p.add_argument('--title', default=None, help='titulo de la cancion')
    p.add_argument('--artist', default=None, help='artista')
    p.add_argument('--sin-letra', action='store_true',
                   help='no transcribir: para vocalizos y ejercicios de afinacion, '
                        'donde Whisper solo inventaria palabras')
    p.add_argument('--ejercicio', action='store_true',
                   help='vocalizo o ejercicio: el audio es el acompanamiento para '
                        'cantar encima. No separa (no hay voz que separar) y saca la '
                        'melodia del audio tal cual. Implica --sin-letra')
    p.add_argument('--model', default='small',
                   choices=['tiny', 'base', 'small', 'medium', 'large-v3-turbo', 'large-v3'],
                   help='modelo de Whisper (default: small; large-v3 es el mejor pero '
                        'el mas lento en CPU, large-v3-turbo casi lo iguala y es ~4x mas rapido)')
    p.add_argument('--language', default=None,
                   help='idioma de la letra, ej. es (default: autodetectar)')
    p.add_argument('--out', default=None,
                   help='carpeta de salida (default: ../app/canta-media junto a este script)')
    p.add_argument('--keep-work', action='store_true',
                   help='no borrar la carpeta temporal de trabajo')
    args = p.parse_args()
    if args.remelodia:
        if args.url or args.archivo:
            p.error('--remelodia trabaja sobre un paquete ya hecho: no lleva URL ni --file.')
    elif bool(args.url) == bool(args.archivo):
        p.error('entrega exactamente una entrada: una URL de YouTube, --file <ruta> '
                'o --remelodia <carpeta>.')
    if args.ejercicio:
        args.sin_letra = True   # un vocalizo no tiene palabras
    return args


def rehacer_melodia(carpeta):
    """Recalcula notes y f0 de un paquete existente y reescribe su canta.json."""
    carpeta = os.path.abspath(carpeta)
    ruta_json = os.path.join(carpeta, 'canta.json')
    if not os.path.exists(ruta_json):
        morir('no hay canta.json en %s' % carpeta)
    try:
        with open(ruta_json, 'r', encoding='utf-8') as f:
            paquete = json.load(f)
    except Exception as e:
        morir('canta.json ilegible en %s: %s' % (carpeta, e))
    if not isinstance(paquete, dict):
        morir('canta.json no tiene la forma esperada (deberia ser un objeto).')

    archivos = paquete.get('files') or {}
    vocals = os.path.join(carpeta, archivos.get('vocals') or 'vocals.m4a')
    music = os.path.join(carpeta, archivos.get('music') or 'music.m4a')
    if not os.path.exists(vocals):
        morir('no se encontro la pista de voz: %s' % vocals)
    if not os.path.exists(music):
        print('AVISO: no hay pista instrumental; se omite el filtro de dominancia.')
        music = None

    t0 = time.time()
    print('== Canta prep: rehacer melodia ==')
    print('Paquete: %s  (%s)' % (paquete.get('title') or paquete.get('id'), carpeta))
    print('[1/2] Extrayendo melodia de la voz (pyin)...', flush=True)
    notes, f0 = extraer_melodia(vocals, music)
    print('      listo en %.1f s' % (time.time() - t0), flush=True)
    resumen_melodia(notes, paquete.get('lines'), paquete.get('duration') or 0)

    print('[2/2] Reescribiendo canta.json (se conserva todo lo demas)...', flush=True)
    paquete['notes'] = notes
    paquete['f0'] = f0
    tmp = ruta_json + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(paquete, f, ensure_ascii=False)
    os.replace(tmp, ruta_json)
    print('')
    print('Listo en %.1f s: %s' % (time.time() - t0, ruta_json))


def main():
    # Consolas Windows (cp1252): que un titulo exotico no tumbe el print
    for flujo in (sys.stdout, sys.stderr):
        try:
            flujo.reconfigure(errors='replace')
        except Exception:
            pass
    args = parsear_args()
    warnings.filterwarnings('ignore')  # librosa/numba son ruidosos en consola

    if args.remelodia:
        rehacer_melodia(args.remelodia)
        return

    revisar_ffmpeg()

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

        if args.ejercicio:
            # Un vocalizo es el piano tocando la secuencia para que TU cantes
            # encima: no hay voz que separar. Demucs mandaria casi todo al
            # instrumental, la pista de voz quedaria con residuos y el detector
            # se quedaria sin melodia (medido: 6% de cobertura). La melodia de
            # referencia se saca del audio tal cual, y sale gratis saltarse
            # Demucs, que es la etapa mas lenta de todas.
            print('[2/6] Separacion omitida (--ejercicio): la melodia sale del audio tal cual.')
            music_wav = wav
            vocals_wav = silencio_wav(wav, workdir)
            melodia_desde = wav
        else:
            with Etapa(2, 6, 'Separando voz e instrumental (Demucs, puede tardar varios minutos)'):
                vocals_wav, music_wav = separar_voz(wav, workdir)
            melodia_desde = vocals_wav

        if args.sin_letra:
            # Un vocalizo o un ejercicio de afinacion no tiene palabras: dejar que
            # Whisper lo intente solo produce letra inventada, ademas de tardar.
            print('[3/6] Transcripcion omitida (--sin-letra).')
            lines, lang = [], args.language
        else:
            with Etapa(3, 6, 'Transcribiendo letra (Whisper %s)' % args.model):
                lines, lang = transcribir(vocals_wav, args.model, args.language)
                print('      lineas de letra: %d' % len(lines))
                if not lines:
                    print('      AVISO: no se detecto letra; el paquete queda sin lines.')

        with Etapa(4, 6, 'Extrayendo melodia de la voz (pyin)'):
            # En un ejercicio no hay separacion, asi que tampoco hay con que
            # medir la dominancia voz/musica: se pasa None y ese filtro se omite.
            notes, f0 = extraer_melodia(melodia_desde,
                                        None if args.ejercicio else music_wav)
            resumen_melodia(notes, lines, duracion)

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
