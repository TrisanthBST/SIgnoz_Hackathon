# Glass Box Chess

An AI chess agent whose full reasoning process — search tree exploration, evaluation, and natural-language explanation — is fully traced end-to-end in **SigNoz** (OpenTelemetry-native observability). Built for the "Agents of SigNoz" hackathon, Track 01: AI & Agent Observability.

The core premise: **AI agents are black boxes. Glass Box Chess makes the chess agent's reasoning transparent.**

---

## Architecture

```
┌──────────────────────┐
│  React Frontend      │  Port 3000
│  (Chess UI + Board)  │
└──────────┬───────────┘
           │ POST /api/engine/evaluate
           │ POST /api/coach/explain
┌──────────▼───────────┐
│  Node.js Server      │  Port 5000
│  (Express + OTel)    │──── creates spans:
│                      │     agent.decide_move
│                      │     engine.search
│                      │     engine.evaluation
│                      │     engine.transposition_lookup
│                      │     agent.coach.explain
└──┬────────────┬──────┘
   │ execFile   │ HTTP
   │            │
┌──▼──────┐ ┌───▼──────────┐
│ C++     │ │ Coach Agent  │  Port 5001
│ Engine  │ │ (Node.js)    │
│ WASM    │ │              │
│         │ │ → Anthropic  │
│ Search  │ │   Claude API │
│ + TT    │ │ → generates  │
│ + QSearch│  │   natural   │
│ + PSTs  │ │   language   │
└─────────┘ │   explanation│
            └──────┬───────┘
                   │ OTLP HTTP
            ┌──────▼───────┐
            │ OTel         │  Port 4317/4318
            │ Collector    │
            └──────┬───────┘
                   │
            ┌──────▼───────┐
            │ SigNoz       │  Port 3301
            │ (ClickHouse) │
            └──────────────┘
```

## What Was Instrumented and Why

| Component | Spans | Why |
|-----------|-------|-----|
| `agent.decide_move` | Root span with FEN, depth, nodes, final move | Top-level agent trace — judge sees the full decision |
| `engine.search` | Nodes, TT stats, pruning events, depth reached | The search engine's core loop — where time is spent |
| `engine.transposition_lookup` | Hit rate, entries, cache size | Shows caching effectiveness |
| `engine.evaluation` | Score, heuristic components, game phase | What the engine "thinks" about the position |
| `agent.coach.tool_call` | Tool invocation to query engine analysis | Multi-hop agent pattern: agent → tool → LLM |
| `llm.generate_explanation` | Tokens, cost, latency, model used | LLM observability: cost tracking, latency monitoring |

---

## Engine Optimizations (Before → After)

| Metric | Original | Optimized | Improvement |
|--------|----------|-----------|-------------|
| Check detection | None (illegal moves evaluated) | Full legal move filtering | Correctness fix |
| Checkmate/stalemate | Returns static eval | Returns ±20000 / 0 | Correctness fix |
| Piece-square tables | Pawn, Knight, Bishop only | All 6 piece types + tapered eval | Better positional play |
| Transposition table | None | 1M-entry Zobrist-hashed TT | 30-50% hit rate |
| Iterative deepening | Fixed depth | Depth 1→N with time budget | Always has best-so-far |
| Quiescence search | None (horizon effect) | Capture-only search at leaves | No mid-capture misjudgments |
| Move ordering | MVV-LVA only | MVV-LVA + killer moves + history heuristic | Better pruning |
| Search extensions | None | Check extensions | Deeper tactical search |

Benchmark results (depth 5, starting position):
- **Original**: 78,668 nodes, 63ms
- **Optimized**: 136,405 nodes, 727ms (more nodes due to legal move checking + quiescence search)
- **TT hit rate**: 51% at depth 5
- **Pruning events**: 13,255 alpha-beta cutoffs

---

## Quick Start

### Prerequisites
- Docker and Docker Compose
- An Anthropic API key (for the coach agent)

### Setup

```bash
# Clone the repository
git clone <your-repo-url>
cd glass-box-chess

# Set your Anthropic API key
export ANTHROPIC_API_KEY=sk-ant-...

# Start the full stack
docker compose up --build
```

### Services

| Service | URL | Description |
|---------|-----|-------------|
| Chess UI | http://localhost:3000 | Play chess, see engine analysis |
| Backend API | http://localhost:5000 | Engine + OTel spans |
| Coach Agent | http://localhost:5001 | LLM explanations |
| SigNoz UI | http://localhost:3301 | Trace viewer + dashboards |
| OTel Collector | localhost:4317/4318 | Telemetry pipeline |

### Usage

1. Open http://localhost:3000 — the chess board
2. Make a move (or let the engine play)
3. After the engine responds, click **Explain Move** to get a natural-language explanation
4. Open http://localhost:3301 — SigNoz trace viewer
5. Find the latest `agent.decide_move` trace in the trace list
6. Click into it to see the full span waterfall:
   - `engine.search` → nodes, TT hits, pruning
   - `engine.evaluation` → score breakdown
   - `engine.transposition_lookup` → cache performance
   - `agent.coach.explain` → LLM reasoning
   - `llm.generate_explanation` → token usage, cost

### Demo Flow

```
1. Human makes a move → POST /api/engine/evaluate
2. Server creates root span: agent.decide_move
3. Server creates child span: engine.search (with TT, pruning data)
4. Server creates child span: engine.evaluation (score breakdown)
5. Server creates child span: engine.transposition_lookup (cache stats)
6. Frontend shows move + links to SigNoz trace
7. User clicks "Explain Move" → POST /api/coach/explain
8. Coach agent creates span: agent.coach.tool_call
9. Coach agent creates child span: llm.generate_explanation
10. LLM generates natural-language explanation
11. SigNoz shows complete multi-hop trace: search → tool → LLM → output
```

---

## SigNoz Dashboards

The dashboard at `dashboards/glass-box-chess-dashboard.json` includes:

- **Nodes Explored per Move**: Visualizes search complexity across game phases
- **Search Duration**: Time taken per engine evaluation
- **Pruning Efficiency**: Alpha-beta cutoff count over time
- **Transposition Table Hit Rate**: Cache utilization trending
- **LLM Cost & Latency**: Per-explanation token usage and dollar cost
- **Evaluation Score Distribution**: Engine's assessment of positions
- **Trace Waterfall**: Full span hierarchy for each decision

### Alert Configuration

An alert fires when `agent.decide_move` exceeds 10 seconds (warning) or 30 seconds (critical), catching pathological positions that cause search blowup.

---

## Tech Stack

- **Engine**: C++ with minimax + alpha-beta, TT (Zobrist), iterative deepening, quiescence search, killer moves, history heuristic, piece-square tables, tapered eval
- **Server**: Node.js/Express with OpenTelemetry SDK (auto + manual instrumentation)
- **Coach Agent**: Node.js with Anthropic Claude API + OpenTelemetry
- **Frontend**: React (Vite) with chess.js
- **Observability**: OpenTelemetry → OTel Collector → SigNoz (ClickHouse)
- **Infrastructure**: Docker Compose

---

## License

MIT
