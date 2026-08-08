# Canta prep — preparador de canciones para "Canta"

Herramienta de escritorio (Python) que convierte una canción en un **paquete Canta**
para la sub-herramienta de karaoke con afinación del Cancionero. Por cada canción:

1. Baja o extrae el audio (YouTube o archivo local).
2. Separa la **voz** del **instrumental** (Demucs).
3. Transcribe la **letra con tiempos por palabra** (Whisper).
4. Extrae la **melodía de la voz** (notas MIDI con tiempos) y estima la **tonalidad**.
5. Deja todo en `../app/canta-media/<id>/`: `vocals.m4a`, `music.m4a` y `canta.json`,
   y actualiza `../app/canta-media/index.json`.

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

## Uso

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

## Tiempos esperados (CPU)

Para una canción de 3–4 minutos: Demucs ~3–8 min, Whisper `small` ~2–4 min,
melodía ~1–2 min. En total espera **5–15 minutos por canción**. La primera corrida
además baja los modelos (Demucs ~80 MB, Whisper small ~180 MB).

## Ojo

- Los paquetes quedan en `app/canta-media/`, que está **gitignoreada**: el audio
  **no se sube al repo**. Cada equipo prepara (o copia a mano) sus paquetes.
- Todo corre local en tu máquina; nada se envía a servicios externos (salvo la
  descarga desde YouTube y la bajada de modelos la primera vez).
