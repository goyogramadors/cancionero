# -*- coding: utf-8 -*-
"""
motor.py - Motor local del Cancionero.

Levanta un servidor HTTP chico (solo biblioteca estandar) que hace dos cosas
en el mismo puerto, para que no haya CORS ni contenido mixto:

  1. Sirve la app web (`../app`) como estaticos.
  2. Expone una API en `/api/...` para preparar canciones con prep.py y
     publicar el paquete resultante al repo con git.

Uso:
  motor.py [--puerto 8765] [--sin-navegador]

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
import threading
import time
import uuid
import webbrowser
from collections import deque
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# ------------------------------------------------------------------ rutas ----

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..'))          # C:\Songbook
APP_DIR = os.path.join(RAIZ, 'app')
OUT_DIR = os.path.join(APP_DIR, 'canta-media')
PREP_PY = os.path.join(AQUI, 'prep.py')
VENV_PY = os.path.join(AQUI, '.venv', 'Scripts', 'python.exe')

VERSION = 1
MAX_SUBIDA = 500 * 1024 * 1024      # 500 MB de tope para el POST de archivo
MAX_LINEAS = 40                     # ultimas lineas de salida que guardamos
VIDA_TRABAJO = 30 * 60              # s: los trabajos terminados se olvidan
TIMEOUT_GIT = 300                   # s por cada comando de git

# Modelos de Whisper que acepta prep.py
MODELOS = ('tiny', 'base', 'small', 'medium')

# Lineas que sabemos leer de la salida de prep.py
RE_ETAPA = re.compile(r'^\[(\d+)/(\d+)\]\s*(.+?)\s*\.*\s*$')
RE_CANCION = re.compile(r'^Cancion:\s*(.+?)\s*\(id:\s*([^)]+)\)\s*$')
RE_PAQUETE = re.compile(r'^Paquete listo:\s*(.+)$')


# --------------------------------------------------------------- trabajos ----

class Trabajo:
    """Una preparacion en curso (o terminada). Vive en memoria."""

    def __init__(self, job):
        self.job = job
        self.estado = 'corriendo'       # corriendo | listo | error
        self.paso = 0
        self.total = 6
        self.etapa = 'Partiendo'
        self.pct = 0
        self.id = None                  # id de la cancion, cuando se sepa
        self.titulo = None
        self.lineas = deque(maxlen=MAX_LINEAS)
        self.error = None
        self.t0 = time.time()
        self.t_fin = None
        self.proc = None
        self.temporal = None            # carpeta temporal a borrar al terminar
        self.cancelado = False
        self.hubo_paquete = False

    def segundos(self):
        return round((self.t_fin or time.time()) - self.t0, 1)

    def a_json(self):
        return {
            'estado': self.estado,
            'paso': self.paso,
            'total': self.total,
            'etapa': self.etapa,
            'pct': self.pct,
            'id': self.id,
            'titulo': self.titulo,
            'lineas': list(self.lineas),
            'error': self.error,
            'segundos': self.segundos(),
        }


TRABAJOS = {}                # job -> Trabajo
CANDADO = threading.Lock()   # protege TRABAJOS y "un trabajo a la vez"


def trabajo_activo():
    """Devuelve el Trabajo en curso, si hay alguno."""
    for t in TRABAJOS.values():
        if t.estado == 'corriendo':
            return t
    return None


def limpiar_viejos():
    """Olvida los trabajos terminados hace mas de VIDA_TRABAJO."""
    ahora = time.time()
    for job in [k for k, t in TRABAJOS.items()
                if t.estado != 'corriendo' and t.t_fin
                and ahora - t.t_fin > VIDA_TRABAJO]:
        TRABAJOS.pop(job, None)


def python_de_trabajo():
    """El python del venv si existe; si no, el que corre este script."""
    return VENV_PY if os.path.exists(VENV_PY) else sys.executable


def lanzar_trabajo(args_prep, temporal=None):
    """Arranca prep.py con `args_prep` y devuelve el Trabajo creado.

    `temporal` es una carpeta que se borra cuando el proceso termina.
    Asume que el llamador ya tomo CANDADO y verifico que no haya otro trabajo.
    """
    job = uuid.uuid4().hex[:12]
    t = Trabajo(job)
    t.temporal = temporal

    cmd = [python_de_trabajo(), PREP_PY] + args_prep + ['--out', OUT_DIR]

    env = dict(os.environ)
    env['PYTHONIOENCODING'] = 'utf-8'
    env['PYTHONUNBUFFERED'] = '1'

    banderas = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

    try:
        t.proc = subprocess.Popen(
            cmd, cwd=AQUI, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding='utf-8', errors='replace', bufsize=1,
            env=env, creationflags=banderas)
    except Exception as e:
        t.estado = 'error'
        t.error = 'no se pudo lanzar prep.py: %s' % e
        t.t_fin = time.time()
        borrar_temporal(t)
        TRABAJOS[job] = t
        return t

    TRABAJOS[job] = t
    hilo = threading.Thread(target=leer_salida, args=(t,), daemon=True)
    hilo.start()
    return t


def borrar_temporal(t):
    if t.temporal:
        shutil.rmtree(t.temporal, ignore_errors=True)
        t.temporal = None


def leer_salida(t):
    """Hilo lector: interpreta la salida de prep.py linea por linea."""
    try:
        for linea in t.proc.stdout:
            linea = linea.rstrip('\r\n')
            if not linea.strip():
                continue
            t.lineas.append(linea)

            m = RE_ETAPA.match(linea)
            if m:
                t.paso = int(m.group(1))
                t.total = int(m.group(2))
                t.etapa = m.group(3).strip().rstrip('.')
                t.pct = int(round((t.paso - 1) / float(t.total) * 100))
                continue

            m = RE_CANCION.match(linea)
            if m:
                t.titulo = m.group(1).strip()
                t.id = m.group(2).strip()
                continue

            if RE_PAQUETE.match(linea):
                t.hubo_paquete = True
                continue

            if linea.startswith('ERROR:'):
                t.error = linea[len('ERROR:'):].strip()
    except Exception as e:
        t.lineas.append('AVISO: se corto la lectura de la salida (%s)' % e)
    finally:
        try:
            t.proc.stdout.close()
        except Exception:
            pass
        codigo = t.proc.wait()
        t.t_fin = time.time()

        if t.cancelado:
            t.estado = 'error'
            t.error = t.error or 'cancelado por ti'
        elif codigo == 0 and t.hubo_paquete and t.id:
            t.estado = 'listo'
            t.pct = 100
            t.etapa = 'Listo'
        else:
            t.estado = 'error'
            if not t.error:
                cola = [x for x in list(t.lineas)[-8:] if x.strip()]
                t.error = ('prep.py termino con codigo %d.\n%s'
                           % (codigo, '\n'.join(cola)) if cola
                           else 'prep.py termino con codigo %d.' % codigo)
        borrar_temporal(t)


def matar_trabajo(t):
    """Mata el proceso y todo su arbol (Demucs corre como hijo)."""
    t.cancelado = True
    proc = t.proc
    if proc is None or proc.poll() is not None:
        return
    try:
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)],
                       capture_output=True, timeout=20)
    except Exception:
        pass
    if proc.poll() is None:
        try:
            proc.kill()
        except Exception:
            pass


# ------------------------------------------------------------------- git ----

def correr_git(args):
    """Corre un git en la raiz del repo. Devuelve (codigo, salida)."""
    try:
        r = subprocess.run(['git'] + args, cwd=RAIZ, capture_output=True,
                           text=True, encoding='utf-8', errors='replace',
                           timeout=TIMEOUT_GIT)
    except FileNotFoundError:
        return 127, 'no se encontro git en el PATH'
    except subprocess.TimeoutExpired:
        return 124, 'git %s se demoro mas de %d s y se corto' % (args[0], TIMEOUT_GIT)
    salida = (r.stdout or '') + (r.stderr or '')
    return r.returncode, salida.strip()


def _error_de_push(salida):
    """Traduce a espanol lo que dijo el push. Devuelve (tipo, mensaje)."""
    bajo = salida.lower()
    if ('authentication' in bajo or 'could not read username' in bajo
            or 'permission denied' in bajo or '403' in bajo
            or 'invalid username or password' in bajo):
        return 'auth', ('GitHub rechazo el push por autenticacion. Autenticate como '
                        'goyogramadors ("gh auth login" o un token) y corre "git push".')
    if ('non-fast-forward' in bajo or 'fetch first' in bajo
            or 'rejected' in bajo and 'behind' in bajo):
        return 'atrasado', 'el remoto tiene commits nuevos'
    return 'otro', ''


def _rebase_a_medias():
    """True si quedo un rebase colgando en el repo."""
    for carpeta in ('rebase-merge', 'rebase-apply'):
        if os.path.exists(os.path.join(RAIZ, '.git', carpeta)):
            return True
    return False


def publicar(ident, mensaje=None):
    """add -f + commit + push (y pull --rebase solo si hace falta).

    Devuelve un dict con ok/empujado/mensaje/salida (o ok=False + error).
    """
    bitacora = []

    def anotar(titulo, codigo, salida):
        bitacora.append('$ git %s  (codigo %d)\n%s' % (titulo, codigo, salida))

    def fallo(msg):
        return {'ok': False, 'error': msg, 'salida': '\n\n'.join(bitacora)}

    def logrado(empujado, msg):
        return {'ok': True, 'empujado': empujado, 'mensaje': msg,
                'salida': '\n\n'.join(bitacora)}

    if not os.path.isdir(os.path.join(RAIZ, '.git')):
        return fallo('esta carpeta no es un repositorio git: %s' % RAIZ)

    if not os.path.isdir(os.path.join(OUT_DIR, ident)):
        return fallo('no existe el paquete "%s" en %s' % (ident, OUT_DIR))

    rel_paq = 'app/canta-media/%s' % ident
    rel_idx = 'app/canta-media/index.json'

    # -f porque app/canta-media/ esta en .gitignore a proposito (para que un
    # "git add -A" distraido no suba 500 MB). Una vez trackeados, los archivos
    # se siguen versionando normal.
    codigo, salida = correr_git(['add', '-f', '-A', '--', rel_paq, rel_idx])
    anotar('add -f -A', codigo, salida)
    if codigo == 127:
        return fallo('no se encontro git en el PATH. Instala Git para Windows y '
                     'abre una consola nueva.')
    if codigo != 0:
        return fallo('fallo "git add": %s' % (salida or 'sin detalle'))

    # Si no quedo nada preparado, es que ya estaba publicado
    codigo, salida = correr_git(['diff', '--cached', '--name-only'])
    anotar('diff --cached --name-only', codigo, salida)
    hay_que_commitear = bool(salida.strip()) if codigo == 0 else True

    if hay_que_commitear:
        texto = (mensaje or '').strip() or 'canta: agrega %s' % ident
        codigo, salida = correr_git(['commit', '-m', texto])
        anotar('commit', codigo, salida)
        if codigo != 0:
            if 'nothing to commit' in salida or 'nada que confirmar' in salida:
                hay_que_commitear = False
            elif 'Please tell me who you are' in salida or 'user.email' in salida:
                return fallo('git no sabe quien eres. Configura tu identidad:\n'
                             '  git config --global user.name "Tu Nombre"\n'
                             '  git config --global user.email "tu@correo.com"')
            else:
                return fallo('fallo "git commit": %s' % (salida or 'sin detalle'))

    # Push. Ojo: no hacemos pull --rebase a ciegas, porque el arbol de trabajo
    # puede tener cambios sin commitear y el rebase se caeria.
    codigo, salida = correr_git(['push'])
    anotar('push', codigo, salida)
    if codigo == 0:
        if not hay_que_commitear:
            return logrado(True, 'El paquete "%s" ya estaba commiteado; se empujo lo '
                                 'que faltaba a GitHub.' % ident)
        return logrado(True, 'Publicado: "%s" ya esta en GitHub (el sitio se '
                             'actualiza en 1-2 minutos).' % ident)

    tipo, msg = _error_de_push(salida)
    if tipo == 'auth':
        base = ('el commit quedo hecho, pero ' if hay_que_commitear else '')
        return fallo(base + msg + ' Detalle: %s' % (salida or 'sin detalle'))
    if tipo != 'atrasado':
        if 'everything up-to-date' in salida.lower():
            return logrado(False, 'Nada nuevo que publicar: "%s" ya estaba en el '
                                  'repo y en GitHub.' % ident)
        base = ('el commit quedo hecho, pero ' if hay_que_commitear else '')
        return fallo(base + 'fallo "git push": %s' % (salida or 'sin detalle'))

    # El remoto se adelanto: recien ahora vale la pena reintegrar.
    codigo, salida = correr_git(['pull', '--rebase'])
    anotar('pull --rebase', codigo, salida)
    if codigo != 0:
        bajo = salida.lower()
        if _rebase_a_medias():
            cod2, sal2 = correr_git(['rebase', '--abort'])
            anotar('rebase --abort', cod2, sal2)
        if ('unstaged changes' in bajo or 'commit your changes' in bajo
                or 'cannot pull with rebase' in bajo or 'stash' in bajo):
            return fallo('hay cambios sin guardar en el repo; haz commit (o guardalos '
                         'con git stash) y vuelve a intentar. El commit del paquete '
                         'ya quedo hecho, solo falta empujarlo.')
        return fallo('el commit quedo hecho, pero fallo "git pull --rebase": %s\n'
                     'Resuelvelo a mano y despues corre "git push".'
                     % (salida or 'sin detalle'))

    codigo, salida = correr_git(['push'])
    anotar('push (2)', codigo, salida)
    if codigo != 0:
        tipo, msg = _error_de_push(salida)
        if tipo == 'auth':
            return fallo('el commit quedo hecho, pero ' + msg +
                         ' Detalle: %s' % (salida or 'sin detalle'))
        return fallo('el commit quedo hecho, pero fallo "git push": %s'
                     % (salida or 'sin detalle'))

    return logrado(True, 'Publicado: "%s" ya esta en GitHub (el sitio se actualiza '
                         'en 1-2 minutos).' % ident)


# --------------------------------------------------------------- servidor ----

class Manejador(SimpleHTTPRequestHandler):
    """Estaticos de app/ + API en /api/."""

    server_version = 'CantaMotor/%d' % VERSION

    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.webmanifest': 'application/manifest+json',
        '.svg': 'image/svg+xml',
        '.m4a': 'audio/mp4',
        '.mp4': 'video/mp4',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.webm': 'video/webm',
        '.woff2': 'font/woff2',
    })

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=APP_DIR, **kw)

    # -- ruido de consola: solo mostramos errores -------------------------
    def log_message(self, formato, *args):
        pass

    def log_error(self, formato, *args):
        sys.stderr.write('HTTP: ' + (formato % args) + '\n')

    # -- cabeceras --------------------------------------------------------
    def end_headers(self):
        ruta = urlparse(self.path).path
        if ruta.startswith('/api/') or ruta.endswith(('.json', '.js', '.mjs',
                                                      '.webmanifest')):
            self.send_header('Cache-Control', 'no-store')
        elif ruta.endswith(('.m4a', '.mp3', '.mp4', '.wav', '.webm')):
            # que el navegador sepa que puede pedir trozos y saltar en el audio
            self.send_header('Accept-Ranges', 'bytes')
        SimpleHTTPRequestHandler.end_headers(self)

    def cabeceras_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Private-Network', 'true')

    def responder_json(self, datos, codigo=200):
        cuerpo = json.dumps(datos, ensure_ascii=False).encode('utf-8')
        self.send_response(codigo)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(cuerpo)))
        self.cabeceras_cors()
        self.end_headers()
        try:
            self.wfile.write(cuerpo)
        except (BrokenPipeError, ConnectionAbortedError):
            pass

    def error_json(self, mensaje, codigo=400):
        self.responder_json({'ok': False, 'error': mensaje}, codigo)

    def consulta(self):
        return parse_qs(urlparse(self.path).query)

    def un_valor(self, q, clave, defecto=None):
        v = q.get(clave, [None])[0]
        if v is None:
            return defecto
        v = v.strip()
        return v if v else defecto

    def cuerpo_json(self):
        """Lee el cuerpo como JSON. Devuelve dict o None si viene mal."""
        largo = int(self.headers.get('Content-Length') or 0)
        if largo <= 0:
            return {}
        if largo > 4 * 1024 * 1024:
            return None
        try:
            crudo = self.rfile.read(largo).decode('utf-8', errors='replace')
            datos = json.loads(crudo) if crudo.strip() else {}
        except Exception:
            return None
        return datos if isinstance(datos, dict) else None

    def descartar_cuerpo(self):
        """Vacia el cuerpo pendiente para no dejar la conexion trabada."""
        largo = int(self.headers.get('Content-Length') or 0)
        restante = largo
        while restante > 0:
            trozo = self.rfile.read(min(1 << 20, restante))
            if not trozo:
                break
            restante -= len(trozo)

    # -- verbos -----------------------------------------------------------
    def do_OPTIONS(self):
        self.send_response(204)
        self.cabeceras_cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        ruta = urlparse(self.path).path
        if ruta.startswith('/api/'):
            return self.api_get(ruta)
        if self.headers.get('Range') and self.servir_rango():
            return
        return SimpleHTTPRequestHandler.do_GET(self)

    def do_HEAD(self):
        ruta = urlparse(self.path).path
        if ruta.startswith('/api/'):
            return self.responder_json({'ok': True})
        return SimpleHTTPRequestHandler.do_HEAD(self)

    def do_POST(self):
        ruta = urlparse(self.path).path
        if not ruta.startswith('/api/'):
            self.descartar_cuerpo()
            return self.error_json('no existe %s' % ruta, 404)
        return self.api_post(ruta)

    # -- rangos (para que el audio se pueda buscar/saltar) ----------------
    def servir_rango(self):
        """Atiende un Range simple. True si respondio, False para el camino normal."""
        cabecera = self.headers.get('Range', '')
        m = re.match(r'^bytes=(\d*)-(\d*)$', cabecera.strip())
        if not m:
            return False
        ruta = self.translate_path(self.path)
        if not os.path.isfile(ruta):
            return False
        tamano = os.path.getsize(ruta)
        ini, fin = m.group(1), m.group(2)
        if ini == '' and fin == '':
            return False
        if ini == '':                       # sufijo: ultimos N bytes
            largo = min(int(fin), tamano)
            ini = tamano - largo
            fin = tamano - 1
        else:
            ini = int(ini)
            fin = int(fin) if fin else tamano - 1
        fin = min(fin, tamano - 1)
        if ini > fin or ini >= tamano:
            self.send_response(416)
            self.send_header('Content-Range', 'bytes */%d' % tamano)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return True
        largo = fin - ini + 1
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(ruta))
        self.send_header('Content-Length', str(largo))
        self.send_header('Content-Range', 'bytes %d-%d/%d' % (ini, fin, tamano))
        self.end_headers()   # end_headers agrega Accept-Ranges para los medios
        try:
            with open(ruta, 'rb') as f:
                f.seek(ini)
                restante = largo
                while restante > 0:
                    trozo = f.read(min(1 << 18, restante))
                    if not trozo:
                        break
                    self.wfile.write(trozo)
                    restante -= len(trozo)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass
        return True

    # ------------------------------------------------------------ API GET --
    def api_get(self, ruta):
        with CANDADO:
            limpiar_viejos()

        if ruta == '/api/estado':
            with CANDADO:
                activo = trabajo_activo()
            return self.responder_json({
                'ok': True,
                'motor': 'canta-motor',
                'version': VERSION,
                'ffmpeg': shutil.which('ffmpeg') is not None,
                'venv': os.path.exists(VENV_PY),
                'out': OUT_DIR,
                'ocupado': activo is not None,
                # para que la pagina retome el hilo si la recargan a mitad de camino
                'job_actual': activo.job if activo is not None else None,
                'repo_git': os.path.isdir(os.path.join(RAIZ, '.git')),
            })

        if ruta == '/api/progreso':
            job = self.un_valor(self.consulta(), 'job')
            if not job:
                return self.error_json('falta el parametro "job".', 400)
            with CANDADO:
                t = TRABAJOS.get(job)
            if t is None:
                return self.error_json('no existe ese trabajo (o ya se olvido).', 404)
            return self.responder_json(t.a_json())

        return self.error_json('no existe %s' % ruta, 404)

    # ----------------------------------------------------------- API POST --
    def api_post(self, ruta):
        if ruta == '/api/preparar':
            return self.api_preparar()
        if ruta == '/api/preparar-archivo':
            return self.api_preparar_archivo()
        if ruta == '/api/cancelar':
            return self.api_cancelar()
        if ruta == '/api/publicar':
            return self.api_publicar()
        self.descartar_cuerpo()
        return self.error_json('no existe %s' % ruta, 404)

    def opciones_prep(self, fuente):
        """Traduce title/artist/model/language a argumentos de prep.py."""
        args = []
        titulo = (fuente.get('title') or '').strip() if fuente.get('title') else ''
        artista = (fuente.get('artist') or '').strip() if fuente.get('artist') else ''
        modelo = (fuente.get('model') or '').strip() if fuente.get('model') else ''
        idioma = (fuente.get('language') or '').strip() if fuente.get('language') else ''
        if titulo:
            args += ['--title', titulo]
        if artista:
            args += ['--artist', artista]
        if modelo:
            if modelo not in MODELOS:
                return None, 'modelo desconocido "%s" (usa: %s).' % (
                    modelo, ', '.join(MODELOS))
            args += ['--model', modelo]
        if idioma:
            args += ['--language', idioma]
        return args, None

    def api_preparar(self):
        datos = self.cuerpo_json()
        if datos is None:
            return self.error_json('el cuerpo no es un JSON valido.', 400)
        url = (datos.get('url') or '').strip()
        if not re.match(r'^https?://\S+$', url):
            return self.error_json(
                'la URL no parece valida; tiene que empezar con http:// o https://.', 400)
        extras, problema = self.opciones_prep(datos)
        if problema:
            return self.error_json(problema, 400)

        with CANDADO:
            limpiar_viejos()
            if trabajo_activo() is not None:
                return self.error_json('Ya hay una cancion en preparacion', 409)
            os.makedirs(OUT_DIR, exist_ok=True)
            t = lanzar_trabajo([url] + extras)
        if t.estado == 'error':
            return self.error_json(t.error, 500)
        return self.responder_json({'job': t.job}, 202)

    def api_preparar_archivo(self):
        q = self.consulta()
        nombre = self.un_valor(q, 'nombre')
        if not nombre:
            self.descartar_cuerpo()
            return self.error_json('falta el parametro "nombre" con el nombre del '
                                   'archivo.', 400)
        largo = int(self.headers.get('Content-Length') or 0)
        if largo <= 0:
            return self.error_json('el cuerpo viene vacio: manda los bytes del '
                                   'archivo tal cual.', 400)
        if largo > MAX_SUBIDA:
            self.descartar_cuerpo()
            return self.error_json('el archivo pesa mas de 500 MB.', 413)

        fuente = {k: self.un_valor(q, k) for k in ('title', 'artist', 'model', 'language')}
        extras, problema = self.opciones_prep(fuente)
        if problema:
            self.descartar_cuerpo()
            return self.error_json(problema, 400)

        # Extension segura sacada del nombre original (ffmpeg igual detecta el formato)
        base = os.path.basename(nombre.replace('\\', '/'))
        ext = os.path.splitext(base)[1].lower()
        if not re.match(r'^\.[a-z0-9]{1,6}$', ext):
            ext = '.bin'

        with CANDADO:
            limpiar_viejos()
            if trabajo_activo() is not None:
                self.descartar_cuerpo()
                return self.error_json('Ya hay una cancion en preparacion', 409)

        temporal = tempfile.mkdtemp(prefix='canta-motor-')
        destino = os.path.join(temporal, 'entrada' + ext)
        try:
            restante = largo
            with open(destino, 'wb') as f:
                while restante > 0:
                    trozo = self.rfile.read(min(1 << 20, restante))
                    if not trozo:
                        break
                    f.write(trozo)
                    restante -= len(trozo)
            if restante > 0:
                raise IOError('la subida se corto antes de tiempo')
        except Exception as e:
            shutil.rmtree(temporal, ignore_errors=True)
            return self.error_json('no se pudo recibir el archivo: %s' % e, 400)

        # Si el usuario no puso titulo, usamos el nombre original del archivo
        if '--title' not in extras:
            extras = ['--title', os.path.splitext(base)[0] or 'Cancion'] + extras

        with CANDADO:
            if trabajo_activo() is not None:
                shutil.rmtree(temporal, ignore_errors=True)
                return self.error_json('Ya hay una cancion en preparacion', 409)
            os.makedirs(OUT_DIR, exist_ok=True)
            t = lanzar_trabajo(['--file', destino] + extras, temporal=temporal)
        if t.estado == 'error':
            return self.error_json(t.error, 500)
        return self.responder_json({'job': t.job}, 202)

    def api_cancelar(self):
        self.descartar_cuerpo()
        job = self.un_valor(self.consulta(), 'job')
        if not job:
            return self.error_json('falta el parametro "job".', 400)
        with CANDADO:
            t = TRABAJOS.get(job)
        if t is None:
            return self.error_json('no existe ese trabajo (o ya se olvido).', 404)
        if t.estado == 'corriendo':
            matar_trabajo(t)
        return self.responder_json({'ok': True})

    def api_publicar(self):
        datos = self.cuerpo_json()
        if datos is None:
            return self.error_json('el cuerpo no es un JSON valido.', 400)
        ident = (datos.get('id') or '').strip()
        if not ident or not re.match(r'^[A-Za-z0-9][A-Za-z0-9._-]*$', ident):
            return self.error_json('falta un "id" de cancion valido.', 400)
        mensaje = (datos.get('mensaje') or '').strip() or None
        # git es lento: lo corremos aqui mismo (ThreadingHTTPServer atiende el resto)
        return self.responder_json(publicar(ident, mensaje))


# ------------------------------------------------------------------ main ----

def abrir_puerto(preferido):
    """Prueba el puerto pedido y los 10 siguientes. Devuelve (servidor, puerto)."""
    ultimo = None
    for puerto in range(preferido, preferido + 11):
        try:
            servidor = ThreadingHTTPServer(('127.0.0.1', puerto), Manejador)
            servidor.daemon_threads = True
            return servidor, puerto
        except OSError as e:
            ultimo = e
            continue
    print('ERROR: no hay puertos libres entre %d y %d (%s).'
          % (preferido, preferido + 10, ultimo))
    sys.exit(1)


def avisos_de_entorno():
    if shutil.which('ffmpeg') is None:
        print('AVISO: no se encontro ffmpeg en el PATH. Instalalo con:')
        print('       winget install Gyan.FFmpeg   (y abre una consola nueva)')
    if not os.path.exists(VENV_PY):
        print('AVISO: no existe el entorno .venv de canta-prep.')
        print('       Corre setup.bat en esta carpeta antes de preparar canciones.')
    if not os.path.isdir(APP_DIR):
        print('AVISO: no se encontro la carpeta de la app en %s' % APP_DIR)


def main():
    for flujo in (sys.stdout, sys.stderr):
        try:
            flujo.reconfigure(errors='replace')
        except Exception:
            pass

    p = argparse.ArgumentParser(
        prog='motor.py',
        description='Motor local: sirve el Cancionero y prepara canciones.')
    p.add_argument('--puerto', type=int, default=8765, help='puerto (default 8765)')
    p.add_argument('--sin-navegador', dest='sin_navegador', action='store_true',
                   help='no abrir el navegador al partir')
    args = p.parse_args()

    servidor, puerto = abrir_puerto(args.puerto)
    url = 'http://localhost:%d' % puerto

    print('== Motor del Cancionero ==')
    print('App:      %s' % APP_DIR)
    print('Paquetes: %s' % OUT_DIR)
    if puerto != args.puerto:
        print('AVISO: el puerto %d estaba ocupado; se uso el %d.' % (args.puerto, puerto))
    avisos_de_entorno()
    print('')
    print('Listo: abre %s' % url)
    print('Corta con Ctrl+C.')
    print('')

    if not args.sin_navegador:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print('')
        print('Cortando...')
    finally:
        with CANDADO:
            activo = trabajo_activo()
        if activo is not None:
            print('Matando la preparacion en curso...')
            matar_trabajo(activo)
        servidor.shutdown()
        servidor.server_close()
        print('Motor detenido.')


if __name__ == '__main__':
    main()
