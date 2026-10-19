alter table "public"."quotations" alter column "status" drop default;

alter type "public"."document_status" rename to "document_status__old_version_to_be_dropped";

create type "public"."document_status" as enum ('draft', 'pending_approval', 'approved', 'converted', 'rejected', 'cancelled');

alter table "public"."quotations" alter column status type "public"."document_status" using status::text::"public"."document_status";

alter table "public"."quotations" alter column "status" set default 'draft'::public.document_status;

drop type "public"."document_status__old_version_to_be_dropped";


