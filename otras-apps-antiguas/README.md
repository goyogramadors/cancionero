# Otras apps antiguas (material de referencia)

Prototipos anteriores de Gregorio (casi todos hechos en Google AI Studio), guardados **solo para
reutilizar ideas y trozos de lógica** en la evolución del Cancionero. **No se publican ni se cargan
desde la app** (`app/` no los referencia). Al portar algo, hay que reescribirlo a JS puro con el
patrón de la app: `SB.registry.register`, un único global `window.SB` y acordes **calculados**
(`core/music.js`, `core/chords.js`), no escritos a mano.

## Qué hay y para qué sirve

| Archivo | Qué es | Qué vale la pena reutilizar |
|---|---|---|
| `html/compositor.html` | «Herramienta de Teoría Musical», HTML suelto con Tailwind y tres vistas: explorador de progresiones (campo armónico de una tonalidad), acordes en piano y «tocar canción» | Cómo genera el campo armónico y los grados, la lógica para armar progresiones y exportarlas a una canción, y el reproductor de la progresión |
| `html/chordpad-pro.html` | «DJ Chord Pad Pro»: una grilla de pads que tocan los acordes de la escala con Web Audio. Es la versión más completa; se descartó `chordpad.html` | Lectura de números romanos (`parseRomanNumeral`), la pista de dominante secundaria (`showDominantHint`), progresiones en loop y las voces de sintetizador (`createVoice`) |
| `banda-tonal-pentatonica.tsx` | Componente React: una banda vertical de notas (de abajo hacia arriba) con los grados del tono, su función (tónica, subdominante, dominante…) y la pentatónica marcada (`isPenta`) | La visualización vertical de grados y funciones y el resaltado de la pentatónica. El scroll «infinito» con 12 octavas repetidas es un truco que conviene reemplazar |
| `cuadernos-musicales/` | Componentes de «Cuadernos Musicales» (React + Vite + Firebase + Gemini). Solo se copió `src/`, sin el esqueleto | Ver abajo |
| `practica-acordes-android/MainActivity.kt` | App Android (Jetpack Compose) para leer acordes rápido en el piano, con metrónomo | Generador de acordes al azar con modificadores (menores, séptimas, inversiones, sostenidos/bemoles, notación latina), el cambio de acorde cada N compases y la pre-visualización del siguiente acorde (`updateNextChordOnly`). Se descartó todo el resto del proyecto Gradle |

### `cuadernos-musicales/`

- **`Cancionero.tsx`**: editor y reproductor de canciones con grilla de compases y avance guiado.
  Trae **`autoRecognizeChords`**: reconoce acordes al pegar letra con acordes. Es justo el pendiente
  «parser de pegado inteligente» de `CLAUDE.md`, así que es la pieza más valiosa.
- **`ChordPadPro.tsx`**: la versión React del chord pad, que además pide progresiones a Gemini
  (`generateAIProgression`).
- **`server.ts`**: el endpoint `/api/ai/compose` que arma el pedido a Gemini («una progresión de 4
  acordes con este *vibe* en este tono»). Sirve como idea de qué pedirle a un modelo; la app actual
  no tiene servidor, así que habría que resolver dónde vive la llave.
- **`CampoTonal.tsx`**: los acordes diatónicos de una escala, con sonido al tocarlos.
- **`InspectorEscalas.tsx`**: teclado interactivo para estudiar escalas, con dibujo de intervalos.
- **`EntrenadorVocal.tsx`**: afinador por micrófono (autocorrelación) con secuencias en solfeo.
  **Canta ya lo supera** (pyin/crepe, carril, puntaje), así que solo sirven las secuencias de
  ejercicios (`generateSequence`) y los nombres de solfeo.
- **`types.ts`**: los tipos de datos de esos componentes (canción, línea, acorde).

## Qué se dejó fuera, y por qué

- `chordpad.html`: es una versión anterior de `chordpad-pro.html`.
- *Inversions for Major Chords Chart.docx*: es una lámina de Julie Swihart (©2022) con imágenes de
  las inversiones. La app ya calcula las inversiones, y el material tiene derechos de autor.
- El esqueleto de AI Studio: `package.json`, `package-lock.json`, `vite.config.ts`, `index.html`,
  `main.tsx`, `App.tsx` (pestañas), `index.css`, Firebase (`firestore.rules`,
  `firebase-blueprint.json`), `.env.example` (sin llaves reales) y todo el proyecto Gradle (temas,
  íconos, tests de ejemplo). Ninguno trae lógica musical.
- Persistencia en Firebase: la app usa `localStorage` más el sync al repo (`core/github.js`).
