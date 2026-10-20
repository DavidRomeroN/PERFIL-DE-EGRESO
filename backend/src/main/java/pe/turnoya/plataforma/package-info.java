/**
 * Plataforma SaaS: locales (tenants), planes, módulos contratados, horario de atención, usuarios, sesión y
 * auditoría.
 *
 * <p>API pública (este paquete): {@link pe.turnoya.plataforma.CatalogoLocales}, {@link pe.turnoya.plataforma.ModulosLocal},
 * {@link pe.turnoya.plataforma.HorarioAtencion}, {@link pe.turnoya.plataforma.Auditoria},
 * {@link pe.turnoya.plataforma.LocalDeTrabajo}, los registros {@code Local}, {@code Plan}, {@code Sesion} y las
 * anotaciones de permisos ({@code @SoloPersonal}, {@code @SoloAdmin}). Los subpaquetes son internos.
 *
 * <p>No depende de ningún otro módulo de negocio: los demás dependen de él.
 */
@ApplicationModule(displayName = "Plataforma")
package pe.turnoya.plataforma;

import org.springframework.modulith.ApplicationModule;
