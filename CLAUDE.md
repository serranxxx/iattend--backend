# CLAUDE.md — iattend--backend

## Qué es este repo
API REST en Node/Express que da servicio a los dos frontends de I attend
(`iattend.site` para el organizador y `iattend.events` para el invitado):
autenticación, invitaciones, invitados, mesas, pagos con Stripe, envío de
WhatsApp/email, generación de Apple Wallet passes, y el agente de IA **Lia**
(wedding planning assistant). El `package.json` conserva el nombre histórico
`lovelink---backend` — el producto se renombró a iAttend pero el repo no.

## Stack técnico
- Framework: Express 4
- Lenguaje: JavaScript (CommonJS, sin TypeScript)
- Estilos: no aplica (backend puro, sin vistas)
- Librería de UI base: no aplica
- Bases de datos: Supabase/Postgres para prácticamente todo (invitaciones,
  invitados, Lia, WhatsApp, storage), más MongoDB vía Mongoose (`DB_CNN`)
  sobreviviendo únicamente para el login legacy (`/api/auth`, ver gotchas)
- IA: `@anthropic-ai/sdk` (Claude Sonnet 4.5, modelo principal de Lia),
  `openai` y `@google/generative-ai` (Gemini, usado como clasificador de
  intent barato en el orquestador)
- Pagos: `stripe`
- Mensajería: WhatsApp Cloud API vía `axios`, email vía `nodemailer`
- Apple Wallet: `passkit-generator`
- Otras dependencias clave: `jsonwebtoken` + `bcryptjs` (auth propia, no
  Supabase Auth, para el login legacy), `multer` (upload de fotos), `nocache`

## Cómo se conecta con el resto de I attend
- **iattend.site / iattend.events**: consumen esta API por HTTP. El login
  legacy (`/api/auth`) sigue en uso real desde `iattend-vite` (Login, alta de
  usuario en Admin, modal de auth en PreviewMood/Checkout) vía JWT en el
  header `token` (no `Authorization: Bearer`); las rutas basadas en Supabase
  (`/api/invitation`, `/api/ai`, `/api/guests`, `/api/photos`… según el caso)
  se identifican por `invitation_id`/`guest_id` sin pasar por ese JWT.
- **Supabase**: conexión directa vía `config/supabase.js` con la
  `SERVICE_ROLE_KEY` (bypassa RLS — este backend es la única capa de
  autorización para esas tablas). Toca `invitations`, `guests`,
  `ai_conversations`, `ai_agent_logs`, `ai_pending_actions`, `checkout_queue`,
  `side_events`, `invitation_message_dispatches`,
  `whatsapp_freetext_dispatches`, y el bucket de Storage `media`. Además
  llama RPCs de lectura, escritura y billing (catálogo completo en la sección
  **Lia AI — detalle del agente** al final de este archivo).
- **MongoDB**: conexión directa vía Mongoose (`database/config.js`),
  independiente de Supabase. Solo queda el modelo `user` (`models/user.js`),
  usado por `controllers/auth.js` para el login/registro legacy — todo lo
  demás que corría sobre Mongo (invitaciones, invitados, tags, rsvp del
  producto "Lovelink") se eliminó por no tener consumidores reales en los
  frontends actuales.
- **Stripe**: integración directa (no vía un servicio intermedio). El backend
  crea Checkout Sessions y también escucha el webhook de Stripe
  (`/api/payment/webhook`) para acreditar créditos/planes.
- **WhatsApp Cloud API**: este backend envía plantillas y texto libre, y
  recibe el webhook entrante (`/api/webhook/whatsapp`) que persiste los
  mensajes en Supabase.

## Estructura de carpetas clave
```
config/             clientes de servicios externos (Supabase, IA, Stripe products)
controllers/        lógica de negocio por dominio (auth, invitation, payment,
                    whatsapp, wallet, mailer, iattend-ai)
  templates/         plantillas de email (HTML armado en JS)
database/           conexión a MongoDB (config.js) — solo para /api/auth
helpers/            utilidades transversales (jwt.js)
middlewares/         validar-jwt.js — único middleware de auth
models/             user.js (Mongoose, login legacy) + módulos del agente Lia
                    (ai.orchestrator.js, sonnet.stream.loop.js)
router/             definición de rutas Express, una por dominio
services/wallet/     generación de Apple Wallet passes (walletService.js)
certificates/        certificados .p12 / WWDR para Apple Wallet (no tocar a mano)
index.js            registro de middlewares, CORS, montaje de rutas, arranque
```

