# -*- coding: utf-8 -*-
"""Portada del libro (SVG 1600x2560)."""
from dibujos import *
import re, sys


def interior(s):
    return re.sub(r'^<svg[^>]*><rect[^>]*/>|</svg>$', '', s)


kb = teclado(60, 83, {60: 'Do', 64: 'Mi', 67: 'Sol'})
mt = mastil([(5, 3, 'Do', True), (4, 2, 'Mi', False), (3, 0, 'Sol', False), (2, 1, 'Do', True), (1, 0, 'Mi', False)], trastes=5)
b = '<rect width="1600" height="2560" fill="#fff"/><rect x="60" y="60" width="1480" height="2440" fill="none" stroke="#000" stroke-width="10"/>'
b += txt(800, 420, 'Teoría musical', 170, peso='bold')
b += txt(800, 620, 'simple y', 150, peso='bold') + txt(800, 800, 'entretenida', 150, peso='bold')
b += '<rect x="500" y="900" width="600" height="10" fill="#000"/>'
b += txt(800, 1030, 'Para piano y guitarra', 78)
b += '<g transform="translate(113,1200) scale(1.5)">%s</g>' % interior(kb)
b += '<g transform="translate(110,1720) scale(1.25)">%s</g>' % interior(mt)
b += txt(800, 2380, 'El compañero del Cancionero', 60, col='#333')
open(sys.argv[1], 'w', encoding='utf-8').write(svg(1600, 2560, b))
