# Libro: «Teoría musical simple y entretenida»

Libro electrónico (EPUB, pensado para Kindle Paperwhite) que acompaña la pestaña **Piano** del
Cancionero y le suma la guitarra. Sigue el mismo orden de las unidades de la app.

- `teoria-musical.epub`: el libro armado. Se manda al Kindle con «Send to Kindle» o por correo.
- `cap/*.md`: el texto, un archivo por capítulo.
- `dibujos.py`: los dibujantes de esquemas (teclado, mástil, cajas de acordes, tablas, ritmos).
- `figuras.py`: la lista de esquemas del libro. Los acordes y escalas se calculan, no se escriben a mano.
- `armar.sh`: genera los esquemas, los pasa a PNG con Chromium y arma el EPUB con pandoc.

Para rearmarlo: `./armar.sh` (necesita python3 con Pillow, node con playwright y pandoc) y copiar
`build/teoria-musical.epub` a esta carpeta.
