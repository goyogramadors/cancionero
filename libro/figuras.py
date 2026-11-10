# -*- coding: utf-8 -*-
"""Lista de figuras del libro: nombre -> SVG."""
from dibujos import *

C3, C4, C5 = 48, 60, 72
FIG = {}


def m(raiz, semis, etiquetas):
    return dict(zip([raiz + s for s in semis], etiquetas))


def acorde_tec(nombre, raiz_midi, tipo, lo=C4, hi=83, titulo=None, grados=None):
    notas = deletrear(nombre, ACO[tipo])
    semis = [s for _, s in ACO[tipo]]
    return teclado(lo, hi, m(raiz_midi, semis, grados or [lat(n) for n in notas]), titulo=titulo)


# ---- 1. Las notas
FIG['tec-blancas'] = teclado(C3, 83, {C3: 'Do', C4: 'Do', C5: 'Do'}, nombres=True)
FIG['tec-negras'] = teclado(C4, C5, {61: 'Do#', 63: 'Re#', 66: 'Fa#', 68: 'Sol#', 70: 'La#'}, nombres=True, kw=96)
FIG['tec-registro'] = teclado(36, 84, {36: '2', 48: '3', 60: '4', 72: '5', 84: '6'},
                              llaves=[(36, 59, 'mano izquierda: bajos'), (60, 84, 'mano derecha: acordes y melodía')])
FIG['mastil-aire'] = mastil([(6, 0, 'Mi', True), (5, 0, 'La', True), (4, 0, 'Re', True), (3, 0, 'Sol', True), (2, 0, 'Si', True), (1, 0, 'Mi', True)], trastes=5)
FIG['mastil-todas'] = mastil(todas=True)
FIG['mastil-65'] = mastil([(6, t, lat(SOST[(40 + t) % 12]), True) for t in (0, 1, 3, 5, 7, 8, 10, 12)] +
                          [(5, t, lat(SOST[(45 + t) % 12]), True) for t in (0, 2, 3, 5, 7, 8, 10, 12)])

# ---- 2. Tonos y semitonos
FIG['tec-semitonos'] = teclado(C4, C5, {60 + i: str(i) for i in range(13)}, nombres=True, kw=96)
FIG['mastil-semitonos'] = mastil([(5, t, lat(SOST[(45 + t) % 12]), '#' not in SOST[(45 + t) % 12]) for t in range(13)])

# ---- 3. Intervalos
FIG['tabla-intervalos'] = tabla([
    ['Semitonos', 'Intervalo', 'Abreviatura', 'Desde Do'],
    ['1', 'segunda menor', '2m', 'Reb'], ['2', 'segunda mayor', '2M', 'Re'],
    ['3', 'tercera menor', '3m', 'Mib'], ['4', 'tercera mayor', '3M', 'Mi'],
    ['5', 'cuarta justa', '4J', 'Fa'], ['6', 'tritono', '4aum / 5dim', 'Fa# / Solb'],
    ['7', 'quinta justa', '5J', 'Sol'], ['8', 'sexta menor', '6m', 'Lab'],
    ['9', 'sexta mayor', '6M', 'La'], ['10', 'séptima menor', '7m', 'Sib'],
    ['11', 'séptima mayor', '7M', 'Si'], ['12', 'octava', '8J', 'Do']], [170, 280, 210, 200], resaltar=(0,))
FIG['tec-terceras'] = teclado(C4, C5, {60: 'Do', 63: '3m', 64: '3M', 67: '5J', 72: '8'}, nombres=True, kw=96)
FIG['mastil-intervalos'] = mastil([(6, 3, '1', True), (5, 1, '3m', False), (5, 2, '3M', False), (5, 3, '4J', False),
                                   (5, 5, '5J', False), (4, 5, '8', True), (4, 2, '6M', False), (4, 3, '7m', False), (4, 4, '7M', False)], trastes=7)

