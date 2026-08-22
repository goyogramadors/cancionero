# Canta prep — preparador de canciones para "Canta"

Herramienta de escritorio (Python) que convierte una canción en un **paquete Canta**
para la sub-herramienta de karaoke con afinación del Cancionero. Por cada canción:

1. Baja o extrae el audio (YouTube o archivo local).
2. Separa la **voz** del **instrumental** (Demucs).
3. Transcribe la **letra con tiempos por palabra** (Whisper).
4. Extrae la **melodía de la voz** (notas MIDI con tiempos) y estima la **tonalidad**.
5. Deja todo en `../app/canta-media/<id>/`: `vocals.m4a`, `music.m4a` y `canta.json`,
   y actualiza `../app/canta-media/index.json`.

## Modo fácil: el motor

Lo normal es no tocar la consola. Después de instalar (una vez, más abajo):

1. **Doble clic a `motor.bat`.** Se abre solo el cancionero en
   <http://localhost:8765> (si ese puerto está ocupado, el motor toma el
   siguiente y te dice cuál).
2. Anda a la pestaña **Canta**.
3. Pega el **link de YouTube** o elige un **archivo** (mp4, mp3, m4a, wav…),
   ponle título y artista si quieres, y aprieta **Preparar canción**.
4. Mientras trabaja ves el avance etapa por etapa. Puedes cancelar cuando
   quieras. Demora entre 5 y 15 minutos por canción (más si es la primera vez,
   porque baja los modelos).
5. Cuando termina, la canción ya está lista para cantar en tu computador. Si la
   quieres en el sitio publicado, aprieta el botón de **publicar**: el motor
   hace el `git commit` y el `git push` por ti, y GitHub Pages se actualiza en
   1 o 2 minutos.

El motor corre **solo en tu máquina**: sirve la app y hace el trabajo pesado en
el mismo puerto, así que no hay que configurar nada. Para apagarlo, cierra la
ventana negra o aprieta Ctrl+C.

Opciones de la ventana (rara vez las vas a necesitar):

```
motor.bat --puerto 9000     REM usa otro puerto
motor.bat --sin-navegador   REM no abre el navegador solo
```

Si te avisa que falta **ffmpeg** o el entorno **.venv**, mira la instalación.

## Instalación (una vez)

Necesitas Python 3.10+ y ffmpeg en el PATH. Si te falta ffmpeg:

```
winget install Gyan.FFmpeg
```

(y abre una consola nueva). Después, en esta carpeta:

```
setup.bat
```

Crea el entorno `.venv` e instala todo. La primera vez baja ~1.2 GB (torch CPU),
así que dale tiempo.

## Modo avanzado: línea de comandos

Si prefieres la consola (o quieres preparar varias canciones seguidas con un
script), `prep.py` hace exactamente lo mismo que el motor, sin interfaz.

Con una URL de YouTube:

```
prep.bat "https://www.youtube.com/watch?v=XXXXXXXX" --title "Gracias a la Vida" --artist "Violeta Parra"
```

Con un archivo que bajaste a mano (un mp4 sirve; también mp3, m4a, wav, webm):

```
prep.bat --file "C:\Descargas\cancion.mp4" --title "Gracias a la Vida" --artist "Violeta Parra"
```

Si no das `--title`/`--artist`, se usan los metadatos de YouTube (o el nombre del
archivo). Otras opciones:

- `--model tiny|base|small|medium` — modelo de Whisper (default `small`; `medium`
  transcribe mejor pero es más lento).
- `--language es` — fuerza el idioma de la letra (default: autodetecta).
- `--out <carpeta>` — dónde dejar el paquete (default `../app/canta-media`).
- `--keep-work` — conserva la carpeta temporal de trabajo (para depurar).

### Corregir la letra a mano

Whisper acierta los **tiempos** pero se equivoca en las **palabras**, sobre todo
si la canción tiene mucha instrumentación. Si tienes la letra buena, esto la
monta sobre los tiempos que Whisper ya encontró, en vez de rehacer la canción:

```
ajustar-letra.bat "..\app\canta-media\<id-de-la-cancion>" letra.txt
```

El `.txt` va con **un verso por línea** (las líneas en blanco se ignoran); esas
líneas son las que verás en el karaoke. Al terminar dice qué porcentaje de
palabras calzó exactamente con lo cantado. Si calza menos del 25 % se detiene sin
tocar nada: es la señal de que esa letra no es de esta canción.

Deja un respaldo en `canta.json.bak` (evítalo con `--sin-respaldo`). No toca las
notas ni la curva de tono, solo la letra. Para probar que el alineador está sano:
`ajustar-letra.bat --autochequeo`.

### Rehacer solo la melodía

Si una canción ya preparada quedó con pocas notas (o mejoramos el detector),
no hace falta rehacerla entera: esto recalcula **solo** las notas y la curva de
tono desde la voz ya separada, y deja la letra y todo lo demás intacto.

```
prep.bat --remelodia "..\app\canta-media\<id-de-la-cancion>"
```

Tarda ~1 minuto en vez de 10, porque no baja nada ni vuelve a correr Demucs ni
Whisper. Al terminar imprime la cobertura lograda. Ojo: si esa canción ya
estaba subida al repo, acuérdate de subir el `canta.json` nuevo.

## Tiempos esperados (CPU)

Para una canción de 3–4 minutos: Demucs ~3–8 min, Whisper `small` ~2–4 min,
melodía ~1–2 min. En total espera **5–15 minutos por canción**. La primera corrida
además baja los modelos (Demucs ~80 MB, Whisper small ~180 MB).

## Ojo

- Los paquetes quedan en `app/canta-media/`, que está **gitignoreada** a
  propósito, para que un `git add -A` distraído no te suba cientos de MB. Nada
  se publica solo: el audio llega al repo **únicamente** cuando aprietas el
  botón de publicar (o si haces `git add -f` a mano), y siempre canción por
  canción.
- Todo corre local en tu máquina; nada se envía a servicios externos (salvo la
  descarga desde YouTube y la bajada de modelos la primera vez).
