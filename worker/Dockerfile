FROM golang:alpine AS builder

WORKDIR /app
COPY . .

# Initialize Go module and download dependencies if go.mod is missing
RUN if [ ! -f go.mod ]; then go mod init ingest-worker && go mod tidy; fi

# Build the Go application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o ingest-worker main.go

# Use a minimal alpine image for the final container
FROM alpine:latest
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /root/

# Copy the pre-built binary file from the previous stage
COPY --from=builder /app/ingest-worker .

# Command to run the executable
CMD ["./ingest-worker"]
