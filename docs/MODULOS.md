# TurnoYa — Índice de módulos avanzados

> **Qué falta por hacer (estado real del código):** [`PENDIENTE.md`](PENDIENTE.md).
>
> El plan completo (contexto, reparto, arquitectura, fundaciones, pruebas, seguridad, DevOps, cronograma, riesgos) está en
> **[`PLAN_INTEGRAL.md`](PLAN_INTEGRAL.md)**. Cada módulo tiene su documento técnico detallado:

| # | Módulo | Integrante | Documento | Horas | Complejidad |
|---|--------|-----------|-----------|-------|-------------|
| M1 | Motor de prioridades con aging | 1 · Nick | [`modulos/M1-prioridades.md`](modulos/M1-prioridades.md) | 40 | ●●●○○ |
| M2 | Predicción de espera | 1 · Nick | [`modulos/M2-prediccion-espera.md`](modulos/M2-prediccion-espera.md) | 56 | ●●●●○ |
| M3 | Citas y reservas con check-in QR | 2 · Jhan | [`modulos/M3-citas-reservas.md`](modulos/M3-citas-reservas.md) | 64 | ●●●●○ |
| M4 | Chatbot de WhatsApp | 2 · Jhan | [`modulos/M4-chatbot-whatsapp.md`](modulos/M4-chatbot-whatsapp.md) | 56 | ●●●●○ |
| M5 | Kiosco autoservicio offline-first | 3 · David | [`modulos/M5-kiosco-offline.md`](modulos/M5-kiosco-offline.md) | 72 | ●●●●● |
| M6 | Transferencia de turnos y balanceo automático | 3 · David | [`modulos/M6-transferencia-balanceo.md`](modulos/M6-transferencia-balanceo.md) | 56 | ●●●●○ |
| M7 | Analítica avanzada y SLA con alertas | 4 · Henyelrey | [`modulos/M7-analitica-sla.md`](modulos/M7-analitica-sla.md) | 60 | ●●●●○ |
| M8 | Simulador de capacidad (Erlang C + DES) | 4 · Henyelrey | [`modulos/M8-simulador-capacidad.md`](modulos/M8-simulador-capacidad.md) | 52 | ●●●●● |

La asignación de personas es una propuesta y puede intercambiarse (ver §2 del plan).

## Estructura de cada documento de módulo
1. Resumen y objetivo · 2. Alcance · 3. Actores e historias · 4. Requisitos (RF / RN / RNF) · 5. Diseño de datos (Prisma + SQL) ·
6. Algoritmos y diseño de la solución · 7. API · 8. Jobs y eventos · 9. UI y pantallas del prototipo · 10. Integración con el núcleo (archivos a tocar) ·
11. Seguridad y privacidad · 12. Pruebas · 13. Observabilidad · 14. Criterios de aceptación (Gherkin) · 15. Riesgos · 16. Plan de tareas con horas.

## Dependencias
```
F5 (emitir_turno extendido) ──► M1 ──► M3, M5, M6
F1 (jobs) ──► M2, M3, M4, M5, M6, M7
F2 (bus multi-instancia) ──► M5, M6, M7
M2 + M7 ──► M8
```
