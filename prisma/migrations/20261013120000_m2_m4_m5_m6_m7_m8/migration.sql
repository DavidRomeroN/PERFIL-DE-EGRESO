-- ---------------------------------------------------------------------------
-- Modelos de datos de M2, M4, M5, M6, M7 y M8 (docs/modulos/M*.md §5).
-- Cierra D1 (bandeja del bot sin local), D3 (kiosco sin dispositivo), D4 (avisos
-- sin registro), D5 (balanceo sin reglas), D8 (modelo global en memoria) y D11.
-- ---------------------------------------------------------------------------

-- Notificaciones: también para citas y alertas (turno opcional), con local para contar la cuota del plan (RN05/RN-M3-10)
ALTER TABLE "notificacion" ALTER COLUMN "turno_id" DROP NOT NULL;
ALTER TABLE "notificacion" ADD COLUMN "local_id" INTEGER REFERENCES "local"("id") ON DELETE CASCADE;
ALTER TABLE "notificacion" ADD COLUMN "cita_id" INTEGER REFERENCES "cita"("id") ON DELETE CASCADE;
UPDATE "notificacion" n SET "local_id" = t.local_id FROM "turno" t WHERE t.id = n.turno_id AND n.local_id IS NULL;
CREATE INDEX "notificacion_local_created_idx" ON "notificacion" ("local_id", "created_at");

-- M2 · Predicción -------------------------------------------------------------
CREATE TYPE "ModeloPrediccion" AS ENUM ('BASELINE', 'EMA', 'ESTACIONAL');

CREATE TABLE "config_prediccion" (
  "local_id"           INTEGER PRIMARY KEY REFERENCES "local"("id") ON DELETE CASCADE,
  "modelo"             TEXT NOT NULL DEFAULT 'AUTO',
  "alfa_ema"           DECIMAL(4,3) NOT NULL DEFAULT 0.2,
  "nivel_confianza"    DECIMAL(3,2) NOT NULL DEFAULT 0.8,
  "dias_entrenamiento" INTEGER NOT NULL DEFAULT 60,
  CONSTRAINT ck_config_prediccion CHECK (alfa_ema BETWEEN 0.05 AND 0.5 AND nivel_confianza IN (0.8, 0.9) AND modelo IN ('AUTO','BASELINE','EMA','ESTACIONAL'))
);

CREATE TABLE "modelo_entrenado" (
  "id"           SERIAL PRIMARY KEY,
  "local_id"     INTEGER NOT NULL REFERENCES "local"("id") ON DELETE CASCADE,
  "cola_id"      INTEGER NOT NULL REFERENCES "cola"("id") ON DELETE CASCADE,
  "tipo"         "ModeloPrediccion" NOT NULL,
  "version"      INTEGER NOT NULL,
  "parametros"   JSONB NOT NULL,
  "n_muestras"   INTEGER NOT NULL,
  "mae"          DOUBLE PRECISION,
  "medae"        DOUBLE PRECISION,
  "acierto_5"    DOUBLE PRECISION,
  "sesgo"        DOUBLE PRECISION,
  "cobertura"    DOUBLE PRECISION,
  "ancho_medio"  DOUBLE PRECISION,
  "importancia"  JSONB,
  "activo"       BOOLEAN NOT NULL DEFAULT false,
  "deriva"       BOOLEAN NOT NULL DEFAULT false,
  "entrenado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("cola_id", "tipo", "version")
);
CREATE INDEX "modelo_entrenado_cola_activo_idx" ON "modelo_entrenado" ("cola_id", "activo");

