/**
 * Datos semilla de TurnoYa: 3 planes, 2 locales, usuarios, colas, ventanillas
 * y ~14 días de historial de turnos para alimentar los reportes.
 *
 *   npx prisma db seed      (o)      npm run db:seed
 */
import "dotenv/config";
import { PrismaClient, type EstadoTurno, type CanalTurno } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { cifrar, enmascararTelefono, generarToken, hashTelefono } from "../src/lib/crypto";
import { renderTurnoProximo } from "../src/lib/whatsapp";

const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

// --------------------------------------------------------------------------
// Utilidades
// --------------------------------------------------------------------------
let semilla = 20261002;
function rnd() {
  // LCG determinista para que la demo sea reproducible
  semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
  return semilla / 0x7fffffff;
}
const entre = (a: number, b: number) => Math.floor(rnd() * (b - a + 1)) + a;
const elegir = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];

function fechaLimaISO(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function fechaADate(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`);
}
function horaLima(iso: string, h: number, m: number, s = 0) {
  return new Date(`${iso}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}-05:00`);
}

// Únicas personas de ejemplo que hacen fila en la demo
const PERSONAS = [
  { nombre: "Jhan Logan", tel: "+51912067030" },
  { nombre: "Nick Saim", tel: "+51958787651" },
  { nombre: "David Romero", tel: "+51940893552" },
];

function clienteFalso() {
  return elegir(PERSONAS);
}

// --------------------------------------------------------------------------
async function main() {
  console.log("🧹 Limpiando datos previos…");
  await prisma.auditoria.deleteMany();
  await prisma.notificacion.deleteMany();
  await prisma.valoracion.deleteMany();
  await prisma.turno.updateMany({ data: { citaId: null, sucesorId: null, transferidoDeTurnoId: null } });
  await prisma.cita.deleteMany();
  await prisma.estadoPrioridadCola.deleteMany();
  await prisma.turno.deleteMany();
  await prisma.contadorCola.deleteMany();
  await prisma.cliente.deleteMany();
  await prisma.ventanilla.deleteMany();
  await prisma.cola.deleteMany();
  await prisma.horarioLocal.deleteMany();
  await prisma.configPrioridad.deleteMany();
  await prisma.categoriaPrioridad.deleteMany();
  await prisma.usuario.deleteMany();
  await prisma.local.deleteMany();
  await prisma.plan.deleteMany();

  console.log("📦 Planes…");
  const [gratis, emprende, pro] = await Promise.all([
    prisma.plan.create({
      data: { codigo: "GRATIS", nombre: "Gratis", precioMensual: 0, maxTurnosMes: 300, maxColas: 1, maxVentanillas: 1, whatsappHabilitado: false, maxAvisosWhatsapp: 0, reportes: false, descripcion: "1 cola, 1 ventanilla, hasta 300 turnos/mes, aviso por web (sin WhatsApp)" },
    }),
    prisma.plan.create({
      data: { codigo: "EMPRENDE", nombre: "Emprende", precioMensual: 69, maxTurnosMes: 5000, maxColas: 3, maxVentanillas: 3, whatsappHabilitado: true, maxAvisosWhatsapp: 1000, reportes: false, descripcion: "3 colas, 3 ventanillas, pantalla TV, 1 000 avisos WhatsApp" },
    }),
    prisma.plan.create({
      data: { codigo: "PRO", nombre: "Pro", precioMensual: 149, maxTurnosMes: 100000, maxColas: 99, maxVentanillas: 10, whatsappHabilitado: true, maxAvisosWhatsapp: 3000, reportes: true, descripcion: "Colas ilimitadas, 10 ventanillas, reportes, 3 000 avisos, soporte prioritario" },
    }),
  ]);
  void gratis;
  // Matriz plan × módulo (§7 del plan integral)
  await prisma.planModulo.createMany({
    data: [
      ...(["M1", "M3", "M4", "M6"] as const).map((modulo) => ({ planId: emprende.id, modulo })),
      ...(["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"] as const).map((modulo) => ({ planId: pro.id, modulo })),
    ],
  });

  console.log("🏥 Locales…");
  const poli = await prisma.local.create({
    data: {
      slug: "policlinico-san-roman",
      ruc: "20601234567",
      razonSocial: "Policlínico San Román S.A.C.",
      nombreComercial: "Policlínico San Román",
      rubro: "Salud",
      direccion: "Jr. San Román 452, Juliaca",
      telefono: "051-321456",
      planId: pro.id,
      colorPrimario: "#0f766e",
      mensajeTv: "Bienvenido. Mantenga su distancia y espere su llamado. Gracias por su preferencia.",
      mensajeBienvenida: "Toma tu turno y espera donde quieras: te avisamos por WhatsApp cuando falten 2 personas.",
      avisarFaltando: 2,
    },
  });
  const julsa = await prisma.local.create({
    data: {
      slug: "transportes-julsa",
      ruc: "20447654321",
      razonSocial: "Transportes Julsa E.I.R.L.",
      nombreComercial: "Transportes Julsa",
      rubro: "Transporte",
      direccion: "Av. Circunvalación 1230, Juliaca",
      telefono: "051-654987",
      planId: emprende.id,
      colorPrimario: "#1d4ed8",
      mensajeTv: "Compre su pasaje con anticipación. Buen viaje.",
      mensajeBienvenida: "Saca tu turno para venta de pasajes o encomiendas.",
      avisarFaltando: 2,
    },
  });

  console.log("⚖️  Prioridades y horario…");
  for (const localId of [poli.id, julsa.id]) {
    await prisma.categoriaPrioridad.createMany({
      data: [
        { localId, codigo: "GENERAL", nombre: "General", pesoBase: 0, orden: 0 },
        { localId, codigo: "ADULTO_MAYOR", nombre: "Adulto mayor (60+)", pesoBase: 60, documento: "DNI", orden: 1 },
        { localId, codigo: "GESTANTE", nombre: "Gestante", pesoBase: 60, documento: "CARNE_GESTANTE", orden: 2 },
        { localId, codigo: "DISCAPACIDAD", nombre: "Persona con discapacidad", pesoBase: 50, documento: "CONADIS", orden: 3 },
        { localId, codigo: "EMERGENCIA", nombre: "Emergencia", pesoBase: 100, absoluta: true, documento: "TRIAJE", visibleCliente: false, orden: 4 },
        { localId, codigo: "CITA", nombre: "Cita reservada", pesoBase: 80, visibleCliente: false, orden: 5 },
      ],
    });
    await prisma.configPrioridad.create({ data: { localId, alfaPuntosPorMin: 1.5, topeAdelantos: 3, agingActivo: true } });
    await prisma.horarioLocal.createMany({
      data: [1, 2, 3, 4, 5, 6].map((diaSemana) => ({ localId, diaSemana, apertura: "08:00", cierre: "20:00" })),
    });
  }

  // Módulos encendidos en la demo: todos los del plan de cada local
  for (const l of [poli, julsa]) {
    const incluidos = await prisma.planModulo.findMany({ where: { planId: l.planId } });
    await prisma.localModulo.createMany({ data: incluidos.map((m) => ({ localId: l.id, modulo: m.modulo, habilitado: true })) });
  }
  await prisma.local.update({ where: { id: poli.id }, data: { tiempoAusenciaSeg: 180 } });

  console.log("👤 Usuarios…");
  const hashAdmin = await bcrypt.hash("admin123", 10);
  const hashOper = await bcrypt.hash("operador123", 10);
  await prisma.usuario.createMany({
    data: [
      { email: "superadmin@turnoya.pe", hashPassword: hashAdmin, nombre: "Equipo TurnoYa", rol: "SUPER_ADMIN", localId: null },
      { email: "admin@policlinico.pe", hashPassword: hashAdmin, nombre: "Dra. Carmen Apaza", rol: "ADMIN_LOCAL", localId: poli.id },
      { email: "operador@policlinico.pe", hashPassword: hashOper, nombre: "Recepción · Lucía Quispe", rol: "OPERADOR", localId: poli.id },
      { email: "operador2@policlinico.pe", hashPassword: hashOper, nombre: "Laboratorio · Edwin Mamani", rol: "OPERADOR", localId: poli.id },
      { email: "admin@transportes.pe", hashPassword: hashAdmin, nombre: "Sr. Rubén Condori", rol: "ADMIN_LOCAL", localId: julsa.id },
      { email: "operador@transportes.pe", hashPassword: hashOper, nombre: "Ventanilla · Nancy Choque", rol: "OPERADOR", localId: julsa.id },
    ],
  });

  console.log("🪪 Colas y ventanillas…");
  const colaA = await prisma.cola.create({ data: { localId: poli.id, prefijo: "A", nombre: "Medicina General", descripcion: "Consulta médica general", tiempoAtencionBase: 420, orden: 1 } });
  const colaB = await prisma.cola.create({ data: { localId: poli.id, prefijo: "B", nombre: "Laboratorio", descripcion: "Toma de muestras y resultados", tiempoAtencionBase: 240, orden: 2 } });
  const colaC = await prisma.cola.create({ data: { localId: poli.id, prefijo: "C", nombre: "Admisión y Caja", descripcion: "Pagos, seguros y admisión", tiempoAtencionBase: 180, orden: 3 } });
  const vPoli = await Promise.all([
    prisma.ventanilla.create({ data: { localId: poli.id, nombre: "Consultorio 1", colaId: colaA.id } }),
    prisma.ventanilla.create({ data: { localId: poli.id, nombre: "Consultorio 2", colaId: colaA.id } }),
    prisma.ventanilla.create({ data: { localId: poli.id, nombre: "Laboratorio", colaId: colaB.id } }),
    prisma.ventanilla.create({ data: { localId: poli.id, nombre: "Caja 1", colaId: colaC.id } }),
  ]);

  const colaV = await prisma.cola.create({ data: { localId: julsa.id, prefijo: "V", nombre: "Venta de pasajes", descripcion: "Boletos interprovinciales", tiempoAtencionBase: 200, orden: 1 } });
  const colaE = await prisma.cola.create({ data: { localId: julsa.id, prefijo: "E", nombre: "Encomiendas", descripcion: "Envío y recojo de encomiendas", tiempoAtencionBase: 260, orden: 2 } });
  const vJulsa = await Promise.all([
    prisma.ventanilla.create({ data: { localId: julsa.id, nombre: "Ventanilla 1", colaId: colaV.id } }),
    prisma.ventanilla.create({ data: { localId: julsa.id, nombre: "Ventanilla 2", colaId: colaV.id } }),
    prisma.ventanilla.create({ data: { localId: julsa.id, nombre: "Encomiendas", colaId: colaE.id } }),
  ]);

  // Configuración de módulos para la demo: citas (M3), SLA (M7) y canal del bot (M4)
  await prisma.configCitas.createMany({ data: [colaA, colaB, colaC, colaV, colaE].map((c) => ({ colaId: c.id, activo: c.id === colaA.id || c.id === colaV.id })) });
  await prisma.categoriaPrioridad.updateMany({ where: { codigo: "CITA" }, data: { pesoBase: 40 } });
  await prisma.slaCola.createMany({ data: [colaA, colaB, colaC].map((c) => ({ colaId: c.id, esperaMaxMin: c.id === colaA.id ? 20 : 15, objetivoPct: 90 })) });
  await prisma.canalWhatsapp.createMany({ data: [{ localId: poli.id, proveedor: "openwa", identificador: process.env.OPENWA_SESSION ?? "turnoya", botActivo: true }] });

  // ------------------------------------------------------------------------
  // Historial de turnos (14 días) + turnos activos de hoy
  // ------------------------------------------------------------------------
  console.log("🕒 Generando historial de turnos (esto toma unos segundos)…");

  type ColaCfg = { cola: { id: number; prefijo: string; localId: number; tiempoAtencionBase: number }; ventanillas: { id: number }[]; volumen: [number, number] };
  const configs: ColaCfg[] = [
    { cola: colaA, ventanillas: [vPoli[0], vPoli[1]], volumen: [28, 48] },
    { cola: colaB, ventanillas: [vPoli[2]], volumen: [14, 26] },
    { cola: colaC, ventanillas: [vPoli[3]], volumen: [18, 32] },
    { cola: colaV, ventanillas: [vJulsa[0], vJulsa[1]], volumen: [30, 55] },
    { cola: colaE, ventanillas: [vJulsa[2]], volumen: [10, 20] },
  ];

  const hoyISO = fechaLimaISO(new Date());
  const ahora = new Date();
  const clientesCache = new Map<string, number>();

  // Un celular solo puede tener un turno activo por cola: si esa persona ya está activa en la cola, va sin celular
  const activosHoy = new Set<string>();
  async function crearClienteConTel(conTelefono: boolean, colaActiva?: number) {
    const { nombre, tel } = clienteFalso();
    const hash = hashTelefono(tel);
    const clave = `${colaActiva}:${hash}`;
    if (!conTelefono || (colaActiva !== undefined && activosHoy.has(clave))) {
      const c = await prisma.cliente.create({ data: { nombre } });
      return { id: c.id, tel: null };
    }
    if (colaActiva !== undefined) activosHoy.add(clave);
    const cached = clientesCache.get(hash);
    if (cached) return { id: cached, tel };
    const c = await prisma.cliente.create({ data: { nombre, telefonoHash: hash, telefonoCifrado: cifrar(tel) } });
    clientesCache.set(hash, c.id);
    return { id: c.id, tel };
  }
  const crearCliente = async (conTelefono: boolean, colaActiva?: number) => (await crearClienteConTel(conTelefono, colaActiva)).id;

  let totalTurnos = 0;
  const turnosData: Parameters<typeof prisma.turno.create>[0]["data"][] = [];

  for (let diasAtras = 14; diasAtras >= 1; diasAtras--) {
    const d = new Date(ahora.getTime() - diasAtras * 86400000);
    const iso = fechaLimaISO(d);
    const dow = new Date(`${iso}T12:00:00-05:00`).getDay();
    if (dow === 0) continue; // domingo cerrado

    for (const cfg of configs) {
      const n = Math.round(entre(cfg.volumen[0], cfg.volumen[1]) * (dow === 6 ? 0.6 : 1));
      let cursorAtencion = horaLima(iso, 7, 30).getTime();
      for (let i = 1; i <= n; i++) {
        // Llegadas concentradas en la mañana
        const minutosDesde7 = Math.min(720, Math.floor(Math.pow(rnd(), 1.6) * 660) + entre(0, 30));
        const emitido = new Date(horaLima(iso, 7, 0).getTime() + minutosDesde7 * 60000 + entre(0, 59) * 1000);
        const atencionSeg = Math.max(60, Math.round(cfg.cola.tiempoAtencionBase * (0.6 + rnd() * 0.9)));
        const r = rnd();
        const estado: EstadoTurno = r < 0.86 ? "ATENDIDO" : r < 0.94 ? "NO_SE_PRESENTO" : "CANCELADO";
        const canal: CanalTurno = rnd() < 0.68 ? "QR" : "TICKET";
        const conTel = canal === "QR" && rnd() < 0.8;
        const clienteId = rnd() < 0.9 ? await crearCliente(conTel) : null;

        const inicioLlamada = Math.max(cursorAtencion, emitido.getTime() + entre(20, 180) * 1000);
        const llamado = new Date(inicioLlamada);
        cursorAtencion = inicioLlamada + (estado === "ATENDIDO" ? atencionSeg : 90) * 1000 / cfg.ventanillas.length;

        const codigo = `${cfg.cola.prefijo}-${String(i).padStart(3, "0")}`;
        turnosData.push({
          localId: cfg.cola.localId,
          colaId: cfg.cola.id,
          numero: i,
          codigo,
          token: generarToken(10),
          clienteId,
          estado,
          ventanillaId: estado === "CANCELADO" ? null : elegir(cfg.ventanillas).id,
          canal,
          fecha: fechaADate(iso),
          emitidoAt: emitido,
          avisadoAt: estado === "CANCELADO" ? null : new Date(llamado.getTime() - entre(120, 600) * 1000),
          llamadoAt: estado === "CANCELADO" ? null : llamado,
          atendidoAt: estado === "ATENDIDO" ? llamado : null,
          finalizadoAt:
            estado === "ATENDIDO" ? new Date(llamado.getTime() + atencionSeg * 1000) : estado === "NO_SE_PRESENTO" ? new Date(llamado.getTime() + 180000) : new Date(emitido.getTime() + entre(60, 900) * 1000),
          rellamadas: estado === "NO_SE_PRESENTO" ? entre(1, 2) : rnd() < 0.1 ? 1 : 0,
        });
        totalTurnos++;
      }
      await prisma.contadorCola.create({ data: { colaId: cfg.cola.id, fecha: fechaADate(iso), ultimoNumero: n } });
    }
  }

  // Insertar en lotes
  for (let i = 0; i < turnosData.length; i += 200) {
    await prisma.turno.createMany({ data: turnosData.slice(i, i + 200) as never });
  }

  // ---- Hoy: atendidos por la mañana + cola viva ------------------------------
  console.log("📅 Turnos de hoy…");
  const minutosAhora = (() => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(ahora);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "9") % 24;
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return h * 60 + m;
  })();

  const hoyCfg: { cfg: ColaCfg; atendidos: number; enEspera: number; llamados: number }[] = [
    { cfg: configs[0], atendidos: 11, enEspera: 6, llamados: 1 },
    { cfg: configs[1], atendidos: 6, enEspera: 3, llamados: 1 },
    { cfg: configs[2], atendidos: 8, enEspera: 2, llamados: 0 },
    { cfg: configs[3], atendidos: 14, enEspera: 5, llamados: 1 },
    { cfg: configs[4], atendidos: 4, enEspera: 2, llamados: 0 },
  ];

  for (const h of hoyCfg) {
    let numero = 0;
    const inicio = Math.max(7 * 60, minutosAhora - 150); // los atendidos ocurrieron en las últimas 2.5 h
    const paso = Math.max(3, Math.floor((minutosAhora - inicio - 20) / Math.max(1, h.atendidos)));
    for (let i = 0; i < h.atendidos; i++) {
      numero++;
      const emitMin = inicio + i * paso;
      const emitido = new Date(horaLima(hoyISO, 0, 0).getTime() + emitMin * 60000);
      const llamado = new Date(emitido.getTime() + entre(4, 14) * 60000);
      const fin = new Date(llamado.getTime() + Math.round(h.cfg.cola.tiempoAtencionBase * (0.7 + rnd() * 0.7)) * 1000);
      const r = rnd();
      const estado: EstadoTurno = r < 0.9 ? "ATENDIDO" : "NO_SE_PRESENTO";
      const canal: CanalTurno = rnd() < 0.7 ? "QR" : "TICKET";
      await prisma.turno.create({
        data: {
          localId: h.cfg.cola.localId, colaId: h.cfg.cola.id, numero, codigo: `${h.cfg.cola.prefijo}-${String(numero).padStart(3, "0")}`, token: generarToken(10),
          clienteId: await crearCliente(canal === "QR"), estado, ventanillaId: elegir(h.cfg.ventanillas).id, canal, fecha: fechaADate(hoyISO),
          emitidoAt: emitido, avisadoAt: new Date(llamado.getTime() - 240000), llamadoAt: llamado, atendidoAt: estado === "ATENDIDO" ? llamado : null, finalizadoAt: fin,
        },
      });
    }
    for (let i = 0; i < h.llamados; i++) {
      numero++;
      const emitido = new Date(ahora.getTime() - entre(12, 20) * 60000);
      await prisma.turno.create({
        data: {
          localId: h.cfg.cola.localId, colaId: h.cfg.cola.id, numero, codigo: `${h.cfg.cola.prefijo}-${String(numero).padStart(3, "0")}`, token: generarToken(10),
          clienteId: await crearCliente(true, h.cfg.cola.id), estado: "LLAMADO", ventanillaId: h.cfg.ventanillas[0].id, canal: "QR", fecha: fechaADate(hoyISO),
          emitidoAt: emitido, avisadoAt: new Date(ahora.getTime() - 5 * 60000), llamadoAt: new Date(ahora.getTime() - entre(1, 3) * 60000),
        },
      });
    }
    for (let i = 0; i < h.enEspera; i++) {
      numero++;
      const emitido = new Date(ahora.getTime() - (h.enEspera - i) * 3 * 60000 - entre(0, 50) * 1000);
      const canal: CanalTurno = i % 3 === 2 ? "TICKET" : "QR";
      const avisado = i < 2; // los dos primeros ya fueron avisados
      const cliente = await crearClienteConTel(canal === "QR", h.cfg.cola.id);
      const t = await prisma.turno.create({
        data: {
          localId: h.cfg.cola.localId, colaId: h.cfg.cola.id, numero, codigo: `${h.cfg.cola.prefijo}-${String(numero).padStart(3, "0")}`, token: generarToken(10),
          clienteId: cliente.id, estado: avisado ? "AVISADO" : "EMITIDO", canal, fecha: fechaADate(hoyISO), emitidoAt: emitido,
          avisadoAt: avisado ? new Date(ahora.getTime() - 60000) : null,
        },
      });
      if (avisado && cliente.tel) {
        await prisma.notificacion.create({
          data: { turnoId: t.id, tipo: "WHATSAPP", destino: enmascararTelefono(cliente.tel), plantilla: "turno_proximo", estado: "LEIDO", enviadoAt: new Date(ahora.getTime() - 60000),
            mensaje: renderTurnoProximo({ codigo: t.codigo, local: h.cfg.cola.localId === poli.id ? poli.nombreComercial : julsa.nombreComercial, faltan: i, url: `${appUrl}/t/${t.token}` }) },
        });
      }
    }
    await prisma.contadorCola.create({ data: { colaId: h.cfg.cola.id, fecha: fechaADate(hoyISO), ultimoNumero: numero } });
    totalTurnos += numero;
  }

  console.log(`✅ Semilla lista: ${totalTurnos} turnos, 2 locales, 5 colas, 7 ventanillas.`);
  console.log("   Para 60 días de histórico (M2, M7, M8): npm run db:seed:historico");
  console.log("\nCredenciales de demo:");
  console.log("  Super admin : superadmin@turnoya.pe / admin123");
  console.log("  Admin local : admin@policlinico.pe / admin123");
  console.log("  Operador    : operador@policlinico.pe / operador123");
  console.log("  Admin local : admin@transportes.pe / admin123");
  console.log("  Operador    : operador@transportes.pe / operador123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