## Convenciones y patrones que hay que respetar
- Cada dominio sigue el patrón `router/*.js` (solo rutas + middleware) →
  `controllers/*.js` (lógica). Excepción: `controllers/payment.js` se exporta
  a sí mismo como router y se monta directo en `index.js`.
- El JWT propio (no Supabase Auth) se manda en el header literal `token`, se
  firma con `SECRET_JWT_SEED`, expira en 8h, y solo lleva `{ uid, name }`.
  `validarJWT` es el único middleware que lo valida.
- Todo lo que toca Supabase pasa por RPCs para las operaciones de escritura
  (nunca `update`/`insert` directo desde el agente de Lia). Las acciones que
  modifican datos desde Lia requieren confirmación explícita del usuario vía
  la tabla `ai_pending_actions` antes de ejecutarse.
- El webhook de Stripe (`/api/payment/webhook`) va **antes** de
  `express.json()` en `index.js` y usa `express.raw()` porque necesita el
  body crudo para verificar la firma — si se mueve después del parser JSON,
  se rompe la verificación.
- El endpoint de créditos (`/api/ai/credits`) se monta **antes** de
  `express.json()`/`express.urlencoded()` también; respeta el orden
  existente al agregar rutas nuevas.
- CORS es una allowlist explícita en `index.js` (`allowedOrigins`) — un
  dominio nuevo de frontend hay que agregarlo ahí a mano.
- Costos de IA se calculan en `config/ai.config.js` (`calculateCost`) y se
  registran vía `log_ai_interaction` — cualquier modelo/proveedor nuevo debe
  agregarse a `MODELS`/`TOKEN_COSTS` ahí.
- Personalidad y terminología de Lia (tiers, estados, ids internos vs.
  lenguaje al usuario) están documentadas en la sección dedicada al final de
  este archivo — no exponer nombres de funciones, RPCs ni IDs internos en las
  respuestas del agente.

## Endpoints principales de la API
| Prefijo | Router | Qué hace |
|---|---|---|
| `/api/auth` | `router/auth.js` | login/registro legacy (Mongo + bcrypt) — sigue en uso real desde `iattend-vite`; algunas rutas también tocan `profiles` en Supabase |
| `/api/invitation` | `router/invitation.js` | invitaciones actuales sobre Supabase: crear desde preview, planes, créditos, datos del evento |
| `/api/ai` | `router/ai.chat.route.js`, `router/ai.credits.route.js`, `router/iattendai.js` | Lia (greeting/chat/approve/reject/feedback), consulta de créditos, generación de invitación por IA |
| `/api/mail` | `router/mailer.js` | envío de emails transaccionales (gift, notificaciones) |
| `/api/whats` | `router/whatsapp.js` | envío de plantillas WhatsApp y texto libre; `/api/whats/reminders` envía el template `reminder` (recordatorio manual, registra en `invitation_reminder_dispatches` e incrementa `guests.reminder_count`/`last_reminder_at` del principal) |
| `/api/webhook` | `router/webhook.js` | webhook entrante de WhatsApp (verify + receive) |
| `/api/payment` | `controllers/payment.js` | Stripe Checkout (créditos, planes, side events, preview) |
| `/api/payment/webhook` | montado directo en `index.js` | webhook de Stripe (raw body) |
| `/api/wallet` | `router/wallet.js` | generación de pase Apple Wallet |
| `/api/photos` | `router/photos.js` | fotos subidas por invitados (upload, likes) sobre Supabase Storage |
| `/api/guests/import` | `router/guestImport.js` | carga masiva de invitados desde Excel: normaliza con Gemini (incluye `owners` y `tags` del evento como contexto para `side`/`tag`) y confirma el insert (gratis, no consume créditos) |

## Comandos frecuentes
```bash
# instalar
npm install

# correr en dev (nodemon, puerto definido por PORT en .env)
npm run dev

# build
# no aplica — no hay paso de build, es Node plano

# tests
npm test   # no hay suite configurada (placeholder que falla)
```

## Variables de entorno que necesita
```
PORT
DB_CNN
SECRET_JWT_SEED
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
OPENAI_API_KEY
GEMINI_API_KEY
STRIPE_SECRET_KEY
STRIPE_PUBLIC_KEY
STRIPE_WEBHOOK_SECRET
EMAIL_USER
EMAIL_PASS
WA_ACCESS_TOKEN
WA_PHONE_NUMBER_ID
WA_WEBHOOK_VERIFY_TOKEN
APPLE_TEAM_ID
APPLE_PASS_TYPE_ID
APPLE_WALLET_CERT_PASSWORD
APPLE_WALLET_P12_BASE64
APPLE_WWDR_CERT_BASE64
CLIENT_URL   # presente en .env pero no se referencia en ningún .js actualmente
```