# ---- 4. Escala mayor
G8 = ['1', '2', '3', '4', '5', '6', '7', '8']
TS = ['T', 'T', 'S', 'T', 'T', 'T', 'S']


def tira_esc(raiz, esc, saltos, grados=None, octava=True):
    ns = deletrear(raiz, ESC[esc])
    if octava:
        ns = ns + [ns[0]]
    return tira([lat(n) for n in ns], saltos, grados)


def tec_esc(raiz, raiz_midi, esc, lo=C4, hi=None, octava=True, etiquetas=None):
    ns = deletrear(raiz, ESC[esc])
    semis = [s for _, s in ESC[esc]]
    if octava:
        ns, semis = ns + [ns[0]], semis + [12]
    hi = hi or (raiz_midi + 12 + (0 if (raiz_midi % 12) in BLANCAS else 1))
    lo2 = lo
    return teclado(lo2, max(hi, lo + 12), m(raiz_midi, semis, etiquetas or [lat(n) for n in ns]), kw=64)


FIG['tira-do-mayor'] = tira_esc('C', 'mayor', TS, G8)
FIG['tec-do-mayor'] = tec_esc('C', 60, 'mayor', hi=76)
FIG['tira-sol-mayor'] = tira_esc('G', 'mayor', TS, G8)
FIG['tec-sol-mayor'] = tec_esc('G', 55, 'mayor', lo=53, hi=69)
FIG['tira-fa-mayor'] = tira_esc('F', 'mayor', TS, G8)
FIG['tec-fa-mayor'] = tec_esc('F', 53, 'mayor', lo=53, hi=67)
FIG['mastil-mi-mayor-cuerda'] = mastil([(6, t, n, i in (0, 7)) for i, (t, n) in enumerate(zip([0, 2, 4, 5, 7, 9, 11, 12], [lat(x) for x in deletrear('E', ESC['mayor'])] + ['Mi']))])
FIG['mastil-do-mayor'] = mastil([(5, 3, 'Do', True), (4, 0, 'Re', False), (4, 2, 'Mi', False), (4, 3, 'Fa', False),
                                 (3, 0, 'Sol', False), (3, 2, 'La', False), (2, 0, 'Si', False), (2, 1, 'Do', True)], trastes=5)
TONOS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'F', 'Bb', 'Eb', 'Ab', 'Db']
ARM = ['—', '1 #', '2 #', '3 #', '4 #', '5 #', '6 #', '1 b', '2 b', '3 b', '4 b', '5 b']
FIG['tabla-escalas-mayores'] = tabla(
    [['Tono', '1', '2', '3', '4', '5', '6', '7', 'Alter.']] +
    [[t] + [lat(n) for n in deletrear(t, ESC['mayor'])] + [ARM[i]] for i, t in enumerate(TONOS)],
    [110, 100, 100, 100, 100, 100, 100, 100, 110], negrita_col0=True, resaltar=(0,))

# ---- 5. Círculo de quintas
FIG['circulo'] = circulo()

# ---- 6. Tríadas
FIG['tec-C'] = teclado(C4, C5, {60: 'Do', 64: 'Mi', 67: 'Sol'}, kw=96, llaves=[(60, 64, '4 semitonos (3M)'), (64, 67, '3 semit. (3m)')])
FIG['tec-Cm'] = teclado(C4, C5, {60: 'Do', 63: 'Mib', 67: 'Sol'}, kw=96, llaves=[(60, 63, '3 semit. (3m)'), (63, 67, '4 semitonos (3M)')])
FIG['tabla-triadas'] = tabla([
    ['Tríada', 'Cifrado', 'Receta', 'Desde Do', 'Carácter'],
    ['mayor', 'C', '4 + 3', 'Do Mi Sol', 'luminoso, estable'],
    ['menor', 'Cm', '3 + 4', 'Do Mib Sol', 'oscuro, íntimo'],
    ['disminuida', 'Cº o Cdim', '3 + 3', 'Do Mib Solb', 'tenso, inestable'],
    ['aumentada', 'C+ o Caug', '4 + 4', 'Do Mi Sol#', 'flotante, raro']], [170, 170, 110, 190, 240], t=21, negrita_col0=True)
