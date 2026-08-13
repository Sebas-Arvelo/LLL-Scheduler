# Backend y persistencia

## Alcance de esta fase

El repositorio conserva Angular y el motor de scheduling existentes, y añade una API Node/Express en `backend/`. PostgreSQL es la fuente persistente para la configuración base y las programaciones generadas. El scheduler continúa siendo TypeScript puro y se ejecuta en el frontend; la API valida el resultado y lo almacena, pero no vuelve a generar ni modifica el plan.

Express es suficiente aquí porque la API inicial es pequeña, HTTP convencional y no necesita el contenedor ni las abstracciones de un framework más pesado. El acceso a datos usa `pg` directamente para mantener SQL visible y migraciones controladas.

Se persiste:

- temporada, categorías, grupos, actividades, elegibilidad y bloques horarios;
- metadatos de cada programación, seed y versión del algoritmo;
- asignaciones generadas con estado `planned`;
- celdas sin asignación y su causa estructurada;
- una snapshot JSONB de la configuración exacta usada al generar.

No se persisten los ciclos proyectados. Tampoco se crean eventos `completed`: una propuesta generada no es historial real. La confirmación operativa, el avance real de ciclos y las reglas de disponibilidad persistentes quedan deliberadamente para una fase posterior.

## Arquitectura

```text
Angular -> /api (proxy local) -> Express -> repositories -> PostgreSQL
                  |                |
                  |                +-- validación y errores HTTP
                  +-- contrato de guardado con snapshot
```

- `backend/src/app.ts`: rutas, CORS y manejo uniforme de errores.
- `backend/src/config`: lectura y validación de variables de entorno.
- `backend/src/db`: pool, transacciones, migrador y seed demo.
- `backend/src/repositories`: consultas PostgreSQL parametrizadas.
- `backend/src/validation`: validación del payload y de referencias/capacidades.
- `src/app/core/api`: contrato y cliente HTTP consumido por Angular.

Los IDs de configuración siguen siendo strings estables, compatibles con el dominio actual. Programaciones, asignaciones y registros sin asignación reciben UUID generados por la aplicación. PostgreSQL conserva claves foráneas, checks y unicidad; el guardado de una programación completa ocurre dentro de una sola transacción.

Las actividades son globales en esta primera versión; grupos y bloques pertenecen a una temporada. La elegibilidad permanece como relación global actividad-categoría, coherente con el contrato existente, y podrá especializarse por temporada cuando exista un caso funcional que lo requiera.

## Requisitos y configuración local

1. Usa la versión de Node indicada en `.nvmrc` y ejecuta `npm install`.
2. Instala PostgreSQL localmente o proporciona una instancia de desarrollo accesible.
3. Crea una base de desarrollo dedicada. No reutilices una base de producción ni la base de tests.
4. Copia `.env.example` a `.env` y reemplaza `DATABASE_URL` con credenciales locales reales.

Variables disponibles:

| Variable | Uso |
| --- | --- |
| `NODE_ENV` | `development`, `test` o `production`. |
| `BACKEND_PORT` | Puerto de Express; por defecto `3000`. |
| `DATABASE_URL` | URL de PostgreSQL. Es obligatoria al iniciar, migrar o sembrar. |
| `DATABASE_SSL` | `true` solo si la conexión requiere TLS verificable. |
| `CORS_ORIGIN` | Origen Angular permitido; por defecto `http://localhost:4200`. |
| `TEST_DATABASE_URL` | Reservada para pruebas de integración PostgreSQL aisladas. |

`.env` está ignorado por Git. `.env.example` contiene únicamente valores ilustrativos.

## Puesta en marcha

Ejecuta en terminales separadas:

```bash
npm run db:migrate
npm run db:seed:demo
npm run backend:start
npm start
```

El seed es idempotente, está bloqueado en `NODE_ENV=production` y carga `season-demo-2026` con los IDs que usa la UI actual. Las migraciones se registran en `schema_migrations` y se aplican en orden dentro de transacciones.

Angular redirige `/api` a `http://localhost:3000` mediante `proxy.conf.json`. El backend también limita CORS al origen configurado para permitir despliegues separados sin abrir la API a cualquier origen.

## API inicial

| Método | Ruta | Resultado |
| --- | --- | --- |
| `GET` | `/api/health` | Salud de API y disponibilidad de base de datos. |
| `GET` | `/api/seasons/:id/config` | Configuración relacional completa de una temporada. |
| `POST` | `/api/schedules` | Guarda snapshot, asignaciones y celdas sin asignación atómicamente. |
| `GET` | `/api/schedules/:id` | Recupera una programación completa. |
| `GET` | `/api/seasons/:seasonId/schedules` | Lista programaciones de una temporada. |

Los errores tienen la forma `{ "code": "BAD_REQUEST", "message": "..." }` y usan `400`, `404`, `409` o `500` según corresponda. Los mensajes internos y detalles de conexión no se exponen en respuestas `500`.

El `POST /api/schedules` exige que:

- fechas, seed, IDs y referencias sean válidos;
- temporada y bloques del snapshot coincidan;
- cada asignación tenga estado `planned` y use entidades activas/elegibles;
- no exista más de una asignación por grupo, fecha y bloque;
- una celda no figure simultáneamente asignada y sin asignación;
- las capacidades de grupos y participantes no sean excedidas.

## Snapshot y consistencia histórica

Las tablas relacionales representan la configuración vigente y permiten consultas e integridad referencial. La columna `schedules.configuration_snapshot` conserva además la configuración exacta que produjo un resultado. Así, cambiar posteriormente un nombre, una capacidad o una elegibilidad no reescribe el contexto histórico del plan guardado.

Las asignaciones siguen apuntando mediante claves foráneas a las entidades relacionales. Esta fase no duplica ciclos proyectados ni crea estados realizados de forma anticipada.

## Pruebas y seguridad de datos

```bash
npm run backend:test
npm test
npm run build
```

La suite backend usa repositorios en memoria para probar la API sin base compartida y un pool controlado para comprobar rollback. También inspecciona las restricciones esenciales de la migración. No toca una base de desarrollo.

Una futura suite de integración PostgreSQL debe usar exclusivamente `TEST_DATABASE_URL`, apuntar a una base cuyo nombre deje claro que es de tests, ejecutar migraciones al comenzar y limpiar solo esa base. Si la variable falta, esas pruebas deben omitirse; nunca deben recurrir silenciosamente a `DATABASE_URL`.

## Evolución prevista

- Persistir disponibilidad de grupos y actividades cuando el flujo de configuración la incorpore.
- Añadir confirmación/cancelación/completado operativo y auditoría de cambios.
- Materializar ciclos reales solo a partir de eventos completados, sin reutilizar timestamps proyectados.
- Incorporar autenticación, autorización y trazabilidad de usuario antes de exposición pública.
- Añadir pruebas contra una instancia PostgreSQL efímera en CI.
