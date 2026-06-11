-- Fundacao do cadastro: usuarios, modelos, edificacoes, localizacoes e sistemas.
-- Os ativos serao adicionados em uma migracao posterior.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.building_types (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.building_models (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  building_type_id uuid references public.building_types(id) on delete set null,
  name text not null,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index building_models_owner_name_key
  on public.building_models(owner_id, lower(name));

create table public.model_locations (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.building_models(id) on delete cascade,
  parent_id uuid,
  name text not null,
  location_type text not null default 'ambiente',
  sort_order integer not null default 0,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, model_id),
  constraint model_locations_parent_fk
    foreign key (parent_id, model_id)
    references public.model_locations(id, model_id)
    on delete restrict
);

create unique index model_locations_sibling_name_key
  on public.model_locations(
    model_id,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  );

create table public.model_systems (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.building_models(id) on delete cascade,
  name text not null,
  description text,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index model_systems_model_name_key
  on public.model_systems(model_id, lower(name));

create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_model_id uuid references public.building_models(id) on delete set null,
  building_type_id uuid references public.building_types(id) on delete set null,
  name text not null,
  reference_code text not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index buildings_owner_reference_key
  on public.buildings(owner_id, lower(reference_code));

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  source_model_location_id uuid references public.model_locations(id) on delete set null,
  parent_id uuid,
  name text not null,
  location_type text not null default 'ambiente',
  sort_order integer not null default 0,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, building_id),
  constraint locations_parent_fk
    foreign key (parent_id, building_id)
    references public.locations(id, building_id)
    on delete restrict
);

create unique index locations_sibling_name_key
  on public.locations(
    building_id,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  );

create table public.systems (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  source_model_system_id uuid references public.model_systems(id) on delete set null,
  name text not null,
  description text,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index systems_building_name_key
  on public.systems(building_id, lower(name));

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger building_models_set_updated_at
before update on public.building_models
for each row execute function public.set_updated_at();

create trigger buildings_set_updated_at
before update on public.buildings
for each row execute function public.set_updated_at();

create trigger locations_set_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

create trigger systems_set_updated_at
before update on public.systems
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1), '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.building_types (slug, name, description)
values
  ('casa', 'Casa', 'Edificacao residencial unifamiliar.'),
  ('condominio_vertical', 'Condominio vertical', 'Conjunto residencial organizado em blocos e pavimentos.'),
  ('condominio_horizontal', 'Condominio horizontal', 'Conjunto residencial de unidades predominantemente horizontais.'),
  ('casa_geminada', 'Casa geminada', 'Unidade residencial que compartilha uma ou mais paredes com outra unidade.')
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    active = true;

alter table public.profiles enable row level security;
alter table public.building_types enable row level security;
alter table public.building_models enable row level security;
alter table public.model_locations enable row level security;
alter table public.model_systems enable row level security;
alter table public.buildings enable row level security;
alter table public.locations enable row level security;
alter table public.systems enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.building_types from anon, authenticated;
revoke all on table public.building_models from anon, authenticated;
revoke all on table public.model_locations from anon, authenticated;
revoke all on table public.model_systems from anon, authenticated;
revoke all on table public.buildings from anon, authenticated;
revoke all on table public.locations from anon, authenticated;
revoke all on table public.systems from anon, authenticated;

grant select, update on table public.profiles to authenticated;
grant select on table public.building_types to authenticated;
grant select, insert, update, delete on table public.building_models to authenticated;
grant select, insert, update, delete on table public.model_locations to authenticated;
grant select, insert, update, delete on table public.model_systems to authenticated;
grant select, insert, update, delete on table public.buildings to authenticated;
grant select, insert, update, delete on table public.locations to authenticated;
grant select, insert, update, delete on table public.systems to authenticated;

create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (id = (select auth.uid()));

create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "building_types_read_authenticated"
on public.building_types for select
to authenticated
using (active);

create policy "building_models_owner_all"
on public.building_models for all
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy "model_locations_owner_all"
on public.model_locations for all
to authenticated
using (
  exists (
    select 1
    from public.building_models model
    where model.id = model_locations.model_id
      and model.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.building_models model
    where model.id = model_locations.model_id
      and model.owner_id = (select auth.uid())
  )
);

create policy "model_systems_owner_all"
on public.model_systems for all
to authenticated
using (
  exists (
    select 1
    from public.building_models model
    where model.id = model_systems.model_id
      and model.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.building_models model
    where model.id = model_systems.model_id
      and model.owner_id = (select auth.uid())
  )
);

create policy "buildings_owner_all"
on public.buildings for all
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy "locations_owner_all"
on public.locations for all
to authenticated
using (
  exists (
    select 1
    from public.buildings building
    where building.id = locations.building_id
      and building.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.buildings building
    where building.id = locations.building_id
      and building.owner_id = (select auth.uid())
  )
);

create policy "systems_owner_all"
on public.systems for all
to authenticated
using (
  exists (
    select 1
    from public.buildings building
    where building.id = systems.building_id
      and building.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.buildings building
    where building.id = systems.building_id
      and building.owner_id = (select auth.uid())
  )
);