## Cosas que hay que saber antes de tocar este repo (gotchas)
- **MongoDB solo existe para `/api/auth`**: en 2026-07 se eliminaron las
  rutas/controllers/models legacy que corrían sobre Mongo para invitaciones,
  invitados, tags y rsvp (producto "Lovelink") tras confirmar que ningún
  frontend activo los consumía. Lo único que queda en Mongo es `models/user.js`,
  usado por `controllers/auth.js` porque `iattend-vite` todavía depende de
  `/api/auth/create-user` (Login, alta de usuario en Admin, modal de auth en
  PreviewMood/Checkout). No asumas que "guests" se refiere a un solo sistema:
  la tabla `guests` de Supabase (la que usa Lia) es independiente de
  cualquier cosa relacionada a Mongo.
- El JWT de auth usa el header `token`, no el estándar `Authorization:
  Bearer` — cualquier cliente nuevo (o Postman) tiene que mandarlo así.
- `SUPABASE_SERVICE_ROLE_KEY` se usa en todas las llamadas a Supabase — este
  backend bypassa RLS por completo, así que cualquier validación de permisos
  tiene que vivir en el código del controller/RPC, no se puede confiar en
  policies de Supabase.
- El webhook de Stripe necesita el body sin parsear; si algo se reordena en
  `index.js` alrededor de `express.json()` puede romper la verificación de
  firma silenciosamente.
- Los certificados de Apple Wallet (`certificates/apple-wallet/*`) están en
  el repo pero en producción (DigitalOcean App Platform) se decodifican
  desde variables de entorno en Base64 (`APPLE_WALLET_P12_BASE64`,
  `APPLE_WWDR_CERT_BASE64`) — no hardcodear rutas a los archivos del repo
  para el flujo de producción.
- No hay tests automatizados (`npm test` es un placeholder que falla) — los
  cambios se validan manualmente contra los frontends.
- Lia no lee `ai_conversations` como contexto — el historial de conversación
  lo manda el frontend en cada request (`conversation_history`). Esa tabla es
  solo analytics de escritura.

## Pendientes / deuda técnica conocida
- Cuando `iattend-vite` migre su login/alta de usuario a Supabase Auth,
  `/api/auth`, `controllers/auth.js`, `models/user.js` y la conexión Mongo
  completa (`database/config.js`, dependencia `mongoose`) quedan libres para
  eliminarse.
- `CLIENT_URL` está definido en `.env` pero no se usa en ningún archivo
  `.js` — limpiar o cablear si tenía un propósito.
- Loop en creación de mesas cuando el nombre es ambiguo (ver lógica en
  `ai.chat.route.js` / `ai.orchestrator.js`).
- Timestamp de mensajes de WhatsApp puede variar por zona horaria.
- Fase 2 del agente Lia pendiente: `bulk_update_guest_state`,
  `bulk_assign_table`, `bulk_update_by_filter`.
- Carga masiva de invitados vía Excel (Fase 3): soporta `guests` y
  `side_events_guests` (verificado contra el esquema real por query
  directa — `side_events_guests` sí tiene `companion_id` bigint, `side`,
  `notes`, `meal`, `has_companion` y `ticket`; solo le falta
  `special_needs`). El selector de a qué `side_event` importar vive en
  `SideEvents.jsx` (variable `current?.id`).

---

## Lia AI — detalle del agente

Esta sección conserva el detalle operativo del agente Lia (créditos, tablas,
RPCs, personalidad, flujo de confirmación) que no encaja en las secciones
genéricas de arriba pero sigue siendo la referencia viva para trabajar sobre
`router/ai.chat.route.js`, `models/ai.orchestrator.js` y
`models/sonnet.stream.loop.js`.

### Sistema de créditos
- Los créditos viven en `invitations.credits` — no hay tabla separada
- 1 consulta al agente = 1 crédito
- La compra de créditos usa el Stripe existente de iAttend
- `consume_ai_credit(invitation_id)` descuenta 1 crédito atómicamente
- Si credits = 0 → error 402 NO_CREDITS