FIG['tec-D'] = acorde_tec('D', 62, '', titulo='D = Re Fa# La')
FIG['tec-Am'] = acorde_tec('A', 57, 'm', lo=53, hi=72, titulo='Am = La Do Mi')
FIG['git-mayores'] = cajas([('C', 'x32010'), ('A', 'x02220'), ('G', '320003'), ('E', '022100'), ('D', 'xx0232')], 3)
FIG['git-menores'] = cajas([('Am', 'x02210'), ('Em', '022000'), ('Dm', 'xx0231')], 3)
FIG['como-leer-caja'] = cajas([('C', 'x32010')], 1)

# ---- 7. Inversiones
FIG['tec-inv0'] = teclado(C4, 79, {60: 'Do', 64: 'Mi', 67: 'Sol'}, titulo='Estado fundamental: Do – Mi – Sol')
FIG['tec-inv1'] = teclado(C4, 79, {64: 'Mi', 67: 'Sol', 72: 'Do'}, titulo='1ª inversión: Mi – Sol – Do')
FIG['tec-inv2'] = teclado(C4, 79, {67: 'Sol', 72: 'Do', 76: 'Mi'}, titulo='2ª inversión: Sol – Do – Mi')
FIG['tec-enlace-C'] = teclado(C4, 79, {67: 'Sol', 72: 'Do', 76: 'Mi'}, titulo='C (2ª inversión)')
FIG['tec-enlace-F'] = teclado(C4, 79, {69: 'La', 72: 'Do', 77: 'Fa'}, titulo='F (1ª inversión): Do se queda')
FIG['tec-enlace-G'] = teclado(C4, 79, {67: 'Sol', 71: 'Si', 74: 'Re'}, titulo='G (fundamental): todo baja un paso')
FIG['git-bajos'] = cajas([('C/G', '332010'), ('D/F#', '2x0232'), ('G/B', 'x20003'), ('Am/G', '3x2210')], 4)

# ---- 8. Séptimas y otros
FIG['tabla-septimas'] = tabla([
    ['Acorde', 'Cifrado', 'Tríada + 7ª', 'Desde Do', 'Dónde aparece'],
    ['séptima mayor', 'Cmaj7', 'mayor + 7M', 'Do Mi Sol Si', 'I y IV: bossa, balada'],
    ['dominante', 'C7', 'mayor + 7m', 'Do Mi Sol Sib', 'V: pide resolver; blues'],
    ['menor séptima', 'Cm7', 'menor + 7m', 'Do Mib Sol Sib', 'ii, iii, vi: suave'],
    ['semidisminuido', 'Cm7b5', 'dim. + 7m', 'Do Mib Solb Sib', 'vii; ii del tono menor']], [210, 130, 180, 220, 280], t=20, negrita_col0=True)
