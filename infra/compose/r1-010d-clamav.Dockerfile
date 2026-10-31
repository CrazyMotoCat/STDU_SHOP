FROM golang:1.25.4-alpine@sha256:d3f0cf7723f3429e3f9ed846243970b20a2de7bae6a5b66fc5914e228d831bbb AS builder
WORKDIR /probe
COPY infra/scan-resource-probe/go.mod infra/scan-resource-probe/main.go infra/scan-resource-probe/main_test.go ./
RUN CGO_ENABLED=0 GOOS=linux go test ./... && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w -buildid=" -o /resource-probe .
FROM clamav/clamav:1.4.6@sha256:982e28f90061d0e66eb03276419f589a47c9fa601e985e472fc2f6c64b497ca0
RUN sed -i 's|^#TemporaryDirectory .*|TemporaryDirectory /tmp|' /etc/clamav/clamd.conf
COPY --from=builder /resource-probe /opt/stdu/resource-probe
COPY infra/compose/r1-010d-clamav-entrypoint.sh /opt/stdu/entrypoint.sh
ENTRYPOINT ["/sbin/tini", "-g", "--", "/bin/sh", "/opt/stdu/entrypoint.sh"]
