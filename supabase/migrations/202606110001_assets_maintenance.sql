-- Cadastro operacional: tipos de ativo, ativos, planos e eventos de manutencao.
-- Todas as tabelas sao isoladas por usuario e edificacao via RLS.

create table public.asset_types (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  description text,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index asset_types_owner_name_key
  on public.asset_types(owner_id, lower(name));

create table public.maintenance_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  asset_type_id uuid not null references public.asset_types(id) on delete cascade,
  system_name text,
  component text,
  name text not null,
  periodicity_months integer,
  reference_cost numeric(14, 2) not null default 0,
  responsible text,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint maintenance_templates_periodicity_positive
    check (periodicity_months is null or periodicity_months > 0),
  constraint maintenance_templates_cost_nonnegative
    check (reference_cost >= 0)
);

create unique index maintenance_templates_owner_source_key
  on public.maintenance_templates(
    owner_id,
    lower(coalesce(system_name, '')),
    asset_type_id,
    lower(name),
    lower(coalesce(component, ''))
  );

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  building_id uuid not null references public.buildings(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  system_id uuid not null references public.systems(id) on delete restrict,
  asset_type_id uuid not null references public.asset_types(id) on delete restrict,
  external_code text not null,
  name text not null,
  subsystem text,
  component text,
  planned_action text,
  quantity numeric(12, 3) not null default 1,
  unit text,
  periodicity_months integer,
  last_maintenance_date date,
  next_maintenance_date date,
  installation_date date,
  expected_life_years numeric(8, 2),
  acquisition_value numeric(14, 2),
  estimated_unit_cost numeric(14, 2),
  estimated_total_cost numeric(14, 2),
  end_of_life_action text not null default 'encerrar'
    check (end_of_life_action in ('renovar', 'encerrar')),
  total_cycles integer not null default 1 check (total_cycles >= 1),
  priority text,
  condition text,
  status text,
  responsible text,
  notes text,
  photo_path text,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint assets_periodicity_positive
    check (periodicity_months is null or periodicity_months > 0),
  constraint assets_expected_life_positive
    check (expected_life_years is null or expected_life_years > 0),
  constraint assets_quantity_nonnegative
    check (quantity >= 0),
  constraint assets_values_nonnegative
    check (
      coalesce(acquisition_value, 0) >= 0
      and coalesce(estimated_unit_cost, 0) >= 0
      and coalesce(estimated_total_cost, 0) >= 0
    )
);

create unique index assets_owner_external_code_key
  on public.assets(owner_id, lower(external_code));

create index assets_building_idx on public.assets(building_id);
create index assets_location_idx on public.assets(location_id);
create index assets_system_idx on public.assets(system_id);
create index assets_next_maintenance_idx on public.assets(next_maintenance_date);

create table public.maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  building_id uuid not null references public.buildings(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  name text not null,
  maintenance_type text not null default 'preventiva',
  periodicity_months integer,
  estimated_cost numeric(14, 2) not null default 0,
  start_date date,
  active boolean not null default true,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint maintenance_plans_periodicity_positive
    check (periodicity_months is null or periodicity_months > 0),
  constraint maintenance_plans_cost_nonnegative
    check (estimated_cost >= 0)
);

create unique index maintenance_plans_asset_name_key
  on public.maintenance_plans(asset_id, lower(name));

create index maintenance_plans_building_idx
  on public.maintenance_plans(building_id);

create table public.maintenance_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  building_id uuid not null references public.buildings(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  plan_id uuid references public.maintenance_plans(id) on delete set null,
  external_event_key text not null,
  event_type text not null default 'manutencao'
    check (event_type in ('manutencao', 'substituicao', 'inspecao', 'outro')),
  scheduled_date date not null,
  execution_date date,
  status text not null default 'programado',
  estimated_cost numeric(14, 2) not null default 0,
  actual_cost numeric(14, 2),
  completed boolean,
  cycle_number integer not null default 1 check (cycle_number >= 1),
  provision_start_date date,
  notes text,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint maintenance_events_values_nonnegative
    check (
      estimated_cost >= 0
      and (actual_cost is null or actual_cost >= 0)
    )
);

create unique index maintenance_events_owner_external_key
  on public.maintenance_events(owner_id, external_event_key);

create index maintenance_events_building_date_idx
  on public.maintenance_events(building_id, scheduled_date);

create index maintenance_events_asset_date_idx
  on public.maintenance_events(asset_id, scheduled_date);

create or replace function public.validate_asset_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.buildings building
    where building.id = new.building_id
      and building.owner_id = new.owner_id
  ) then
    raise exception 'Asset owner and building owner must match';
  end if;

  if new.location_id is not null and not exists (
    select 1
    from public.locations location
    where location.id = new.location_id
      and location.building_id = new.building_id
  ) then
    raise exception 'Asset location must belong to the same building';
  end if;

  if not exists (
    select 1
    from public.systems system
    where system.id = new.system_id
      and system.building_id = new.building_id
  ) then
    raise exception 'Asset system must belong to the same building';
  end if;

  if not exists (
    select 1
    from public.asset_types asset_type
    where asset_type.id = new.asset_type_id
      and asset_type.owner_id = new.owner_id
  ) then
    raise exception 'Asset type must belong to the same owner';
  end if;

  return new;