FIG['tec-Cmaj7'] = acorde_tec('C', 60, 'maj7', titulo='Cmaj7 = Do Mi Sol Si')
FIG['tec-C7'] = acorde_tec('C', 60, '7', titulo='C7 = Do Mi Sol Sib')
FIG['tec-Cm7'] = acorde_tec('C', 60, 'm7', titulo='Cm7 = Do Mib Sol Sib')
FIG['tec-G7-C'] = teclado(C4, 79, {65: 'Fa', 67: 'Sol', 71: 'Si', 74: 'Re'}, titulo='G7 (Sol Si Re Fa): Si y Fa forman un tritono')
FIG['git-dom7'] = cajas([('A7', 'x02020'), ('D7', 'xx0212'), ('E7', '020100'), ('G7', '320001'), ('C7', 'x32310'), ('B7', 'x21202')], 3)
FIG['git-maj7-m7'] = cajas([('Cmaj7', 'x32000'), ('Fmaj7', 'xx3210'), ('Gmaj7', '320002'), ('Am7', 'x02010'), ('Em7', '022030'), ('Dm7', 'xx0211')], 3)
FIG['tec-sus'] = teclado(C4, C5, {60: 'Do', 62: 'sus2', 64: '3ª', 65: 'sus4', 67: 'Sol'}, kw=96)
FIG['git-sus'] = cajas([('Dsus2', 'xx0230'), ('D', 'xx0232'), ('Dsus4', 'xx0233'), ('Asus2', 'x02200'), ('A', 'x02220'), ('Asus4', 'x02230')], 3)
FIG['tec-dim'] = teclado(C4, 79, {71: 'Si', 74: 'Re', 77: 'Fa'}, titulo='Bº (Si disminuido) = Si Re Fa')
FIG['tec-aug'] = teclado(C4, 79, {60: 'Do', 64: 'Mi', 68: 'Sol#'}, titulo='C+ (Do aumentado) = Do Mi Sol#')

# ---- 9. Escalas menores
FIG['tira-la-menor'] = tira_esc('A', 'menor', ['T', 'S', 'T', 'T', 'S', 'T', 'T'], G8)
FIG['tec-relativas'] = teclado(53, 76, {57: 'La', 59: 'Si', 60: 'Do', 62: 'Re', 64: 'Mi', 65: 'Fa', 67: 'Sol', 69: 'La', 71: 'Si', 72: 'Do'},
                               llaves=[(57, 69, 'La menor'), (60, 72, 'Do mayor')])
FIG['tira-la-armonica'] = tira_esc('A', 'armonica', ['T', 'S', 'T', 'T', 'S', 'T+S', 'S'], ['1', '2', 'b3', '4', '5', 'b6', '7', '8'])
FIG['tabla-mayor-menor'] = tabla([
    ['Grado', '1', '2', '3', '4', '5', '6', '7'],
    ['Do mayor', 'Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'],
    ['Do menor', 'Do', 'Re', 'Mib', 'Fa', 'Sol', 'Lab', 'Sib'],
    ['Do menor armónica', 'Do', 'Re', 'Mib', 'Fa', 'Sol', 'Lab', 'Si']], [300, 95, 95, 95, 95, 95, 95, 95], negrita_col0=True, resaltar=(3, 6, 7))

# ---- 10. Pentatónicas y blues
FIG['tira-penta-do'] = tira([lat(n) for n in deletrear('C', ESC['penta'])] + ['Do'], ['T', 'T', 'T+S', 'T', 'T+S'], ['1', '2', '3', '5', '6', '8'])
FIG['tira-pentam-la'] = tira([lat(n) for n in deletrear('A', ESC['pentam'])] + ['La'], ['T+S', 'T', 'T', 'T+S', 'T'], ['1', 'b3', '4', '5', 'b7', '8'])
FIG['tec-penta-negras'] = teclado(C4, 83, {66: 'Fa#', 68: 'Sol#', 70: 'La#', 73: 'Do#', 75: 'Re#', 78: 'Fa#'})
FIG['mastil-pentam-la'] = mastil([(6, 5, 'La', True), (6, 8, 'Do', False), (5, 5, 'Re', False), (5, 7, 'Mi', False),
                                  (4, 5, 'Sol', False), (4, 7, 'La', True), (3, 5, 'Do', False), (3, 7, 'Re', False),
                                  (2, 5, 'Mi', False), (2, 8, 'Sol', False), (1, 5, 'La', True), (1, 8, 'Do', False)], trastes=7, desde=3)
