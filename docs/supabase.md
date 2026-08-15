# Supabase: autenticación, programaciones y ejecución real

## Flujo principal

La aplicación Angular usa directamente Supabase Auth y la tabla `saved_schedules` protegida por Row Level Security. El scheduler sigue siendo TypeScript puro y no conoce Supabase.

```text
Angular -> Supabase Auth
        -> saved_schedules (PostgreSQL administrado + RLS)
        -> assignment_progress + activity_cycles + cycle_requirements
```

El backend Express de `backend/` se conserva temporalmente para facilitar una decisión posterior, pero ya no forma parte del arranque ni del guardado principal del frontend. `npm start` no requiere Express, PostgreSQL local, `DATABASE_URL`, `TEST_DATABASE_URL` ni migraciones locales.

`src/app/core/api/schedule-api.ts`, el proxy `/api` y los scripts backend también se conservan como infraestructura heredada, pero `AppComponent` ya no los consume para autenticar, guardar, listar, abrir o eliminar programaciones.

## Configuración

El archivo `src/environments/environment.ts` contiene placeholders públicos:

```ts
supabase: {
  url: 'https://your-project.supabase.co',
  anonKey: 'your-anon-or-publishable-key',
}
```

Reemplázalos localmente con la Project URL y la clave anon/publishable del proyecto. La clave `service_role` nunca debe colocarse en Angular.

En el SQL Editor de Supabase ejecuta íntegramente `supabase/setup.sql`. El script es acumulativo: conserva `saved_schedules`, añade las tablas de ejecución, índices, constraints, triggers, funciones transaccionales y políticas separadas de SELECT, INSERT, UPDATE y DELETE para `auth.uid()`.

## Datos guardados

Cada fila contiene metadata consultable y `schedule_data` JSONB con:

- `schemaVersion`;
- snapshot de temporada, categorías, grupos, actividades, elegibilidad y bloques;
- assignments y unassigned de planificación;
- bloques generados, métricas y diagnósticos.

No se guardan `projectedCycles` ni se marcan assignments como historial completado. Al abrir una fila, Angular reconstruye las vistas desde el JSON guardado sin llamar a `generateSchedule()`.

## Ejecución e historial real

`saved_schedules.schedule_data` continúa siendo un snapshot inmutable del plan. La ejecución vive en tablas estructuradas:

- `assignment_progress`: una fila por schedule, grupo, fecha y bloque, con estado `planned`, `completed` o `cancelled`;
- `activity_cycles`: ciclos reales numerados por usuario y `group_id`;
- `cycle_requirements`: snapshot de actividades activas y elegibles al abrir el ciclo.

`initialize_schedule_execution()` lee el snapshot guardado y crea únicamente las filas faltantes. Por eso guardar o abrir varias veces no duplica progreso. `set_assignment_progress_status()` aplica en una sola transacción el cambio de assignment, el requirement y el cierre o reapertura del ciclo. `set_cycle_requirement_status()` permite exonerar explícitamente un requisito pendiente.

Solo `completed` forma parte de `realHistory`. `planned` y `cancelled` nunca completan requisitos. Los `projectedCycles` siguen siendo una simulación del resultado del motor y no se persisten ni se mezclan con `activity_cycles`.

Las funciones usan la sesión del usuario, son `security invoker` y validan `auth.uid()`. La aplicación Angular solo necesita la URL y la clave publishable/anon; nunca una clave `service_role`.

Para no destruir historial real por accidente, la UI rechaza eliminar una programación que ya tenga assignments `completed`. Una programación sin completados conserva el comportamiento de eliminación existente.

## Desarrollo

```powershell
npm install
npm start
```

Después crea una cuenta con email y contraseña. Si la confirmación de email está activa en Supabase, confirma el correo antes de iniciar sesión.
