# Songbook — Cancionero propio

App web para un cancionero personal, usado para **cantar**, **acompañar con piano** o **tocar guitarra**.
Referentes: CifraClub, LaCuerda, Guitar Tuna. Diseño **minimalista, blanco y negro**.

## En vivo

**App:** https://goyogramadors.github.io/cancionero/ · **Repo:** https://github.com/goyogramadors/cancionero

Ábrela en el celular y **instálala** (menú del navegador → «Agregar a pantalla de inicio»):
queda como app y funciona **offline**. Las canciones que agregues se guardan en ese dispositivo;
para compartirlas entre dispositivos, usa **Ajustes → Sincronizar con GitHub** (ver abajo).

### Sincronizar entre dispositivos (repo como base de datos)
1. Crea un **token fino** en GitHub: Settings → Developer settings → Fine-grained tokens →
   solo el repo `cancionero`, permiso **Contents: Read and write**.
2. En la app: **Ajustes → Sincronizar con GitHub**, completa owner (`goyogramadors`),
   repo (`cancionero`), pega el token, **Guardar**.
3. **Subir al repo** guarda tus canciones en `data/user-songs.json` (un commit). En otro
   dispositivo, **Traer del repo** las baja. El token vive solo en cada dispositivo.

## Estado actual (2026-07-07)

- **Construcción iniciada (Fase 1 lista).** La app real vive en `app/` — arquitectura extensible,
  sin build, JavaScript puro. Ver `app/ARQUITECTURA.md` para el detalle y cómo sumar sub-herramientas.
  - **Núcleo compartido** (`app/core/`): teoría musical, registro de herramientas, router por hash,
    almacenamiento (semilla + localStorage), utilidades.
  - **Herramienta Cancionero** (`app/tools/songbook/`): repertorio + visor de canción con perfiles
    (Cantar/Piano/Guitarra/Solo acordes), transposición ±½ tono, notación A-B-C ↔ DO-RE-MI, diagramas.
  - **Sub-herramienta Práctica** (`app/tools/practice/`): generador con metrónomo, integrada por el
    registro (botón pequeño). Demuestra la extensibilidad pedida.
  - **Editor (Fase 2):** modo *Editar acordes* (ladrillos arrastrables, imán a la sílaba, agregar/
    cambiar/eliminar) y *Editar letra* (filas con regla del guion, Enter/Retroceso). Crear canción,
    agregar/eliminar partes, editar metadatos. Todo persiste solo.
  - **Acordes** (`app/tools/chords/`): biblioteca de acordes. El piano se genera por fórmula y la
    guitarra por un **generador de digitaciones** (`app/core/music.js` → `guitarVoicings`) que cubre
    *cualquier* acorde en afinación estándar (fundamental/bajo en la cuerda grave), con varias formas
    entre las que elegir por canción. Formas abiertas conocidas están curadas (`app/core/chords.js`).
    El usuario puede **agregar una digitación propia** o **definir una alteración desconocida**.
  - **Ajustes** (`app/tools/settings/`): tema claro/oscuro, respaldo local (descargar/importar),
    y **sync con GitHub** (`app/core/github.js`) — repo como base de datos (Fase 4).
  - **PWA + hosting (Fase 4):** service worker *stale-while-revalidate* (offline + se actualiza solo),
    desplegada en GitHub Pages desde la rama `main` (`index.html` raíz redirige a `app/`).
  - Verificado: arranque, ruteo/deep-linking, transposición, notación, perfiles, diagramas,
    metrónomo, editor completo (incl. arrastre), persistencia, caché offline, sitio en vivo, y el
    round-trip de sync contra el repo real.
- El **mockup** previo se conserva en `mockup/cancionero-mockup.html` como referencia de UX.

### Pendiente / ideas futuras
- **Parser de pegado inteligente** (la vieja Fase 3): pegar letra+acordes y que los reconozca
  automáticamente. Se pospuso: el cancionero se poblará a mano con el editor cuando haga falta.
- **Sync automático** (hoy es manual con botones Traer/Subir).
- **Más sub-herramientas**: enchúfalas por el registro (ver `app/ARQUITECTURA.md`).

## Arquitectura acordada

**PWA estática (sin backend) + repo Git como base de datos + hosting gratuito** (GitHub Pages / Netlify).
Todo es determinista y corre en el navegador, **sin IA en tiempo de ejecución**. La IA (Claude) se usa solo
como herramienta de carga/migración masiva de canciones, fuera de la app.

### Formato canónico de canción (la pieza clave)
Cada canción es un JSON. El acorde **no** se guarda "encima" de la letra, sino **anclado a la posición
de un carácter** de la letra (`[posición, "acorde"]`). Eso permite: arrastrar el acorde por la línea,
transponer sin desalinear, partir/unir filas sin desincronizar, y renderizar en cualquier vista.

