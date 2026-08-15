# CilamAI - ITSM Go Service

A lightweight, standalone Go daemon for IT Service Management (ITSM), diagnostics, health checks, and system metrics for **CilamAI**.

---

## 1. Features
- **Health Checks**: Instant HTTP `/health` endpoint.
- **System Metrics**: `/status` endpoint returning runtime memory, CPU cores, OS, and uptime.
- **Cross-Platform**: Compiles natively to Windows, macOS, and Linux.

---

## 2. Quick Start

### Prerequisites
- **Go** 1.22+

### Run Locally
```bash
cd go
go run main.go
```

### Build Executable
```bash
go build -o cilamai-go.exe main.go
```

---

## 3. Endpoints

| Endpoint | Method | Response |
| :------- | :----- | :------- |
| `/health` | `GET` | `{"status":"OK","code":200}` |
| `/status` | `GET` | System specs, runtime OS, CPU count, uptime |
