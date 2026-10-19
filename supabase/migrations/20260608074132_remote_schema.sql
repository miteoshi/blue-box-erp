alter table "public"."workers" add column "email" text;

CREATE UNIQUE INDEX workers_email_unique ON public.workers USING btree (email) WHERE (email IS NOT NULL);