FIG['tira-blues-la'] = tira(['La', 'Do', 'Re', 'Mib', 'Mi', 'Sol', 'La'], ['T+S', 'T', 'S', 'S', 'T+S', 'T'], ['1', 'b3', '4', 'b5', '5', 'b7', '8'])
FIG['mastil-blues-la'] = mastil([(6, 5, 'La', True), (6, 8, 'Do', False), (5, 5, 'Re', False), (5, 6, 'Mib', False), (5, 7, 'Mi', False),
                                 (4, 5, 'Sol', False), (4, 7, 'La', True), (3, 5, 'Do', False), (3, 7, 'Re', False), (3, 8, 'Mib', False),
                                 (2, 5, 'Mi', False), (2, 8, 'Sol', False), (1, 5, 'La', True), (1, 8, 'Do', False)], trastes=7, desde=3)

# ---- 11. Modos
FIG['tabla-modos'] = tabla([
    ['Escala', '1', '2', '3', '4', '5', '6', '7', 'Color'],
    ['Mayor', '1', '2', '3', '4', '5', '6', '7', 'alegre'],
    ['Mixolidia', '1', '2', '3', '4', '5', '6', 'b7', 'rock, blues'],
    ['Dórica', '1', '2', 'b3', '4', '5', '6', 'b7', 'menor claro'],
    ['Menor natural', '1', '2', 'b3', '4', '5', 'b6', 'b7', 'triste']], [220, 70, 70, 70, 70, 70, 70, 70, 220], negrita_col0=True)
FIG['tira-re-dorica'] = tira_esc('D', 'dorica', ['T', 'S', 'T', 'T', 'T', 'S', 'T'], ['1', '2', 'b3', '4', '5', '6', 'b7', '8'])
FIG['tira-sol-mixo'] = tira_esc('G', 'mixo', ['T', 'T', 'S', 'T', 'T', 'S', 'T'], ['1', '2', '3', '4', '5', '6', 'b7', '8'])

# ---- 12. Campo armónico
ROM = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'viiº']
CAL = ['', 'm', 'm', '', '', 'm', 'º']


def campo(t):
    return [n + c for n, c in zip(deletrear(t, ESC['mayor']), CAL)]


FIG['tabla-campo-do'] = tabla([
    ['Grado'] + ROM,
    ['Acorde'] + campo('C'),
    ['Notas', 'Do Mi Sol', 'Re Fa La', 'Mi Sol Si', 'Fa La Do', 'Sol Si Re', 'La Do Mi', 'Si Re Fa'],
    ['Función', 'tónica', 'subdom.', 'tónica', 'subdom.', 'dominante', 'tónica', 'dominante']],
    [130, 128, 128, 128, 128, 128, 128, 128], t=18, negrita_col0=True, resaltar=(1, 4, 5))
FIG['tec-campo-do'] = teclado(C4, 83, {60: 'Do', 64: 'Mi', 67: 'Sol', 69: 'La', 72: 'Do', 76: 'Mi'},
                              llaves=[(60, 67, 'C: una sí, una no'), (69, 76, 'Am: lo mismo desde La')])
FIG['tabla-campo-12'] = tabla([['Tono'] + ROM] + [[t] + campo(t) for t in TONOS],
                              [110, 115, 115, 115, 115, 115, 115, 115], negrita_col0=True, resaltar=(1, 4, 5))
ROMm = ['i', 'iiº', 'III', 'iv', 'V', 'VI', 'VII']
CALm = ['m', 'º', '', 'm', '', '', '']


def campo_m(t):
    return [n + c for n, c in zip(deletrear(t, ESC['menor']), CALm)]


TONOSm = ['A', 'E', 'B', 'F#', 'C#', 'D', 'G', 'C', 'F']
FIG['tabla-campo-menor'] = tabla([['Tono'] + ROMm] + [[t + 'm'] + campo_m(t) for t in TONOSm],
                                 [110, 115, 115, 115, 115, 115, 115, 115], negrita_col0=True, resaltar=(1, 4, 5))
