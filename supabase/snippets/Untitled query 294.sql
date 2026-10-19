select pg_get_functiondef(
  'public.create_organization(text,text,jsonb,jsonb)'::regprocedure
);