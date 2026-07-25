const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const path = require('path');
const { trace, metrics, SpanStatusCode } = require('@opentelemetry/api');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const ENGINE_PATH = process.env.ENGINE_PATH || path.join(__dirname, '..', 'engine.exe');
const COACH_SERVICE_URL = process.env.COACH_SERVICE_URL || 'http://localhost:5001';

const tracer = trace.getTracer('chess-engine-tracer', '2.0.0');
const meter = metrics.getMeter('chess-engine-meter', '2.0.0');

const moveCounter = meter.createCounter('chess_moves_total', {
  description: 'Total number of chess engine evaluations requested',
});
const nodeCounter = meter.createCounter('chess_nodes_searched_total', {
  description: 'Total number of chess positions/nodes evaluated by C++ engine',
});
const searchDurationHistogram = meter.createHistogram('chess_eval_duration_ms', {
  description: 'Duration of engine search evaluation in milliseconds',
  unit: 'ms',
});
const ttHitRateGauge = meter.createObservableGauge('chess_tt_hit_rate', {
  description: 'Transposition table hit rate for recent searches',
});
const pruningCounter = meter.createCounter('chess_pruning_events_total', {
  description: 'Total alpha-beta pruning events across all searches',
});
const coachRequestCounter = meter.createCounter('chess_coach_requests_total', {
  description: 'Total LLM coach explanation requests',
});
const coachDurationHistogram = meter.createHistogram('chess_coach_duration_ms', {
  description: 'Duration of LLM coach explanation in milliseconds',
  unit: 'ms',
});

let dynamicConfig = {
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
  signozUiUrl: process.env.SIGNOZ_UI_URL || 'http://localhost:16686',
  defaultDepth: 4,
};

let recentTelemetryLogs = [];

function addTelemetryLog(log) {
  recentTelemetryLogs.unshift({ timestamp: new Date().toISOString(), ...log });
  if (recentTelemetryLogs.length > 50) recentTelemetryLogs.pop();
}

function runEngine(fen, depth, timeMs) {
  return new Promise((resolve, reject) => {
    const binary = process.platform === 'win32' ? ENGINE_PATH : ENGINE_PATH.replace('.exe', '');
    const args = [fen, String(depth)];
    if (timeMs) args.push(String(timeMs));
    execFile(binary, args, { maxBuffer: 1024 * 1024 * 10, timeout: 15000 }, (error, stdout, stderr) => {
      if (error) return reject(error);
      try {
        resolve(JSON.parse(stdout));
      } catch (parseErr) {
        reject(new Error(`Failed to parse C++ engine JSON: ${stdout.substring(0, 200)}`));
      }
    });
  });
}

