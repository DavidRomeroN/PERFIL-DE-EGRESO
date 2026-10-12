import { z } from "zod";

/** Esquemas de validación (DTO en el borde de la API). */

export const colaSchema = z.object({
  prefijo: z.string().trim().min(1).max(3).regex(/^[A-Za-z0-9]+$/, "Usa letras o números (A, B, LAB)"),
  nombre: z.string().trim().min(2, "Mínimo 2 caracteres").max(60),
  descripcion: z.string().trim().max(160).optional().nullable(),
  tiempoAtencionBase: z.coerce.number().int().min(30).max(3600).default(300),
  activa: z.boolean().optional().default(true),
  orden: z.coerce.number().int().min(0).optional().default(0),
});

export const ventanillaSchema = z.object({
  nombre: z.string().trim().min(2, "Mínimo 2 caracteres").max(40),
  colaId: z.coerce.number().int().positive().optional().nullable(),
  activa: z.boolean().optional().default(true),
});

export const usuarioSchema = z.object({
  nombre: z.string().trim().min(2, "Mínimo 2 caracteres").max(80),
  email: z.string().trim().email("Correo inválido").transform((s) => s.toLowerCase()),
  password: z.string().min(6, "Mínimo 6 caracteres").max(72).optional(),
  rol: z.enum(["ADMIN_LOCAL", "OPERADOR"]),
  activo: z.boolean().optional().default(true),
});

export const localConfigSchema = z.object({
  nombreComercial: z.string().trim().min(2).max(80).optional(),
  razonSocial: z.string().trim().min(2).max(120).optional(),
  ruc: z.string().trim().max(11).optional().nullable(),
  rubro: z.string().trim().max(40).optional(),
  direccion: z.string().trim().max(160).optional().nullable(),
  telefono: z.string().trim().max(20).optional().nullable(),
  colorPrimario: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color hex inválido").optional(),
  logoUrl: z.string().trim().url("URL inválida").max(300).optional().nullable().or(z.literal("")),
  mensajeTv: z.string().trim().max(200).optional().nullable(),
  mensajeBienvenida: z.string().trim().max(200).optional().nullable(),
  avisarFaltando: z.coerce.number().int().min(0).max(10).optional(),
});

export const localSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Solo minúsculas, números y guiones"),
  nombreComercial: z.string().trim().min(2).max(80),
  razonSocial: z.string().trim().min(2).max(120),
  ruc: z.string().trim().max(11).optional().nullable(),
  rubro: z.string().trim().max(40).default("Salud"),
  direccion: z.string().trim().max(160).optional().nullable(),
  telefono: z.string().trim().max(20).optional().nullable(),
  ciudad: z.string().trim().max(60).default("Juliaca"),
  planId: z.coerce.number().int().positive(),
  colorPrimario: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#0f766e"),
  activo: z.boolean().optional().default(true),
  // Admin inicial opcional
  adminNombre: z.string().trim().min(2).max(80).optional(),
  adminEmail: z.string().trim().email().optional(),
  adminPassword: z.string().min(6).max(72).optional(),
});

/** N08 · Plan con su matriz de módulos. */
export const planSchema = z.object({
  codigo: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{3,20}$/),
  nombre: z.string().trim().min(2).max(40),
  precioMensual: z.number().min(0).max(100000),
  maxTurnosMes: z.number().int().min(1),
  maxColas: z.number().int().min(1),
  maxVentanillas: z.number().int().min(1),
  whatsappHabilitado: z.boolean(),
  maxAvisosWhatsapp: z.number().int().min(0),
  reportes: z.boolean(),
  descripcion: z.string().trim().max(200).nullable().optional(),
  modulos: z.array(z.enum(["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"])).default([]),
});
