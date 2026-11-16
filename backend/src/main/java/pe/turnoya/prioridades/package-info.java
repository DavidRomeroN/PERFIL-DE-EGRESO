/**
 * M1 · Prioridades: atención preferente con antigüedad (aging) y tope de adelantos. Los preferentes pasan delante,
 * pero un general que esperó lo suficiente los alcanza y nunca hay más de N preferentes seguidos.
 *
 * <p>Se conecta con el núcleo implementando el puerto {@link pe.turnoya.nucleo.puertos.PoliticaPrioridad} (solo cuando
 * M1 está activo en el local). El orden lo hace la base de datos con la clave persistida {@code turno.clave_orden};
 * este módulo administra categorías y parámetros y recalcula esa clave.
 *
 * <p>Slices: {@code politica} (puerto del núcleo y siembra de un local nuevo), {@code configuracion} (administración y
 * vista previa) y {@code verificacion} (el operador verifica, rechaza o cambia la categoría de un turno).
 */
@ApplicationModule(displayName = "Prioridades (M1)")
package pe.turnoya.prioridades;

import org.springframework.modulith.ApplicationModule;
