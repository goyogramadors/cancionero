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

### Medir qué tan bien salió la melodía

El carril de afinación depende de que el detector siga de verdad la voz. Como
no hay una "respuesta correcta" contra la cual comparar, se miden las señales
que delatan cuándo se equivoca:

```
evaluar-melodia.bat
evaluar-melodia.bat --contra ..\referencia    REM comparar con una tanda anterior
evaluar-melodia.bat --guardar ..\referencia   REM dejar la tanda actual como referencia
```

| Columna | Qué es | Dirección |
|---|---|---|
| `en-canto` | % del tiempo con letra que tiene nota. Lo que falta es melodía que el detector no vio | subir |
| `8vas/min` | saltos de ±una octava entre notas seguidas: el error clásico de pyin, y el que más se nota | bajar |
| `fuera` | % del tiempo de las notas que cae donde no hay letra (suele ser un instrumento colado en la pista de voz) | bajar |
| `cortas` | % de notas de menos de 0,12 s: contorno picado en vez de notas sostenidas | bajar |
| `saltos` | mediana del salto entre notas seguidas, en semitonos | bajar |

**Cómo usarlo para mejorar el detector:** guarda una referencia, cambia los
parámetros de `prep.py`, corre `--remelodia` sobre las canciones y compara. Las
marcas `+` y `-` dicen si cada canción mejoró o empeoró. Conviene mirar canción
por canción y no solo el promedio: un cambio puede arreglar una voz grave y
arruinar una aguda.

Ojo con `fuera`: si a la canción le falta letra en algún tramo (un *fade-out*
que repite más de lo que dice el `.txt`), ahí hay canto real sin verso al cual
pegarse y la cifra sale inflada sin que el detector tenga la culpa.

### Afinar los umbrales del detector

`evaluar-melodia.bat` dice **si** una tanda salió mejor; esto sirve para encontrar
**qué umbrales** probar. El problema es que pyin tarda ~90 s por canción, así que
mover un umbral y volver a medir es inviable. La solución es separar lo caro de lo
barato: se corre el análisis una vez y se cachea, y después evaluar cualquier
combinación cuesta milisegundos.

```
calibrar-melodia.bat --preparar    REM una vez: ~90 s por cancion
calibrar-melodia.bat --actual      REM que dan los umbrales de hoy
calibrar-melodia.bat --barrer      REM explora combinaciones y las ordena
```

El barrido muestra las dos métricas que **se pelean entre sí**: subir la cobertura
(capturar la melodía que falta) empuja al detector a seguir instrumentos donde no
hay canto, y bajar los falsos positivos se lleva melodía real por delante. No hay
un valor "correcto": hay un intercambio que conviene ver completo antes de elegir.

Por eso la tabla incluye `peor-cob`, la canción peor parada. Un promedio bonito con
una canción hundida no sirve cuando el corpus va a crecer: **mira siempre canción por
canción**, no solo el promedio.

El caché queda en `cache-melodia/` (gitignoreado). Si cambias los parámetros que
afectan a pyin —`FRAME`, `NOTA_MIN/MAX`, `NO_TROUGH_PROB`— el caché queda obsoleto:
bórralo y vuelve a prepararlo. Los umbrales que se barren (`RMS_MIN_REL`,
`DOMINANCIA_MIN`) se aplican *después* de pyin, por eso no lo invalidan.

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
