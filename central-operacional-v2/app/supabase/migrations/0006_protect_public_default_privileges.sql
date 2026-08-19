-- Protect future application objects in public with fail-closed defaults.
-- Migration 0005 hardened objects that already exist. This migration controls
-- only the default privileges for future objects created by the application
-- migration owner observed in development: postgres.
--
-- supabase_admin is an internal Supabase-managed role. The migration executor
-- cannot alter its default privileges, so this file intentionally does not
-- reference it operationally. Any inherited platform defaults for that role
-- must remain monitored by advisors and object-level hardening migrations.

-- Future objects created by application migrations should not be automatically
-- exposed to browser roles or even to service_role. Each future migration must
-- grant service_role explicitly only for the objects the backend needs.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;