end;
$$;

create or replace function public.validate_maintenance_template_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.asset_types asset_type
    where asset_type.id = new.asset_type_id
      and asset_type.owner_id = new.owner_id
  ) then
    raise exception 'Maintenance template asset type must belong to the same owner';
  end if;

  return new;
end;
$$;

create or replace function public.validate_maintenance_plan_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.assets asset
    where asset.id = new.asset_id
      and asset.owner_id = new.owner_id
      and asset.building_id = new.building_id
  ) then
    raise exception 'Maintenance plan must use an asset from the same owner and building';
  end if;

  return new;
end;
$$;

create or replace function public.validate_maintenance_event_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.assets asset
    where asset.id = new.asset_id
      and asset.owner_id = new.owner_id
      and asset.building_id = new.building_id
  ) then
    raise exception 'Maintenance event must use an asset from the same owner and building';
  end if;

  if new.plan_id is not null and not exists (
    select 1
    from public.maintenance_plans plan
    where plan.id = new.plan_id
      and plan.asset_id = new.asset_id
      and plan.owner_id = new.owner_id
      and plan.building_id = new.building_id
  ) then
    raise exception 'Maintenance event plan must belong to the same asset';
  end if;

  return new;
end;
$$;

create trigger asset_types_set_updated_at
before update on public.asset_types
for each row execute function public.set_updated_at();

create trigger maintenance_templates_set_updated_at
before update on public.maintenance_templates
for each row execute function public.set_updated_at();

create trigger assets_set_updated_at
before update on public.assets
for each row execute function public.set_updated_at();

create trigger maintenance_plans_set_updated_at
before update on public.maintenance_plans
for each row execute function public.set_updated_at();

create trigger maintenance_events_set_updated_at
before update on public.maintenance_events
for each row execute function public.set_updated_at();

create trigger assets_validate_scope
before insert or update on public.assets
for each row execute function public.validate_asset_scope();

create trigger maintenance_templates_validate_scope
before insert or update on public.maintenance_templates
for each row execute function public.validate_maintenance_template_scope();

create trigger maintenance_plans_validate_scope
before insert or update on public.maintenance_plans
for each row execute function public.validate_maintenance_plan_scope();

create trigger maintenance_events_validate_scope
before insert or update on public.maintenance_events
for each row execute function public.validate_maintenance_event_scope();

alter table public.asset_types enable row level security;
alter table public.maintenance_templates enable row level security;
alter table public.assets enable row level security;
alter table public.maintenance_plans enable row level security;
alter table public.maintenance_events enable row level security;

revoke all on table public.asset_types from anon, authenticated;
revoke all on table public.maintenance_templates from anon, authenticated;
revoke all on table public.assets from anon, authenticated;
revoke all on table public.maintenance_plans from anon, authenticated;
revoke all on table public.maintenance_events from anon, authenticated;

grant select, insert, update, delete on table public.asset_types to authenticated;
grant select, insert, update, delete on table public.maintenance_templates to authenticated;
grant select, insert, update, delete on table public.assets to authenticated;
grant select, insert, update, delete on table public.maintenance_plans to authenticated;
grant select, insert, update, delete on table public.maintenance_events to authenticated;

create policy "asset_types_owner_all"
on public.asset_types for all
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy "maintenance_templates_owner_all"
on public.maintenance_templates for all
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy "assets_owner_all"
on public.assets for all
to authenticated
using (
  owner_id = (select auth.uid())
  and exists (
    select 1
    from public.buildings building
    where building.id = assets.building_id
      and building.owner_id = (select auth.uid())
  )
)
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1
    from public.buildings building
    where building.id = assets.building_id
      and building.owner_id = (select auth.uid())
  )
);

insert into public.building_types (slug, name, description)
values (
  'apartamento',
  'Apartamento',
  'Unidade residencial pertencente a uma edificacao multifamiliar.'
)
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    active = true;

create policy "maintenance_plans_owner_all"
on public.maintenance_plans for all
to authenticated
using (
  owner_id = (select auth.uid())
  and exists (
    select 1
    from public.buildings building
    where building.id = maintenance_plans.building_id
      and building.owner_id = (select auth.uid())
  )
)
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1
    from public.buildings building
    where building.id = maintenance_plans.building_id
      and building.owner_id = (select auth.uid())
  )
);

create policy "maintenance_events_owner_all"
on public.maintenance_events for all
to authenticated
using (
  owner_id = (select auth.uid())
  and exists (
    select 1
    from public.buildings building
    where building.id = maintenance_events.building_id
      and building.owner_id = (select auth.uid())
  )
)
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1
    from public.buildings building
    where building.id = maintenance_events.building_id
      and building.owner_id = (select auth.uid())
  )
);
