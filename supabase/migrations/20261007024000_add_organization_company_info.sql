begin;

alter table public.organizations
    add column address text,
    add column city text,
    add column state text,
    add column pincode text,
    add column phone text,
    add column email text,
    add column gst_number text;

commit;