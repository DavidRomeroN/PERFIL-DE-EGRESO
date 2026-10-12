import { prisma } from "@/lib/db";
import { definirJob } from "@/lib/jobs/scheduler";
import { expirarLlamados } from "@/lib/operacion";
import { purgarDatosPersonales } from "@/lib/turnos";

/**
 * F1 · Tabla de jobs (ADR-01). Cada job es idempotente y se reclama en `job_estado` (una sola instancia lo corre).
 * Los jobs de módulos revisan la bandera del local antes de actuar: un local sin el módulo no se toca (D4, D5).
 */
export function registrarJobs() {
  definirJob({ nombre: "expirar-llamados", cadaSeg: 15, descripcion: "RN04: LLAMADO sin presentarse ⇒ NO_SE_PRESENTO (solo locales con tiempo de ausencia)", handler: async () => ({ vencidos: await expirarLlamados() }) });
  definirJob({ nombre: "purga-datos-personales", diario: { hora: 3 }, descripcion: "Ley 29733: anonimiza datos de más de 90 días, mensajes del bot de más de 30", handler: async () => {
    const r = await purgarDatosPersonales(90);
    await prisma.auditoria.create({ data: { accion: "PURGA_DATOS", entidad: "cliente", datosJson: r, accionHumana: `Purga automática: ${r.clientes} clientes anonimizados` } });
    return r;
  } });
  definirJob({ nombre: "limpieza-tecnica", diario: { hora: 4 }, descripcion: "Borra idempotencia vencida, contadores de límite y auditoría > 365 días", handler: async () => {
    const idem = await prisma.idempotencia.deleteMany({ where: { expiraAt: { lt: new Date() } } });
    const rl = await prisma.rateLimit.deleteMany({ where: { ventana: { lt: new Date(Date.now() - 86400000) } } });
    const aud = await prisma.auditoria.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 365 * 86400000) } } });
    return { idempotencia: idem.count, rateLimit: rl.count, auditoria: aud.count };
  } });
  // M2
  definirJob({ nombre: "prediccion-reentrenar", diario: { hora: 2 }, descripcion: "M2: reentrena BASELINE/EMA/ESTACIONAL por cola (walk-forward, AUTO)", handler: async () => (await import("@/lib/prediccion/service")).jobReentrenar() });
  definirJob({ nombre: "prediccion-deriva", cadaSeg: 600, descripcion: "M2: detecta deriva del modelo en producción", handler: async () => (await import("@/lib/prediccion/service")).jobDeriva() });
  definirJob({ nombre: "prediccion-avisos", cadaSeg: 60, descripcion: "M2: aviso \"X min antes\" (opt-in del cliente)", handler: async () => (await import("@/lib/prediccion/service")).jobAvisosMinutos() });
  // M3
  definirJob({ nombre: "citas-recordatorios", cadaSeg: 300, descripcion: "M3: recordatorios T−24 h y T−2 h (una vez por cita)", handler: async () => (await import("@/lib/citas/service")).jobRecordatorios() });
  definirJob({ nombre: "citas-no-show", cadaSeg: 300, descripcion: "M3: marca inasistencias y bloquea reincidentes", handler: async () => (await import("@/lib/citas/service")).jobNoShow() });
  definirJob({ nombre: "citas-generar-slots", diario: { hora: 1 }, descripcion: "M3: prepara los horarios de los próximos días", handler: async () => (await import("@/lib/citas/service")).jobGenerarSlots() });
  // M4
  definirJob({ nombre: "bot-expirar-sesiones", cadaSeg: 300, descripcion: "M4: cierra conversaciones inactivas y devuelve handoff sin respuesta", handler: async () => (await import("@/lib/bot/service")).jobExpirarSesiones() });
  // M5
  definirJob({ nombre: "kiosco-vigilancia", cadaSeg: 60, descripcion: "M5: marca kioscos sin heartbeat", handler: async () => (await import("@/lib/kiosco/service")).jobVigilancia() });
  definirJob({ nombre: "kiosco-limpieza", diario: { hora: 4, minuto: 15 }, descripcion: "M5: elimina eventos sincronizados antiguos", handler: async () => (await import("@/lib/kiosco/service")).jobLimpieza() });
  // M6
  definirJob({ nombre: "balanceo-evaluar", cadaSeg: 30, descripcion: "M6: evalúa reglas de balanceo por local (candado consultivo)", handler: async () => (await import("@/lib/balanceo/service")).jobBalanceo() });
  definirJob({ nombre: "balanceo-limpiar", diario: { hora: 4, minuto: 30 }, descripcion: "M6: elimina ejecuciones de más de 90 días", handler: async () => ({ eliminadas: (await prisma.ejecucionRegla.deleteMany({ where: { ts: { lt: new Date(Date.now() - 90 * 86400000) } } })).count }) });
  // M7
  definirJob({ nombre: "analitica-refrescar-mv", cadaSeg: 300, descripcion: "M7: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_turno_franja", handler: async () => (await import("@/lib/analitica/consultas")).refrescarVista() });
  definirJob({ nombre: "alertas-evaluar", cadaSeg: 60, descripcion: "M7: SLA, espera, anomalías, escalamiento", handler: async () => (await import("@/lib/analitica/alertas")).jobEvaluarAlertas() });
  definirJob({ nombre: "reportes-programados", cadaSeg: 60, descripcion: "M7: genera y envía los reportes que tocan", handler: async () => (await import("@/lib/analitica/reportes")).jobReportes() });
  definirJob({ nombre: "analitica-limpiar", diario: { hora: 4, minuto: 45 }, descripcion: "M7: reportes > 90 días, alertas resueltas > 180 días", handler: async () => (await import("@/lib/analitica/reportes")).jobLimpiarAnalitica() });
}
