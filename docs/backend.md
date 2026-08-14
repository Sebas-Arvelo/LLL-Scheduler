# Backend y persistencia

> Estado actual: esta infraestructura Express/PostgreSQL se conserva como legado opcional. El flujo principal del frontend usa Supabase directamente y está documentado en `docs/supabase.md`; ejecutar Angular ya no requiere este backend ni PostgreSQL local.

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

La versión requerida por el proyecto es Node `22.23.2`, indicada en `.nvmrc`. En Windows, con NVM for Windows instalado:

```powershell
nvm install 22.23.2
nvm use 22.23.2
node --version
npm install
```

No desinstales otras versiones de Node. Si `nvm` no existe, instala primero NVM for Windows desde su distribución oficial o instala Node 22.23.2 mediante el instalador oficial. En la validación de Fase 6.5 de esta máquina no estaban instalados NVM ni PostgreSQL; por ello no se asumieron credenciales ni se ejecutaron operaciones de base de datos.

PostgreSQL debe estar instalado como servicio local y `psql` debe estar disponible. Un gestor estándar disponible en Windows puede mostrar la opción de instalación con `winget search PostgreSQL`; revisa el identificador y versión antes de ejecutar cualquier instalación del sistema.

Conéctate con un rol PostgreSQL local que tú controles y crea dos bases separadas:

```powershell
createdb lll_scheduler_dev
createdb lll_scheduler_test
```

Si el servidor requiere usuario o contraseña, pásalos mediante las opciones normales de PostgreSQL y completa las URLs locales con esas credenciales. No copies contraseñas a archivos versionados ni reutilices credenciales de otros proyectos.

Después:

1. Copia `.env.example` a `.env`.
2. Define `DATABASE_URL` apuntando exclusivamente a `lll_scheduler_dev`.
3. Define `TEST_DATABASE_URL` apuntando exclusivamente a `lll_scheduler_test`.
4. Mantén ambas URLs diferentes.

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

En PowerShell, verifica primero `node --version` y después prepara desarrollo:

```powershell
npm run db:migrate
npm run db:seed:demo
```

Los dos comandos pueden repetirse: migraciones ya aplicadas se omiten y el seed usa upserts/constraints para no duplicar datos. Levanta los procesos en terminales separadas:

```powershell
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

Pruebas rápidas, que no acceden a PostgreSQL:

```powershell
npm run backend:test
npm test
npm run build
```

Integración PostgreSQL real:

```powershell
npm run backend:test:postgres
```

La suite rápida usa repositorios en memoria y un pool controlado. La suite PostgreSQL recrea el schema `public` de la base de test, migra dos veces, ejecuta el seed dos veces, prueba repositorios y API reales, verifica snapshot, rollback y constraints. Si `TEST_DATABASE_URL` falta, se reporta como omitida.

Antes de limpiar datos, la suite PostgreSQL se niega a continuar salvo que:

- el nombre de base termine en `_test`;
- el host sea `localhost`, `127.0.0.1` o `::1`;
- `TEST_DATABASE_URL` sea diferente de `DATABASE_URL`.

Nunca usa `DATABASE_URL` como fallback. La base de desarrollo no se limpia desde tests.

## Evolución prevista

- Persistir disponibilidad de grupos y actividades cuando el flujo de configuración la incorpore.
- Añadir confirmación/cancelación/completado operativo y auditoría de cambios.
- Materializar ciclos reales solo a partir de eventos completados, sin reutilizar timestamps proyectados.
- Incorporar autenticación, autorización y trazabilidad de usuario antes de exposición pública.
- Añadir pruebas contra una instancia PostgreSQL efímera en CI.
