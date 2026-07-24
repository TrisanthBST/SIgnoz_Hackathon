# ♟️ SigNoz Chess Engine - Telemetry & Benchmark Platform

A scalable, high-performance C++ Chess Engine integrated with **OpenTelemetry (Traces, Metrics, Logs)** and **SigNoz** monitoring. Designed for performance benchmarking and observability stress testing at scale.

![SigNoz Chess Telemetry Architecture](https://raw.githubusercontent.com/opentelemetry/opentelemetry.io/main/icon.png)

---

## 🌟 Highlights

- **High-Speed C++ Engine (`engine.cpp`)**: Minimax search with Alpha-Beta pruning & MVV-LVA move ordering evaluating **> 1.2M nodes/sec**.
- **OpenTelemetry Native**: Instrumented Node.js backend (`server.js`) emitting custom spans and OTLP metrics (`chess_moves_total`, `chess_nodes_searched_total`, `chess_eval_duration_ms`).
- **SigNoz W3C Trace Correlation**: Injects 128-bit OpenTelemetry `trace_id` directly into chess evaluation responses.
- **Glassmorphism Web Dashboard**: Modern Vite/React interactive board with evaluation bar, move indicators, live trace waterfall inspector, and built-in **SigNoz Traffic Load Simulator**.

---

## 🛠️ Architecture

```
┌─────────────────────────────────┐
│ React Web UI (Client: 3000)     │
└────────────────┬────────────────┘
                 │ HTTP REST / OTel Trace Inspection
┌────────────────▼────────────────┐
│ Node.js Express API (Server:5000)│
└────────┬───────────────┬────────┘
         │ IPC           │ OTLP (4318)
┌────────▼───────┐ ┌─────▼──────────────┐
│ C++ Engine     │ │ OpenTelemetry      │
│ (>1.2M NPS)    │ │ Collector / SigNoz │
└────────────────┘ └────────────────────┘
```

---

## 🚀 Quick Start with Docker

```bash
# Clone repository
git clone <your-repo-url>
cd Chess_Engine

# Spin up complete stack (Frontend, Backend, OTel Collector)
docker compose up --build
```

- **Web Dashboard**: [http://localhost:3000](http://localhost:3000)
- **Backend API**: [http://localhost:5000](http://localhost:5000)
- **OTLP Receiver**: `4317` (gRPC) / `4318` (HTTP)

---

## 🧪 Running SigNoz Benchmark & Stress Tests

1. Open the Web Dashboard at `http://localhost:3000`.
2. Locate the **SigNoz Scale Simulator** panel.
3. Configure **Total Requests** (e.g. 50–200) and **Concurrency** (e.g. 10 workers).
4. Click **Run SigNoz Stress Test** to fire concurrent engine evaluations.
5. Open your SigNoz instance to observe real-time trace waterfalls, latency percentiles (p50, p90, p99), and search node histograms.

---

## 📄 License

MIT License
