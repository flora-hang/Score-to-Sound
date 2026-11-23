# Free note reading with homr (AGPL-3.0, https://github.com/liebharc/homr), run unchanged.
# Built and deployed by `wrangler deploy` (Cloudflare Workers Builds) together with the app.
FROM public.ecr.aws/docker/library/python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 \
 && rm -rf /var/lib/apt/lists/*

RUN pip install homr==0.7.1 onnxruntime==1.32.0

# Download the models into the image, so a new container doesn't wait for them.
RUN homr --init

WORKDIR /app
COPY server.py /app/server.py

EXPOSE 8080
CMD ["python", "/app/server.py"]