FIG['git-campo-do'] = cajas([('C', 'x32010'), ('Dm', 'xx0231'), ('Em', '022000'), ('F', 'xx3211'), ('G', '320003'), ('Am', 'x02210')], 3)
FIG['git-campo-sol'] = cajas([('G', '320003'), ('Am', 'x02210'), ('Bm', 'x24432', (2, 5, 1)), ('C', 'x32010'), ('D', 'xx0232'), ('Em', '022000')], 3)

# ---- 13. Progresiones
def prog_tabla(nombre_grados, idx, tonos, menor=False):
    f = [['Tono'] + nombre_grados]
    for t in tonos:
        c = campo_m(t) if menor else campo(t)
        f.append([t + ('m' if menor else '')] + [c[i] for i in idx])
    return tabla(f, [150] + [170] * len(idx), negrita_col0=True)


FIG['prog-folk'] = prog_tabla(['I', 'IV', 'V', 'I'], [0, 3, 4, 0], ['C', 'G', 'D', 'A', 'E'])
FIG['prog-pop'] = prog_tabla(['I', 'V', 'vi', 'IV'], [0, 4, 5, 3], ['C', 'G', 'D', 'A', 'E'])
FIG['prog-50'] = prog_tabla(['I', 'vi', 'IV', 'V'], [0, 5, 3, 4], ['C', 'G', 'D', 'A', 'E'])
FIG['prog-menor'] = prog_tabla(['i', 'iv', 'V', 'i'], [0, 3, 4, 0], ['A', 'E', 'D', 'B'], menor=True)
FIG['prog-andaluza'] = prog_tabla(['i', 'VII', 'VI', 'V'], [0, 6, 5, 4], ['A', 'E', 'D', 'B'], menor=True)
FIG['prog-iivi'] = tabla([['Tono', 'ii', 'V', 'I'], ['C', 'Dm7', 'G7', 'Cmaj7'], ['G', 'Am7', 'D7', 'Gmaj7'],
                          ['F', 'Gm7', 'C7', 'Fmaj7'], ['D', 'Em7', 'A7', 'Dmaj7']], [150, 190, 190, 190], negrita_col0=True)
FIG['blues-12'] = tabla([['A7', 'A7', 'A7', 'A7'], ['D7', 'D7', 'A7', 'A7'], ['E7', 'D7', 'A7', 'E7']], [200, 200, 200, 200], cab=False, t=28, alto=70,
                        titulo='Blues de 12 compases en La (un acorde por compás)')

# ---- 14. Transponer y cejillo
FIG['tabla-transponer'] = tabla([
    ['Grado', 'I', 'ii', 'iii', 'IV', 'V', 'vi'],
    ['Original: G'] + campo('G')[:6],
    ['Sube 2 trastes: A'] + campo('A')[:6],
    ['Baja a E'] + campo('E')[:6],
    ['Baja a D'] + campo('D')[:6],
    ['En C'] + campo('C')[:6]], [290, 110, 110, 110, 110, 110, 110], negrita_col0=True)
FIG['rueda-12'] = tabla([['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'],
                         ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
                         ['', 'Db', '', 'Eb', '', '', 'Gb', '', 'Ab', '', 'Bb', '']], [80] * 12, t=24)
