# ── Stage 1: build the React frontend ─────────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ .
RUN npm run build


# ── Stage 2: Python backend + built frontend ───────────────────────────────────
FROM python:3.11-slim AS final
WORKDIR /app

# Bring in uv (single static binary — fastest Python installer available)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Install Python dependencies from the lock file before copying source,
# so Docker caches this layer independently of code changes.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Copy backend source (pyproject.toml overwrites itself — no problem)
COPY backend/ .

# Copy compiled frontend into static/ (FastAPI serves this)
COPY --from=frontend-build /frontend/dist ./static

EXPOSE 8080

# Run via the venv uvicorn directly (no uv overhead at runtime)
CMD [".venv/bin/uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
