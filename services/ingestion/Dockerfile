FROM ghcr.io/astral-sh/uv:0.13.3 AS uv
FROM python:3.14.3-slim-bookworm
COPY --from=uv /uv /usr/local/bin/uv
ENV PYTHONUNBUFFERED=1 UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY services/ingestion/pyproject.toml services/ingestion/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY services/ingestion/src ./src
RUN uv sync --frozen --no-dev && useradd --create-home --uid 10001 app
USER app
EXPOSE 8000
CMD [".venv/bin/uvicorn", "ingestion.main:app", "--host", "0.0.0.0", "--port", "8000"]
