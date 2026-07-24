import React, { useState, useEffect } from 'react';
import { Chess } from 'chess.js';
import { PieceSVG } from './components/ChessPieces';
import { 
  Activity, 
  Cpu, 
  Zap, 
  RotateCcw, 
  Play, 
  Settings, 
  ExternalLink, 
  BarChart3, 
  Flame, 
  ShieldAlert, 
  Sliders, 
  Copy, 
  Check,
  Bot,
  User,
  Gauge
} from 'lucide-react';

export default function App() {
  const [game, setGame] = useState(new Chess());
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [possibleMoves, setPossibleMoves] = useState([]);
  const [lastMove, setLastMove] = useState(null);
  const [moveHistory, setMoveHistory] = useState([]);
  
  // Engine Telemetry State
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

  // Settings & SigNoz Config
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState({
    otlpEndpoint: 'http://localhost:4318',
    signozUiUrl: 'http://localhost:3301',
    engineDepth: 4,
    autoPlayMode: false,
    playAsWhite: true,
  });

  // Load Simulator State
  const [simConfig, setSimConfig] = useState({ totalRequests: 50, concurrency: 10, depth: 3 });
  const [isSimulating, setIsSimulating] = useState(false);
  const [simResult, setSimResult] = useState(null);

  // Copied state indicator
  const [copiedTrace, setCopiedTrace] = useState(false);

  // Trigger engine move when it's engine turn
  useEffect(() => {
    const isEngineTurn = (config.playAsWhite && game.turn() === 'b') || (!config.playAsWhite && game.turn() === 'w');
    if (!game.isGameOver() && isEngineTurn && !isEvaluating && !config.autoPlayMode) {
      makeEngineMove();
    }
  }, [game]);

  // Handle Auto-Play Bot vs Bot Mode
  useEffect(() => {
    let timeout;
    if (config.autoPlayMode && !game.isGameOver() && !isEvaluating) {
      timeout = setTimeout(() => {
        makeEngineMove();
      }, 400);
    }
    return () => clearTimeout(timeout);
  }, [game, config.autoPlayMode, isEvaluating]);

  const makeEngineMove = async () => {
    if (game.isGameOver()) return;
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
          depth: config.engineDepth
        })
      });

      const data = await response.json();

      if (data.best_move) {
        const from = data.best_move.slice(0, 2);
        const to = data.best_move.slice(2, 4);
        const promotion = data.best_move.length > 4 ? data.best_move[4] : undefined;

        const newGame = new Chess(game.fen());
        const moveResult = newGame.move({ from, to, promotion });

        if (moveResult) {
          setGame(newGame);
          setLastMove({ from, to });
          setMoveHistory(prev => [...prev, moveResult.san]);
        }
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
        console.warn('Engine evaluation request timed out');
      } else {
        console.error('Engine evaluation failed:', err);
      }
    } finally {
      clearTimeout(timeoutId);
      setIsEvaluating(false);
    }
  };

  const handleSquareClick = (squareStr) => {
    if (config.autoPlayMode || isEvaluating) return;

    // Square selection logic
    if (!selectedSquare) {
      const piece = game.get(squareStr);
      if (piece && piece.color === game.turn()) {
        setSelectedSquare(squareStr);
        const moves = game.moves({ square: squareStr, verbose: true });
        setPossibleMoves(moves.map(m => m.to));
      }
    } else {
      // Try to execute move
      if (possibleMoves.includes(squareStr)) {
        const newGame = new Chess(game.fen());
        const moveResult = newGame.move({ from: selectedSquare, to: squareStr, promotion: 'q' });
        if (moveResult) {
          setGame(newGame);
          setLastMove({ from: selectedSquare, to: squareStr });
          setMoveHistory(prev => [...prev, moveResult.san]);
        }
      }
      setSelectedSquare(null);
      setPossibleMoves([]);
    }
  };

  const handleResetGame = () => {
    const newGame = new Chess();
    setGame(newGame);
    setSelectedSquare(null);
    setPossibleMoves([]);
    setLastMove(null);
    setMoveHistory([]);
    setTelemetry({ eval: 0, depth: config.engineDepth, nodes: 0, timeMs: 0, nps: 0, traceId: null, signozTraceUrl: null, bestMove: null });
  };

  const handleRunSimulation = async () => {
    setIsSimulating(true);
    setSimResult(null);

    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(simConfig)
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

  // Compute Eval Bar Fill Height (Range: -1000 to +1000 centipawns)
  const evalScore = telemetry.eval / 100;
  const clampedEval = Math.max(-10, Math.min(10, evalScore));
  const evalPercentage = Math.round(((clampedEval + 10) / 20) * 100);

  // Render 8x8 Board Squares
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
          {/* Coordinates Labels */}
          {c === 0 && <span className="square-coord square-coord-rank">{rank}</span>}
          {r === 7 && <span className="square-coord square-coord-file">{file}</span>}

          {/* Legal move dot */}
          {isDest && <div className="square-dest-indicator" />}

          {/* Chess piece graphic */}
          {piece && <PieceSVG type={piece.type} color={piece.color} />}
        </div>
      );
    }
  }

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col gap-6 max-w-7xl mx-auto">
      {/* Header Bar */}
      <header className="glass-panel p-4 px-6 flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-600/20 border border-indigo-500/30 rounded-xl text-indigo-400">
            <Activity className="w-7 h-7 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-300 to-cyan-400">
              SigNoz Chess Telemetry Platform
            </h1>
            <p className="text-xs text-slate-400 font-medium">
              High-Performance C++ Minimax Engine • OpenTelemetry Tracing & Metrics Benchmark
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="badge badge-emerald">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            SigNoz Live
          </span>
          <button onClick={() => setShowConfig(true)} className="btn btn-secondary text-xs">
            <Settings className="w-4 h-4" /> SigNoz Config
          </button>
        </div>
      </header>

      {/* Main Grid: Left Chessboard + Right Telemetry Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Column: Board & Play Controls */}
        <div className="lg:col-span-7 flex flex-col items-center gap-6">
          <div className="glass-panel p-6 w-full flex flex-col items-center gap-4">
            
            {/* Player Info Bar */}
            <div className="w-full flex justify-between items-center px-4 py-2 bg-slate-900/60 rounded-xl border border-slate-800">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-indigo-400" />
                <span className="font-semibold text-sm">C++ Minimax Engine</span>
                <span className="badge badge-indigo text-xs">Depth {config.engineDepth}</span>
              </div>
              {isEvaluating && (
                <span className="text-xs font-mono text-cyan-400 animate-pulse flex items-center gap-1.5">
                  <Cpu className="w-4 h-4 animate-spin" /> Searching tree...
                </span>
              )}
            </div>

            {/* Chessboard & Eval Bar */}
            <div className="board-container">
              <div className="eval-bar">
                <div className="eval-bar-text">
                  {evalScore > 0 ? `+${evalScore.toFixed(1)}` : evalScore.toFixed(1)}
                </div>
                <div 
                  className="eval-bar-fill"
                  style={{ height: `${evalPercentage}%` }}
                />
              </div>

              <div className="chessboard">
                {boardGrid}
              </div>
            </div>

            {/* Human Info Bar */}
            <div className="w-full flex justify-between items-center px-4 py-2 bg-slate-900/60 rounded-xl border border-slate-800">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-emerald-400" />
                <span className="font-semibold text-sm">Human Player ({config.playAsWhite ? 'White' : 'Black'})</span>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {game.turn() === 'w' ? "White to move" : "Black to move"}
              </span>
            </div>

            {/* Game Controls */}
            <div className="flex flex-wrap justify-center gap-3 mt-2 w-full">
              <button onClick={handleResetGame} className="btn btn-secondary text-xs">
                <RotateCcw className="w-4 h-4" /> Reset Game
              </button>
              
              <button 
                onClick={() => setConfig(prev => ({ ...prev, autoPlayMode: !prev.autoPlayMode }))} 
                className={`btn text-xs ${config.autoPlayMode ? 'btn-danger' : 'btn-emerald'}`}
              >
                <Bot className="w-4 h-4" /> 
                {config.autoPlayMode ? 'Stop Bot vs Bot' : 'Start Bot vs Bot'}
              </button>

              <button 
                onClick={makeEngineMove} 
                disabled={isEvaluating}
                className="btn btn-primary text-xs"
              >
                <Zap className="w-4 h-4" /> Force Engine Move
              </button>
            </div>

          </div>
        </div>

        {/* Right Column: OpenTelemetry & SigNoz Live Inspector */}
        <div className="lg:col-span-5 flex flex-col gap-6 w-full">
          
          {/* Live OpenTelemetry Trace Card */}
          <div className="glass-panel p-6 flex flex-col gap-4 relative overflow-hidden">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-purple-400" />
                <h2 className="font-bold text-base text-slate-100">Live Move Telemetry</h2>
              </div>
              <span className="badge badge-cyan">OpenTelemetry v1.22</span>
            </div>

            {telemetry.traceId ? (
              <div className="flex flex-col gap-3">
                {/* Trace ID Badge with Copy */}
                <div className="p-3 bg-indigo-950/40 border border-indigo-500/30 rounded-xl flex items-center justify-between gap-2 trace-glow">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-indigo-400">
                      OpenTelemetry Trace ID
                    </span>
                    <span className="font-mono text-xs text-indigo-200 truncate select-all">
                      {telemetry.traceId}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button 
                      onClick={() => copyToClipboard(telemetry.traceId)} 
                      className="p-1.5 hover:bg-indigo-800/50 rounded-lg text-indigo-300 transition-colors"
                      title="Copy Trace ID"
                    >
                      {copiedTrace ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                    {telemetry.signozTraceUrl && (
                      <a 
                        href={telemetry.signozTraceUrl} 
                        target="_blank" 
                        rel="noreferrer"
                        className="p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                      >
                        SigNoz <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Metrics Breakdown Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl flex flex-col">
                    <span className="text-[11px] text-slate-400 font-medium">Nodes Evaluated</span>
                    <span className="text-lg font-bold font-mono text-cyan-400">
                      {telemetry.nodes.toLocaleString()}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl flex flex-col">
                    <span className="text-[11px] text-slate-400 font-medium">Search Speed</span>
                    <span className="text-lg font-bold font-mono text-purple-400">
                      {(telemetry.nps / 1000).toFixed(1)}k <span className="text-xs font-normal">n/s</span>
                    </span>
                  </div>

                  <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl flex flex-col">
                    <span className="text-[11px] text-slate-400 font-medium">Search Duration</span>
                    <span className="text-lg font-bold font-mono text-emerald-400">
                      {telemetry.timeMs.toFixed(1)} <span className="text-xs font-normal">ms</span>
                    </span>
                  </div>

                  <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl flex flex-col">
                    <span className="text-[11px] text-slate-400 font-medium">Centipawn Eval</span>
                    <span className="text-lg font-bold font-mono text-amber-400">
                      {telemetry.eval > 0 ? `+${telemetry.eval}` : telemetry.eval}
                    </span>
                  </div>
                </div>

                {/* OpenTelemetry Span Tree Waterfall Graphic */}
                <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl font-mono text-xs flex flex-col gap-1.5">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wide">Span Hierarchy Waterfall</span>
                  <div className="flex justify-between items-center text-indigo-300">
                    <span>├─ HTTP POST /api/engine/evaluate</span>
                    <span>{telemetry.timeMs.toFixed(0)}ms</span>
                  </div>
                  <div className="flex justify-between items-center text-cyan-300 pl-4">
                    <span>├─ ChessEngine.EvaluatePosition</span>
                    <span>{(telemetry.timeMs * 0.95).toFixed(0)}ms</span>
                  </div>
                  <div className="flex justify-between items-center text-emerald-300 pl-8">
                    <span>└─ C++ SubprocessExec (Minimax)</span>
                    <span>{telemetry.timeMs.toFixed(0)}ms</span>
                  </div>
                </div>

              </div>
            ) : (
              <div className="py-8 text-center text-slate-500 font-mono text-xs flex flex-col items-center gap-2">
                <Gauge className="w-8 h-8 text-slate-600 animate-bounce" />
                Make a move on the board to generate OpenTelemetry trace spans.
              </div>
            )}
          </div>

          {/* SigNoz Traffic & Scalability Stress Tester */}
          <div className="glass-panel p-6 flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Flame className="w-5 h-5 text-rose-400" />
                <h2 className="font-bold text-base text-slate-100">SigNoz Scale Simulator</h2>
              </div>
              <span className="badge badge-cyan">Batch Generator</span>
            </div>

            <p className="text-xs text-slate-400">
              Generate hundreds of concurrent engine evaluations to stress-test your SigNoz OTel Collector and observe latency percentiles & metric histograms.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-300 flex justify-between">
                  <span>Total Requests</span>
                  <span className="text-indigo-400">{simConfig.totalRequests}</span>
                </label>
                <input 
                  type="range" 
                  min="10" 
                  max="200" 
                  step="10"
                  value={simConfig.totalRequests}
                  onChange={(e) => setSimConfig(prev => ({ ...prev, totalRequests: Number(e.target.value) }))}
                  className="accent-indigo-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-300 flex justify-between">
                  <span>Concurrency</span>
                  <span className="text-purple-400">{simConfig.concurrency}</span>
                </label>
                <input 
                  type="range" 
                  min="1" 
                  max="20" 
                  step="1"
                  value={simConfig.concurrency}
                  onChange={(e) => setSimConfig(prev => ({ ...prev, concurrency: Number(e.target.value) }))}
                  className="accent-purple-500"
                />
              </div>
            </div>

            <button 
              onClick={handleRunSimulation} 
              disabled={isSimulating}
              className="btn btn-primary w-full justify-center text-xs"
            >
              {isSimulating ? (
                <>
                  <Zap className="w-4 h-4 animate-spin" /> Firing Traffic to SigNoz...
                </>
              ) : (
                <>
                  <Flame className="w-4 h-4" /> Run SigNoz Stress Test ({simConfig.totalRequests} Req)
                </>
              )}
            </button>

            {simResult && (
              <div className="p-3 bg-emerald-950/30 border border-emerald-500/30 rounded-xl flex flex-col gap-2 font-mono text-xs">
                <div className="flex justify-between items-center text-emerald-300 font-bold">
                  <span>Stress Test Complete</span>
                  <span>{simResult.reqPerSec} Req/Sec</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
                  <div>Completed: <span className="text-emerald-400">{simResult.completed}</span></div>
                  <div>Duration: <span className="text-cyan-400">{simResult.durationMs}ms</span></div>
                  <div>Total Nodes: <span className="text-purple-400">{simResult.totalNodes.toLocaleString()}</span></div>
                  <div>Batch Trace ID: <span className="text-indigo-400 truncate">{simResult.traceId.slice(0, 8)}...</span></div>
                </div>
              </div>
            )}
          </div>

          {/* Move Log History */}
          <div className="glass-panel p-4 flex flex-col gap-2 max-h-48 overflow-y-auto">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Move History (Algebraic)</span>
            <div className="flex flex-wrap gap-2 text-xs font-mono">
              {moveHistory.length === 0 ? (
                <span className="text-slate-600">No moves played yet</span>
              ) : (
                moveHistory.map((m, idx) => (
                  <span key={idx} className="px-2 py-1 bg-slate-800 rounded border border-slate-700 text-slate-200">
                    {Math.floor(idx / 2) + 1}.{idx % 2 === 0 ? '' : '...'} {m}
                  </span>
                ))
              )}
            </div>
          </div>

        </div>

      </div>

      {/* SigNoz Configuration Modal */}
      {showConfig && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4">
              <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-400" /> SigNoz & Engine Setup
              </h3>
              <button onClick={() => setShowConfig(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="form-group">
              <label>SigNoz OTLP Collector Endpoint</label>
              <input 
                type="text" 
                className="form-input"
                value={config.otlpEndpoint}
                onChange={(e) => setConfig(prev => ({ ...prev, otlpEndpoint: e.target.value }))}
                placeholder="http://localhost:4318 or https://ingest.signoz.cloud"
              />
              <span className="text-[11px] text-slate-500">Supports local Docker SigNoz or SigNoz Cloud HTTP ingestion.</span>
            </div>

            <div className="form-group">
              <label>SigNoz UI Dashboard Base URL</label>
              <input 
                type="text" 
                className="form-input"
                value={config.signozUiUrl}
                onChange={(e) => setConfig(prev => ({ ...prev, signozUiUrl: e.target.value }))}
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
                onChange={(e) => setConfig(prev => ({ ...prev, engineDepth: Number(e.target.value) }))}
                className="accent-indigo-500"
              />
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowConfig(false)} className="btn btn-secondary text-xs">
                Cancel
              </button>
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
                      })
                    });
                  } catch (e) {
                    console.error(e);
                  }
                  setShowConfig(false);
                }} 
                className="btn btn-primary text-xs"
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
