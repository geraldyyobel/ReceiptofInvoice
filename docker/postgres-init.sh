#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$ROI_APP_PASSWORD" -v database_name="$POSTGRES_DB" <<'SQL'
CREATE ROLE roi_bcu LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
SELECT format('ALTER DATABASE %I OWNER TO roi_bcu', :'database_name') \gexec
ALTER SCHEMA public OWNER TO roi_bcu;
SQL
