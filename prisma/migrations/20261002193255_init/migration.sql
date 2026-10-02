-- CreateEnum
CREATE TYPE "RolUsuario" AS ENUM ('SUPER_ADMIN', 'ADMIN_LOCAL', 'OPERADOR');

-- CreateEnum
CREATE TYPE "EstadoTurno" AS ENUM ('EMITIDO', 'AVISADO', 'LLAMADO', 'ATENDIDO', 'NO_SE_PRESENTO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "CanalTurno" AS ENUM ('QR', 'TICKET');

-- CreateEnum
CREATE TYPE "TipoNotificacion" AS ENUM ('WHATSAPP', 'WEB');

-- CreateEnum
CREATE TYPE "EstadoNotificacion" AS ENUM ('PENDIENTE', 'ENVIADO', 'ENTREGADO', 'LEIDO', 'FALLIDO');

-- CreateTable
CREATE TABLE "plan" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "precio_mensual" DECIMAL(10,2) NOT NULL,
    "max_turnos_mes" INTEGER NOT NULL,
    "max_colas" INTEGER NOT NULL,
    "max_ventanillas" INTEGER NOT NULL,
    "whatsapp_habilitado" BOOLEAN NOT NULL,
    "max_avisos_whatsapp" INTEGER NOT NULL,
    "reportes" BOOLEAN NOT NULL DEFAULT false,
    "descripcion" TEXT,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "ruc" TEXT,
    "razon_social" TEXT NOT NULL,
    "nombre_comercial" TEXT NOT NULL,
    "rubro" TEXT NOT NULL DEFAULT 'Salud',
    "direccion" TEXT,
    "ciudad" TEXT NOT NULL DEFAULT 'Juliaca',
    "telefono" TEXT,
    "plan_id" INTEGER NOT NULL,
    "zona_horaria" TEXT NOT NULL DEFAULT 'America/Lima',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "color_primario" TEXT NOT NULL DEFAULT '#0f766e',
    "logo_url" TEXT,
    "mensaje_tv" TEXT,
    "mensaje_bienvenida" TEXT,
    "avisar_faltando" INTEGER NOT NULL DEFAULT 2,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" SERIAL NOT NULL,
    "local_id" INTEGER,
    "email" TEXT NOT NULL,
    "hash_password" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_acceso" TIMESTAMP(3),

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cola" (
    "id" SERIAL NOT NULL,
    "local_id" INTEGER NOT NULL,
    "prefijo" VARCHAR(3) NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "tiempo_atencion_base" INTEGER NOT NULL DEFAULT 300,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cola_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ventanilla" (
    "id" SERIAL NOT NULL,
    "local_id" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "cola_id" INTEGER,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ventanilla_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contador_cola" (
    "cola_id" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "ultimo_numero" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "contador_cola_pkey" PRIMARY KEY ("cola_id","fecha")
);

-- CreateTable
CREATE TABLE "cliente" (
    "id" SERIAL NOT NULL,
    "telefono_hash" TEXT,
    "telefono_cifrado" TEXT,
    "nombre" TEXT,
    "consentimiento_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turno" (
    "id" SERIAL NOT NULL,
    "local_id" INTEGER NOT NULL,
    "cola_id" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "codigo" VARCHAR(10) NOT NULL,
    "token" VARCHAR(16) NOT NULL,
    "cliente_id" INTEGER,
    "estado" "EstadoTurno" NOT NULL DEFAULT 'EMITIDO',
    "ventanilla_id" INTEGER,
    "canal" "CanalTurno" NOT NULL,
    "rellamadas" INTEGER NOT NULL DEFAULT 0,
    "emitido_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "avisado_at" TIMESTAMP(3),
    "llamado_at" TIMESTAMP(3),
    "atendido_at" TIMESTAMP(3),
    "finalizado_at" TIMESTAMP(3),
    "fecha" DATE NOT NULL,

    CONSTRAINT "turno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacion" (
    "id" SERIAL NOT NULL,
    "turno_id" INTEGER NOT NULL,
    "tipo" "TipoNotificacion" NOT NULL,
    "destino" TEXT,
    "mensaje" TEXT NOT NULL,
    "plantilla" TEXT,
    "proveedor_msg_id" TEXT,
    "estado" "EstadoNotificacion" NOT NULL DEFAULT 'PENDIENTE',
    "enviado_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" SERIAL NOT NULL,
    "local_id" INTEGER,
    "usuario_id" INTEGER,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT,
    "datos_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_codigo_key" ON "plan"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "local_slug_key" ON "local"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE INDEX "usuario_local_id_idx" ON "usuario"("local_id");

-- CreateIndex
CREATE UNIQUE INDEX "cola_local_id_prefijo_key" ON "cola"("local_id", "prefijo");

-- CreateIndex
CREATE INDEX "ventanilla_local_id_idx" ON "ventanilla"("local_id");

-- CreateIndex
CREATE INDEX "cliente_telefono_hash_idx" ON "cliente"("telefono_hash");

-- CreateIndex
CREATE UNIQUE INDEX "turno_token_key" ON "turno"("token");

-- CreateIndex
CREATE INDEX "turno_cola_id_estado_emitido_at_idx" ON "turno"("cola_id", "estado", "emitido_at");

-- CreateIndex
CREATE INDEX "turno_local_id_fecha_idx" ON "turno"("local_id", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "turno_cola_id_fecha_numero_key" ON "turno"("cola_id", "fecha", "numero");

-- CreateIndex
CREATE INDEX "notificacion_turno_id_idx" ON "notificacion"("turno_id");

-- CreateIndex
CREATE INDEX "notificacion_created_at_idx" ON "notificacion"("created_at");

-- CreateIndex
CREATE INDEX "auditoria_local_id_created_at_idx" ON "auditoria"("local_id", "created_at");

-- AddForeignKey
ALTER TABLE "local" ADD CONSTRAINT "local_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_local_id_fkey" FOREIGN KEY ("local_id") REFERENCES "local"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cola" ADD CONSTRAINT "cola_local_id_fkey" FOREIGN KEY ("local_id") REFERENCES "local"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventanilla" ADD CONSTRAINT "ventanilla_local_id_fkey" FOREIGN KEY ("local_id") REFERENCES "local"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventanilla" ADD CONSTRAINT "ventanilla_cola_id_fkey" FOREIGN KEY ("cola_id") REFERENCES "cola"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contador_cola" ADD CONSTRAINT "contador_cola_cola_id_fkey" FOREIGN KEY ("cola_id") REFERENCES "cola"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turno" ADD CONSTRAINT "turno_local_id_fkey" FOREIGN KEY ("local_id") REFERENCES "local"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turno" ADD CONSTRAINT "turno_cola_id_fkey" FOREIGN KEY ("cola_id") REFERENCES "cola"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turno" ADD CONSTRAINT "turno_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turno" ADD CONSTRAINT "turno_ventanilla_id_fkey" FOREIGN KEY ("ventanilla_id") REFERENCES "ventanilla"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_turno_id_fkey" FOREIGN KEY ("turno_id") REFERENCES "turno"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_local_id_fkey" FOREIGN KEY ("local_id") REFERENCES "local"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