### Cómo funciona Lia — flujo completo
```
Usuario abre /luma?id=uuid   (la URL conserva el nombre "luma"; el bot que
                              corre ahí ya es Lia — ver naming en Pendientes)
  → Frontend genera session_id = crypto.randomUUID() (en memoria)
  → messages = [] en estado React
  → Llama POST /api/ai/greeting → muestra bienvenida personalizada

Usuario escribe mensaje
  → Frontend manda { invitation_id, message, session_id,
                     conversation_history: messages.slice(-6) }
  → Backend usa conversation_history del frontend — NO consulta DB
  → Lia responde usando tools (RPCs de Supabase)
  → Backend guarda en ai_conversations (analytics) pero NO lo lee
  → Frontend actualiza messages[] en memoria

Usuario cierra Lia
  → messages[] se pierde — React desmonta
  → Próxima apertura = sesión limpia sin contexto anterior
```

**Supabase es solo escritura para el agente:**
- `ai_conversations` → se escribe para analytics, nunca se lee para contexto
- `ai_agent_logs` → registro de tokens y costo por llamada
- `ai_pending_actions` → se lee y escribe — es la tabla activa en ejecución
- `invitations.credits` → se descuenta con cada consulta

### Tablas en Supabase

**Modificadas en Fase 1**
- `guests` — ENUMs: guest_state, guest_type, action_actor
  - `state`: creado | esperando | confirmado | rechazado | asistente
  - `type`: female | male | child | undefined
  - `last_action_by`: admin | guest | system
  - `companion_id`: bigint FK → guests.id
  - Campos nuevos: invitation_sent_at, reminder_count, last_reminder_at, special_needs
- `invitations` — campos nuevos: event_date (con trigger auto-sync), rsvp_deadline, credits
- `tables` — sin cambios

**Nuevas en Fase 2**
- `ai_conversations` — historial de mensajes (analytics only, no se lee para contexto)
- `ai_agent_logs` — registro de llamadas al modelo (tokens, costo, duración)
- `ai_pending_actions` — acciones propuestas esperando confirmación del usuario
- `ai_agent_credits` — tabla reservada, no se usa activamente

**Notas importantes**
- `confirmado` y `asistente` son equivalentes — ambos significan que el invitado viene
- `side_events_guests` es tabla paralela a guests — NO recibió cambios de Fase 1
- `last_action_by` en `side_events_guests` sigue siendo boolean (true=admin, false=guest)
- `companion_id` en guests era text, ahora es bigint FK → guests.id

### Funciones RPC en Supabase

**Lectura**
```
get_event_summary(p_invitation_id)
  → resumen completo: conteos por estado, mesas, distribución, créditos

get_guests_by_status(p_invitation_id, p_state, p_tier, p_side, p_tag, p_type)
  → lista filtrada con days_since_sent y days_since_reminder
  → ILIKE en tier, side, tag (case-insensitive)
  → p_type usa el enum guest_type

get_whatsapp_history(p_guest_id)
  → dispatches + incoming_messages cronológicos de un invitado

get_tables_occupancy(p_invitation_id)
  → mesas con capacidad, ocupados, disponibles, lista de invitados
  → ignora mesas con size=0 (pista de baile)

get_guests_without_table(p_invitation_id)
  → invitados con state IN (confirmado, asistente) sin mesa asignada

get_failed_dispatches(p_invitation_id)
  → evalúa ÚLTIMO dispatch por invitado — un fallo anterior no cuenta
    si el último intento fue exitoso

get_unread_messages(p_invitation_id)
  → mensajes WhatsApp sin leer, ligados al invitado
  → normaliza teléfonos: RIGHT(regexp_replace(phone, '[^0-9]','','g'), 10)
  → incluye hours_ago calculado

get_latest_messages(p_invitation_id, p_limit)
  → últimos N mensajes recibidos (leídos o no)
  → normalización de teléfonos incluida

get_event_details(p_invitation_id)
  → extrae del JSON data: itinerario, dresscode, avisos, people,
    destinations, gifts, quote, greeting

get_seen_not_replied(p_invitation_id)
  → invitados que recibieron/leyeron la invitación pero no respondieron
```

**Escritura (requieren confirmación del usuario)**
```
update_guest_state(p_guest_id, p_new_state, p_actor)
  → actualiza state, guarda anterior en last_action

assign_guest_table(p_guest_id, p_table_id)
  → valida disponibilidad antes de asignar

create_table(p_invitation_id, p_name, p_size, p_shape, p_vertical, p_number)
  → shapes válidos: round | square | rectangle | dance
  → dance puede tener size=0
  → coordenadas automáticas: x = MAX(x) + 150, y = 0

update_event_date(p_invitation_id, p_new_date)
  → actualiza event_date Y data->cover->date->value simultáneamente
```

