# syntax=docker/dockerfile:1
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UVICORN_WORKERS=2

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt && pip install gunicorn

COPY . .

EXPOSE 8000

# Optional: run as non-root
RUN useradd -m appuser
USER appuser

# Use Gunicorn with Uvicorn worker class
CMD ["sh","-lc","gunicorn -k uvicorn.workers.UvicornWorker -w ${UVICORN_WORKERS:-2} -b 0.0.0.0:8000 app.main:app"]
