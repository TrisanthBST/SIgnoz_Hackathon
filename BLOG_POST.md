# Glass Box Chess: Making AI Agent Reasoning Transparent with SigNoz

## The Problem: AI Agents Are Black Boxes

Every day, AI agents make decisions that affect our lives — recommending products, flagging fraud, composing emails, writing code. But when we ask "why did the agent do that?", we get silence. The reasoning is locked inside model weights, search trees, and heuristic evaluations that nobody can inspect.

This opacity isn't just an academic concern. When an AI agent makes a wrong decision in production — a bad trade, a misdiagnosed patient, a biased hiring recommendation — the debugging process is painful because there's no audit trail of *why* the agent chose that path.

**Glass Box Chess** is our answer to this problem. We took a chess-playing AI agent and made its entire reasoning process transparent using SigNoz, the OpenTelemetry-native observability platform. The result: a system where you can watch the agent think, see every evaluation it makes, track every cache hit, and read a natural-language explanation of its final decision — all in real-time dashboards.

## What We Built

Glass Box Chess is a full-stack chess application with three key components:

1. **An optimized C++ chess engine** — a minimax search with alpha-beta pruning, transposition tables, iterative deepening, quiescence search, and piece-square tables for positional evaluation.

2. **A Node.js backend** that wraps the engine and emits detailed OpenTelemetry traces for every aspect of the search: node counts, pruning events, transposition table hit rates, evaluation scores, and search depth.

3. **An LLM coach agent** — a service that takes the engine's analysis output and calls Anthropic's Claude API to generate natural-language explanations like "Qh5+ wins material because the pinned knight can't recapture."

The whole system is instrumented with OpenTelemetry and self-hosted SigNoz, giving us dashboards that show the agent's reasoning in real-time.

## Why Chess?

Chess is the perfect domain for demonstrating AI observability because:

- **The search tree is concrete and measurable.** We can count exactly how many positions were evaluated, how many were pruned, how many were cached. This isn't possible with LLM-based agents where the "search" is opaque.

- **The decisions have clear right/wrong answers.** We can verify that the engine's reasoning is sound, not just plausible-sounding.

- **The search is hierarchical.** Root decision → candidate evaluation → heuristic scoring → terminal position. This maps naturally to a span tree in distributed tracing.

- **It's relatable.** Everyone understands chess. A non-technical judge can open a SigNoz dashboard and immediately grasp what the agent was "thinking" during each move.

## What We Instrumented (and Why)

We created a span hierarchy that mirrors the engine's decision-making process:

**Root span: `agent.decide_move`** — The top-level trace for each engine decision. Tags include the FEN position, depth reached, total time, and the chosen move. This is the entry point for understanding any decision.

**Child span: `engine.search`** — The core minimax search loop. We track nodes visited, pruning events (alpha-beta cutoffs), and the search depth. This tells us how "hard" the engine had to think about a position.

**Child span: `engine.evaluation`** — Each time the engine evaluates a position, we record the score and which heuristic components contributed (material, positional tables, king safety). This reveals *what the engine values* in a position.

**Child span: `engine.transposition_lookup`** — Tracks whether a position was found in the transposition table (a cache of previously evaluated positions). Hit rate is a key metric for search efficiency.

**Child span: `agent.coach.tool_call` → `llm.generate_explanation`** — The coach agent's LLM call, with full token usage, cost tracking, and latency. This demonstrates the multi-hop agent pattern: search agent → tool invocation → LLM reasoning → final output.

This span hierarchy means a judge can open SigNoz, click on any `agent.decide_move` trace, and see the complete reasoning pipeline as a waterfall — from initial search through evaluation to the final natural-language explanation.

## Engine Optimizations: Before and After

The original engine was a basic minimax implementation. We optimized it significantly:

| Feature | Before | After |
|---------|--------|-------|
| Legal move filtering | None (illegal moves evaluated) | Full check detection |
| Checkmate detection | Returns static eval | Returns ±20000 (mate score) |
| Piece-square tables | 3 piece types | All 6 piece types + tapered eval |
| Transposition table | None | 1M-entry Zobrist-hashed TT |
| Iterative deepening | Fixed depth | Depth 1→N with time budget |
| Quiescence search | None | Capture-only search at leaves |
| Move ordering | MVV-LVA | MVV-LVA + killers + history |

