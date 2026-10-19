begin;

drop function if exists public.create_organization(text);

create or replace function public.create_organization(
    p_name text,
    p_template text default null,
    p_categories jsonb default '[]'::jsonb,
    p_material_types jsonb default '[]'::jsonb
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

    if p_template is not null then

        insert into public.item_categories (
            org_id,
            code,
            name,
            description
        )
        select
            v_org_id,
            category->>'code',
            category->>'name',
            category->>'description'
        from jsonb_array_elements(p_categories) as category;

        insert into public.material_types (
            org_id,
            code,
            name,
            description
        )
        select
            v_org_id,
            material_type->>'code',
            material_type->>'name',
            material_type->>'description'
        from jsonb_array_elements(p_material_types) as material_type;

    end if;

    return v_org_id;
end;
$function$;

revoke all on function public.create_organization(
    text,
    text,
    jsonb,
    jsonb
) from public;

grant execute on function public.create_organization(
    text,
    text,
    jsonb,
    jsonb
) to authenticated;

commit;