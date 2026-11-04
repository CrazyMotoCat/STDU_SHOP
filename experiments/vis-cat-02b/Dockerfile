FROM python:3.14.3-slim-bookworm@sha256:f21c0d5a44c56805654c15abccc1b2fd576c8d93aca0a3f74b4aba2dc92510e2
ENV PYTHONDONTWRITEBYTECODE=1
COPY requirements.txt /bench/requirements.txt
RUN --mount=type=bind,from=wheels,target=/wheels python -m pip install --no-index --find-links=/wheels --no-cache-dir --disable-pip-version-check --only-binary=:all: --require-hashes -r /bench/requirements.txt
COPY codec.py storage.py /bench/
USER 65534:65534
