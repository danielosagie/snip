FROM oven/bun:1.3.9-debian AS dependencies

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.9-debian

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./package.json
COPY src ./src

ENV JOB_SPEC_PATH=/work/job.json \
  LOCAL_JOB_STATE_PATH=/work/job-state.json \
  RESULT_MANIFEST_PATH=/work/result-manifest.json \
  WORK_DIR=/tmp/snip-render

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "run", "start"]
