# Supabase: autenticación y programaciones guardadas

## Flujo principal

La aplicación Angular usa directamente Supabase Auth y la tabla `saved_schedules` protegida por Row Level Security. El scheduler sigue siendo TypeScript puro y no conoce Supabase.

```text
Angular -> Supabase Auth
        -> saved_schedules (PostgreSQL administrado + RLS)
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

En el SQL Editor de Supabase ejecuta íntegramente `supabase/setup.sql`. El script crea la tabla, índice, actualización automática de `updated_at`, activa RLS y define políticas separadas de SELECT, INSERT, UPDATE y DELETE para `auth.uid()`.

## Datos guardados

Cada fila contiene metadata consultable y `schedule_data` JSONB con:

- `schemaVersion`;
- snapshot de temporada, categorías, grupos, actividades, elegibilidad y bloques;
- assignments y unassigned de planificación;
- bloques generados, métricas y diagnósticos.

No se guardan `projectedCycles` ni se marcan assignments como historial completado. Al abrir una fila, Angular reconstruye las vistas desde el JSON guardado sin llamar a `generateSchedule()`.

## Desarrollo

```powershell
npm install
npm start
```

Después crea una cuenta con email y contraseña. Si la confirmación de email está activa en Supabase, confirma el correo antes de iniciar sesión.
