#!/usr/bin/env bash
# Starts the PostgreSQL that GitHub's Ubuntu runner image already has installed (service off by default), with the
# same user, password and database the CI jobs expect. It replaces a Postgres service container: pulling the image
# hit the registry's data limit several times a day, failing runs before any test ran (2026-10-15).
set -euo pipefail
major=$(psql --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')
if [ "$major" -lt 16 ]; then echo "The runner's PostgreSQL is $major; CI needs 16 or newer."; exit 1; fi
sudo systemctl start postgresql.service
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "alter user postgres password 'postgres'" -c "create database cm"
for i in $(seq 20); do pg_isready -h localhost -p 5432 -q && exit 0; sleep 1; done
echo "PostgreSQL did not start"; exit 1