app.post('/api/engine/evaluate', async (req, res) => {
  const { fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", depth = dynamicConfig.defaultDepth } = req.body;

  return tracer.startActiveSpan('agent.decide_move', async (rootSpan) => {
    try {
      const activeTraceId = rootSpan.spanContext().traceId;
      const activeSpanId = rootSpan.spanContext().spanId;

      rootSpan.setAttribute('chess.fen', fen);
      rootSpan.setAttribute('chess.requested_depth', depth);
      rootSpan.setAttribute('chess.engine_type', 'cpp-minimax-alphabeta');
      rootSpan.setAttribute('chess.service.version', '2.0.0');

      const startTime = Date.now();

      const engineResult = await tracer.startActiveSpan('engine.search', async (searchSpan) => {
        try {
          const result = await runEngine(fen, depth, 5000);

          searchSpan.setAttribute('engine.nodes_total', result.nodes);
          searchSpan.setAttribute('engine.time_ms', result.time_ms);
          searchSpan.setAttribute('engine.nps', result.nps);
          searchSpan.setAttribute('engine.best_move', result.best_move);
          searchSpan.setAttribute('engine.eval_score', result.eval);
          searchSpan.setAttribute('engine.depth_reached', result.depth);

          if (result.trace) {
            searchSpan.setAttribute('engine.tt_hits', result.trace.tt_hits);
            searchSpan.setAttribute('engine.tt_cutoffs', result.trace.tt_cutoffs);
            searchSpan.setAttribute('engine.tt_hit_rate', result.trace.tt_hit_rate);
            searchSpan.setAttribute('engine.tt_entries', result.trace.tt_entries);
            searchSpan.setAttribute('engine.pruning_events', result.trace.total_pruning_events);
            searchSpan.setAttribute('engine.iterative_deepening', result.trace.iterative_deepening);
            searchSpan.setAttribute('engine.actual_depth', result.trace.actual_depth_reached);
          }

          return result;
        } catch (err) {
          searchSpan.recordException(err);
          searchSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
          throw err;
        } finally {
          searchSpan.end();
        }
      });

      if (engineResult.trace) {
        await tracer.startActiveSpan('engine.transposition_lookup', async (ttSpan) => {
          ttSpan.setAttribute('tt.hits', engineResult.trace.tt_hits);
          ttSpan.setAttribute('tt.cutoffs', engineResult.trace.tt_cutoffs);
          ttSpan.setAttribute('tt.hit_rate', engineResult.trace.tt_hit_rate);
          ttSpan.setAttribute('tt.total_entries', engineResult.trace.tt_entries);
          ttSpan.setAttribute('tt.cache_size', 1048576);
          ttSpan.end();
        });

        await tracer.startActiveSpan('engine.evaluation', async (evalSpan) => {
          evalSpan.setAttribute('eval.score', engineResult.eval);
          evalSpan.setAttribute('eval.centipawns', engineResult.eval);
          evalSpan.setAttribute('eval.pawns', (engineResult.eval / 100).toFixed(2));
          evalSpan.setAttribute('eval.components', 'material,piece_square_tables,king_safety_tapered');
          evalSpan.setAttribute('eval.phase', Math.abs(engineResult.eval) > 300 ? 'middlegame' : 'opening');
          evalSpan.end();
        });

        pruningCounter.add(engineResult.trace.total_pruning_events, {
          depth: String(engineResult.depth),
        });
      }

      const totalDuration = Date.now() - startTime;

      moveCounter.add(1, { depth: String(depth) });
      nodeCounter.add(engineResult.nodes, { depth: String(depth) });
      searchDurationHistogram.record(engineResult.time_ms, { depth: String(depth) });

      rootSpan.setAttribute('chess.eval_centipawns', engineResult.eval);
      rootSpan.setAttribute('chess.total_duration_ms', totalDuration);
      rootSpan.setAttribute('chess.best_move', engineResult.best_move);
      rootSpan.setAttribute('chess.total_nodes', engineResult.nodes);

      addTelemetryLog({
        traceId: activeTraceId,
        fen,
        bestMove: engineResult.best_move,
        eval: engineResult.eval,
        nodes: engineResult.nodes,
        timeMs: engineResult.time_ms,
        depth: engineResult.depth,
      });

      res.json({
        ...engineResult,
        trace_id: activeTraceId,
        span_id: activeSpanId,
        signoz_trace_url: `${dynamicConfig.signozUiUrl}/trace/${activeTraceId}`,
      });
    } catch (err) {
      rootSpan.recordException(err);
      rootSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      res.status(500).json({ error: err.message, trace_id: rootSpan.spanContext().traceId });
    } finally {
      rootSpan.end();
    }
  });
});

app.post('/api/coach/explain', async (req, res) => {
  const { fen, bestMove, evalScore, legalMoves, traceId } = req.body;

  return tracer.startActiveSpan('agent.coach.explain', async (coachSpan) => {
    try {
      coachSpan.setAttribute('coach.fen', fen);
      coachSpan.setAttribute('coach.best_move', bestMove);
      coachSpan.setAttribute('coach.eval_score', evalScore);

      const startTime = Date.now();

      const explainResult = await tracer.startActiveSpan('agent.coach.tool_call', async (toolSpan) => {
        try {
          toolSpan.setAttribute('tool.name', 'query_engine_analysis');
          toolSpan.setAttribute('tool.input.fen', fen);
          toolSpan.setAttribute('tool.input.best_move', bestMove);

          const topMoves = (legalMoves || []).slice(0, 5).join(', ');
          toolSpan.setAttribute('tool.input.candidate_moves', topMoves);

          const response = await fetch(`${COACH_SERVICE_URL}/api/explain`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fen,
              bestMove,
              evalScore,
              candidateMoves: legalMoves ? legalMoves.slice(0, 5) : [],
              traceId,
            }),
          });

          if (!response.ok) {
            throw new Error(`Coach service returned ${response.status}`);
          }

          const data = await response.json();
          toolSpan.setAttribute('tool.output.explanation', data.explanation || '');
          toolSpan.setAttribute('tool.output.tokens_used', data.tokensUsed || 0);
          toolSpan.setAttribute('tool.output.latency_ms', data.latencyMs || 0);

          return data;
        } catch (err) {
          toolSpan.recordException(err);
          toolSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
          throw err;
        } finally {
          toolSpan.end();
        }
      });

      const duration = Date.now() - startTime;
      coachSpan.setAttribute('coach.explanation', explainResult.explanation || '');
      coachSpan.setAttribute('coach.total_duration_ms', duration);
      coachSpan.setAttribute('coach.tokens_used', explainResult.tokensUsed || 0);
      coachSpan.setAttribute('coach.cost_estimate_usd', explainResult.costUsd || 0);

      coachRequestCounter.add(1);
      coachDurationHistogram.record(duration);

      res.json(explainResult);
    } catch (err) {
      coachSpan.recordException(err);
      coachSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      res.status(500).json({ error: err.message });
    } finally {
      coachSpan.end();
    }
  });
});

