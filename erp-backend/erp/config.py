import os

DB_URL = os.getenv("DB_URL", "postgresql+psycopg2://erp_app:erp@postgres:5432/erp")
ADMIN_TOKEN = os.getenv("ERP_ADMIN_TOKEN", "")
UI_SECRET = os.getenv("UI_SECRET", ADMIN_TOKEN or "dev-secret")
CARPIP_TOLERANCE_S = int(os.getenv("CARPIP_TOLERANCE_S", "300"))
SYNC_INTERVAL_S = int(os.getenv("ERP_PUSH_SYNC_INTERVAL_S", "45"))
CARPIP_GRAPHQL_URL = os.getenv("CARPIP_GRAPHQL_URL", "http://carpip-backend:8080/graphql")
