-- Protect future objects in public from automatic browser-role exposure.
-- Migration 0005 hardened objects that already exist. Default privileges are
-- per object owner, so this migration targets the owners observed in
-- pg_default_acl after applying 0001 through 0005.

-- supabase_admin currently grants future public tables, sequences and
-- functions to anon/authenticated through default privileges. Revoke those
-- future grants explicitly for the public schema only.
alter default privileges for role supabase_admin in schema public
  revoke all privileges on tables from public, anon, authenticated;

alter default privileges for role supabase_admin in schema public
  revoke all privileges on sequences from public, anon, authenticated;

alter default privileges for role supabase_admin in schema public
  revoke execute on functions from public, anon, authenticated;

-- Preserve the backend-only access model for future objects created by
-- supabase_admin. The V2 backend uses the service role server-side; browser
-- roles remain without direct table/function access.
alter default privileges for role supabase_admin in schema public
  grant select, insert, update, delete, truncate, references, trigger on tables to service_role;

alter default privileges for role supabase_admin in schema public
  grant usage, select, update on sequences to service_role;

alter default privileges for role supabase_admin in schema public
  grant execute on functions to service_role;

-- postgres owns the objects created by 0001 through 0005 in the development
-- project. Its current default privileges already target only service_role,
-- but these explicit grants make the desired future state deterministic.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete, truncate, references, trigger on tables to service_role;

alter default privileges for role postgres in schema public
  grant usage, select, update on sequences to service_role;

alter default privileges for role postgres in schema public
  grant execute on functions to service_role;
