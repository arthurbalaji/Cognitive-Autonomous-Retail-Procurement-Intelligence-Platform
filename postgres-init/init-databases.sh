#!/bin/bash
set -e

# Create POS database and user
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER pos_user WITH PASSWORD 'pos_password';
    CREATE DATABASE pos_db OWNER pos_user;
    GRANT ALL PRIVILEGES ON DATABASE pos_db TO pos_user;

    CREATE USER erp_user WITH PASSWORD 'erp_password';
    CREATE DATABASE erp_db OWNER erp_user;
    GRANT ALL PRIVILEGES ON DATABASE erp_db TO erp_user;
EOSQL

# Grant schema permissions for POS
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "pos_db" <<-EOSQL
    GRANT ALL ON SCHEMA public TO pos_user;
EOSQL

# Grant schema permissions for ERP
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "erp_db" <<-EOSQL
    GRANT ALL ON SCHEMA public TO erp_user;
EOSQL

echo "✅ All databases created: carpipdb, pos_db, erp_db"
