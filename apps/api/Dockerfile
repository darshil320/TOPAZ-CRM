FROM python:3.12-slim

WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install shared package first (dependency of api)
COPY packages/shared /app/packages/shared
RUN pip install --no-cache-dir /app/packages/shared

# Install api
COPY apps/api /app/apps/api
RUN pip install --no-cache-dir /app/apps/api

WORKDIR /app/apps/api
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
