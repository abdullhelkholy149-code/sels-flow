#!/bin/bash
# Creates the database used by the integration test suite.
# Runs once, on the first initialisation of the postgres data volume.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE DATABASE salesflow_test OWNER $POSTGRES_USER;
SQL
