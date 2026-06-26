create table if not exists public.license_activations (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null unique,
  app_id text not null,
  app_version text,
  hwid text not null,
  machine_platform text,
  machine_hostname text,
  request_nonce text,
  request_created_at timestamptz,
  customer_name text,
  store_name text,
  features text[] not null default array['offline-pos'],
  issued_at timestamptz not null,
  expires_at timestamptz,
  issued_by text not null default 'activation-site',
  requester_ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists license_activations_hwid_idx
  on public.license_activations (hwid);

create index if not exists license_activations_created_at_idx
  on public.license_activations (created_at desc);

create table if not exists public.activation_site_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  license_id uuid,
  hwid text,
  metadata jsonb not null default '{}'::jsonb,
  requester_ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists activation_site_events_created_at_idx
  on public.activation_site_events (created_at desc);

create index if not exists activation_site_events_type_idx
  on public.activation_site_events (event_type);
