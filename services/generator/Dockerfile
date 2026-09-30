FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OMP_NUM_THREADS=1

WORKDIR /app
COPY services/generator/pyproject.toml services/generator/uv.lock /app/services/generator/
RUN pip install --no-cache-dir uv && \
    cd /app/services/generator && uv sync --frozen --no-dev --no-install-project && \
    .venv/bin/python -c "from rembg import new_session; new_session('u2net')"

COPY services/generator/app /app/services/generator/app
COPY templates /app/templates
WORKDIR /app/services/generator
ENV PATH="/app/services/generator/.venv/bin:${PATH}"

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
