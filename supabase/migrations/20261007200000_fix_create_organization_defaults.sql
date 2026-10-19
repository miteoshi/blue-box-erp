begin;

-- Remove the older overloaded versions.
drop function if exists public.create_organization(
    text,
    text,
    jsonb,
    jsonb
);

drop function if exists public.create_organization(
    text,
    text,
    jsonb,
    jsonb,
    boolean
);

create function public.create_organization(
    p_name text,
    p_template text default null,
    p_categories jsonb default '[]'::jsonb,
    p_material_types jsonb default '[]'::jsonb,
    p_units jsonb default '[]'::jsonb,
    p_include_sap_defaults boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
    v_org_id uuid;
    v_existing uuid;
begin
    select org_id
    into v_existing
    from public.profiles
    where id = auth.uid();

    if v_existing is not null then
        raise exception 'User already belongs to an organization'
            using errcode = 'P0006';
    end if;

    insert into public.organizations (name)
    values (p_name)
    returning id into v_org_id;

    update public.profiles
    set org_id = v_org_id,
        role = 'admin'
    where id = auth.uid();

    -- Categories supplied by the selected template / SAP defaults
    if jsonb_array_length(p_categories) > 0 then
        insert into public.item_categories (
            org_id,
            code,
            name,
            description
        )
        select
            v_org_id,
            nullif(trim(x->>'code'), ''),
            nullif(trim(x->>'name'), ''),
            nullif(trim(x->>'description'), '')
        from jsonb_array_elements(p_categories) x
        where nullif(trim(x->>'code'), '') is not null
          and nullif(trim(x->>'name'), '') is not null
        on conflict (org_id, code) do nothing;
    end if;

    -- Material types supplied by the selected template / SAP defaults
    if jsonb_array_length(p_material_types) > 0 then
        insert into public.material_types (
            org_id,
            code,
            name,
            description
        )
        select
            v_org_id,
            nullif(trim(x->>'code'), ''),
            nullif(trim(x->>'name'), ''),
            nullif(trim(x->>'description'), '')
        from jsonb_array_elements(p_material_types) x
        where nullif(trim(x->>'code'), '') is not null
          and nullif(trim(x->>'name'), '') is not null
        on conflict (org_id, code) do nothing;
    end if;

    -- Units supplied by SAP global defaults
    if jsonb_array_length(p_units) > 0 then
        insert into public.units (
            org_id,
            code,
            name,
            description
        )
        select
            v_org_id,
            nullif(trim(x->>'code'), ''),
            nullif(trim(x->>'name'), ''),
            nullif(trim(x->>'description'), '')
        from jsonb_array_elements(p_units) x
        where nullif(trim(x->>'code'), '') is not null
          and nullif(trim(x->>'name'), '') is not null
        on conflict (org_id, code) do nothing;
    end if;

    return v_org_id;
end;
$function$;

alter function public.create_organization(
    text,
    text,
    jsonb,
    jsonb,
    jsonb,
    boolean
) owner to postgres;

revoke all on function public.create_organization(
    text,
    text,
    jsonb,
    jsonb,
    jsonb,
    boolean
) from public;

grant execute on function public.create_organization(
    text,
    text,
    jsonb,
    jsonb,
    jsonb,
    boolean
) to authenticated;

commit;