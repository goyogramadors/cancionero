# -*- coding: utf-8 -*-
"""Esquemas del libro (SVG en blanco y negro, pensados para tinta electrónica).
Cada función devuelve un SVG como texto. Sin dependencias."""
import math

F = 'DejaVu Sans, Arial, sans-serif'
LAT = {'C': 'Do', 'D': 'Re', 'E': 'Mi', 'F': 'Fa', 'G': 'Sol', 'A': 'La', 'B': 'Si'}
LETRAS = 'CDEFGAB'
PC = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
SOST = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
BEM = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']


def lat(n):
    """C# -> Do#, Bb -> Sib"""
    return LAT[n[0]] + n[1:]


def pc(n):
    return (PC[n[0]] + n.count('#') - n.count('b')) % 12


def deletrear(raiz, pasos):
    """Notas con el nombre correcto. pasos = [(grado 1..7, semitonos)]."""
    i0 = LETRAS.index(raiz[0])
    out = []
    for g, s in pasos:
        letra = LETRAS[(i0 + g - 1) % 7]
        dif = (pc(raiz) + s - PC[letra] + 6) % 12 - 6
        out.append(letra + ('#' * dif if dif > 0 else 'b' * (-dif)))
    return out


ESC = {
    'mayor': [(1, 0), (2, 2), (3, 4), (4, 5), (5, 7), (6, 9), (7, 11)],
    'menor': [(1, 0), (2, 2), (3, 3), (4, 5), (5, 7), (6, 8), (7, 10)],
    'armonica': [(1, 0), (2, 2), (3, 3), (4, 5), (5, 7), (6, 8), (7, 11)],
    'penta': [(1, 0), (2, 2), (3, 4), (5, 7), (6, 9)],
    'pentam': [(1, 0), (3, 3), (4, 5), (5, 7), (7, 10)],
    'blues': [(1, 0), (3, 3), (4, 5), (5, 6), (5, 7), (7, 10)],
    'dorica': [(1, 0), (2, 2), (3, 3), (4, 5), (5, 7), (6, 9), (7, 10)],
    'mixo': [(1, 0), (2, 2), (3, 4), (4, 5), (5, 7), (6, 9), (7, 10)],
}
ACO = {
    '': [(1, 0), (3, 4), (5, 7)], 'm': [(1, 0), (3, 3), (5, 7)],
    'dim': [(1, 0), (3, 3), (5, 6)], 'aug': [(1, 0), (3, 4), (5, 8)],
    'sus2': [(1, 0), (2, 2), (5, 7)], 'sus4': [(1, 0), (4, 5), (5, 7)],
    '7': [(1, 0), (3, 4), (5, 7), (7, 10)], 'maj7': [(1, 0), (3, 4), (5, 7), (7, 11)],
    'm7': [(1, 0), (3, 3), (5, 7), (7, 10)], 'm7b5': [(1, 0), (3, 3), (5, 6), (7, 10)],
    '6': [(1, 0), (3, 4), (5, 7), (6, 9)], 'add9': [(1, 0), (3, 4), (5, 7), (2, 14)],
}


def svg(w, h, cuerpo):
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">'
            '<rect width="100%%" height="100%%" fill="#fff"/>%s</svg>' % (w, h, w, h, cuerpo))


def txt(x, y, s, t=20, ancla='middle', peso='normal', col='#000', estilo=''):
    s = str(s).replace('&', '&amp;').replace('<', '&lt;')
    return ('<text x="%.1f" y="%.1f" font-family="%s" font-size="%d" text-anchor="%s" font-weight="%s" '
            'fill="%s" %s>%s</text>' % (x, y, F, t, ancla, peso, col, estilo, s))


# ---------------------------------------------------------------- teclado
BLANCAS = [0, 2, 4, 5, 7, 9, 11]


