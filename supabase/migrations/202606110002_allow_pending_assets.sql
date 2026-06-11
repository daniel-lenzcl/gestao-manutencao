-- Permite criar o registro minimo de um ativo apenas com a edificacao.
-- Sistema, tipo e localizacao podem ser definidos posteriormente.

alter table public.assets
  alter column system_id drop not null,
  alter column asset_type_id drop not null;

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

  if new.system_id is not null and not exists (
    select 1
    from public.systems system
    where system.id = new.system_id
      and system.building_id = new.building_id
  ) then
    raise exception 'Asset system must belong to the same building';
  end if;

  if new.asset_type_id is not null and not exists (
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
