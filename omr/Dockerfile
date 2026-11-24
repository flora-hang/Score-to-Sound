# Free note reading with homr (AGPL-3.0, https://github.com/liebharc/homr), run unchanged.
# Built and deployed by `wrangler deploy` (Cloudflare Workers Builds) together with the app.
FROM public.ecr.aws/docker/library/python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 \
 && rm -rf /var/lib/apt/lists/*

# rapidocr is pinned for the 简谱 reader (omr/jianpu.py), which was tuned against this version.
RUN pip install homr==0.7.1 onnxruntime==1.32.0 rapidocr==3.10.0

# Download the models into the image, so a new container doesn't wait for them.
RUN homr --init

WORKDIR /app
COPY server.py jianpu.py /app/

# Fetch the text reader's models for the 简谱 reader now too, so it runs without internet.
RUN python -c "import numpy as np; from rapidocr import RapidOCR; RapidOCR(params={'Global.log_level': 'critical'})(np.full((64, 256, 3), 255, np.uint8))"

EXPOSE 8080
CMD ["python", "/app/server.py"]
