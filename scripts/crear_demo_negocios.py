"""
Crea los negocios pequeños de demostración usando la API (solo para desarrollo, con las credenciales del README):

  * Salón Bella (plan Gratis): una sola cola; la dueña llama y emite tickets desde el celular.
  * Dental Sonrisa (plan Emprende): dos médicos, dos colas y un operador por consultorio.

Uso: python scripts/crear_demo_negocios.py [http://localhost:8080]
"""
import http.cookiejar
import json
import sys
import urllib.request

B = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'http://localhost:8080'
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def pedir(metodo, ruta, cuerpo=None, token=None):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    r = urllib.request.Request(B + ruta, data=datos, method=metodo, headers={'Content-Type': 'application/json'})
    if token:
        r.add_header('Authorization', 'Bearer ' + token)
    try:
        with op.open(r) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())

planes = {p['codigo']: p['id'] for p in pedir('POST', '/api/v1/auth/login', {'email': 'superadmin@turnoya.pe', 'password': 'admin123'}) and pedir('GET', '/api/v1/planes')['data']}

negocios = [
    dict(slug='salon-bella', nombreComercial='Salón Bella', razonSocial='Bella Estilos E.I.R.L.', rubro='Belleza', ciudad='Juliaca',
         planId=planes['GRATIS'], colorPrimario='#db2777', adminNombre='Rosa Quispe', adminEmail='admin@salonbella.pe', adminPassword='admin123'),
    dict(slug='dental-sonrisa', nombreComercial='Dental Sonrisa', razonSocial='Clínica Dental Sonrisa S.A.C.', rubro='Salud', ciudad='Juliaca',
         planId=planes['EMPRENDE'], colorPrimario='#0284c7', adminNombre='Dra. Lucía Ríos', adminEmail='admin@dentalsonrisa.pe', adminPassword='admin123'),
]
for n in negocios:
    print(n['slug'], pedir('POST', '/api/v1/locales', n).get('ok'), '(ya existe si False)')

sin_cookies = urllib.request.build_opener()

def pedir_app(metodo, ruta, cuerpo=None, token=None):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    r = urllib.request.Request(B + ruta, data=datos, method=metodo, headers={'Content-Type': 'application/json'})
    if token:
        r.add_header('Authorization', 'Bearer ' + token)
    try:
        with sin_cookies.open(r) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())

def token(email, clave):
    r = pedir_app('POST', '/api/v1/auth/movil', {'email': email, 'password': clave})
    assert r.get('ok'), r
    return r['data']['token']

# Salón: una sola cola y su ventanilla; la dueña hace todo desde el celular
t = token('admin@salonbella.pe', 'admin123')
colas = pedir_app('GET', '/api/v1/colas', token=t)['data']
print('salon colas', [(c['nombre'], [v['nombre'] for v in c['ventanillas']]) for c in colas])
c = colas[0]
print('salon', pedir_app('PATCH', '/api/v1/colas/%d' % c['id'], {'nombre': 'Atención', 'prefijo': 'S'}, token=t).get('ok'))
v = pedir_app('GET', '/api/v1/ventanillas', token=t)['data'][0]
print('salon v', pedir_app('PATCH', '/api/v1/ventanillas/%d' % v['id'], {'nombre': 'Sillón 1'}, token=t).get('ok'))

# Dental: dos médicos, dos colas, un operador por consultorio
t = token('admin@dentalsonrisa.pe', 'admin123')
colas = pedir_app('GET', '/api/v1/colas', token=t)['data']
print('dental colas', [c['nombre'] for c in colas])
print(pedir_app('PATCH', '/api/v1/colas/%d' % colas[0]['id'], {'nombre': 'Dra. Ríos', 'prefijo': 'R'}, token=t).get('ok'))
print(pedir_app('POST', '/api/v1/colas', {'prefijo': 'P', 'nombre': 'Dr. Paredes'}, token=t))
ventanillas = {v['cola']['nombre']: v['id'] for v in pedir_app('GET', '/api/v1/ventanillas', token=t)['data'] if v.get('cola')}
print(ventanillas)
for cola, vent in [('Dra. Ríos', 'Consultorio 1'), ('Dr. Paredes', 'Consultorio 2')]:
    pedir_app('PATCH', '/api/v1/ventanillas/%d' % ventanillas[cola], {'nombre': vent}, token=t)
for nombre, email, cola in [('Dra. Lucía Ríos (consultorio)', 'rios@dentalsonrisa.pe', 'Dra. Ríos'), ('Dr. Mario Paredes', 'paredes@dentalsonrisa.pe', 'Dr. Paredes')]:
    r = pedir_app('POST', '/api/v1/usuarios', {'nombre': nombre, 'email': email, 'password': 'operador123', 'rol': 'OPERADOR', 'activo': True,
                                               'ventanillaIds': [ventanillas[cola]]}, token=t)
    print(email, r.get('ok'), r.get('error'))

# Ejemplo de un día: algunos clientes ya esperan para que haya a quién llamar (solo si la cola está vacía)
def clientes_de_ejemplo(email, por_cola):
    t = token(email, 'admin123')
    panel = pedir_app('GET', '/api/v1/movil/panel', token=t)['data']
    for v in panel['ventanillas']:
        if v['enEspera'] > 0:
            continue
        for nombre in por_cola.get(v['cola'], []):
            r = pedir_app('POST', '/api/v1/turnos/ticket', {'colaId': v['colaId'], 'nombre': nombre}, token=t)
            print(panel['local'], v['cola'], r.get('data', {}).get('codigo'), r.get('error'))

clientes_de_ejemplo('admin@salonbella.pe', {'Atención': ['María (corte)', 'Lucía (tinte)', 'Carmen (manicure)']})
clientes_de_ejemplo('admin@dentalsonrisa.pe', {'Dra. Ríos': ['Juan Mamani (limpieza)', 'Rosa Condori (control)'], 'Dr. Paredes': ['Pedro Huanca (extracción)']})
