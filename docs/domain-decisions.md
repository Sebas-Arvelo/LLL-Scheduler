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

El scheduler definitivo será un motor de TypeScript puro e independiente de Angular. Resolverá las asignaciones globalmente por bloque; se evaluará matching bipartito ponderado o flujo de coste mínimo. El algoritmo greedy actual es provisional y no define el comportamiento futuro.

## Fechas e instantes

Las fechas operativas se representan como strings `YYYY-MM-DD`: son fechas civiles del campamento y no instantes, por lo que no deben convertirse implícitamente a la zona horaria del navegador. Los eventos que sí representan un instante, como el inicio o cierre de un ciclo, usan strings ISO 8601 en UTC.

## Elegibilidad

La elegibilidad se representa mediante registros independientes `ActivityEligibility` con `activityId` y `groupCategoryId`. Esto mantiene una relación muchos-a-muchos basada en identificadores, evita guardar nombres dentro de una actividad y puede trasladarse directamente a una futura tabla puente.

## Compatibilidad temporal

El catálogo de demostración usa el nuevo modelo `Activity`. Un adaptador conserva por ahora los campos ambiguos `capacity`, `enabled` y `category` requeridos por la interfaz y el scheduler greedy actuales. Esa forma temporal no debe utilizarse en lógica de dominio nueva.

## Motor de asignación por bloque

El primer motor real resuelve una única combinación de fecha y bloque mediante matching bipartito de coste mínimo. Maximiza primero la cantidad de grupos asignados y después minimiza, en orden, repeticiones dentro del ciclo, desequilibrio histórico, uso reciente, falta de equidad y un desempate determinista por semilla. Las capacidades variables de participantes se resuelven mediante branch-and-bound sobre el matching, sin aceptar soluciones que excedan una hard constraint.

Solo las asignaciones con estado `completed` cuentan como actividades realizadas para el historial. Las asignaciones bloqueadas conservan su identidad opcional, ocupan capacidad antes de generar propuestas y un bloque con asignaciones bloqueadas inválidas produce `invalid_input` en lugar de una corrección silenciosa.