Benchmark results on the starting position at depth 5:

- **Original**: 78,668 nodes, 63ms, no correctness checks
- **Optimized**: 136,405 nodes, 727ms, fully correct with legal move verification
- **TT hit rate**: 51% — half the positions at depth 5 were cached from shallower searches
- **Pruning events**: 13,255 alpha-beta cutoffs from better move ordering

The optimized engine is slower in raw milliseconds because it does significantly more work per node: checking legality (is the king in check after this move?), running quiescence search at leaf nodes (chasing captures beyond the search horizon), and maintaining the transposition table. But it produces *correct* results and generates rich observability data.

## The LLM Coach: Multi-Hop Agent Tracing

The coach agent is what makes Glass Box Chess a genuine AI agent observability project, not just a chess engine with metrics. The flow is:

1. The chess engine produces structured analysis: chosen move, eval score, candidate moves considered, why alternatives were rejected.
2. The coach agent receives this data and calls Claude with a system prompt: "You are an expert chess coach. Explain why this move is strong."
3. Claude generates a natural-language explanation like: "Nf3 develops the knight to its best square, controlling the center and preparing kingside castling. The engine rejected e4 because after ...e5, Black equalizes immediately."
4. The entire flow is traced: `agent.coach.tool_call` → `llm.generate_explanation`, with token counts, cost, and latency recorded.

This is a real multi-hop agent trace — exactly the kind of thing the hackathon judges want to see. The trace shows the agent using a tool (querying the engine analysis), making an LLM call, and producing output. Each step is observable.

## SigNoz Dashboards

We built a dashboard in SigNoz with six panels:

1. **Nodes Explored per Move** — Shows search complexity across game phases (openings are fast, complex middlegames spike)
2. **Pruning Efficiency** — Alpha-beta cutoff count over time, demonstrating the impact of move ordering
3. **Transposition Table Hit Rate** — Cache utilization trending, showing the TT's contribution
4. **LLM Cost & Latency** — Per-explanation token usage and dollar cost from the Anthropic API
5. **Evaluation Score Distribution** — The engine's assessment of positions across a game
6. **Trace Waterfall** — Full span hierarchy for each decision

We also configured an alert: if `agent.decide_move` exceeds 10 seconds, a warning fires. At 30 seconds, it's critical. This catches pathological positions (e.g., zugzwang positions with complex pawn structures) that cause search blowup.

## What We Learned

**Observability for AI agents is different from traditional microservices.** Traditional observability tracks request flow through services. AI agent observability needs to track *reasoning flow* through decision stages. A search tree isn't a request graph — it's a tree of hypotheses that get pruned. We needed custom spans that capture domain-specific concepts (pruning events, TT hits, evaluation components) rather than just HTTP request/response pairs.

**The LLM cost tracking is surprisingly valuable.** Each chess explanation costs roughly $0.001-0.003 in Claude API tokens. Over a full game (30-40 moves), that's $0.03-0.12. In a production agent making thousands of decisions per hour, this adds up fast. Having per-decision cost attribution in SigNoz dashboards is something every LLM-powered agent needs.

**The multi-hop trace pattern scales.** Our chess agent uses one tool (engine analysis) and one LLM call. A real-world agent might use 5-10 tools per decision. The same span hierarchy pattern — root decision span → tool call spans → LLM reasoning spans — works at any scale.

**Self-hosted SigNoz is straightforward.** The Docker Compose setup with ClickHouse, query-service, and frontend took about 10 minutes to get running. The OTel Collector integration is seamless. For a hackathon project, this is a huge win — no cloud accounts, no billing, no API keys for the observability layer.

## Try It

```bash
git clone <repo-url>
cd glass-box-chess
export ANTHROPIC_API_KEY=sk-ant-...
docker compose up --build
```

Open http://localhost:3000 to play chess. Open http://localhost:3301 to watch the agent think.

---

*Built for the "Agents of SigNoz" Hackathon, Track 01: AI & Agent Observability.*
