# I attend — Luma AI Agent

## Qué es esto
iAttend es una plataforma de gestión de invitaciones para eventos (bodas principalmente).
Tiene dos frontends:
- **iattend.site** — dashboard del organizador (React + Ant Design + Vite)
- **iattend.events** — portal del invitado para confirmar asistencia

El backend es **Node.js + Express** conectado a **Supabase** como base de datos.

**Luma** es la asistente AI de wedding planning integrada en iAttend.

---

## Stack

- **Backend:** Node.js + Express + JavaScript — puerto 4000
- **Frontend:** React + Vite + Ant Design
- **Base de datos:** Supabase (PostgreSQL)
- **Pagos:** Stripe (ya integrado)
- **AI:** Claude Sonnet 4.5 (Anthropic) — modelo único para todas las interacciones

---

## Estructura de carpetas del backend

```
backend/
├── config/
│   ├── supabase.js           ← cliente Supabase existente
│   └── ai.config.js          ← clientes AI y costos por token
├── models/
│   ├── ai.models.js          ← wrappers de modelos AI
│   └── ai.orchestrator.js    ← clasificador de intent + function calling
├── routes/
│   ├── ai.chat.route.js      ← endpoints principales de Luma
│   └── ai.credits.route.js   ← consulta de créditos
└── index.js                  ← registro de rutas
```

---

## Endpoints de Luma

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | /api/ai/greeting | Saludo inicial al abrir Luma — no consume crédito |
| POST | /api/ai/chat | Mensaje al agente — consume 1 crédito |
| POST | /api/ai/chat/approve | Aprobar acción pendiente |
| POST | /api/ai/chat/reject | Rechazar acción pendiente |
| GET | /api/ai/credits/:invitationId | Ver créditos disponibles |
| GET | /api/ai/credits/packages/list | Ver paquetes disponibles |

---

## Sistema de créditos

- Los créditos viven en `invitations.credits` — no hay tabla separada
- 1 consulta al agente = 1 crédito
- La compra de créditos usa el Stripe existente de iAttend
- `consume_ai_credit(invitation_id)` descuenta 1 crédito atómicamente
- Si credits = 0 → error 402 NO_CREDITS

---

## Cómo funciona Luma — flujo completo

```
Usuario abre /luma?id=uuid
  → Frontend genera session_id = crypto.randomUUID() (en memoria)
  → messages = [] en estado React
  → Llama POST /api/ai/greeting → muestra bienvenida personalizada

Usuario escribe mensaje
  → Frontend manda { invitation_id, message, session_id, 
                     conversation_history: messages.slice(-6) }
  → Backend usa conversation_history del frontend — NO consulta DB
  → Luma responde usando tools (RPCs de Supabase)
  → Backend guarda en ai_conversations (analytics) pero NO lo lee
  → Frontend actualiza messages[] en memoria

Usuario cierra Luma
  → messages[] se pierde — React desmonta
  → Próxima apertura = sesión limpia sin contexto anterior
```

**Supabase es solo escritura para el agente:**
- `ai_conversations` → se escribe para analytics, nunca se lee para contexto
- `ai_agent_logs` → registro de tokens y costo por llamada
- `ai_pending_actions` → se lee y escribe — es la tabla activa en ejecución
- `invitations.credits` → se descuenta con cada consulta

---

## Tablas en Supabase

### Modificadas en Fase 1
- `guests` — ENUMs: guest_state, guest_type, action_actor
  - `state`: creado | esperando | confirmado | rechazado | asistente
  - `type`: female | male | child | undefined
  - `last_action_by`: admin | guest | system
  - `companion_id`: bigint FK → guests.id
  - Campos nuevos: invitation_sent_at, reminder_count, last_reminder_at, special_needs
- `invitations` — campos nuevos: event_date (con trigger auto-sync), rsvp_deadline, credits
- `tables` — sin cambios

### Nuevas en Fase 2
- `ai_conversations` — historial de mensajes (analytics only, no se lee para contexto)
- `ai_agent_logs` — registro de llamadas al modelo (tokens, costo, duración)
- `ai_pending_actions` — acciones propuestas esperando confirmación del usuario
- `ai_agent_credits` — tabla reservada, no se usa activamente

### Notas importantes
- `confirmado` y `asistente` son equivalentes — ambos significan que el invitado viene
- `side_events_guests` es tabla paralela a guests — NO recibió cambios de Fase 1
- `last_action_by` en `side_events_guests` sigue siendo boolean (true=admin, false=guest)
- `companion_id` en guests era text, ahora es bigint FK → guests.id

---

## Funciones RPC en Supabase

### Lectura
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

### Escritura (requieren confirmación del usuario)
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

### Billing
```
consume_ai_credit(p_invitation_id)
  → UPDATE invitations SET credits = credits - 1
  → atómico — usa FOR UPDATE para evitar race conditions
  → retorna credits_remaining o error NO_CREDITS

log_ai_interaction(p_invitation_id, p_model, p_tokens_in, p_tokens_out,
                   p_cost_usd, p_tool_called, p_conversation_id,
                   p_duration_ms, p_success, p_error_message)
```

---

## Variables de entorno (.env backend)

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...          # instalado pero no en uso activo
GEMINI_API_KEY=AI...           # instalado pero no en uso activo
FRONTEND_URL=https://iattend.site
```

---

## Personalidad de Luma

- **Nombre:** Luma
- **Tono:** Cálida y empática, como una amiga experta en bodas
- **Idioma:** Español siempre
- **Proactiva:** Al abrir el chat analiza el evento y dice algo relevante
- **Directa:** Máximo 3-4 líneas por respuesta salvo que se pida más detalle
- **Sin tecnicismos:** Nunca menciona nombres de funciones, IDs internos ni términos de DB

### Terminología interna vs lenguaje al usuario
| Interno | Al usuario |
|---------|-----------|
| tier A/B/C/D | Prioridad Alta/Media/Baja/Muy Baja |
| table_id | número/nombre de mesa |
| guest_id | nombre del invitado |
| state: confirmado/asistente | confirmado (son equivalentes) |
| action_actor: system | acción de Luma |

---

## Flujo de confirmación de acciones

```
Luma propone acción
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

---

## Creación de mesas — flujo estricto

Datos obligatorios: nombre, capacidad, forma
- Si falta alguno → preguntar de a uno en este orden: nombre → capacidad → forma
- Si forma = rectangle → preguntar orientación (vertical/horizontal)
- Pista de baile: se crea con name="Pista de Baile", size=0, shape="dance" sin preguntar nada
- Cualquier texto que dé el usuario ES un nombre válido
- Si hay ambigüedad → confirmar antes de proceder, no rechazar

---

## Fase actual: Fase 1 — Testeo y estabilización

Objetivo: Luma responde correctamente el 90%+ de consultas simples y ejecuta acciones individuales sin errores.

### Bugs conocidos / pendientes
- Loop en creación de mesas cuando el nombre es ambiguo (en progreso)
- Timestamp de mensajes WhatsApp puede variar por zona horaria

### Siguiente fase (Fase 2)
- bulk_update_guest_state — cambiar estado a múltiples invitados
- bulk_assign_table — asignar múltiples invitados a una mesa
- bulk_update_by_filter — operar por filtros (tag, side, tier)