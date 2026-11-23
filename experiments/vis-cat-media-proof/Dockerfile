# Reuse the prebuilt, digest-pinned VIS-CAT-02B bench image and its locked Pillow wheel.
ARG BENCH_IMAGE=stdu-vis-cat-02b:offline-lab
FROM ${BENCH_IMAGE}
COPY experiments/vis-cat-02b/codec.py /proof/vis-cat-02b/codec.py
COPY experiments/vis-cat-media-proof/pipeline.py experiments/vis-cat-media-proof/container_child.py /proof/vis-cat-media-proof/