CREATE TABLE "prediccion_log" (
  "id"         BIGSERIAL PRIMARY KEY,
  "turno_id"   INTEGER NOT NULL UNIQUE REFERENCES "turno"("id") ON DELETE CASCADE,
  "cola_id"    INTEGER NOT NULL,
  "tipo"       "ModeloPrediccion" NOT NULL,
  "version"    INTEGER NOT NULL,
  "delante"    INTEGER NOT NULL,
  "c"          INTEGER NOT NULL,
  "pred_seg"   INTEGER NOT NULL,
  "lo_seg"     INTEGER NOT NULL,
  "hi_seg"     INTEGER NOT NULL,
  "real_seg"   INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "prediccion_log_cola_created_idx" ON "prediccion_log" ("cola_id", "created_at");

-- M4 · Chatbot ----------------------------------------------------------------
CREATE TYPE "EstadoBot" AS ENUM ('INICIO', 'MENU', 'ELEGIR_COLA', 'ELEGIR_CATEGORIA', 'PEDIR_NOMBRE', 'PEDIR_CONSENTIMIENTO',
  'CONFIRMAR_TURNO', 'ELEGIR_TURNO_ACTIVO', 'SEGUIMIENTO', 'CONFIRMAR_CANCELAR', 'ELEGIR_FECHA', 'ELEGIR_HORA',
  'CONFIRMAR_CITA', 'HANDOFF', 'CERRADA');
CREATE TYPE "DireccionMensaje" AS ENUM ('ENTRANTE', 'SALIENTE');

CREATE TABLE "canal_whatsapp" (
  "id"              SERIAL PRIMARY KEY,
  "local_id"        INTEGER NOT NULL REFERENCES "local"("id") ON DELETE CASCADE,
  "proveedor"       TEXT NOT NULL,
  "identificador"   TEXT NOT NULL,
  "bot_activo"      BOOLEAN NOT NULL DEFAULT false,
  "bienvenida"      TEXT,
  "atencion_humana" JSONB,
  UNIQUE ("proveedor", "identificador")
);
CREATE INDEX "canal_whatsapp_local_idx" ON "canal_whatsapp" ("local_id");

CREATE TABLE "conversacion_bot" (
  "id"                 TEXT PRIMARY KEY,
  "local_id"           INTEGER NOT NULL REFERENCES "local"("id") ON DELETE CASCADE,
  "telefono_hash"      TEXT NOT NULL,
  "telefono_cifrado"   TEXT NOT NULL,
  "estado"             "EstadoBot" NOT NULL DEFAULT 'INICIO',
  "contexto"           JSONB NOT NULL DEFAULT '{}',
  "handoff"            BOOLEAN NOT NULL DEFAULT false,
  "handoff_at"         TIMESTAMP(3),
  "consentimiento_at"  TIMESTAMP(3),
  "intentos_invalidos" INTEGER NOT NULL DEFAULT 0,
  "infracciones"       INTEGER NOT NULL DEFAULT 0,
  "silenciada_hasta"   TIMESTAMP(3),
  "ultimo_mensaje_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expira_at"          TIMESTAMP(3) NOT NULL,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("local_id", "telefono_hash")
);
CREATE INDEX "conversacion_bot_bandeja_idx" ON "conversacion_bot" ("local_id", "handoff", "ultimo_mensaje_at");

CREATE TABLE "mensaje_bot" (
  "id"               BIGSERIAL PRIMARY KEY,
  "conversacion_id"  TEXT NOT NULL REFERENCES "conversacion_bot"("id") ON DELETE CASCADE,
  "direccion"        "DireccionMensaje" NOT NULL,
  "proveedor_msg_id" TEXT,
  "texto_cifrado"    TEXT NOT NULL,
  "estado"           TEXT NOT NULL DEFAULT 'PENDIENTE',
  "autor"            TEXT,
  "intencion"        TEXT,
  "estado_bot"       TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "mensaje_bot_conv_created_idx" ON "mensaje_bot" ("conversacion_id", "created_at");

CREATE TABLE "evento_bot_procesado" (
  "proveedor"    TEXT NOT NULL,
  "mensaje_id"   TEXT NOT NULL,
  "procesado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("proveedor", "mensaje_id")
);

-- Canal por defecto: cada local con M4 usa la sesión OpenWA configurada (se puede cambiar en /admin/bandeja)
INSERT INTO "canal_whatsapp" ("local_id", "proveedor", "identificador", "bot_activo")
SELECT lm.local_id, 'openwa', 'turnoya-' || l.slug, true
  FROM "local_modulo" lm JOIN "local" l ON l.id = lm.local_id
 WHERE lm.modulo = 'M4' AND lm.habilitado
ON CONFLICT DO NOTHING;

-- M5 · Kiosco -----------------------------------------------------------------
CREATE TYPE "EstadoEventoKiosco" AS ENUM ('PENDIENTE', 'APLICADO', 'DUPLICADO', 'REVISION', 'RECHAZADO');

CREATE TABLE "dispositivo_kiosco" (
  "id"                    SERIAL PRIMARY KEY,
  "local_id"              INTEGER NOT NULL REFERENCES "local"("id") ON DELETE CASCADE,
  "numero"                INTEGER NOT NULL,
  "nombre"                TEXT NOT NULL,
  "cola_ids"              INTEGER[] NOT NULL DEFAULT '{}',
  "token_hash"            TEXT,
  "codigo_emparej_hash"   TEXT,
  "codigo_emparej_expira" TIMESTAMP(3),
  "pin_mantenimiento"     TEXT,
  "activo"                BOOLEAN NOT NULL DEFAULT true,
  "version_app"           TEXT,
  "ultimo_heartbeat_at"   TIMESTAMP(3),
  "offset_reloj_ms"       INTEGER NOT NULL DEFAULT 0,
  "pendientes_reportados" INTEGER NOT NULL DEFAULT 0,
  "impresora"             TEXT,
  "config_version"        INTEGER NOT NULL DEFAULT 1,
  "en_linea"              BOOLEAN NOT NULL DEFAULT false,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("local_id", "numero")
);
CREATE UNIQUE INDEX "dispositivo_kiosco_token_key" ON "dispositivo_kiosco" ("token_hash") WHERE token_hash IS NOT NULL;

CREATE TABLE "evento_kiosco" (
  "id"                  BIGSERIAL PRIMARY KEY,
  "dispositivo_id"      INTEGER NOT NULL REFERENCES "dispositivo_kiosco"("id") ON DELETE CASCADE,
  "clave_idem"          TEXT NOT NULL UNIQUE,
  "seq"                 INTEGER NOT NULL,
  "tipo"                TEXT NOT NULL,
  "payload"             JSONB NOT NULL,
  "ts_dispositivo"      TIMESTAMP(3) NOT NULL,
  "offset_ms_al_emitir" INTEGER NOT NULL DEFAULT 0,
  "ts_corregido"        TIMESTAMP(3),
  "recibido_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "estado"              "EstadoEventoKiosco" NOT NULL DEFAULT 'PENDIENTE',
  "motivo"              TEXT,
  "turno_id"            INTEGER REFERENCES "turno"("id") ON DELETE SET NULL,
  "resuelto_por"        INTEGER,
  "resuelto_at"         TIMESTAMP(3)
);
CREATE INDEX "evento_kiosco_disp_seq_idx" ON "evento_kiosco" ("dispositivo_id", "seq");
CREATE INDEX "evento_kiosco_estado_idx" ON "evento_kiosco" ("estado", "recibido_at");

ALTER TABLE "turno" ADD CONSTRAINT "turno_origen_dispositivo_fkey" FOREIGN KEY ("origen_dispositivo_id") REFERENCES "dispositivo_kiosco"("id") ON DELETE SET NULL;

-- M6 · Transferencia y balanceo -------------------------------------------------
CREATE TYPE "OrigenTransferencia" AS ENUM ('MANUAL', 'REGLA');

ALTER TABLE "ventanilla" ADD COLUMN "cola_original_id" INTEGER REFERENCES "cola"("id") ON DELETE SET NULL;
ALTER TABLE "ventanilla" ADD COLUMN "asignacion_temporal_hasta" TIMESTAMP(3);
ALTER TABLE "ventanilla" ADD COLUMN "regla_asignadora_id" INTEGER;

CREATE TABLE "regla_balanceo" (
  "id"                    SERIAL PRIMARY KEY,
  "local_id"              INTEGER NOT NULL REFERENCES "local"("id") ON DELETE CASCADE,
  "nombre"                TEXT NOT NULL,
  "activa"                BOOLEAN NOT NULL DEFAULT false,
  "modo"                  TEXT NOT NULL DEFAULT 'SIMULACION',
  "condicion"             JSONB NOT NULL,
  "accion"                JSONB NOT NULL,
  "for_segundos"          INTEGER NOT NULL DEFAULT 300,
  "for_segundos_reversa"  INTEGER NOT NULL DEFAULT 300,
  "cooldown_seg"          INTEGER NOT NULL DEFAULT 600,
  "histeresis_pct"        INTEGER NOT NULL DEFAULT 20,
  "ttl_seg"               INTEGER,
  "requiere_confirmacion" BOOLEAN NOT NULL DEFAULT false,
  "prioridad"             INTEGER NOT NULL DEFAULT 100,
  "created_by"            INTEGER,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_regla_modo CHECK (modo IN ('SIMULACION', 'ACTIVA') AND cooldown_seg >= 120)
);
CREATE INDEX "regla_balanceo_local_activa_idx" ON "regla_balanceo" ("local_id", "activa");

CREATE TABLE "regla_estado" (
  "regla_id"            INTEGER PRIMARY KEY REFERENCES "regla_balanceo"("id") ON DELETE CASCADE,
  "fase"                TEXT NOT NULL DEFAULT 'INACTIVA',
  "verdadera_desde"     TIMESTAMP(3),
  "falsa_desde"         TIMESTAMP(3),
  "ultima_ejecucion_at" TIMESTAMP(3),
  "estado_accion"       JSONB
);

CREATE TABLE "ejecucion_regla" (
  "id"             BIGSERIAL PRIMARY KEY,
  "regla_id"       INTEGER NOT NULL REFERENCES "regla_balanceo"("id") ON DELETE CASCADE,
  "local_id"       INTEGER NOT NULL,
  "ts"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fase"           TEXT NOT NULL,
  "metricas"       JSONB NOT NULL,
  "resultado"      TEXT NOT NULL,
  "detalle"        JSONB,
  "confirmada_por" INTEGER
);
CREATE INDEX "ejecucion_regla_local_ts_idx" ON "ejecucion_regla" ("local_id", "ts");

CREATE TABLE "transferencia" (
  "id"                  SERIAL PRIMARY KEY,
  "local_id"            INTEGER NOT NULL REFERENCES "local"("id") ON DELETE CASCADE,
  "turno_origen_id"     INTEGER NOT NULL REFERENCES "turno"("id") ON DELETE CASCADE,
  "turno_destino_id"    INTEGER NOT NULL REFERENCES "turno"("id") ON DELETE CASCADE,
  "de_cola_id"          INTEGER NOT NULL,
  "a_cola_id"           INTEGER NOT NULL,
  "a_ventanilla_id"     INTEGER,
  "motivo"              TEXT NOT NULL,
  "detalle"             TEXT,
  "origen"              "OrigenTransferencia" NOT NULL,
  "regla_id"            INTEGER,
  "usuario_id"          INTEGER,
  "conservo_antiguedad" BOOLEAN NOT NULL DEFAULT true,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "transferencia_local_created_idx" ON "transferencia" ("local_id", "created_at");

DROP TRIGGER IF EXISTS trg_auditoria_regla_balanceo ON regla_balanceo;
CREATE TRIGGER trg_auditoria_regla_balanceo AFTER INSERT OR UPDATE OR DELETE ON regla_balanceo
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

-- M7 · Analítica, SLA y alertas ------------------------------------------------
CREATE TYPE "EstadoAlerta" AS ENUM ('ABIERTA', 'RECONOCIDA', 'RESUELTA', 'SILENCIADA');
CREATE TYPE "TipoAlerta" AS ENUM ('SLA_INCUMPLIDO', 'ESPERA_ALTA', 'COLA_LARGA', 'ANOMALIA_LLEGADAS', 'VENTANILLA_INACTIVA',
  'WHATSAPP_CAIDO', 'KIOSCO_OFFLINE', 'PREDICCION_DERIVA', 'BALANCEO_LIMITE', 'JOB_FALLIDO');

CREATE TABLE "sla_cola" (
  "cola_id"        INTEGER PRIMARY KEY REFERENCES "cola"("id") ON DELETE CASCADE,
  "espera_max_min" INTEGER NOT NULL,
  "objetivo_pct"   DECIMAL(5,2) NOT NULL,
  "ventana_min"    INTEGER NOT NULL DEFAULT 60,
  "activo"         BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT ck_sla CHECK (espera_max_min BETWEEN 1 AND 480 AND objetivo_pct > 0 AND objetivo_pct <= 100 AND ventana_min BETWEEN 15 AND 1440)
);

CREATE TABLE "regla_alerta" (
  "id"                SERIAL PRIMARY KEY,
  "local_id"          INTEGER NOT NULL REFERENCES "local"("id") ON DELETE CASCADE,
  "tipo"              "TipoAlerta" NOT NULL,
  "nombre"            TEXT NOT NULL,
  "umbral"            JSONB NOT NULL,
  "niveles"           JSONB NOT NULL,
  "resolver_tras_min" INTEGER NOT NULL DEFAULT 10,
  "silenciada_hasta"  TIMESTAMP(3),
  "activa"            BOOLEAN NOT NULL DEFAULT true,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "regla_alerta_local_activa_idx" ON "regla_alerta" ("local_id", "activa");

-- Racha de disparos por (regla, entidad): memoria de la FSM de alertas (RN-M7-03)
CREATE TABLE "alerta_racha" (
  "huella"       TEXT PRIMARY KEY,
  "local_id"     INTEGER NOT NULL,
  "disparos"     INTEGER NOT NULL DEFAULT 0,
  "normal_desde" TIMESTAMP(3),
  "actualizada_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "alerta" (
  "id"                BIGSERIAL PRIMARY KEY,
  "local_id"          INTEGER NOT NULL REFERENCES "local"("id") ON DELETE CASCADE,
  "regla_id"          INTEGER REFERENCES "regla_alerta"("id") ON DELETE SET NULL,
  "tipo"              "TipoAlerta" NOT NULL,
  "huella"            TEXT NOT NULL,
  "entidad"           TEXT,
  "nivel"             INTEGER NOT NULL DEFAULT 1,
  "estado"            "EstadoAlerta" NOT NULL DEFAULT 'ABIERTA',
  "titulo"            TEXT NOT NULL,
  "detalle"           JSONB NOT NULL,
  "ocurrencias"       INTEGER NOT NULL DEFAULT 1,
  "primera_vez_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ultima_vez_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "proximo_escala_at" TIMESTAMP(3),
  "reconocida_por"    INTEGER,
  "reconocida_at"     TIMESTAMP(3),
  "resuelta_at"       TIMESTAMP(3),
  "silenciada_hasta"  TIMESTAMP(3)
);
CREATE INDEX "alerta_local_estado_idx" ON "alerta" ("local_id", "estado", "ultima_vez_at");
-- RN-M7-02: una sola alerta viva por huella
CREATE UNIQUE INDEX "ux_alerta_huella_viva" ON "alerta" ("huella") WHERE estado IN ('ABIERTA', 'RECONOCIDA', 'SILENCIADA');

CREATE TABLE "alerta_notificacion" (
  "id"         BIGSERIAL PRIMARY KEY,
  "alerta_id"  BIGINT NOT NULL REFERENCES "alerta"("id") ON DELETE CASCADE,
  "nivel"      INTEGER NOT NULL,
  "canal"      TEXT NOT NULL,
  "destino"    TEXT,
  "estado"     TEXT NOT NULL,
  "hora"       TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- RN-M7-05: 1 notificación por alerta, nivel y canal por hora
  UNIQUE ("alerta_id", "nivel", "canal", "hora")
);

CREATE TABLE "reporte_programado" (
  "id"                  SERIAL PRIMARY KEY,
  "local_id"            INTEGER NOT NULL REFERENCES "local"("id") ON DELETE CASCADE,
  "nombre"              TEXT NOT NULL,
  "tipo"                TEXT NOT NULL,
  "frecuencia"          TEXT NOT NULL,
  "dia_semana"          INTEGER,
  "dia_mes"             INTEGER,
  "hora"                TEXT NOT NULL,
  "formato"             TEXT[] NOT NULL DEFAULT ARRAY['PDF'],
  "destinatarios"       TEXT[] NOT NULL,
  "filtros"             JSONB,
  "activo"              BOOLEAN NOT NULL DEFAULT true,
  "ultima_ejecucion_at" TIMESTAMP(3),
  CONSTRAINT ck_reporte_frecuencia CHECK (frecuencia IN ('DIARIO', 'SEMANAL', 'MENSUAL'))
);

CREATE TABLE "reporte_generado" (
  "id"            BIGSERIAL PRIMARY KEY,
  "programado_id" INTEGER NOT NULL REFERENCES "reporte_programado"("id") ON DELETE CASCADE,
  "periodo"       TEXT NOT NULL,
  "archivo"       TEXT,
  "bytes"         INTEGER NOT NULL DEFAULT 0,
  "estado"        TEXT NOT NULL,
  "error"         TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("programado_id", "periodo")
);

DROP TRIGGER IF EXISTS trg_auditoria_sla ON sla_cola;
CREATE TRIGGER trg_auditoria_sla AFTER INSERT OR UPDATE OR DELETE ON sla_cola
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria();
DROP TRIGGER IF EXISTS trg_auditoria_regla_alerta ON regla_alerta;
CREATE TRIGGER trg_auditoria_regla_alerta AFTER INSERT OR UPDATE OR DELETE ON regla_alerta
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

-- Vista materializada de agregados por franja de 30 min (M7 §5)
CREATE MATERIALIZED VIEW mv_turno_franja AS
SELECT t.local_id, t.cola_id, t.fecha,
       EXTRACT(DOW FROM t.fecha)::int AS dow,
       (EXTRACT(HOUR FROM ((t.emitido_at AT TIME ZONE 'UTC') AT TIME ZONE l.zona_horaria)) * 2
        + FLOOR(EXTRACT(MINUTE FROM ((t.emitido_at AT TIME ZONE 'UTC') AT TIME ZONE l.zona_horaria)) / 30))::int AS franja,
       COUNT(*)::int AS llegadas,
       COUNT(*) FILTER (WHERE t.estado = 'ATENDIDO')::int AS atendidos,
       COUNT(*) FILTER (WHERE t.estado = 'NO_SE_PRESENTO')::int AS no_presentados,
       COUNT(*) FILTER (WHERE t.estado = 'CANCELADO')::int AS cancelados,
       COUNT(*) FILTER (WHERE t.llamado_at IS NOT NULL)::int AS llamados,
       AVG(EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at))) FILTER (WHERE t.llamado_at IS NOT NULL) AS espera_prom_seg,
       percentile_cont(ARRAY[0.5, 0.9, 0.95]::double precision[]) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at)))
         FILTER (WHERE t.llamado_at IS NOT NULL) AS espera_pcts,
       percentile_cont(ARRAY[0.5, 0.9, 0.95]::double precision[]) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.finalizado_at - t.llamado_at)))
         FILTER (WHERE t.estado = 'ATENDIDO' AND t.finalizado_at IS NOT NULL) AS atencion_pcts
  FROM turno t JOIN local l ON l.id = t.local_id
 WHERE t.fecha >= current_date - 180
 GROUP BY 1, 2, 3, 4, 5;
CREATE UNIQUE INDEX ux_mv_turno_franja ON mv_turno_franja (local_id, cola_id, fecha, franja);

-- M8 · Simulador ----------------------------------------------------------------
CREATE TABLE "escenario_simulacion" (
  "id"         SERIAL PRIMARY KEY,
  "local_id"   INTEGER NOT NULL REFERENCES "local"("id") ON DELETE CASCADE,
  "cola_id"    INTEGER REFERENCES "cola"("id") ON DELETE SET NULL,
  "nombre"     TEXT NOT NULL,
  "parametros" JSONB NOT NULL,
  "resultados" JSONB,
  "semilla"    INTEGER NOT NULL,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "escenario_simulacion_local_idx" ON "escenario_simulacion" ("local_id", "created_at");