```json
{
  "titulo": "A primeira vista",
  "tono": "C",
  "partes": [
    { "nombre": "Parte A", "lineas": [
      { "l": " Cuando no tenía nada deseé...",
        "a": [[0,"C"],[17,"G#dim"],[27,"Am"]] }
    ]},
    { "nombre": "Parte A", "ref": "Parte A", "lineas": [ ... ] }
  ],
  "voicings": { "G#dim": ["4x343x"] }
}
```
- Acordes guardados **siempre en notación americana** internamente; latino (DO/RE/MI) es solo presentación.
- **Partes repetidas** se referencian (`"ref"`); la letra nueva hereda la estructura de acordes.
- Partes de **solo acordes** usan `grid` (filas de acordes) en vez de `lineas`.

## Requerimientos del usuario (checklist)

- [x] Reconocer **partes** (Intro, A, B, C, Coro, Coda, Inter…), marcando las repetidas → *mockup*
- [x] Letra: el **guion `-` parte la línea** y baja a la fila siguiente → *mockup (Editar letra)*
- [x] Acordes **movibles** a lo largo de la línea (ladrillo/bloque arrastrable) → *mockup (Editar acordes)*
- [x] Entrada **inteligente**: pegar letra sola, o letra+acordes, y reconocer cada línea → *mockup (maqueta)*
- [x] Acordes **al costado**, ocultables (no mostrar los fáciles) → *mockup*
- [x] Notación **americana (A,B,C) ↔ latina (DO,RE,MI)** → *mockup (funcional)*
- [x] Biblioteca de **alteraciones** (m, 7, dim, 4, 6, 9, aug, m7b5…) y **bajo alterado** (/G, /D) → *motor en mockup*
- [x] **Voicings** seleccionables por canción cuando hay varias digitaciones → *mockup (UI)*
- [x] **Transponer ± ½ tono** → *mockup (funcional)*
- [x] Elegir **qué se muestra**: solo letra / solo acordes / con diagramas piano o guitarra → *mockup (perfiles)*
- [x] **Almacenar** canciones y consultarlas en **celular y navegador** → arquitectura: repo Git + PWA
- [x] **Editar**: dos modos separados — *Editar acordes* (ladrillos arrastrables, imán a la sílaba) y *Editar letra* (filas con regla del guion `-`, Enter divide, Retroceso une) → *mockup*
- [x] **Mini-app «Práctica de acordes»** (botón pequeño en la barra): generador aleatorio con metrónomo, campo tonal/modo libre, alteraciones (sost., menor, 7ª, /bajo), inversiones, notación Do-Re/C-D, teclado que ilumina las notas. Adaptada al B&N desde el `practica_de_acordes.html` original (que usaba React+CDN); ahora es vanilla JS, autónoma y offline → *mockup*
- [ ] **App real** (Fase 1 en adelante) — pendiente

## Plan de construcción

1. **Fase 1 — núcleo:** formato canónico JSON + parser de pegado + render con transposición y notación.
   Migrar las canciones reales de `fuentes/Cancionero.txt` como corpus de prueba.
2. **Fase 2 — biblioteca de acordes:** diagramas de guitarra (voicing seleccionable) + piano por fórmula.
3. **Fase 3 — editor fino:** arrastre de acordes, regla del guion, perfiles de vista (ya prototipado).
4. **Fase 4 — publicación:** repo `Songbook` + PWA (service worker, offline) + hosting; edición desde el celular.

## Estructura de carpetas

```
Songbook/
├─ README.md              ← este archivo (estado + plan)
├─ app/                   ← LA APP REAL (Fase 1)
│  ├─ index.html          ← caparazón: carga scripts + monta la barra
│  ├─ ARQUITECTURA.md     ← cómo funciona y cómo sumar sub-herramientas
│  ├─ manifest.webmanifest· sw.js   ← PWA (instalable + offline)
│  ├─ css/base.css        ← tokens B&N, tema claro/oscuro
│  ├─ core/               ← núcleo: music · registry · router(app) · store · ui
│  ├─ data/songs.js       ← biblioteca semilla (2 canciones + pendientes)
│  ├─ tools/songbook/     ← herramienta principal (cancionero)
│  ├─ tools/practice/     ← sub-herramienta (práctica de acordes)
│  └─ pwa/icon.svg
├─ mockup/
│  └─ cancionero-mockup.html   ← mockup de referencia (incluye editor por portar)
└─ fuentes/               ← corpus original del usuario (texto extraído de los .docx)
   ├─ Cancionero.txt          ← ~20 canciones con acordes (notación mezclada)
   ├─ Cancionero - Repertorio.txt
   └─ Unchained Melody.txt
```

## Notas de diseño

- Blanco y negro estricto, tipografía monoespaciada para letra/acordes (alineación por columnas).
- Tema claro y oscuro según el sistema.
- El corpus del usuario mezcla notación latina y americana en una misma canción (incluso trae tablas de
  equivalencia escritas a mano) — el parser debe leer ambas.
- Hay canciones solo-esquema (Unchained Melody: solo grillas de acordes, sin letra) y canciones con letra
  que deben poder verse en modo **solo acordes**.
