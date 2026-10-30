-- Pases de Apple Wallet que se actualizan solos (servicio web de PassKit):
-- notificaciones al invitado (cuenta regresiva, bienvenida al escanear, avisos
-- del organizador) y cambios del pase (hora, dirección, mesa) sin volver a
-- descargarlo. Ver services/wallet/ y router/wallet.js.
--
-- · wallet_passes: un renglón por pase emitido (número de serie fijo por
--   invitado: "inv-<invitación>-<invitado>" o "side-<evento>-<invitado>") con
--   su token, el último aviso y los hitos de la cuenta regresiva ya enviados.
-- · wallet_devices / wallet_registrations: los iPhone que agregaron cada pase
--   (Wallet los registra solo) y su token de notificaciones.
-- · wallet_geocodes: caché de coordenadas y nombre del lugar por link de
--   Google Maps (pantalla de bloqueo cerca del lugar).
--
-- Solo las lee y escribe el backend (service role): sin policies para anon.

create table if not exists public.wallet_passes (
  serial_number   text primary key,
  kind            text not null check (kind in ('invitacion', 'side')),
  invitation_id   uuid,
  side_event_id   bigint,
  guest_id        bigint not null,
  auth_token      text not null,
  -- Fecha del evento (para la cuenta regresiva y el vencimiento).
  evento_fecha    timestamptz,
  -- Último aviso que se mandó (va en el reverso del pase con changeMessage).
  aviso           text,
  aviso_at        timestamptz,
  -- Hitos de la cuenta regresiva ya enviados (ej. {7,1,0}).
  hitos           int[] not null default '{}',
  bienvenida_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists wallet_passes_invitation_idx on public.wallet_passes (invitation_id);
create index if not exists wallet_passes_side_idx on public.wallet_passes (side_event_id);
create index if not exists wallet_passes_fecha_idx on public.wallet_passes (evento_fecha);

create table if not exists public.wallet_devices (
  device_library_id text primary key,
  push_token        text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.wallet_registrations (
  device_library_id text not null references public.wallet_devices (device_library_id) on delete cascade,
  serial_number     text not null references public.wallet_passes (serial_number) on delete cascade,
  created_at        timestamptz not null default now(),
  primary key (device_library_id, serial_number)
);

create index if not exists wallet_registrations_serial_idx on public.wallet_registrations (serial_number);

create table if not exists public.wallet_geocodes (
  clave      text primary key,
  lat        double precision,
  lng        double precision,
  nombre     text,
  created_at timestamptz not null default now()
);

alter table public.wallet_passes enable row level security;
alter table public.wallet_devices enable row level security;
alter table public.wallet_registrations enable row level security;
alter table public.wallet_geocodes enable row level security;

revoke all on public.wallet_passes, public.wallet_devices, public.wallet_registrations, public.wallet_geocodes from anon, authenticated;