FIG['tabla-cejillo'] = tabla([
    ['Formas de…', 'sin', 'traste 1', 'traste 2', 'traste 3', 'traste 4', 'traste 5'],
    ['C', 'C', 'C#/Db', 'D', 'Eb', 'E', 'F'],
    ['G', 'G', 'Ab', 'A', 'Bb', 'B', 'C'],
    ['D', 'D', 'Eb', 'E', 'F', 'F#', 'G'],
    ['A', 'A', 'Bb', 'B', 'C', 'C#/Db', 'D'],
    ['E', 'E', 'F', 'F#', 'G', 'Ab', 'A'],
    ['Am', 'Am', 'Bbm', 'Bm', 'Cm', 'C#m', 'Dm'],
    ['Em', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am']], [190, 110, 135, 135, 135, 135, 135], negrita_col0=True, resaltar=(0,))

# ---- 15. Ritmo
C8 = ['1', 'y', '2', 'y', '3', 'y', '4', 'y']
C6 = ['1', 'y', '2', 'y', '3', 'y']
C68 = ['1', '2', '3', '4', '5', '6']


def pasos(s, mapa=None):
    mapa = mapa or {}
    return [mapa.get(ch, '' if ch == '.' else ch) for ch in s]


AC = {'A': 'ac.', 'B': 'bajo', '5': '5ª', '8': '8ª'}
FIG['figuras'] = tabla([['Figura', 'Dura', 'En un compás de 4/4', 'Se cuenta'],
                        ['redonda', '4 tiempos', '1', '1 – – –'], ['blanca', '2 tiempos', '2', '1 – 3 –'],
                        ['negra', '1 tiempo', '4', '1 2 3 4'], ['corchea', '½ tiempo', '8', '1 y 2 y 3 y 4 y'],
                        ['semicorchea', '¼ de tiempo', '16', '1 e y a 2 e y a…']], [210, 190, 300, 260], t=21, negrita_col0=True)
FIG['rit-negras'] = ritmo(C8, [('M. derecha', pasos('A.A.A.A.', AC)), ('M. izquierda', pasos('B...B...', AC))], 'Balada en negras (4/4)')
FIG['rit-corcheas'] = ritmo(C8, [('M. derecha', pasos('AAAAAAAA', AC)), ('M. izquierda', pasos('B...B...', AC))], 'Pop en corcheas (4/4)')
FIG['rit-arpegio'] = ritmo(C8, [('M. derecha', pasos('.135831.')), ('M. izquierda', pasos('B.......', AC))], 'Balada arpegiada (4/4)')
FIG['rit-vals'] = ritmo(C6, [('M. derecha', pasos('..A.A.', AC)), ('M. izquierda', pasos('B.....', AC))], 'Vals (3/4)')
FIG['rit-68'] = ritmo(C68, [('M. derecha', pasos('.AA.AA', AC)), ('M. izquierda', pasos('B..5..', AC))], '6/8: cueca, tonada')
FIG['rit-bolero'] = ritmo(C8, [('M. derecha', pasos('A..A..A.', AC)), ('M. izquierda', pasos('B...5...', AC))], 'Bolero / tresillo 3+3+2 (4/4)')
FIG['rit-cumbia'] = ritmo(C8, [('M. derecha', pasos('.A.A.A.A', AC)), ('M. izquierda', pasos('B.5.B.5.', AC))], 'Cumbia (4/4)')
FIG['rit-reggae'] = ritmo(C8, [('M. derecha', pasos('..A...A.', AC)), ('M. izquierda', pasos('B.......', AC))], 'Reggae (4/4)')
FIG['ras-basico'] = ritmo(C8, [('Rasgueo', pasos('↓.↓.↓.↓.'))], 'Guitarra: negras, todo hacia abajo')
FIG['ras-corcheas'] = ritmo(C8, [('Rasgueo', pasos('↓↑↓↑↓↑↓↑'))], 'Guitarra: corcheas, abajo y arriba')
FIG['ras-pop'] = ritmo(C8, [('Rasgueo', pasos('↓.↓↑.↑↓↑'))], 'Guitarra: el rasgueo de fogata')
FIG['ras-vals'] = ritmo(C6, [('Rasgueo', ['bajo', '', '↓', '', '↓', ''])], 'Guitarra: vals (3/4)')
FIG['ras-68'] = ritmo(C68, [('Rasgueo', pasos('↓.↓↑↓↑'))], 'Guitarra: 6/8')
FIG['ras-reggae'] = ritmo(C8, [('Rasgueo', pasos('..↓...↓.'))], 'Guitarra: reggae (golpes cortos)')

# ---- 16. Cejilla
FIG['git-cejilla-E'] = cajas([('E', '022100'), ('F', '133211', (1, 6, 1)), ('G', '355433', (3, 6, 1)), ('A', '577655', (5, 6, 1))], 4)
FIG['git-cejilla-Em'] = cajas([('Em', '022000'), ('Fm', '133111', (1, 6, 1)), ('F#m', '244222', (2, 6, 1)), ('Gm', '355333', (3, 6, 1))], 4)
FIG['git-cejilla-A'] = cajas([('A', 'x02220'), ('Bb', 'x13331', (1, 5, 1)), ('B', 'x24442', (2, 5, 1)), ('C', 'x35553', (3, 5, 1))], 4)
FIG['git-cejilla-Am'] = cajas([('Am', 'x02210'), ('Bbm', 'x13321', (1, 5, 1)), ('Bm', 'x24432', (2, 5, 1)), ('Cm', 'x35543', (3, 5, 1))], 4)
FIG['tabla-cejilla'] = tabla([
    ['Traste', '0', '1', '2', '3', '4', '5', '6', '7', '8'],
    ['6ª cuerda', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B', 'C'],
    ['5ª cuerda', 'A', 'Bb', 'B', 'C', 'C#', 'D', 'Eb', 'E', 'F']], [190, 85, 85, 85, 85, 85, 85, 85, 85, 85], negrita_col0=True)
FIG['git-quinta'] = cajas([('G5', '355xxx'), ('A5', '577xxx'), ('C5', 'x355xx'), ('D5', 'x577xx')], 4)

# ---- Apéndices
RAI = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']


def ns(r, t):
    return ' '.join(lat(n) for n in deletrear(r, ACO[t]))


FIG['ap-triadas'] = tabla([['Raíz', 'Mayor', 'Menor (m)', 'Dism. (º)', 'Aum. (+)']] +
                          [[r, ns(r, ''), ns(r, 'm'), ns(r, 'dim'), ns(r, 'aug')] for r in RAI], [110, 220, 220, 230, 230], t=20, negrita_col0=True, resaltar=(0,))
FIG['ap-septimas'] = tabla([['Raíz', 'maj7', '7', 'm7']] +
                           [[r, ns(r, 'maj7'), ns(r, '7'), ns(r, 'm7')] for r in RAI], [110, 300, 300, 300], t=20, negrita_col0=True, resaltar=(0,))
FIG['ap-git-1'] = cajas([('C', 'x32010'), ('D', 'xx0232'), ('E', '022100'), ('F', '133211', (1, 6, 1)),
                         ('G', '320003'), ('A', 'x02220'), ('B', 'x24442', (2, 5, 1)), ('Bb', 'x13331', (1, 5, 1))], 4)
FIG['ap-git-2'] = cajas([('Cm', 'x35543', (3, 5, 1)), ('Dm', 'xx0231'), ('Em', '022000'), ('Fm', '133111', (1, 6, 1)),
                         ('Gm', '355333', (3, 6, 1)), ('Am', 'x02210'), ('Bm', 'x24432', (2, 5, 1)), ('F#m', '244222', (2, 6, 1))], 4)
FIG['ap-git-3'] = cajas([('C7', 'x32310'), ('D7', 'xx0212'), ('E7', '020100'), ('F7', '131211', (1, 6, 1)),
                         ('G7', '320001'), ('A7', 'x02020'), ('B7', 'x21202'), ('Bm7', 'x24232', (2, 5, 1))], 4)

if __name__ == '__main__':
    import os, sys
    d = sys.argv[1]
    os.makedirs(d, exist_ok=True)
    for k, v in FIG.items():
        open(os.path.join(d, k + '.svg'), 'w', encoding='utf-8').write(v)
    print(len(FIG), 'figuras')
