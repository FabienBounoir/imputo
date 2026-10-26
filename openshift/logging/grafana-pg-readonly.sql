-- Rôle lecture seule pour la datasource Postgres de Grafana (dashboard "Activité"). À jouer à la
-- main, une fois par base (imputo et imputo-preprod), avec le superuser `postgres` (socket locale du pod, le rôle `imputo` ne peut pas créer de rôle) ; jamais appliqué par la CI :
--   oc exec -i -n <ns> imputo-db-0 -- psql -U postgres -d imputo \
--     -v pw="'<mot de passe>'" -f - < openshift/logging/grafana-pg-readonly.sql
-- Le mot de passe va ensuite dans le secret `grafana-pg` (imputo-logs), voir README.md.
--
-- Droits par COLONNE, pas par table : ni password_hash, ni jetons, ni libellés de tickets ne sont
-- lisibles par Grafana. Un droit de colonne survit à une migration Drizzle (une vue SQL, elle,
-- bloquerait un ALTER sur ses colonnes).
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grafana_ro') THEN
    CREATE ROLE grafana_ro LOGIN;
  END IF;
END $$;
ALTER ROLE grafana_ro PASSWORD :pw;
ALTER ROLE grafana_ro SET statement_timeout = '15s';
ALTER ROLE grafana_ro CONNECTION LIMIT 5;

GRANT CONNECT ON DATABASE imputo TO grafana_ro;
GRANT USAGE ON SCHEMA public TO grafana_ro;
GRANT SELECT (id, display_name, email, active, sso_login_at, created_at) ON "user" TO grafana_ro;
GRANT SELECT (id, name, created_by_user_id, created_at) ON workspace TO grafana_ro;
GRANT SELECT (workspace_id, user_id, created_at) ON membership TO grafana_ro;
GRANT SELECT (id, workspace_id, created_by_sync_run_id, created_by_import_id, created_at) ON ticket TO grafana_ro;
GRANT SELECT (workspace_id, user_id, amount, created_at) ON time_entry TO grafana_ro;