create or replace function public.create_townhouse_demo_model()
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_type_id uuid;
  v_model_id uuid;
  v_ground_floor_id uuid;
  v_upper_floor_id uuid;
  v_external_area_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select id into v_type_id
  from public.building_types
  where slug = 'casa_geminada';

  select id into v_model_id
  from public.building_models
  where owner_id = v_user_id
    and lower(name) = lower('Casa geminada - modelo inicial');

  if v_model_id is not null then
    return v_model_id;
  end if;

  insert into public.building_models (owner_id, building_type_id, name, description)
  values (
    v_user_id,
    v_type_id,
    'Casa geminada - modelo inicial',
    'Modelo minimo para validar hierarquia, sistemas e criacao de instancias.'
  )
  returning id into v_model_id;

  insert into public.model_locations (model_id, name, location_type, sort_order)
  values (v_model_id, 'Pavimento terreo', 'pavimento', 10)
  returning id into v_ground_floor_id;

  insert into public.model_locations (model_id, name, location_type, sort_order)
  values (v_model_id, 'Pavimento superior', 'pavimento', 20)
  returning id into v_upper_floor_id;

  insert into public.model_locations (model_id, name, location_type, sort_order)
  values (v_model_id, 'Area externa', 'area_externa', 30)
  returning id into v_external_area_id;

  insert into public.model_locations (model_id, parent_id, name, location_type, sort_order)
  values
    (v_model_id, v_ground_floor_id, 'Sala', 'ambiente', 10),
    (v_model_id, v_ground_floor_id, 'Cozinha', 'ambiente', 20),
    (v_model_id, v_ground_floor_id, 'Lavabo', 'ambiente', 30),
    (v_model_id, v_ground_floor_id, 'Area de servico', 'ambiente', 40),
    (v_model_id, v_upper_floor_id, 'Quarto 1', 'ambiente', 10),
    (v_model_id, v_upper_floor_id, 'Quarto 2', 'ambiente', 20),
    (v_model_id, v_upper_floor_id, 'Banheiro', 'ambiente', 30),
    (v_model_id, v_external_area_id, 'Jardim frontal', 'area_externa', 10),
    (v_model_id, v_external_area_id, 'Quintal', 'area_externa', 20);

  insert into public.model_systems (model_id, name, description)
  values
    (v_model_id, 'Estrutural', 'Estrutura da edificacao.'),
    (v_model_id, 'Pisos', 'Sistemas de pisos internos e externos.'),
    (v_model_id, 'Vedacoes', 'Vedacoes verticais internas e externas.'),
    (v_model_id, 'Cobertura', 'Cobertura e seus complementos.'),
    (v_model_id, 'Hidrossanitario', 'Agua, esgoto e drenagem.'),
    (v_model_id, 'Eletrico', 'Alimentacao, distribuicao e pontos eletricos.');

  return v_model_id;
end;
$$;

create or replace function public.create_building_from_model(
  p_model_id uuid,
  p_name text,
  p_reference_code text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_model public.building_models%rowtype;
  v_building_id uuid;
  v_location record;
  v_new_location_id uuid;
  v_new_parent_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if nullif(trim(p_name), '') is null or nullif(trim(p_reference_code), '') is null then
    raise exception 'Building name and reference code are required';
  end if;

  select * into v_model
  from public.building_models
  where id = p_model_id
    and owner_id = v_user_id;

  if not found then
    raise exception 'Model not found or not owned by current user';
  end if;

  insert into public.buildings (
    owner_id,
    source_model_id,
    building_type_id,
    name,
    reference_code
  )
  values (
    v_user_id,
    v_model.id,
    v_model.building_type_id,
    trim(p_name),
    trim(p_reference_code)
  )
  returning id into v_building_id;

  create temporary table if not exists location_copy_map (
    source_id uuid primary key,
    target_id uuid not null
  ) on commit drop;

  truncate table location_copy_map;

  for v_location in
    with recursive location_tree as (
      select location.*, 0 as depth
      from public.model_locations location
      where location.model_id = p_model_id
        and location.parent_id is null

      union all

      select child.*, parent.depth + 1
      from public.model_locations child
      join location_tree parent on parent.id = child.parent_id
      where child.model_id = p_model_id
    )
    select *
    from location_tree
    order by depth, sort_order, name
  loop
    v_new_parent_id := null;

    if v_location.parent_id is not null then
      select target_id into v_new_parent_id
      from location_copy_map
      where source_id = v_location.parent_id;
    end if;

    insert into public.locations (
      building_id,
      source_model_location_id,
      parent_id,
      name,
      location_type,
      sort_order,
      properties
    )
    values (
      v_building_id,
      v_location.id,
      v_new_parent_id,
      v_location.name,
      v_location.location_type,
      v_location.sort_order,
      v_location.properties
    )
    returning id into v_new_location_id;

    insert into location_copy_map (source_id, target_id)
    values (v_location.id, v_new_location_id);
  end loop;

  insert into public.systems (
    building_id,
    source_model_system_id,
    name,
    description,
    properties
  )
  select
    v_building_id,
    model_system.id,
    model_system.name,
    model_system.description,
    model_system.properties
  from public.model_systems model_system
  where model_system.model_id = p_model_id;

  return v_building_id;
end;
$$;

grant execute on function public.create_townhouse_demo_model() to authenticated;
grant execute on function public.create_building_from_model(uuid, text, text) to authenticated;

revoke all on function public.create_townhouse_demo_model() from public, anon;
revoke all on function public.create_building_from_model(uuid, text, text) from public, anon;
