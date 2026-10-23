FROM python:3.11-slim-bookworm
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /srv
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt
COPY erp erp
COPY tests tests
EXPOSE 8000
CMD ["uvicorn", "erp.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
