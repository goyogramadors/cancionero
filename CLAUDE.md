# Instrucciones para Claude — Proyecto Cancionero (Songbook)

Este archivo lo lees al abrir el repo. Define qué es el proyecto y cómo trabajar en él.

## Qué es
App web personal: un **cancionero propio** (letras + acordes, transposición, diagramas de piano y
guitarra) con sub-herramientas. Se usa para cantar, acompañar con piano o tocar guitarra.
Diseño **minimalista, blanco y negro**. **Sin build, JavaScript puro** (se abre directo; servida por
http(s) es PWA instalable y offline).

- **En vivo:** https://goyogramadors.github.io/cancionero/
- **Repo:** https://github.com/goyogramadors/cancionero (público)
- **Documentación viva:** lee `README.md` (estado + guía de uso) y `app/ARQUITECTURA.md`
  (cómo funciona por dentro y **cómo sumar sub-herramientas**). Manda la fuente ante cualquier duda.

## Trato con el usuario
Es **chileno**: háblale en **español de Chile, tuteo** (recuerda, puedes, dime). **Nada de voseo**
("tenés", "podés") ni argentinismos.

## Estructura
```
app/            ← la PWA (lo que se publica)
  index.html    ← carga los <script> en orden y monta la barra
  core/         ← núcleo compartido: music, registry, store, github, diagrams, chords, app(router), ui
  data/songs.js ← biblioteca semilla de canciones
  tools/        ← una carpeta por sub-herramienta (songbook, chords, practice, settings)
  manifest.webmanifest · sw.js · pwa/icon.svg
mockup/         ← mockup de referencia (histórico)
fuentes/        ← corpus original del usuario (texto de sus .docx)
index.html      ← raíz del repo: redirige a app/ (para GitHub Pages)
```

## Cómo correr y verificar
```bash
cd app
python -m http.server 8000   # abrir http://localhost:8000
```
- Abrir `app/index.html` con doble clic funciona para las vistas básicas; para **PWA/offline** y para
  probar como en producción, sírvelo (arriba).
- Tras un cambio, **verifica de verdad en el navegador** (que arranque, sin errores de consola), no
  solo que compile.

## Reglas de trabajo (no negociables)
- **Extensibilidad:** cada herramienta se auto-registra con `SB.registry.register({...})`. Para sumar
  una: crea `tools/<id>/<id>.js`, agrégala a los `<script>` de `index.html` y (si debe ir offline) al
  `SHELL` de `sw.js`. Detalle y contrato en `app/ARQUITECTURA.md`. No rompas el patрón: un único global
  `window.SB`, router por hash `#/<tool>/<resto>`.
- **Acordes se calculan, no se escriben a mano.** Piano por fórmula; guitarra por
  `SB.music.guitarVoicings`. Formas curadas y personalizadas en `core/chords.js`.
- **Service worker:** es *stale-while-revalidate*. Si cambias archivos del shell, **sube el número de
  `CACHE`** en `sw.js` (va por `cancionero-vN`). Al depurar, si ves código viejo, es la caché del SW:
  desregístralo y limpia caches.
- **Despliegue:** GitHub Pages sirve desde la rama `main`, carpeta raíz. **Cada `git push` a `main`
  republica** el sitio (tarda ~1-2 min). El `index.html` raíz redirige a `app/`.
- **No agregues archivos en `.github/workflows/`**: el token de `gh` de la cuenta no tiene el scope
  `workflow` y el push será rechazado. Por eso Pages es por rama, no por Actions.
- **Persistencia:** ediciones del usuario en `localStorage`; sync opcional al repo
  (`data/user-songs.json`) vía `core/github.js` + herramienta Ajustes (necesita un token fino con
  Contents: Read and write). La forma del dato no cambia entre local y repo.

## Git
- Sincroniza siempre: `git pull` al empezar; `git add <archivos>`, `commit`, `push` al terminar.
- Mensajes en español, formato `tipo: descripción` (ej. `acordes: …`, `songbook: …`).
- Termina los mensajes de commit con:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Pushear requiere estar autenticado en GitHub como **goyogramadors** (gh auth o un PAT).

## Estado actual (2026-07-27)
Listo y en vivo: arquitectura extensible, cancionero (visor + **editor** de acordes-ladrillo y
letra-por-filas, crear/editar/borrar canciones), **biblioteca de acordes** (generador de guitarra
para cualquier acorde + herramienta "Acordes" para agregar formas/alteraciones propias), práctica de
acordes con metrónomo, ajustes (tema, respaldo, sync GitHub), y PWA desplegada.

### Pendiente / ideas
- **Parser de pegado inteligente**: pegar letra+acordes y reconocerlos solos (se pospuso; el usuario
  poblará el cancionero a mano con el editor).
- **Sync automático** (hoy es manual con botones Traer/Subir).
- Precargar formas de guitarra propias del usuario si las pide.