app.post('/api/simulate', async (req, res) => {
  const { totalRequests = 20, concurrency = 5, depth = 3 } = req.body;

  return tracer.startActiveSpan('ChessEngine.LoadSimulation', async (span) => {
    span.setAttribute('simulation.total_requests', totalRequests);
    span.setAttribute('simulation.concurrency', concurrency);
    span.setAttribute('simulation.depth', depth);

    const fens = [
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 1 5",
      "rnbqkb1r/pp1ppppp/5n2/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq c6 0 3",
      "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
      "rnbqk2r/ppp1bppp/4pn2/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R w KQkq - 4 5",
    ];

    let completed = 0, failed = 0, totalNodes = 0;
    const startTime = Date.now();

    const tasks = Array.from({ length: totalRequests }, (_, i) => async () => {
      const fen = fens[i % fens.length];
      try {
        const result = await runEngine(fen, depth);
        completed++;
        totalNodes += result.nodes;
        moveCounter.add(1, { simulated: 'true' });
        nodeCounter.add(result.nodes, { simulated: 'true' });
      } catch {
        failed++;
      }
    });

    const pool = [];
    for (const task of tasks) {
      const p = task();
      pool.push(p);
      if (pool.length >= concurrency) {
        await Promise.race(pool);
        pool.splice(pool.findIndex(p => p.isResolved), 1);
      }
    }
    await Promise.all(pool);

    const duration = Date.now() - startTime;
    span.setAttribute('simulation.duration_ms', duration);
    span.setAttribute('simulation.completed', completed);
    span.setAttribute('simulation.failed', failed);
    span.setAttribute('simulation.total_nodes', totalNodes);
    span.end();

    res.json({
      status: 'completed',
      totalRequests,
      completed,
      failed,
      totalNodes,
      durationMs: duration,
      reqPerSec: (completed / (duration / 1000)).toFixed(2),
      traceId: span.spanContext().traceId,
    });
  });
});

app.get('/api/telemetry/stats', (req, res) => {
  res.json({
    status: 'online',
    engine: 'C++ Minimax Alpha-Beta (Optimized)',
    version: '2.0.0',
    features: ['transposition_table', 'iterative_deepening', 'quiescence_search', 'killer_moves', 'history_heuristic', 'check_detection', 'tapered_eval'],
    otlpEndpoint: dynamicConfig.otlpEndpoint,
    signozUiUrl: dynamicConfig.signozUiUrl,
    coachServiceUrl: COACH_SERVICE_URL,
    recentLogs: recentTelemetryLogs.slice(0, 15),
  });
});

app.post('/api/config/otlp', (req, res) => {
  const { otlpEndpoint, signozUiUrl, defaultDepth } = req.body;
  if (otlpEndpoint) dynamicConfig.otlpEndpoint = otlpEndpoint;
  if (signozUiUrl) dynamicConfig.signozUiUrl = signozUiUrl;
  if (defaultDepth) dynamicConfig.defaultDepth = Number(defaultDepth);
  res.json({ message: 'Configuration updated', dynamicConfig });
});

app.listen(PORT, () => {
  console.log(`[Chess Backend] v2.0 running on port ${PORT}`);
  console.log(`[Chess Backend] Engine: ${ENGINE_PATH}`);
  console.log(`[Chess Backend] Coach: ${COACH_SERVICE_URL}`);
});
