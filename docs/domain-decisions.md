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