**Billing**
```
consume_ai_credit(p_invitation_id)
  → UPDATE invitations SET credits = credits - 1
  → atómico — usa FOR UPDATE para evitar race conditions
  → retorna credits_remaining o error NO_CREDITS

log_ai_interaction(p_invitation_id, p_model, p_tokens_in, p_tokens_out,
                   p_cost_usd, p_tool_called, p_conversation_id,
                   p_duration_ms, p_success, p_error_message)
```

**Carga masiva de invitados** (feature separada de Lia — no pasa por
`ai_pending_actions`, la revisión/edición ocurre en el wizard del
frontend antes de confirmar; ver `router/guestImport.js`)
```
bulk_create_guests(p_invitation_id, p_side_events_id, p_target_table, p_rows)
  → inserta un batch de invitados normalizados por Gemini
  → p_target_table: 'guests' (usa p_invitation_id, p_side_events_id null)
    o 'side_events_guests' (usa p_side_events_id, p_invitation_id null)
  → side_events_guests no tiene columna special_needs — el backend la
    descarta antes de mandar la fila a esta RPC cuando aplica
  → p_rows es un array jsonb, cada elemento ya viene con password
    generado por helpers/simpleId.js
  → retorna TABLE(id, name) en el mismo orden del array de entrada —
    el backend hace zip índice a índice, no hay columna de correlación

bulk_set_guest_companions(p_target_table, p_pairs)
  → p_target_table: 'guests' o 'side_events_guests', actualiza esa tabla
  → p_pairs: [{ guest_id, companion_id }] ya resueltos por nombre en
    Node (companion_of del Excel se resuelve contra el resultado de
    bulk_create_guests, no dentro de SQL)
  → guest_id = acompañante, companion_id = invitado principal
  → UPDATE companion_id en el acompañante, has_companion=true en el principal
```
SQL completo en `migrations/2026-07-09_bulk_create_guests.sql` — hay que
correrlo a mano en el SQL editor de Supabase, no hay pipeline de
migraciones en este repo.

### Personalidad de Lia
- **Nombre:** Lia
- **Tono:** Cálida y empática, como una amiga experta en bodas
- **Idioma:** Responde en el mismo idioma en el que le escribe el usuario
  (español por defecto si no hay pistas claras del idioma)
- **Proactiva:** Al abrir el chat analiza el evento y dice algo relevante
- **Directa:** Máximo 3-4 líneas por respuesta salvo que se pida más detalle
- **Sin tecnicismos:** Nunca menciona nombres de funciones, IDs internos ni términos de DB

**Terminología interna vs lenguaje al usuario**
| Interno | Al usuario |
|---------|-----------|
| tier A/B/C/D | Prioridad Alta/Media/Baja/Muy Baja |
| table_id | número/nombre de mesa |
| guest_id | nombre del invitado |
| state: confirmado/asistente | confirmado (son equivalentes) |
| action_actor: system | acción de Lia |

### Flujo de confirmación de acciones
```
Lia propone acción
  → executeTool retorna { requires_confirmation: true, payload, preview_text }
  → Backend INSERT ai_pending_actions { status: 'pending' }
  → Respuesta incluye pending_actions con id real de la tabla

Frontend muestra card con preview_text + botones Aprobar/Cancelar

Usuario aprueba → POST /api/ai/chat/approve { action_id, invitation_id }
  → Backend ejecuta RPC correspondiente
  → UPDATE ai_pending_actions SET status = 'executed'
  → Frontend elimina card, agrega mensajes locales "Aprobé..." + "Listo ✓"
  → NO llama al backend de chat después del approve

Usuario cancela → POST /api/ai/chat/reject { action_id }
  → UPDATE ai_pending_actions SET status = 'rejected'
  → Frontend elimina card
```

### Creación de mesas — flujo estricto
Datos obligatorios: nombre, capacidad, forma
- Si falta alguno → preguntar de a uno en este orden: nombre → capacidad → forma
- Si forma = rectangle → preguntar orientación (vertical/horizontal)
- Pista de baile: se crea con name="Pista de Baile", size=0, shape="dance" sin preguntar nada
- Cualquier texto que dé el usuario ES un nombre válido
- Si hay ambigüedad → confirmar antes de proceder, no rechazar

### Fase actual: Fase 1 — Testeo y estabilización
Objetivo: Lia responde correctamente el 90%+ de consultas simples y ejecuta acciones individuales sin errores.
