const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const path = require('path');
const { trace, metrics, Context, executionAsyncResource } = require('@opentelemetry/api');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const ENGINE_PATH = process.env.ENGINE_PATH || path.join(__dirname, '..', 'engine.exe');

// OpenTelemetry Metrics & Tracers
const tracer = trace.getTracer('chess-engine-tracer', '1.0.0');
const meter = metrics.getMeter('chess-engine-meter', '1.0.0');

// Custom Telemetry Metrics
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

const activeSimulationsGauge = meter.createUpDownCounter('chess_active_simulations', {
  description: 'Number of concurrent load simulation games running',
});

// Dynamic configuration state
let dynamicConfig = {
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
  signozUiUrl: process.env.SIGNOZ_UI_URL || 'http://localhost:3301',
  defaultDepth: 4,
};

let recentTelemetryLogs = [];

function addTelemetryLog(log) {
  recentTelemetryLogs.unshift({
    timestamp: new Date().toISOString(),
    ...log
  });
  if (recentTelemetryLogs.length > 50) recentTelemetryLogs.pop();
}

/**
 * Execute C++ Engine binary
 */
function runEngine(fen, depth) {
  return new Promise((resolve, reject) => {
    // Detect binary name depending on OS
    const binary = process.platform === 'win32' ? ENGINE_PATH : ENGINE_PATH.replace('.exe', '');
    execFile(binary, [fen, String(depth)], { maxBuffer: 1024 * 1024 * 10, timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        return reject(error);
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (parseErr) {
        reject(new Error(`Failed to parse C++ engine JSON output: ${stdout}`));
      }
    });
  });
}

/**
 * POST /api/engine/evaluate
 * Primary engine evaluation endpoint
 */
app.post('/api/engine/evaluate', async (req, res) => {
  const { fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", depth = dynamicConfig.defaultDepth } = req.body;

  return tracer.startActiveSpan('ChessEngine.EvaluatePosition', async (span) => {
    try {
      const activeTraceId = span.spanContext().traceId;
      const activeSpanId = span.spanContext().spanId;

      span.setAttribute('chess.fen', fen);
      span.setAttribute('chess.requested_depth', depth);
      span.setAttribute('chess.engine_type', 'C++ Minimax Alpha-Beta');

      const startTime = Date.now();

      // Child span for C++ Engine Process
      const engineResult = await tracer.startActiveSpan('ChessEngine.SubprocessExec', async (childSpan) => {
        childSpan.setAttribute('chess.subprocess_cmd', ENGINE_PATH);
        const result = await runEngine(fen, depth);
        childSpan.setAttribute('chess.nodes_searched', result.nodes);
        childSpan.setAttribute('chess.time_ms', result.time_ms);
        childSpan.setAttribute('chess.nps', result.nps);
        childSpan.setAttribute('chess.best_move', result.best_move);
        childSpan.setAttribute('chess.eval_score', result.eval);
        childSpan.end();
        return result;
      });

      const totalDuration = Date.now() - startTime;

      // Update OTel metrics
      moveCounter.add(1, { depth: String(depth) });
      nodeCounter.add(engineResult.nodes, { depth: String(depth) });
      searchDurationHistogram.record(engineResult.time_ms, { depth: String(depth) });

      span.setAttribute('chess.eval_centipawns', engineResult.eval);
      span.setAttribute('chess.total_duration_ms', totalDuration);

      addTelemetryLog({
        traceId: activeTraceId,
        fen,
        bestMove: engineResult.best_move,
        eval: engineResult.eval,
        nodes: engineResult.nodes,
        timeMs: engineResult.time_ms,
        depth
      });

      res.json({
        ...engineResult,
        trace_id: activeTraceId,
        span_id: activeSpanId,
        signoz_trace_url: `${dynamicConfig.signozUiUrl}/trace/${activeTraceId}`
      });
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: 1, message: err.message });
      res.status(500).json({ error: err.message, trace_id: span.spanContext().traceId });
    } finally {
      span.end();
    }
  });
});

/**
 * POST /api/simulate
 * Load & Scale simulation endpoint for stress testing SigNoz OTel pipeline
 */
app.post('/api/simulate', async (req, res) => {
  const { totalRequests = 20, concurrency = 5, depth = 3 } = req.body;
  activeSimulationsGauge.add(1);

  return tracer.startActiveSpan('ChessEngine.LoadSimulation', async (span) => {
    span.setAttribute('simulation.total_requests', totalRequests);
    span.setAttribute('simulation.concurrency', concurrency);
    span.setAttribute('simulation.depth', depth);

    const fens = [
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 1 5",
      "rnbqkb1r/pp1ppppp/5n2/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq c6 0 3",
      "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
      "rnbqk2r/ppp1bppp/4pn2/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R w KQkq - 4 5"
    ];

    let completed = 0;
    let failed = 0;
    let totalNodes = 0;
    const startTime = Date.now();

    const tasks = Array.from({ length: totalRequests }, (_, i) => async () => {
      const fen = fens[i % fens.length];
      try {
        const res = await runEngine(fen, depth);
        completed++;
        totalNodes += res.nodes;
        moveCounter.add(1, { simulated: "true" });
        nodeCounter.add(res.nodes, { simulated: "true" });
      } catch (err) {
        failed++;
      }
    });

    // Execute with controlled concurrency
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

    activeSimulationsGauge.add(-1);

    res.json({
      status: "completed",
      totalRequests,
      completed,
      failed,
      totalNodes,
      durationMs: duration,
      reqPerSec: (completed / (duration / 1000)).toFixed(2),
      traceId: span.spanContext().traceId
    });
  });
});

/**
 * GET /api/telemetry/stats
 */
app.get('/api/telemetry/stats', (req, res) => {
  res.json({
    status: 'online',
    engine: 'C++ Minimax Alpha-Beta',
    otlpEndpoint: dynamicConfig.otlpEndpoint,
    signozUiUrl: dynamicConfig.signozUiUrl,
    recentLogs: recentTelemetryLogs.slice(0, 15)
  });
});

/**
 * POST /api/config/otlp
 */
app.post('/api/config/otlp', (req, res) => {
  const { otlpEndpoint, signozUiUrl, defaultDepth } = req.body;
  if (otlpEndpoint) dynamicConfig.otlpEndpoint = otlpEndpoint;
  if (signozUiUrl) dynamicConfig.signozUiUrl = signozUiUrl;
  if (defaultDepth) dynamicConfig.defaultDepth = Number(defaultDepth);

  res.json({ message: "Configuration updated successfully", dynamicConfig });
});

app.listen(PORT, () => {
  console.log(`[Chess Backend] Engine Server running on port ${PORT}`);
  console.log(`[Chess Backend] Executing C++ Engine at: ${ENGINE_PATH}`);
});
