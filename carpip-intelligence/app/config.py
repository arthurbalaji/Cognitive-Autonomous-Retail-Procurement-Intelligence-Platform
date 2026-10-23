"""Environment-driven settings for the cognitive intelligence engine."""
import os


def _f(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return float(default)


def _i(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return int(default)


def _b(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


class Settings:
    DB_URL = os.getenv("DB_URL", "postgresql+psycopg2://carpip_intel:change-me@postgres:5432/carpip")
    REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
    KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "kafka:9092")
    INTERNAL_TOKEN = os.getenv("INTERNAL_SERVICE_TOKEN", "")
    CARPIP_BACKEND_URL = os.getenv("CARPIP_BACKEND_URL", "http://carpip-backend:8080")

    # Bedrock / LLM (AWS Bedrock only - no local models)
    AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
    AWS_CREDENTIALS_FILE = os.getenv("AWS_CREDENTIALS_FILE", "/aws/credentials.json")
    BEDROCK_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-5-5")
    LLM_EFFORT = os.getenv("LLM_EFFORT", "low")
    LLM_MAX_TOKENS = _i("LLM_MAX_TOKENS", 1024)
    LLM_TIMEOUT_S = _f("LLM_TIMEOUT_S", 20)
    LLM_MAX_CONCURRENCY = _i("LLM_MAX_CONCURRENCY", 3)
    LLM_PRICE_FLEX_PCT = _f("LLM_PRICE_FLEX_PCT", 0.01)
    LLM_DAILY_TOKEN_BUDGET = _i("LLM_DAILY_TOKEN_BUDGET", 2_000_000)
    LLM_BREAKER_FAILS = _i("LLM_BREAKER_FAILS", 3)
    LLM_BREAKER_OPEN_S = _i("LLM_BREAKER_OPEN_S", 60)
    NEGOTIATION_DEADLINE_S = _f("NEGOTIATION_DEADLINE_S", 40)
    NEGOTIATION_MAX_CONCURRENCY = _i("NEGOTIATION_MAX_CONCURRENCY", 3)

    # feature flags (ablations)
    FEATURE_MPI = _b("FEATURE_MPI", True)
    FEATURE_CDIN = _b("FEATURE_CDIN", True)

    # MPI
    MPI_INTERVAL_S = _i("MPI_INTERVAL_S", 900)
    MPI_WEIGHTS = [float(x) for x in os.getenv("MPI_WEIGHTS", "0.315,0.225,0.18,0.18,0.10").split(",")]
    RANKING_WEIGHTS = {"price": 0.40, "reliability": 0.25, "expiry": 0.15, "lead": 0.20}
    SAFETY_DAYS = _i("SAFETY_DAYS", 3)
    REVIEW_DAYS = _i("REVIEW_DAYS", 7)

    # forecasting
    MODEL_DIR = os.getenv("MODEL_DIR", "/models")
    FORECAST_HORIZON = _i("FORECAST_HORIZON_DAYS", 14)
    FORECAST_WINDOW = _i("FORECAST_WINDOW_DAYS", 30)
    FORECAST_LSTM_EPOCHS = _i("FORECAST_LSTM_EPOCHS", 12)
    FORECAST_TRANSFORMER_EPOCHS = _i("FORECAST_TRANSFORMER_EPOCHS", 10)
    XGB_ESTIMATORS = _i("XGB_ESTIMATORS", 120)
    TORCH_THREADS = _i("TORCH_NUM_THREADS", 2)
    SEED = _i("SEED", 42)

    # CDIN
    CDIN_MIN_QUORUM = _i("CDIN_MIN_QUORUM", 2)
    CDIN_ROUND_DEADLINE_S = _i("CDIN_ROUND_DEADLINE_S", 120)
    CDIN_LOCAL_EPOCHS = _i("CDIN_LOCAL_EPOCHS", 3)
    CDIN_FEDPROX_MU = _f("CDIN_FEDPROX_MU", 0.01)
    CDIN_SHARE_CAP = _f("CDIN_SHARE_CAP", 0.6)
    CDIN_ROUND_INTERVAL_S = _i("CDIN_ROUND_INTERVAL_S", 900)

    DEMO_MODE = _b("DEMO_MODE", True)


settings = Settings()
