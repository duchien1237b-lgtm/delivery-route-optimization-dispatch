FROM debian:12-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends g++ make && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Makefile ./
COPY src ./src
COPY third_party ./third_party
RUN make delivery -j2

FROM debian:12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/delivery ./delivery
COPY web ./web
COPY data ./data
EXPOSE 10000
CMD ./delivery --host 0.0.0.0 --port ${PORT:-10000} --web web --data data
