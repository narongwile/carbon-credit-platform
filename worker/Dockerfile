# Multi-stage: build a static binary, ship it on distroless nonroot so the image
# matches the Deployment securityContext (runAsNonRoot + readOnlyRootFilesystem).
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod ./
COPY *.go ./
RUN go mod tidy
# CGO off → fully static binary that runs on distroless/static.
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /worker .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /worker /worker
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/worker"]
