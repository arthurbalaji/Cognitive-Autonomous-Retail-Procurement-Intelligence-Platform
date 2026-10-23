FROM python:3.11-slim-bookworm
ENV PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
RUN pip install --no-cache-dir httpx==0.27.0 numpy==1.26.4
COPY datagen ./datagen
COPY bootstrap ./bootstrap
CMD ["python", "bootstrap/bootstrap.py"]
