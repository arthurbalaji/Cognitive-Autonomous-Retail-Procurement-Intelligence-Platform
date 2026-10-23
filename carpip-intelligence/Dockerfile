# syntax=docker/dockerfile:1.7
FROM python:3.11-slim-bookworm
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
# CPU-only PyTorch (no GPU on the target laptop)
RUN --mount=type=cache,target=/root/.cache/pip pip install torch==2.4.1 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt
COPY app app
COPY cdin_node cdin_node
COPY bench bench
COPY tests tests
EXPOSE 5000
# one worker + threads: APScheduler (MPI job) and the CDIN coordinator live in-process
CMD ["gunicorn", "-w", "1", "--threads", "8", "-b", "0.0.0.0:5000", "--timeout", "180", "--access-logfile", "-", "app:create_app()"]
