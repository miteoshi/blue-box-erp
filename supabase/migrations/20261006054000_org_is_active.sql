begin;

create or replace function public.org_is_active()
returns boolean
language sql
stable
security definer
set search_path to public
as $$
    select access_status = 'active'
    from public.organizations
    where id = public.my_org()
$$;

alter function public.org_is_active() owner to postgres;

grant execute on function public.org_is_active() to authenticated;

commit;