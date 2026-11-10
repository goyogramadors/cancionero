#!/usr/bin/env bash
# Arma el libro: esquemas (SVG -> PNG), texto (Markdown) y EPUB con pandoc.
# Requiere python3 con Pillow, node con playwright y pandoc.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf build && mkdir -p build/svg build/fig
python3 figuras.py build/svg
python3 portada.py build/svg/portada.svg
node render.js
python3 - <<'PY'
import glob, re
from PIL import Image
for f in glob.glob('build/fig/*.png'):
    im = Image.open(f).convert('L')
    if f.endswith('portada.png'):
        im.resize((1600, 2560)).save(f, optimize=True)
    else:
        im.quantize(16).save(f, optimize=True)
# texto: numera los capítulos y comprueba que cada figura exista
import os
out, n = [], 0
for p in sorted(glob.glob('cap/*.md')):
    t = open(p, encoding='utf-8').read()
    base = os.path.basename(p)
    if base[:2].isdigit() and 1 <= int(base[:2]) <= 89:
        n += 1
        t = re.sub(r'^# ', '# %d. ' % n, t, count=1)
    for fig in re.findall(r'\(fig/([^)]+)\)', t):
        assert os.path.exists('build/fig/' + fig), (p, fig)
    out.append(t)
open('build/libro.md', 'w', encoding='utf-8').write('\n\n'.join(out))
PY
cd build
pandoc libro.md -o teoria-musical.epub --from markdown+pipe_tables+implicit_figures --to epub3 \
  --toc --toc-depth=1 --split-level=1 --css ../libro.css --epub-cover-image=fig/portada.png \
  --metadata title="Teoría musical simple y entretenida" --metadata subtitle="Para piano y guitarra" \
  --metadata author="Cancionero" --metadata lang=es-CL --metadata date="$(date +%Y-%m-%d)" \
  --metadata toc-title="Contenido"
ls -la teoria-musical.epub
