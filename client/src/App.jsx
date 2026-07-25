import React, { useState, useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import './index.css';
import {
  Activity,
  Cpu,
  Zap,
  RotateCcw,
  Settings,
  ExternalLink,
  Flame,
  Copy,
  Check,
  Bot,
  User,
  Gauge,
  X,
  History,
  Timer,
  Play,
  Pause,
  ChevronDown,
} from 'lucide-react';

// ---- Piece rendering (merged from former components/ChessPieces.js) ----
const PIECE_GLYPHS = {
  w: { k: '\u2654', q: '\u2655', r: '\u2656', b: '\u2657', n: '\u2658', p: '\u2659' },
  b: { k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F' },
};

function Piece({ type, color }) {
  return (
    <span className={`piece piece-${color}`} aria-hidden="true">
      {PIECE_GLYPHS[color][type]}
    </span>
  );
}

// Formats a millisecond duration into a short human readable string
const formatDuration = (ms) => {
  if (ms == null) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

// Formats a live-ticking clock as m:ss.t
const formatClock = (ms) => {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(1);
  return `${minutes}:${seconds.padStart(4, '0')}`;
};

export default function App() {
  const [game, setGame] = useState(new Chess());
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [possibleMoves, setPossibleMoves] = useState([]);
  const [lastMove, setLastMove] = useState(null);
  const [moveHistory, setMoveHistory] = useState([]); // [{ san, mover, durationMs }]

  const [isEvaluating, setIsEvaluating] = useState(false);
  const [telemetry, setTelemetry] = useState({
    eval: 0,
    depth: 4,
    nodes: 0,
    timeMs: 0,
    nps: 0,
    traceId: null,
    signozTraceUrl: null,
    bestMove: null,
  });

  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState({
    otlpEndpoint: 'http://localhost:4318',
    signozUiUrl: 'http://localhost:3301',
    engineDepth: 4,
    autoPlayMode: false,
    playAsWhite: true,
  });

  const [simConfig, setSimConfig] = useState({ totalRequests: 50, concurrency: 10, depth: 3 });
  const [isSimulating, setIsSimulating] = useState(false);
  const [simResult, setSimResult] = useState(null);

  const [copiedTrace, setCopiedTrace] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [engineError, setEngineError] = useState(null);

  // ---- Move timing / pause / start-gating ----
  // The game sits idle until the player presses Start. Nothing moves and no
  // clock runs until then. `hasStarted` flips permanently once Start is
  // pressed for the first time, which is also what drives the title bar
  // away.
  const [hasStarted, setHasStarted] = useState(false);
  const [isPaused, setIsPaused] = useState(true);

  const turnStartRef = useRef(Date.now());
  const pauseStartRef = useRef(null);
  const [liveElapsedMs, setLiveElapsedMs] = useState(0);

  // Collapsible sections inside the secondary (telemetry) panel.
  const [openSections, setOpenSections] = useState({
    telemetry: true,
    simulator: false,
  });
  const toggleSection = (id) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Reset the clock every time the position changes (a move was made).
  useEffect(() => {
    turnStartRef.current = Date.now();
    setLiveElapsedMs(0);
  }, [game]);

  // Tick the live clock while the game is in progress and not paused.
  useEffect(() => {
    if (game.isGameOver() || isPaused) return undefined;
    const interval = setInterval(() => {
      setLiveElapsedMs(Date.now() - turnStartRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, [game, isPaused]);

  // When pausing, remember when. When resuming, push the clock's start time
  // forward by however long we were paused so the elapsed time doesn't jump.
  useEffect(() => {
    if (isPaused) {
      pauseStartRef.current = Date.now();
    } else if (pauseStartRef.current) {
      const pausedFor = Date.now() - pauseStartRef.current;
      turnStartRef.current += pausedFor;
      pauseStartRef.current = null;
      setLiveElapsedMs(Date.now() - turnStartRef.current);
    }
  }, [isPaused]);

  // Opening the telemetry panel pauses the game so the position can't
  // change underneath you.
  useEffect(() => {
    if (sidebarOpen) {
      setIsPaused(true);
    }
  }, [sidebarOpen]);

  const recordMove = (san, moverColor) => {
    const durationMs = Date.now() - turnStartRef.current;
    setMoveHistory((prev) => [...prev, { san, mover: moverColor, durationMs }]);
  };

  // Single source of truth for "should the engine move right now". Covers
  // both regular single-engine play (engine only moves for its own color)
  // and Bot vs Bot autoplay (engine moves for both colors, back to back).
  // Keeping this as one effect — instead of two effects with partially
  // overlapping conditions — avoids the race where autoplay's timer and the
  // single-play trigger could both fire, or where a stale closure over
  // `config` caused moves to silently stop after the first one.
  useEffect(() => {
    if (!hasStarted || isPaused || isEvaluating || game.isGameOver()) return undefined;

    const isSingleEngineTurn =
      !config.autoPlayMode &&
      ((config.playAsWhite && game.turn() === 'b') || (!config.playAsWhite && game.turn() === 'w'));

    if (!config.autoPlayMode && !isSingleEngineTurn) return undefined;

    // Bot vs Bot gets a small pacing delay between moves so it's easy to
    // follow visually; single-engine replies fire right away.
    const delay = config.autoPlayMode ? 500 : 0;
    const timeout = setTimeout(() => {
      makeEngineMove();
    }, delay);

    return () => clearTimeout(timeout);
  }, [game, isPaused, isEvaluating, hasStarted, config.autoPlayMode, config.playAsWhite]);

  const makeEngineMove = async () => {
    if (game.isGameOver() || isPaused) return;
    setIsEvaluating(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
      const response = await fetch('/api/engine/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          fen: game.fen(),
          depth: config.engineDepth,
        }),
      });

      if (!response.ok) {
        throw new Error(`Engine endpoint returned ${response.status}`);
      }

      const data = await response.json();

      if (data.best_move) {
        const from = data.best_move.slice(0, 2);
        const to = data.best_move.slice(2, 4);
        const promotion = data.best_move.length > 4 ? data.best_move[4] : undefined;

        const moverColor = game.turn();
        const newGame = new Chess(game.fen());
        const moveResult = newGame.move({ from, to, promotion });

        if (moveResult) {
          setGame(newGame);
          setLastMove({ from, to });
          recordMove(moveResult.san, moverColor);
          setEngineError(null);
        } else {
          // The engine proposed a move that isn't legal for this position.
          // Pause rather than silently retrying forever with nothing
          // happening on the board.
          setEngineError(`Engine returned an illegal move (${data.best_move}). Game paused.`);
          setConfig((prev) => ({ ...prev, autoPlayMode: false }));
          setIsPaused(true);
        }
      } else {
        setEngineError('Engine response had no move. Game paused.');
        setConfig((prev) => ({ ...prev, autoPlayMode: false }));
        setIsPaused(true);
      }

      setTelemetry({
        eval: data.eval,
        depth: data.depth,
        nodes: data.nodes,
        timeMs: data.time_ms,
        nps: data.nps,
        traceId: data.trace_id,
        signozTraceUrl: data.signoz_trace_url,
        bestMove: data.best_move,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        setEngineError('Engine request timed out. Game paused.');
      } else {
        setEngineError('Could not reach the engine at /api/engine/evaluate. Game paused.');
      }
      setConfig((prev) => ({ ...prev, autoPlayMode: false }));
      setIsPaused(true);
    } finally {
      clearTimeout(timeoutId);
      setIsEvaluating(false);
    }
  };

  const handleSquareClick = (squareStr) => {
    if (!hasStarted || config.autoPlayMode || isEvaluating || isPaused) return;

    if (!selectedSquare) {
      const piece = game.get(squareStr);
      if (piece && piece.color === game.turn()) {
        setSelectedSquare(squareStr);
        const moves = game.moves({ square: squareStr, verbose: true });
        setPossibleMoves(moves.map((m) => m.to));
      }
    } else {
      if (possibleMoves.includes(squareStr)) {
        const moverColor = game.turn();
        const newGame = new Chess(game.fen());
        const moveResult = newGame.move({ from: selectedSquare, to: squareStr, promotion: 'q' });
        if (moveResult) {
          setGame(newGame);
          setLastMove({ from: selectedSquare, to: squareStr });
          recordMove(moveResult.san, moverColor);
        }
      }
      setSelectedSquare(null);
      setPossibleMoves([]);
    }
  };

  // Start/Stop lives in the main window. First press starts the game (and
  // permanently retires the title bar); subsequent presses just pause/resume.
  const handleStartStop = () => {
    if (isPaused) {
      setHasStarted(true);
      setIsPaused(false);
      setEngineError(null);
    } else {
      setIsPaused(true);
    }
  };

  const handleResetGame = () => {
    const newGame = new Chess();
    setGame(newGame);
    setSelectedSquare(null);
    setPossibleMoves([]);
    setLastMove(null);
    setMoveHistory([]);
    setHasStarted(false);
    setIsPaused(true);
    setEngineError(null);
    setConfig((prev) => ({ ...prev, autoPlayMode: false }));
    pauseStartRef.current = null;
    setTelemetry({ eval: 0, depth: config.engineDepth, nodes: 0, timeMs: 0, nps: 0, traceId: null, signozTraceUrl: null, bestMove: null });
  };

  const handleRunSimulation = async () => {
    setIsSimulating(true);
    setSimResult(null);

    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(simConfig),
      });
      const data = await res.json();
      setSimResult(data);
    } catch (err) {
      console.error('Simulation failed:', err);
    } finally {
      setIsSimulating(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedTrace(true);
    setTimeout(() => setCopiedTrace(false), 2000);
  };

  const evalScore = telemetry.eval / 100;
  const clampedEval = Math.max(-10, Math.min(10, evalScore));
  const evalPercentage = Math.round(((clampedEval + 10) / 20) * 100);

  const boardGrid = [];
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const rank = ranks[r];
      const file = files[c];
      const squareStr = `${file}${rank}`;
      const isLight = (r + c) % 2 === 0;
      const piece = game.get(squareStr);

      const isSelected = selectedSquare === squareStr;
      const isDest = possibleMoves.includes(squareStr);
      const isLastMoveSquare = lastMove && (lastMove.from === squareStr || lastMove.to === squareStr);

      boardGrid.push(
        <div
          key={squareStr}
          onClick={() => handleSquareClick(squareStr)}
          className={`square ${isLight ? 'square-light' : 'square-dark'} ${isSelected ? 'square-selected' : ''} ${isLastMoveSquare ? 'square-last-move' : ''}`}
        >
          {c === 0 && <span className="square-coord square-coord-rank">{rank}</span>}
          {r === 7 && <span className="square-coord square-coord-file">{file}</span>}
          {isDest && <div className="square-dest-indicator" />}
          {piece && <Piece type={piece.type} color={piece.color} />}
        </div>
      );
    }
  }

  const statusLabel = !hasStarted
    ? 'Press Start to begin'
    : game.isGameOver()
      ? 'Game over'
      : isPaused
        ? 'Paused'
        : `${game.turn() === 'w' ? 'White' : 'Black'} to move`;

  return (
    <div className="app-shell">
      {/* Title bar: only shown before the game has started, then eases away */}
      <header className={`app-header ${hasStarted ? 'app-header-hidden' : ''}`}>
        <div className="app-title">
          <Activity className="w-6 h-6" style={{ color: 'var(--accent-indigo)' }} />
          <div>
            <div className="app-title-text">SigNoz Chess Telemetry</div>
            <div className="app-title-sub">AI vs human, traced end to end</div>
          </div>
        </div>
      </header>

      {/* Always-available access to telemetry / simulator / config, since the
          header retires once play begins. */}
      <button
        className="floating-panel-btn"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open telemetry panel"
        title="Telemetry, simulator & SigNoz config"
      >
        <Cpu className="w-4 h-4" />
      </button>

      <main className="main-stage">
        <div className="board-column">
          {/* Start/Stop and Bot vs Bot live in the main window, front and center */}
          <div className="game-controls-bar">
            <div className="game-controls-primary">
              <button
                onClick={handleStartStop}
                className={`btn btn-lg btn-interactive ${isPaused ? 'btn-emerald' : 'btn-danger'}`}
              >
                {isPaused ? (<><Play className="w-4 h-4" /> Start</>) : (<><Pause className="w-4 h-4" /> Stop</>)}
              </button>

              <button
                onClick={() => setConfig((prev) => ({ ...prev, autoPlayMode: !prev.autoPlayMode }))}
                disabled={!hasStarted || isPaused}
                className={`btn btn-lg btn-interactive ${config.autoPlayMode ? 'btn-danger' : 'btn-secondary'}`}
                title="Have the engine play both sides"
              >
                <Bot className="w-4 h-4" /> {config.autoPlayMode ? 'Stop Bot vs Bot' : 'Bot vs Bot'}
              </button>
            </div>

            <div className="game-controls-status">
              {config.autoPlayMode && (
                <span className="badge badge-purple">
                  <span className="live-dot" style={{ background: 'var(--accent-purple)' }} /> Engine vs Engine
                </span>
              )}
              <span className={`badge ${isPaused ? 'badge-amber' : 'badge-emerald'}`}>
                {isPaused ? <Pause className="w-3 h-3" /> : <span className="live-dot" />}
                {statusLabel}
              </span>
              <span className="move-clock" title="Time on the clock for the side to move">
                <Timer className="w-3.5 h-3.5" />
                {formatClock(liveElapsedMs)}
              </span>
              {isEvaluating && (
                <span className="engine-thinking">
                  <Cpu className="w-3.5 h-3.5" style={{ animation: 'spin 1s linear infinite' }} /> Searching...
                </span>
              )}
            </div>

            {engineError && (
              <div className="engine-error-banner">
                <span>{engineError}</span>
                <button onClick={() => setEngineError(null)} aria-label="Dismiss">✕</button>
              </div>
            )}
          </div>

          <div className="board-container">
            <div className="eval-bar">
              <div className="eval-bar-text">
                {evalScore > 0 ? `+${evalScore.toFixed(1)}` : evalScore.toFixed(1)}
              </div>
              <div className="eval-bar-fill" style={{ height: `${evalPercentage}%` }} />
            </div>

            <div className={`chessboard ${!hasStarted ? 'chessboard-idle' : ''}`}>{boardGrid}</div>
          </div>
        </div>

        {/* Players, secondary controls & move history sit beside the board */}
        <aside className="side-panel">
          <div className="glass-panel side-panel-card">
            <div className="section-header-title">
              <User className="w-4 h-4" style={{ color: 'var(--accent-emerald)' }} />
              Players & Controls
            </div>

            <div className="side-panel-body">
              <div className="player-row">
                <div className="player-row-label">
                  <Bot className="w-4 h-4" style={{ color: 'var(--accent-indigo)' }} />
                  C++ Minimax Engine
                  <span className="badge badge-indigo">Depth {config.engineDepth}</span>
                </div>
              </div>
              <div className="player-row">
                <div className="player-row-label">
                  <User className="w-4 h-4" style={{ color: 'var(--accent-emerald)' }} />
                  Human ({config.playAsWhite ? 'White' : 'Black'})
                </div>
                <span className="player-row-turn">
                  {game.turn() === 'w' ? 'White to move' : 'Black to move'}
                </span>
              </div>

              <div className="controls-grid">
                <button onClick={handleResetGame} className="btn btn-secondary btn-interactive">
                  <RotateCcw className="w-3.5 h-3.5" /> Reset
                </button>
                <button
                  onClick={makeEngineMove}
                  disabled={!hasStarted || isEvaluating || isPaused || config.autoPlayMode}
                  className="btn btn-primary btn-interactive"
                  title="Ask the engine to move immediately"
                >
                  <Zap className="w-3.5 h-3.5" /> Force Move
                </button>
              </div>
            </div>
          </div>

          <div className="glass-panel side-panel-card side-panel-history">
            <div className="section-header-title">
              <History className="w-4 h-4" style={{ color: 'var(--accent-cyan)' }} />
              Move History
            </div>
            <div className="history-list">
              {moveHistory.length === 0 ? (
                <span className="history-empty">No moves played yet</span>
              ) : (
                moveHistory.map((m, idx) => (
                  <span key={idx} className="history-chip" title={`Took ${formatDuration(m.durationMs)} to play`}>
                    <span className="history-chip-move">
                      {Math.floor(idx / 2) + 1}.{idx % 2 === 0 ? '' : '...'} {m.san}
                    </span>
                    <span className="history-chip-time">{formatDuration(m.durationMs)}</span>
                  </span>
                ))
              )}
            </div>
          </div>
        </aside>
      </main>

      {/* Secondary sidebar backdrop */}
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      {/* Secondary Sidebar Panel: Telemetry, Simulator, SigNoz Config */}
      <aside className={`sidebar-panel ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-head">
          <h2>Telemetry & Setup</h2>
          <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="sidebar-scroll">
          {/* Live Telemetry */}
          <div className={`glass-panel sidebar-section sidebar-section-collapsible ${openSections.telemetry ? 'pinned' : ''}`}>
            <button className="section-header-row" onClick={() => toggleSection('telemetry')}>
              <div className="section-header-title">
                <Cpu className="w-4 h-4" style={{ color: 'var(--accent-purple)' }} />
                Live Telemetry
                <span className="badge badge-cyan">OTel v1.22</span>
              </div>
              <ChevronDown className={`section-chevron ${openSections.telemetry ? 'section-chevron-open' : ''}`} />
            </button>

            <div className="section-body">
              {telemetry.traceId ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="trace-glow trace-card">
                    <div className="trace-card-id">
                      <span className="trace-card-label">Trace ID</span>
                      <span className="trace-card-value">{telemetry.traceId}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button
                        onClick={() => copyToClipboard(telemetry.traceId)}
                        title="Copy Trace ID"
                        className="icon-btn"
                      >
                        {copiedTrace ? <Check className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      {telemetry.signozTraceUrl && (
                        <a
                          href={telemetry.signozTraceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="signoz-link-btn"
                        >
                          SigNoz <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="stat-grid">
                    <div className="stat-box">
                      <div className="stat-box-label">Nodes</div>
                      <div className="stat-box-value" style={{ color: 'var(--accent-cyan)' }}>{telemetry.nodes.toLocaleString()}</div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-box-label">Speed</div>
                      <div className="stat-box-value" style={{ color: 'var(--accent-purple)' }}>{(telemetry.nps / 1000).toFixed(1)}k n/s</div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-box-label">Duration</div>
                      <div className="stat-box-value" style={{ color: 'var(--accent-emerald)' }}>{telemetry.timeMs.toFixed(1)} ms</div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-box-label">Eval (cp)</div>
                      <div className="stat-box-value" style={{ color: 'var(--accent-amber)' }}>{telemetry.eval > 0 ? `+${telemetry.eval}` : telemetry.eval}</div>
                    </div>
                  </div>

                  <div className="span-waterfall">
                    <span className="span-waterfall-title">Span Waterfall</span>
                    <div className="span-row span-row-1">
                      <span>{'\u251C\u2500 POST /api/engine/evaluate'}</span><span>{telemetry.timeMs.toFixed(0)}ms</span>
                    </div>
                    <div className="span-row span-row-2">
                      <span>{'\u251C\u2500 EvaluatePosition'}</span><span>{(telemetry.timeMs * 0.95).toFixed(0)}ms</span>
                    </div>
                    <div className="span-row span-row-3">
                      <span>{'\u2514\u2500 C++ Minimax'}</span><span>{telemetry.timeMs.toFixed(0)}ms</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="telemetry-empty">
                  <Gauge className="w-6 h-6" style={{ color: '#475569' }} />
                  Make a move to generate trace spans.
                </div>
              )}
            </div>
          </div>

          {/* Scale Simulator */}
          <div className={`glass-panel sidebar-section sidebar-section-collapsible ${openSections.simulator ? 'pinned' : ''}`}>
            <button className="section-header-row" onClick={() => toggleSection('simulator')}>
              <div className="section-header-title">
                <Flame className="w-4 h-4" style={{ color: 'var(--accent-rose)' }} />
                Scale Simulator
              </div>
              <ChevronDown className={`section-chevron ${openSections.simulator ? 'section-chevron-open' : ''}`} />
            </button>

            <div className="section-body">
              <p className="simulator-blurb">
                Generate concurrent engine evaluations to stress-test your OTel Collector.
              </p>

              <div className="simulator-grid">
                <div>
                  <label className="simulator-label">
                    <span>Requests</span><span className="simulator-label-value" style={{ color: 'var(--accent-indigo)' }}>{simConfig.totalRequests}</span>
                  </label>
                  <input
                    type="range" min="10" max="200" step="10"
                    value={simConfig.totalRequests}
                    onChange={(e) => setSimConfig((prev) => ({ ...prev, totalRequests: Number(e.target.value) }))}
                    style={{ width: '100%', accentColor: 'var(--accent-indigo)' }}
                  />
                </div>
                <div>
                  <label className="simulator-label">
                    <span>Concurrency</span><span className="simulator-label-value" style={{ color: 'var(--accent-purple)' }}>{simConfig.concurrency}</span>
                  </label>
                  <input
                    type="range" min="1" max="20" step="1"
                    value={simConfig.concurrency}
                    onChange={(e) => setSimConfig((prev) => ({ ...prev, concurrency: Number(e.target.value) }))}
                    style={{ width: '100%', accentColor: 'var(--accent-purple)' }}
                  />
                </div>
              </div>

              <button onClick={handleRunSimulation} disabled={isSimulating} className="btn btn-primary btn-interactive simulator-run-btn">
                {isSimulating ? (<><Zap className="w-3.5 h-3.5" style={{ animation: 'spin 1s linear infinite' }} /> Firing Traffic...</>)
                  : (<><Flame className="w-3.5 h-3.5" /> Run Stress Test ({simConfig.totalRequests})</>)}
              </button>

              {simResult && (
                <div className="sim-result">
                  <div className="sim-result-head">
                    <span>Complete</span><span>{simResult.reqPerSec} Req/Sec</span>
                  </div>
                  <div className="sim-result-grid">
                    <div>Completed: <span style={{ color: 'var(--accent-emerald)' }}>{simResult.completed}</span></div>
                    <div>Duration: <span style={{ color: 'var(--accent-cyan)' }}>{simResult.durationMs}ms</span></div>
                    <div>Nodes: <span style={{ color: 'var(--accent-purple)' }}>{simResult.totalNodes.toLocaleString()}</span></div>
                    <div>Trace: <span style={{ color: 'var(--accent-indigo)' }}>{simResult.traceId.slice(0, 8)}...</span></div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <button onClick={() => setShowConfig(true)} className="btn btn-secondary btn-interactive sidebar-config-btn">
            <Settings className="w-3.5 h-3.5" /> SigNoz Config
          </button>
        </div>
      </aside>

      {/* SigNoz Configuration Modal */}
      {showConfig && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-head">
              <h3>
                <Settings className="w-5 h-5" style={{ color: 'var(--accent-indigo)' }} /> SigNoz & Engine Setup
              </h3>
              <button onClick={() => setShowConfig(false)} className="modal-close-btn">✕</button>
            </div>

            <div className="form-group">
              <label>SigNoz OTLP Collector Endpoint</label>
              <input
                type="text"
                className="form-input"
                value={config.otlpEndpoint}
                onChange={(e) => setConfig((prev) => ({ ...prev, otlpEndpoint: e.target.value }))}
                placeholder="http://localhost:4318 or https://ingest.signoz.cloud"
              />
              <span className="form-hint">Supports local Docker SigNoz or SigNoz Cloud HTTP ingestion.</span>
            </div>

            <div className="form-group">
              <label>SigNoz UI Dashboard Base URL</label>
              <input
                type="text"
                className="form-input"
                value={config.signozUiUrl}
                onChange={(e) => setConfig((prev) => ({ ...prev, signozUiUrl: e.target.value }))}
                placeholder="http://localhost:3301"
              />
            </div>

            <div className="form-group">
              <label>Default C++ Search Depth ({config.engineDepth})</label>
              <input
                type="range"
                min="1"
                max="6"
                value={config.engineDepth}
                onChange={(e) => setConfig((prev) => ({ ...prev, engineDepth: Number(e.target.value) }))}
                style={{ accentColor: 'var(--accent-indigo)' }}
              />
            </div>

            <div className="modal-actions">
              <button onClick={() => setShowConfig(false)} className="btn btn-secondary btn-interactive">Cancel</button>
              <button
                onClick={async () => {
                  try {
                    await fetch('/api/config/otlp', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        otlpEndpoint: config.otlpEndpoint,
                        signozUiUrl: config.signozUiUrl,
                        defaultDepth: config.engineDepth,
                      }),
                    });
                  } catch (e) {
                    console.error(e);
                  }
                  setShowConfig(false);
                }}
                className="btn btn-primary btn-interactive"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}