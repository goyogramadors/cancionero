# -*- coding: utf-8 -*-
"""Chequeo del paso curva -> plataformas. Correr: .venv\\Scripts\\python test_plataformas.py"""
import numpy as np
import prep


def nota(s, e, m):
    return {'s': s, 'e': e, 'm': float(m), 'vals': np.full(5, float(m))}


# 1) Un salto melodico real (Do, Do#, Sol agudo, Fa) no se pliega...
salto = prep._pegar_octavas_sueltas([nota(0, 1, 60), nota(1.1, 2, 61), nota(2.1, 3, 67), nota(3.1, 4, 65)])
assert [n['m'] for n in salto] == [60, 61, 67, 65], salto

# ...pero un error de octava (12 st arriba de AMBAS vecinas) si.
error = prep._pegar_octavas_sueltas([nota(0, 1, 60), nota(1.1, 2, 74), nota(2.1, 3, 62)])
assert [n['m'] for n in error] == [60, 62, 62], error

# 2) Un paso de un semitono sostenido 0.5 s parte la plataforma en dos,
#    y un vibrato de +-0.6 st a 5.5 Hz no la parte.
dtf = prep.HOP / prep.SR_MELODIA
n = int(1.0 / dtf)
t = np.arange(n) * dtf
paso = np.where(t < 0.5, 64.0, 65.0)
assert len(prep._segmentar_notas(paso, np.arange(n))) == 2

vibrato = 64.0 + 0.6 * np.sin(2 * np.pi * 5.5 * t)
assert len(prep._segmentar_notas(vibrato, np.arange(n))) == 1

print('plataformas OK')