def teclado(lo, hi, marcas=None, nombres=False, titulo=None, llaves=None, kw=None):
    """lo, hi: MIDI de la primera y última tecla blanca. marcas: {midi: etiqueta}.
    llaves: [(midi_a, midi_b, texto)] corchetes bajo el teclado."""
    marcas = marcas or {}
    bl = [m for m in range(lo, hi + 1) if m % 12 in BLANCAS]
    n = len(bl)
    kw = kw or min(64, 1000 // n)
    kh = int(kw * 3.6) if kw < 50 else 200
    bw, bh = kw * 0.6, kh * 0.62
    x0, y0 = 10, 10 + (34 if titulo else 0)
    pos = {}
    b = ''
    if titulo:
        b += txt(x0 + n * kw / 2, 28, titulo, 24, peso='bold')
    for i, m in enumerate(bl):
        x = x0 + i * kw
        pos[m] = (x + kw / 2, y0 + kh - kw * 0.48, False)
        b += '<rect x="%d" y="%d" width="%d" height="%d" fill="#fff" stroke="#000" stroke-width="2"/>' % (x, y0, kw, kh)
        if nombres:
            b += txt(x + kw / 2, y0 + kh + 24, LAT['CDEFGAB'[BLANCAS.index(m % 12)]], min(20, int(kw * 0.42)), col='#333')
    for i, m in enumerate(bl[:-1]):
        if bl[i + 1] - m == 2:
            x = x0 + (i + 1) * kw - bw / 2
            pos[m + 1] = (x + bw / 2, y0 + bh - bw * 0.62, True)
            b += '<rect x="%.1f" y="%d" width="%.1f" height="%.1f" fill="#000"/>' % (x, y0, bw, bh)
    for m, et in marcas.items():
        if m not in pos:
            continue
        x, y, negra = pos[m]
        r = kw * 0.42 if not negra else max(bw * 0.47, kw * 0.38)
        t = int(r * (0.95 if len(str(et)) <= 2 else 0.72))
        if negra:
            b += '<circle cx="%.1f" cy="%.1f" r="%.1f" fill="#fff" stroke="#000" stroke-width="2"/>' % (x, y, r)
            b += txt(x, y + t * 0.36, et, t, peso='bold')
        else:
            b += '<circle cx="%.1f" cy="%.1f" r="%.1f" fill="#000"/>' % (x, y, r)
            b += txt(x, y + t * 0.36, et, t, peso='bold', col='#fff')
    alto = y0 + kh + (34 if nombres else 8)
    for a, z, s in (llaves or []):
        xa, xz = pos[a][0], pos[z][0]
        y = alto + 6
        b += '<path d="M%.1f %d v10 H%.1f v-10" fill="none" stroke="#000" stroke-width="2"/>' % (xa, y, xz)
        b += txt((xa + xz) / 2, y + 34, s, 20)
        alto_ll = y + 44
    if llaves:
        alto = alto_ll
    return svg(x0 * 2 + n * kw, alto, b)


def notas_midi(raiz_midi, semis):
    return [raiz_midi + s for s in semis]


# ---------------------------------------------------------------- guitarra
AFIN = [40, 45, 50, 55, 59, 64]  # 6ª a 1ª


def mastil(puntos=None, trastes=12, desde=0, titulo=None, todas=False, nombres_fn=None):
    """Mástil horizontal, 1ª cuerda arriba (como una tablatura).
    puntos: [(cuerda 1..6, traste, etiqueta, relleno)]."""
    puntos = list(puntos or [])
    fw, sh = 1000 // (trastes + 1), 46
    x0, y0 = 70, 26 + (34 if titulo else 0)
    b = ''
    if titulo:
        b += txt(x0 + (trastes + 1) * fw / 2, 28, titulo, 24, peso='bold')
    W = x0 + (trastes + 1) * fw + 12
    nom_c = ['Mi', 'Si', 'Sol', 'Re', 'La', 'Mi']
    for i in (3, 5, 7, 9, 12):
        t = i - desde
        if 1 <= t <= trastes:
            b += txt(x0 + fw + (t - 0.5) * fw, y0 + 5 * sh + 44, i, 20, col='#333')
    for s in range(6):
        y = y0 + s * sh
        b += '<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="#000" stroke-width="%.1f"/>' % (x0 + fw, y, x0 + (trastes + 1) * fw, y, 1.5 + s * 0.5)
        b += txt(x0 - 44, y + 7, '%dª' % (s + 1), 18, col='#333')
    for t in range(trastes + 1):
        x = x0 + fw + t * fw
        b += '<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="#000" stroke-width="%d"/>' % (x, y0, x, y0 + 5 * sh, 7 if (t == 0 and desde == 0) else 2)
    if todas:
        for s in range(1, 7):
            for t in range(0, trastes + 1):
                m = AFIN[6 - s] + t
                n = SOST[m % 12]
                puntos.append((s, t, lat(n), '#' not in n))
    for s, t, et, lleno in puntos:
        x = x0 + fw + (t - desde - 0.5) * fw if t > 0 else x0 + fw * 0.5
        y = y0 + (s - 1) * sh
        r = 19
        ts = 17 if len(str(et)) <= 2 else 13
        if lleno:
            b += '<circle cx="%.1f" cy="%d" r="%d" fill="#000"/>' % (x, y, r)
            b += txt(x, y + ts * 0.36, et, ts, peso='bold', col='#fff')
        else:
            b += '<circle cx="%.1f" cy="%d" r="%d" fill="#fff" stroke="#000" stroke-width="2"/>' % (x, y, r)
            b += txt(x, y + ts * 0.36, et, ts, peso='bold')
    return svg(W, y0 + 5 * sh + 58, b)


CON_BEMOL = ('F', 'Fm', 'Dm', 'Gm', 'Cm', 'C7', 'F7', 'Dm7', 'Gm7')


def caja(pat, nombre, x, y, notas=True, cejilla=None):
    """Una caja de acorde vertical. pat: 'x32010' (6ª a 1ª)."""
    fr = [-1 if c in 'xX' else int(c) for c in pat]
    pres = [f for f in fr if f > 0]
    base = 1 if (not pres or max(pres) <= 4) else min(pres)
    cw, rh = 30, 38
    b = txt(x + 2.5 * cw, y, nombre, 26, peso='bold')
    top = y + 46
    for i in range(6):
        b += '<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="#000" stroke-width="2"/>' % (x + i * cw, top, x + i * cw, top + 4 * rh)
    for j in range(5):
        b += '<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="#000" stroke-width="%d"/>' % (x, top + j * rh, x + 5 * cw, top + j * rh, 7 if (j == 0 and base == 1) else 2)
    if base > 1:
        b += txt(x - 12, top + rh * 0.65, '%d' % base, 20, ancla='end', col='#333')
    if cejilla:
        c_tr, c_de, c_a = cejilla
        yy = top + (c_tr - base + 0.5) * rh
        b += '<rect x="%d" y="%.1f" width="%d" height="22" rx="11" fill="#000"/>' % (x + (6 - c_de) * cw - 11, yy - 11, (c_de - c_a) * cw + 22)
    for i, f in enumerate(fr):
        cx = x + i * cw
        if f == -1:
            b += txt(cx, top - 10, '×', 22, col='#333')
        elif f == 0:
            b += '<circle cx="%d" cy="%d" r="8" fill="#fff" stroke="#000" stroke-width="2"/>' % (cx, top - 16)
        else:
            b += '<circle cx="%d" cy="%.1f" r="11.5" fill="#000"/>' % (cx, top + (f - base + 0.5) * rh)
        if notas and f >= 0:
            n = (BEM if (nombre[1:2] == 'b' or nombre in CON_BEMOL) else SOST)[(AFIN[i] + f) % 12]
            b += txt(cx, top + 4 * rh + 26, lat(n), 14 if len(lat(n)) < 4 else 12, col='#333')
    return b


def cajas(lista, por_fila=4, notas=True):
    """lista: [(nombre, patrón)] o [(nombre, patrón, cejilla)]."""
    dx, dy = 250, 262 + (10 if notas else -16)
    filas = (len(lista) + por_fila - 1) // por_fila
    b = ''
    for k, it in enumerate(lista):
        b += caja(it[1], it[0], 62 + (k % por_fila) * dx, 34 + (k // por_fila) * dy, notas, it[2] if len(it) > 2 else None)
    return svg(por_fila * dx + 10, filas * dy + 6, b)


# ---------------------------------------------------------------- tablas y tiras
def tabla(filas, anchos, cab=True, t=22, alto=50, resaltar=(), negrita_col0=False, titulo=None):
    """Tabla dibujada (para las que no caben como texto en el Kindle).
    resaltar: columnas (índice) con fondo gris."""
    W = sum(anchos) + 4
    y0 = 2 + (40 if titulo else 0)
    b = ''
    if titulo:
        b += txt(W / 2, 28, titulo, 24, peso='bold')
    for r, fila in enumerate(filas):
        x = 2
        y = y0 + r * alto
        for c, cel in enumerate(fila):
            es_cab = cab and r == 0
            fondo = '#000' if es_cab else ('#ddd' if c in resaltar else '#fff')
            b += '<rect x="%d" y="%d" width="%d" height="%d" fill="%s" stroke="#000" stroke-width="1.5"/>' % (x, y, anchos[c], alto, fondo)
            b += txt(x + anchos[c] / 2, y + alto / 2 + t * 0.36, cel, t,
                     peso='bold' if (es_cab or (negrita_col0 and c == 0)) else 'normal', col='#fff' if es_cab else '#000')
            x += anchos[c]
    return svg(W, y0 + len(filas) * alto + 2, b)


def tira(notas, saltos, grados=None, titulo=None):
    """Notas en cajas con la distancia (T, S…) entre una y otra."""
    n = len(notas)
    cw = min(118, 1000 // n)
    bw = int(cw * 0.66)
    y0 = 58 + (38 if titulo else 0)
    b = ''
    if titulo:
        b += txt(n * cw / 2 + 4, 28, titulo, 24, peso='bold')
    for i, nt in enumerate(notas):
        x = 6 + i * cw
        b += '<rect x="%d" y="%d" width="%d" height="64" rx="8" fill="#fff" stroke="#000" stroke-width="2.5"/>' % (x, y0, bw, )
        b += txt(x + bw / 2, y0 + 41, nt, 24 if len(nt) <= 3 else 19, peso='bold')
        if grados:
            b += txt(x + bw / 2, y0 + 92, grados[i], 20, col='#333')
        if i < n - 1 and saltos:
            xa, xb = x + bw / 2, x + cw + bw / 2
            b += '<path d="M%.1f %d Q%.1f %d %.1f %d" fill="none" stroke="#000" stroke-width="2"/>' % (xa + 8, y0 - 6, (xa + xb) / 2, y0 - 44, xb - 8, y0 - 6)
            b += txt((xa + xb) / 2, y0 - 32, saltos[i], 22, peso='bold')
    return svg(6 + (n - 1) * cw + bw + 6, y0 + (104 if grados else 72), b)


def ritmo(cuentas, filas, titulo=None, fuertes=()):
    """Rejilla de ritmo. cuentas: ['1','y','2',…]; filas: [(nombre, [símbolos])]."""
    n = len(cuentas)
    cw = min(96, 860 // n)
    x0 = 150
    y0 = 6 + (40 if titulo else 0)
    b = ''
    if titulo:
        b += txt((x0 + n * cw) / 2, 28, titulo, 24, peso='bold')
    for i, c in enumerate(cuentas):
        x = x0 + i * cw
        fuerte = c.isdigit()
        b += '<rect x="%d" y="%d" width="%d" height="44" fill="%s" stroke="#000" stroke-width="1.5"/>' % (x, y0, cw, '#000' if fuerte else '#bbb')
        b += txt(x + cw / 2, y0 + 30, c, 22, peso='bold', col='#fff' if fuerte else '#000')
    for r, (nom, sims) in enumerate(filas):
        y = y0 + 44 + r * 62
        b += txt(x0 - 12, y + 39, nom, 19, ancla='end')
        for i in range(n):
            x = x0 + i * cw
            b += '<rect x="%d" y="%d" width="%d" height="62" fill="#fff" stroke="#000" stroke-width="1.5"/>' % (x, y, cw)
            s = sims[i] if i < len(sims) else ''
            if s:
                b += txt(x + cw / 2, y + 42, s, 30 if len(s) == 1 else 20, peso='bold')
    return svg(x0 + n * cw + 4, y0 + 44 + len(filas) * 62 + 4, b)


def circulo():
    may = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F']
    men = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm']
    alt = ['0', '1#', '2#', '3#', '4#', '5#', '6#', '5b', '4b', '3b', '2b', '1b']
    cx = cy = 450
    b = ''
    for r in (430, 320, 215, 130):
        b += '<circle cx="%d" cy="%d" r="%d" fill="%s" stroke="#000" stroke-width="2.5"/>' % (cx, cy, r, '#fff' if r != 215 else '#fff')
    for i in range(12):
        a = math.radians(i * 30 - 90)
        a2 = math.radians(i * 30 - 75)
        b += '<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="#000" stroke-width="1.5"/>' % (
            cx + 130 * math.cos(a2), cy + 130 * math.sin(a2), cx + 430 * math.cos(a2), cy + 430 * math.sin(a2))
        b += txt(cx + 375 * math.cos(a), cy + 375 * math.sin(a) + 18, may[i], 50, peso='bold')
        b += txt(cx + 268 * math.cos(a), cy + 268 * math.sin(a) + 12, men[i], 32)
        b += txt(cx + 172 * math.cos(a), cy + 172 * math.sin(a) + 9, alt[i], 25, col='#333')
    b += txt(cx, cy - 22, 'quintas', 26) + txt(cx, cy + 10, 'hacia la', 22) + txt(cx, cy + 42, 'derecha →', 26)
    return svg(900, 900, b)
