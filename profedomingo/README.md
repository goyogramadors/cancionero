# Piano · Profe Domingo

Sitio público con **solo las lecciones y la práctica de piano** del Cancionero:
https://goyogramadors.github.io/cancionero/profedomingo/

- No tiene código propio de la herramienta: su `index.html` carga
  `core/` y `tools/piano/piano.js` de `app/` por ruta absoluta (`/cancionero/app/...`).
  Lo que se mejore en el Piano del cancionero aparece acá.
- El avance de cada persona queda **en su navegador** (`localStorage`, claves
  `pd.piano.*`), sin cuenta ni servidor. Si borra los datos del sitio o cambia de
  equipo, parte de cero.
- Logo `logo.jpg` arriba a la derecha y letras en el café de su tinta (`theme.css`); el sitio es
  siempre claro.
- Las teclas del computador parten **apagadas**; se prenden con el botón «⌨ Teclas».
- Si cambia un archivo del shell (acá o en `app/`), sube `CACHE` en `sw.js` de esta carpeta.
- Es una carpeta de este repo (Gregorio prefirió no abrir otro repositorio, 16-11-2026): quien
  recorte la dirección llega al cancionero personal.
