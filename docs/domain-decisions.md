# Decisiones de dominio

## Capacidad por bloque

La capacidad de una actividad se evalúa por bloque horario, no por día. El modelo futuro podrá definir:

- `maxGroups`: máximo de grupos que pueden realizar la actividad simultáneamente.
- `maxParticipants`: máximo opcional de participantes simultáneos.

Cada grupo podrá tener un `participantCount`. Cuando `maxParticipants` esté definido, el scheduler deberá considerar la suma de participantes asignados durante el bloque.

## Restricciones y asignaciones imposibles

Las restricciones obligatorias nunca deben violarse. Si un grupo no tiene ninguna actividad válida, el scheduler debe devolverlo como `unassigned` con una causa explícita, por ejemplo: capacidad agotada, ausencia de actividades elegibles, grupo no disponible o configuración incompatible.

No se permite usar un fallback que exceda una capacidad o ignore una restricción obligatoria.

## Ciclos de actividades

Al comenzar un ciclo se guarda una snapshot de las actividades activas y elegibles que el grupo debe completar.

- Una actividad añadida durante un ciclo entra en el ciclo siguiente.
- Una indisponibilidad temporal no elimina una actividad pendiente.
- Una actividad desactivada permanentemente puede exonerarse de forma explícita y auditable.
- Si una actividad exonerada vuelve a activarse, entra en el ciclo siguiente.
- Un ciclo termina cuando todos sus requisitos fueron completados o exonerados.

## Dirección del scheduler

El scheduler es un motor de TypeScript puro e independiente de Angular. Resuelve las asignaciones globalmente por bloque mediante matching bipartito ponderado de coste mínimo y aplica branch-and-bound cuando existe capacidad por participantes.

## Fechas e instantes

Las fechas operativas se representan como strings `YYYY-MM-DD`: son fechas civiles del campamento y no instantes, por lo que no deben convertirse implícitamente a la zona horaria del navegador. Los eventos que sí representan un instante, como el inicio o cierre de un ciclo, usan strings ISO 8601 en UTC.

## Elegibilidad

La elegibilidad se representa mediante registros independientes `ActivityEligibility` con `activityId` y `groupCategoryId`. Esto mantiene una relación muchos-a-muchos basada en identificadores, evita guardar nombres dentro de una actividad y puede trasladarse directamente a una futura tabla puente.

## Catálogo de demostración

El catálogo y los fixtures de demostración utilizan directamente `Activity`, `ActivityEligibility`, `GroupCategory`, `Season` y `TimeBlock`. No existe un modelo paralelo para la UI: `maxGroups`, `active` y los demás nombres del dominio son la única representación conceptual vigente.

## Motor de asignación por bloque

El primer motor real resuelve una única combinación de fecha y bloque mediante matching bipartito de coste mínimo. Maximiza primero la cantidad de grupos asignados y después minimiza, en orden, repeticiones dentro del ciclo, desequilibrio histórico, uso reciente, falta de equidad y un desempate determinista por semilla. Las capacidades variables de participantes se resuelven mediante branch-and-bound sobre el matching, sin aceptar soluciones que excedan una hard constraint.

Solo las asignaciones con estado `completed` cuentan como actividades realizadas para el historial. Las asignaciones bloqueadas conservan su identidad opcional, ocupan capacidad antes de generar propuestas y un bloque con asignaciones bloqueadas inválidas produce `invalid_input` en lugar de una corrección silenciosa.

## Proyección multibloque

La generación de varios días y bloques mantiene un estado de ciclos proyectado separado del historial real. El historial de entrada sigue siendo evidencia persistida: solo sus asignaciones `completed` cuentan como realizadas. En cambio, una asignación generada en un bloque anterior de la misma ejecución se conserva como asignación proyectada y afecta la selección de los bloques posteriores sin falsear su estado como completado.

Al completar un ciclo proyectado, el siguiente se abre al comenzar el próximo bloque cronológico. Su snapshot se construye con las actividades que en ese momento están activas y son elegibles para la categoría del grupo. Una indisponibilidad temporal no elimina requisitos del ciclo. Una asignación bloqueada futura solo ocupa capacidad y actualiza el ciclo cuando se alcanza exactamente su fecha y bloque; un grupo sin asignación no avanza.

Los campos `startedInSlot` y `completedInSlot` son la referencia temporal autoritativa de un ciclo proyectado. Los instantes ISO de su `ActivityCycle` son marcadores UTC deterministas exigidos por el contrato compartido y no deben persistirse como si fueran eventos reales. La confirmación operativa futura deberá crear los instantes reales y actualizar el historial persistido.
