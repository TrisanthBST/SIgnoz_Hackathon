import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Chess } from 'chess.js';
import './index.css';
import {
  Activity,
  Cpu,
  Zap,
  RotateCcw,
  Settings,
  Bot,
  User,
  X,
  History,
  Timer,
  Play,
  Pause,
  Undo2,
  Rabbit,
  Swords,
  Skull,
  Crown,
  Target,
  Sparkles,
  MoveRight,
  Coins,
  Volume2,
  VolumeX,
  Trophy,
  Handshake,
} from 'lucide-react';

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playMoveSound(isCapture = false, isCheck = false) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (isCapture) {
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } else if (isCheck) {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.18);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.1);
    }
  } catch {}
}

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

const DIFFICULTY_LEVELS = [
  { id: 'pawn-shuffler', name: 'Pawn Shuffler', tier: 'Easy', depth: 2, icon: Rabbit,
    timeMs: 1000, randomChance: 30, evalNoise: 25, quiescenceDepth: 3,
    fetchTimeout: 8000,
    personality: 'A beginner chess program that occasionally makes random moves. Great for learning.',
    description: 'Depth 2 + 30% random blunders + eval noise. Plays sub-optimally on purpose.' },
  { id: 'trace-hunter', name: 'Trace Hunter', tier: 'Medium', depth: 4, icon: Swords,
    timeMs: 3000, randomChance: 5, evalNoise: 10, quiescenceDepth: 5,
    fetchTimeout: 10000,
    personality: 'An intermediate engine with slight positional understanding. Occasionally blunders.',
    description: 'Depth 4 + mild noise. A balanced challenge for casual players.' },
  { id: 'segfault', name: 'Segfault', tier: 'Hard', depth: 6, icon: Skull,
    timeMs: 6000, randomChance: 0, evalNoise: 0, quiescenceDepth: 8,
    fetchTimeout: 15000,
    personality: 'A serious engine with deep tactical vision. Finds most traps and forks.',
    description: 'Depth 6, pure search. A strong opponent that rarely blunders.' },
  { id: 'grandmaster', name: 'Grandmaster', tier: 'Expert', depth: 8, icon: Crown,
    timeMs: 10000, randomChance: 0, evalNoise: 0, quiescenceDepth: 10,
    fetchTimeout: 20000,
    personality: 'Maximum search depth with deep quiescence. Plays at a very strong level.',
    description: 'Depth 8, deep quiescence. Near-maximum strength of this engine.' },
];

const DIFFICULTY_COLORS = {
  easy:   '#10b981',
  medium: '#f59e0b',
  hard:   '#f43f5e',
  expert: '#a855f7',
};

// Fixed pacing for Bot vs Bot autoplay (no user-facing speed control).
const AUTOPLAY_DELAY_MS = 600;

const formatDuration = (ms) => {
  if (ms == null) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const formatClock = (ms) => {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(1);
  return `${minutes}:${seconds.padStart(4, '0')}`;
};

const STORAGE_KEY = 'chesswiz-game-v1';

function loadSavedGame() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

const CLASSIFICATION_COLORS = {
  Brilliant: '#f59e0b',
  Good: '#10b981',
  Inaccuracy: '#f59e0b',
  Mistake: '#f97316',
  Blunder: '#f43f5e',
  Best: '#6366f1',
};

function classifyMove(evalBefore, evalAfter, moverColor) {
  const perspective = moverColor === 'w' ? 1 : -1;
  const delta = (evalAfter - evalBefore) * perspective;
  const d = delta / 100;
  if (d >= 1.5) return 'Brilliant';
  if (d >= -0.3) return 'Good';
  if (d >= -1.0) return 'Inaccuracy';
  if (d >= -2.0) return 'Mistake';
  return 'Blunder';
}

// Works out who won a finished game, in terms that make sense given the
// current mode (Human vs Engine, or Bot vs Bot autoplay), including the
// color of whichever side won.
function computeGameResult(g, cfg, difficultyName) {
  let reason = 'Game Over';
  let isDraw = false;
  let winnerColor = null; // 'w' | 'b' | null when drawn

  if (g.isCheckmate()) {
    winnerColor = g.turn() === 'w' ? 'b' : 'w';
    reason = 'Checkmate';
  } else if (g.isStalemate()) {
    isDraw = true; reason = 'Stalemate';
  } else if (g.isThreefoldRepetition()) {
    isDraw = true; reason = 'Threefold Repetition';
  } else if (g.isInsufficientMaterial()) {
    isDraw = true; reason = 'Insufficient Material';
  } else if (g.isDraw()) {
    isDraw = true; reason = '50-Move Rule';
  } else {
    isDraw = true;
  }

  const humanColor = cfg.playAsWhite ? 'w' : 'b';
  const getController = (color) => {
    if (cfg.autoPlayMode) return 'bot';
    return color === humanColor ? 'human' : 'bot';
  };

  const colorLabel = (c) => (c === 'w' ? 'White' : 'Black');

  let outcome, icon, eyebrow, title, subtitle;

  if (isDraw) {
    outcome = 'draw';
    icon = 'draw';
    eyebrow = 'Game Drawn';
    title = 'Draw';
    subtitle = `${reason} \u00b7 Nobody wins this one.`;
  } else if (cfg.autoPlayMode) {
    outcome = 'bot';
    icon = 'bot';
    eyebrow = 'Bot vs Bot';
    title = `${colorLabel(winnerColor)} Wins`;
    subtitle = `${reason} \u00b7 ${colorLabel(winnerColor)} (${difficultyName}) defeats ${colorLabel(winnerColor === 'w' ? 'b' : 'w')}`;
  } else if (getController(winnerColor) === 'human') {
    outcome = 'win';
    icon = 'win';
    eyebrow = 'You Won';
    title = 'Victory!';
    subtitle = `${reason} \u00b7 You played ${colorLabel(winnerColor)} against ${difficultyName}`;
  } else {
    outcome = 'loss';
    icon = 'loss';
    eyebrow = 'Engine Wins';
    title = `${difficultyName} Wins`;
    subtitle = `${reason} \u00b7 The engine played ${colorLabel(winnerColor)}`;
  }

  return {
    outcome, icon, eyebrow, title, subtitle, winnerColor, isDraw,
    whiteLabel: cfg.autoPlayMode ? `Bot (${difficultyName})` : (humanColor === 'w' ? 'You' : difficultyName),
    blackLabel: cfg.autoPlayMode ? `Bot (${difficultyName})` : (humanColor === 'b' ? 'You' : difficultyName),
  };
}

function TypewriterText({ text, speed = 18 }) {
  const [displayed, setDisplayed] = useState('');
  const indexRef = useRef(0);

  useEffect(() => {
    setDisplayed('');
    indexRef.current = 0;
    if (!text) return;
    const interval = setInterval(() => {
      indexRef.current++;
      setDisplayed(text.slice(0, indexRef.current));
      if (indexRef.current >= text.length) clearInterval(interval);
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);

  return <span>{displayed}<span className="typewriter-cursor">|</span></span>;
}

const SPAN_COLORS = {
  'agent.decide_move': '#818cf8',
  'engine.search': '#22d3ee',
  'engine.transposition_lookup': '#a78bfa',
  'engine.evaluation': '#34d399',
  'agent.coach.explain': '#f472b6',
  'agent.coach.tool_call': '#fb923c',
};

function SpanWaterfall({ spans, totalMs }) {
  if (!spans || spans.length === 0) return null;
  const maxEnd = Math.max(...spans.map((s) => s.start + s.duration), totalMs || 1);

  return (
    <div className="span-waterfall">
      {spans.map((span, i) => {
        const left = maxEnd > 0 ? (span.start / maxEnd) * 100 : 0;
        const width = maxEnd > 0 ? Math.max((span.duration / maxEnd) * 100, 1.5) : 1.5;
        const color = SPAN_COLORS[span.name] || '#64748b';
        return (
          <div key={i} className="span-waterfall-row">
            <span className="span-waterfall-name" title={span.name}>{span.name.split('.').pop()}</span>
            <div className="span-waterfall-track">
              <div className="span-waterfall-bar" style={{ left: `${left}%`, width: `${width}%`, backgroundColor: color }} />
            </div>
            <span className="span-waterfall-dur">{span.duration}ms</span>
          </div>
        );
      })}
    </div>
  );
}

function BestMoveArrow({ move, flipped, boardRef }) {
  const [dims, setDims] = useState(null);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setDims({ w: rect.width, h: rect.height });
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [boardRef]);

  if (!dims || !move || move.length < 4) return null;

  const fromSq = move.slice(0, 2);
  const toSq = move.slice(2, 4);
  const files = flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
  const ranks = flipped ? ['1','2','3','4','5','6','7','8'] : ['8','7','6','5','4','3','2','1'];

  const fx = (files.indexOf(fromSq[0]) + 0.5) / 8 * dims.w;
  const fy = (ranks.indexOf(fromSq[1]) + 0.5) / 8 * dims.h;
  const tx = (files.indexOf(toSq[0]) + 0.5) / 8 * dims.w;
  const ty = (ranks.indexOf(toSq[1]) + 0.5) / 8 * dims.h;

  const dx = tx - fx; const dy = ty - fy;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / len; const uy = dy / len;
  const arrowLen = Math.min(len * 0.4, 18);
  const tipX = tx - ux * 4; const tipY = ty - uy * 4;
  const baseX = tipX - ux * arrowLen; const baseY = tipY - uy * arrowLen;
  const perpX = -uy * 10; const perpY = ux * 10;

  return (
    <svg className="best-move-arrow" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10 }}>
      <defs>
        <filter id="arrow-glow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <polygon
        points={`${tipX},${tipY} ${baseX + perpX},${baseY + perpY} ${baseX - perpX},${baseY - perpY}`}
        fill="rgba(99, 102, 241, 0.75)"
        filter="url(#arrow-glow)"
        stroke="rgba(99, 102, 241, 0.9)"
        strokeWidth="1"
      />
      <circle cx={tx} cy={ty} r={4} fill="rgba(99, 102, 241, 0.5)" />
    </svg>
  );
}

const RESULT_ICONS = { win: Trophy, loss: Skull, draw: Handshake, bot: Bot };

export default function App() {
  const [game, setGame] = useState(() => {
    const saved = loadSavedGame();
    if (saved?.fen) { try { return new Chess(saved.fen); } catch { return new Chess(); } }
    return new Chess();
  });
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [possibleMoves, setPossibleMoves] = useState([]);
  const [lastMove, setLastMove] = useState(() => loadSavedGame()?.lastMove || null);
  const [moveHistory, setMoveHistory] = useState(() => loadSavedGame()?.moveHistory || []);
  const [fenHistory, setFenHistory] = useState(() => {
    const saved = loadSavedGame();
    if (Array.isArray(saved?.fenHistory) && saved.fenHistory.length > 0) return saved.fenHistory;
    return [saved?.fen || new Chess().fen()];
  });

  const [isEvaluating, setIsEvaluating] = useState(false);
  const [bestMoves, setBestMoves] = useState([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastEngineBlunder, setLastEngineBlunder] = useState(false);
  const [gameStats, setGameStats] = useState(() => loadSavedGame()?.gameStats ?? {
    totalMoves: 0, captures: 0, checks: 0, castles: 0, promos: 0,
    whiteAvgThinkMs: 0, blackAvgThinkMs: 0, whiteTotalThinkMs: 0, blackTotalThinkMs: 0,
    whiteMoveCount: 0, blackMoveCount: 0,
  });
  const [telemetry, setTelemetry] = useState(() => {
    const saved = loadSavedGame()?.telemetry;
    return {
      eval: saved?.eval ?? 0, depth: saved?.depth ?? 4, nodes: saved?.nodes ?? 0,
      timeMs: saved?.timeMs ?? 0, nps: saved?.nps ?? 0, traceId: saved?.traceId ?? null,
      traceUrl: saved?.traceUrl ?? saved?.signozTraceUrl ?? null, bestMove: saved?.bestMove ?? null,
      legalMoves: saved?.legalMoves ?? [], spans: saved?.spans ?? [],
    };
  });

  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState(() => {
    const saved = loadSavedGame();
    return {
      otlpEndpoint: 'http://localhost:4318', traceUiUrl: 'http://localhost:3301',
      engineDepth: saved?.engineDepth ?? 4, autoPlayMode: false,
      autoPlayDelayMs: AUTOPLAY_DELAY_MS, playAsWhite: saved?.playAsWhite ?? true,
    };
  });

  const [engineError, setEngineError] = useState(null);

  const [coachExplanation, setCoachExplanation] = useState(() => loadSavedGame()?.coachExplanation ?? null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [coachStats, setCoachStats] = useState(() => loadSavedGame()?.coachStats ?? { totalTokens: 0, totalCostUsd: 0, callCount: 0 });

  const [hasStarted, setHasStarted] = useState(() => !!loadSavedGame()?.hasStarted);
  const [isPaused, setIsPaused] = useState(true);

  const [showColorPicker, setShowColorPicker] = useState(() => {
    const saved = loadSavedGame();
    return !saved?.hasStarted;
  });

  const [reloadPrompt, setReloadPrompt] = useState(() => {
    const saved = loadSavedGame();
    const moveCount = Array.isArray(saved?.moveHistory) ? saved.moveHistory.length : 0;
    let alreadyOver = false;
    if (saved?.fen) {
      try { alreadyOver = new Chess(saved.fen).isGameOver(); } catch {}
    }
    // If the saved game had already ended, skip straight to the game-over
    // modal instead of also showing "Resume Game" — otherwise both alerts
    // stack on top of each other.
    return { open: !!saved?.hasStarted && moveCount > 0 && !alreadyOver, moveCount };
  });

  // End-of-game result modal. `result` holds the computeGameResult() output.
  const [gameOverModal, setGameOverModal] = useState({ open: false, result: null });

  const turnStartRef = useRef(Date.now());
  const pauseStartRef = useRef(null);
  const prevEvalRef = useRef(0);
  const boardRef = useRef(null);
  const historyRef = useRef(null);
  const [showBestMoveArrow, setShowBestMoveArrow] = useState(true);
  const [liveElapsedMs, setLiveElapsedMs] = useState(0);

  useEffect(() => { turnStartRef.current = Date.now(); setLiveElapsedMs(0); }, [game]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        fen: game.fen(), moveHistory, lastMove, hasStarted, fenHistory, telemetry,
        coachExplanation, coachStats, gameStats, playAsWhite: config.playAsWhite, engineDepth: config.engineDepth,
      }));
    } catch {}
  }, [game, moveHistory, lastMove, hasStarted, fenHistory, telemetry, coachExplanation, coachStats,
      gameStats, config.playAsWhite, config.engineDepth]);

  // Keep the move-history panel scrolled to the latest move as it grows.
  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [moveHistory]);

  useEffect(() => {
    if (game.isGameOver() || isPaused) return undefined;
    const interval = setInterval(() => { setLiveElapsedMs(Date.now() - turnStartRef.current); }, 100);
    return () => clearInterval(interval);
  }, [game, isPaused]);

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

  // Detect the game ending and pop the result modal — covers Human vs Engine
  // and Bot vs Bot alike, using whatever mode was active when it ended.
  useEffect(() => {
    if (!hasStarted || !game.isGameOver()) return;
    setIsPaused(true);
    setReloadPrompt((prev) => (prev.open ? { ...prev, open: false } : prev));
    const activeDiff = DIFFICULTY_LEVELS.find((l) => l.depth === config.engineDepth) || DIFFICULTY_LEVELS[1];
    setGameOverModal((prev) => (prev.open ? prev : { open: true, result: computeGameResult(game, config, activeDiff.name) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, hasStarted]);

  const recordMove = (san, moverColor, from, to, classification) => {
    const durationMs = Date.now() - turnStartRef.current;
    setMoveHistory((prev) => [...prev, { san, mover: moverColor, durationMs, from, to, classification: classification || null }]);

    const isCapture = san.includes('x');
    const isCheck = san.includes('+') || san.includes('#');
    const isCastle = san === 'O-O' || san === 'O-O-O';
    const isPromo = san.includes('=');

    if (soundEnabled) playMoveSound(isCapture, isCheck);

    setGameStats((prev) => {
      const isWhite = moverColor === 'w';
      const moveCountKey = isWhite ? 'whiteMoveCount' : 'blackMoveCount';
      const thinkKey = isWhite ? 'whiteTotalThinkMs' : 'blackTotalThinkMs';
      const newMoveCount = prev[moveCountKey] + 1;
      const newThinkTotal = prev[thinkKey] + durationMs;
      return {
        ...prev,
        totalMoves: prev.totalMoves + 1,
        captures: prev.captures + (isCapture ? 1 : 0),
        checks: prev.checks + (isCheck ? 1 : 0),
        castles: prev.castles + (isCastle ? 1 : 0),
        promos: prev.promos + (isPromo ? 1 : 0),
        [moveCountKey]: newMoveCount,
        [thinkKey]: newThinkTotal,
        [isWhite ? 'whiteAvgThinkMs' : 'blackAvgThinkMs']: Math.round(newThinkTotal / newMoveCount),
      };
    });
  };

  useEffect(() => {
    if (!hasStarted || isPaused || isEvaluating || game.isGameOver()) return undefined;
    const isSingleEngineTurn =
      !config.autoPlayMode &&
      ((config.playAsWhite && game.turn() === 'b') || (!config.playAsWhite && game.turn() === 'w'));
    if (!config.autoPlayMode && !isSingleEngineTurn) return undefined;
    const delay = config.autoPlayMode ? AUTOPLAY_DELAY_MS : 0;
    const timeout = setTimeout(() => { makeEngineMove(); }, delay);
    return () => clearTimeout(timeout);
  }, [game, isPaused, isEvaluating, hasStarted, config.autoPlayMode, config.playAsWhite]);

  const computeBestMoves = (legalMoveUci, fen) => {
    if (!legalMoveUci || legalMoveUci.length === 0) { setBestMoves([]); return; }
    const candidates = legalMoveUci.slice(0, 5).map((m, i) => ({
      uci: m,
      san: (() => {
        try {
          const g = new Chess(fen);
          const r = g.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m.length > 4 ? m[4] : undefined });
          return r ? r.san : m;
        } catch { return m; }
      })(),
      eval: i === 0 ? telemetry.eval : null,
    }));
    setBestMoves(candidates);
  };

  const getDifficultyParams = () => {
    const level = DIFFICULTY_LEVELS.find((l) => l.depth === config.engineDepth) || DIFFICULTY_LEVELS[1];
    return { timeMs: level.timeMs, randomChance: level.randomChance, evalNoise: level.evalNoise, quiescenceDepth: level.quiescenceDepth, fetchTimeout: level.fetchTimeout };
  };

  const evaluatePosition = async (fen) => {
    setIsEvaluating(true);
    setCoachExplanation(null);
    const dp = getDifficultyParams();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), dp.fetchTimeout);
    try {
      const response = await fetch('/api/engine/evaluate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ fen, depth: config.engineDepth, timeMs: dp.timeMs, randomChance: dp.randomChance, evalNoise: dp.evalNoise, quiescenceDepth: dp.quiescenceDepth }),
      });
      if (!response.ok) throw new Error(`Engine returned ${response.status}`);
      const data = await response.json();
      setTelemetry({
        eval: data.eval, depth: data.depth, nodes: data.nodes, timeMs: data.time_ms,
        nps: data.nps, traceId: data.trace_id, traceUrl: data.trace_url ?? data.signoz_trace_url ?? null,
        bestMove: data.best_move, legalMoves: data.legal_moves || [], spans: data.spans || [],
      });
      computeBestMoves(data.legal_moves || [], fen);
      setEngineError(null);
      setLastEngineBlunder(data.trace?.random_blunder || false);
      setMoveHistory((prev) => {
        if (prev.length === 0) return prev;
        const lastIdx = prev.length - 1;
        const last = prev[lastIdx];
        if (last.classification) return prev;
        const cls = classifyMove(prevEvalRef.current, data.eval, last.mover);
        return prev.map((m, i) => i === lastIdx ? { ...m, classification: cls } : m);
      });
      prevEvalRef.current = data.eval;
    } catch (err) {
      if (err.name !== 'AbortError') setEngineError('Could not refresh the evaluation.');
    } finally { clearTimeout(timeoutId); setIsEvaluating(false); }
  };

  const makeEngineMove = async () => {
    if (game.isGameOver() || isPaused) return;
    setIsEvaluating(true);
    setCoachExplanation(null);
    const currentFen = game.fen();
    const dp = getDifficultyParams();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), dp.fetchTimeout);
    try {
      const response = await fetch('/api/engine/evaluate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ fen: currentFen, depth: config.engineDepth, timeMs: dp.timeMs, randomChance: dp.randomChance, evalNoise: dp.evalNoise, quiescenceDepth: dp.quiescenceDepth }),
      });
      if (!response.ok) throw new Error(`Engine returned ${response.status}`);
      const data = await response.json();

      if (data.best_move) {
        const from = data.best_move.slice(0, 2);
        const to = data.best_move.slice(2, 4);
        const promotion = data.best_move.length > 4 ? data.best_move[4] : undefined;
        const moverColor = game.turn();
        const newGame = new Chess(game.fen());
        const moveResult = newGame.move({ from, to, promotion });
        if (moveResult) {
          const nextFen = newGame.fen();
          setGame(newGame);
          setLastMove({ from, to });
          recordMove(moveResult.san, moverColor, from, to, 'Best');
          setFenHistory((prev) => [...prev, nextFen]);
          setEngineError(null);
          setTelemetry({
            eval: data.eval, depth: data.depth, nodes: data.nodes, timeMs: data.time_ms,
            nps: data.nps, traceId: data.trace_id, traceUrl: data.trace_url ?? data.signoz_trace_url ?? null,
            bestMove: data.best_move, legalMoves: data.legal_moves || [], spans: data.spans || [],
          });
          computeBestMoves(data.legal_moves || [], nextFen);
          prevEvalRef.current = data.eval;
          setLastEngineBlunder(data.trace?.random_blunder || false);
        } else {
          setEngineError(`Engine returned illegal move (${data.best_move}). Paused.`);
          setConfig((prev) => ({ ...prev, autoPlayMode: false }));
          setIsPaused(true);
        }
      } else {
        setEngineError('Engine response had no move. Paused.');
        setConfig((prev) => ({ ...prev, autoPlayMode: false }));
        setIsPaused(true);
      }
    } catch (err) {
      if (err.name === 'AbortError') setEngineError('Engine timed out. Paused.');
      else setEngineError('Could not reach engine. Paused.');
      setConfig((prev) => ({ ...prev, autoPlayMode: false }));
      setIsPaused(true);
    } finally { clearTimeout(timeoutId); setIsEvaluating(false); }
  };

  const requestCoachExplanation = async (moveUci) => {
    const move = moveUci || telemetry.bestMove;
    if (!move) return;
    setIsExplaining(true);
    setCoachExplanation(null);
    try {
      const response = await fetch('/api/coach/explain', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fen: game.fen(), bestMove: move, evalScore: telemetry.eval,
          legalMoves: telemetry.legalMoves || [], traceId: telemetry.traceId,
        }),
      });
      if (!response.ok) throw new Error(`Coach returned ${response.status}`);
      const data = await response.json();
      setCoachExplanation(data);
      if (data.tokensUsed > 0) {
        setCoachStats((prev) => ({
          totalTokens: prev.totalTokens + data.tokensUsed,
          totalCostUsd: prev.totalCostUsd + (data.costUsd || 0),
          callCount: prev.callCount + 1,
        }));
      }
    } catch (err) {
      setCoachExplanation({ explanation: `Error: ${err.message}`, tokensUsed: 0, costUsd: 0, latencyMs: 0 });
    } finally { setIsExplaining(false); }
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
          recordMove(moveResult.san, moverColor, selectedSquare, squareStr);
          setFenHistory((prev) => [...prev, newGame.fen()]);
          setCoachExplanation(null);
          setBestMoves([]);
          evaluatePosition(newGame.fen());
        }
      }
      setSelectedSquare(null);
      setPossibleMoves([]);
    }
  };

  const handleStartGame = (asWhite) => {
    setConfig((prev) => ({ ...prev, playAsWhite: asWhite }));
    setHasStarted(true);
    setShowColorPicker(false);
    setIsPaused(false);
    setGame(new Chess());
    setMoveHistory([]);
    setFenHistory([new Chess().fen()]);
    setLastMove(null);
    setBestMoves([]);
    setCoachExplanation(null);
    setEngineError(null);
    setGameOverModal({ open: false, result: null });
    setTelemetry({ eval: 0, depth: config.engineDepth, nodes: 0, timeMs: 0, nps: 0, traceId: null, traceUrl: null, bestMove: null, legalMoves: [], spans: [] });
  };

  const handleStartStop = () => {
    if (isPaused) { setHasStarted(true); setIsPaused(false); setEngineError(null); }
    else { setIsPaused(true); }
  };

  const handleResetGame = () => {
    const newGame = new Chess();
    setGame(newGame);
    setSelectedSquare(null); setPossibleMoves([]); setLastMove(null);
    setMoveHistory([]); setFenHistory([newGame.fen()]);
    setHasStarted(false); setIsPaused(true); setShowColorPicker(true);
    setEngineError(null); setConfig((prev) => ({ ...prev, autoPlayMode: false }));
    pauseStartRef.current = null;
    setBestMoves([]); setCoachExplanation(null); setLastEngineBlunder(false);
    setGameStats({ totalMoves: 0, captures: 0, checks: 0, castles: 0, promos: 0, whiteAvgThinkMs: 0, blackAvgThinkMs: 0, whiteTotalThinkMs: 0, blackTotalThinkMs: 0, whiteMoveCount: 0, blackMoveCount: 0 });
    setTelemetry({ eval: 0, depth: config.engineDepth, nodes: 0, timeMs: 0, nps: 0, traceId: null, traceUrl: null, bestMove: null, legalMoves: [], spans: [] });
    setGameOverModal({ open: false, result: null });
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  };

  const handleContinueSavedGame = () => { setReloadPrompt((prev) => ({ ...prev, open: false })); };
  const handleResetOnReload = () => { handleResetGame(); setReloadPrompt({ open: false, moveCount: 0 }); };

  const handleReviewBoard = () => { setGameOverModal((prev) => ({ ...prev, open: false })); };
  const handleNewGameFromResult = () => { handleResetGame(); };

  // "Done" on the result modal: jumps straight into a fresh game with the
  // same color/difficulty/mode, skipping the color picker and Start button.
  const handleDoneNextGame = () => {
    const newGame = new Chess();
    setGame(newGame);
    setSelectedSquare(null); setPossibleMoves([]); setLastMove(null);
    setMoveHistory([]); setFenHistory([newGame.fen()]);
    setHasStarted(true); setIsPaused(false); setShowColorPicker(false);
    setEngineError(null);
    pauseStartRef.current = null;
    setBestMoves([]); setCoachExplanation(null); setLastEngineBlunder(false);
    setGameStats({ totalMoves: 0, captures: 0, checks: 0, castles: 0, promos: 0, whiteAvgThinkMs: 0, blackAvgThinkMs: 0, whiteTotalThinkMs: 0, blackTotalThinkMs: 0, whiteMoveCount: 0, blackMoveCount: 0 });
    setTelemetry({ eval: 0, depth: config.engineDepth, nodes: 0, timeMs: 0, nps: 0, traceId: null, traceUrl: null, bestMove: null, legalMoves: [], spans: [] });
    setGameOverModal({ open: false, result: null });
  };

  const handleUndo = () => {
    if (moveHistory.length === 0 || isEvaluating) return;
    const newMoveHistory = moveHistory.slice(0, -1);
    const newFenHistory = fenHistory.slice(0, -1);
    const targetFen = newFenHistory[newFenHistory.length - 1] || new Chess().fen();
    setGame(new Chess(targetFen));
    setMoveHistory(newMoveHistory);
    setFenHistory(newFenHistory.length > 0 ? newFenHistory : [targetFen]);
    setSelectedSquare(null); setPossibleMoves([]); setEngineError(null);
    setConfig((prev) => ({ ...prev, autoPlayMode: false }));
    setIsPaused(true);
    setGameOverModal({ open: false, result: null });
    const priorMove = newMoveHistory[newMoveHistory.length - 1];
    setLastMove(priorMove ? { from: priorMove.from, to: priorMove.to } : null);
    evaluatePosition(targetFen);
  };

  const handleSetDifficulty = (level) => {
    if (isEvaluating) return;
    setConfig((prev) => ({ ...prev, engineDepth: level.depth }));
  };

  const activeDifficulty = DIFFICULTY_LEVELS.find((l) => l.depth === config.engineDepth) || null;

  const evalScore = telemetry.eval / 100;
  const clampedEval = Math.max(-10, Math.min(10, evalScore));
  const evalPercentage = Math.round(((clampedEval + 10) / 20) * 100);

  const boardGrid = [];
  const normalFiles = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const normalRanks = ['8', '7', '6', '5', '4', '3', '2', '1'];
  const flipped = !config.playAsWhite;
  const files = flipped ? [...normalFiles].reverse() : normalFiles;
  const ranks = flipped ? [...normalRanks].reverse() : normalRanks;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const rank = ranks[r]; const file = files[c];
      const squareStr = `${file}${rank}`;
      const isLight = (r + c) % 2 === 0;
      const piece = game.get(squareStr);
      const isSelected = selectedSquare === squareStr;
      const isDest = possibleMoves.includes(squareStr);
      const isLastMoveSquare = lastMove && (lastMove.from === squareStr || lastMove.to === squareStr);
      boardGrid.push(
        <div key={squareStr} onClick={() => handleSquareClick(squareStr)}
          className={`square ${isLight ? 'square-light' : 'square-dark'} ${isSelected ? 'square-selected' : ''} ${isLastMoveSquare ? 'square-last-move' : ''}`}>
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
    : game.isGameOver() ? 'Game over'
    : isPaused ? 'Paused'
    : `${game.turn() === 'w' ? 'White' : 'Black'} to move`;

  if (showColorPicker) {
    return (
      <div className="app-shell">
        <div className="color-picker-screen">
          <div className="color-picker-card">
            <div className="color-picker-crown"><Crown className="w-10 h-10" style={{ color: 'var(--accent-amber)' }} /></div>
            <h1 className="color-picker-title">ChessWiz</h1>
            <p className="color-picker-sub">AI chess engine with full observability</p>

            <div className="difficulty-selector">
              <div className="difficulty-label">Difficulty</div>
              <div className="difficulty-grid">
                {DIFFICULTY_LEVELS.map((level) => {
                  const isActive = config.engineDepth === level.depth;
                  const dc = DIFFICULTY_COLORS[level.tier.toLowerCase()];
                  return (
                    <button key={level.id} className={`difficulty-btn ${isActive ? 'difficulty-active' : ''}`}
                      onClick={() => setConfig((prev) => ({ ...prev, engineDepth: level.depth }))}
                      style={isActive ? { borderColor: dc, color: dc } : {}}>
                      <level.icon className="w-4 h-4" />
                      <span className="difficulty-btn-label">{level.name}</span>
                      <span className="difficulty-btn-tier">{level.tier} &middot; Depth {level.depth}</span>
                      <span className="difficulty-btn-desc">{level.personality}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="color-choice-section">
              <div className="difficulty-label">Play as</div>
              <div className="color-choice-grid">
                <button className="color-choice-btn" onClick={() => handleStartGame(true)}>
                  <div className="color-choice-piece">&#9812;</div>
                  <span>White</span>
                  <span className="color-choice-hint">First move</span>
                </button>
                <button className="color-choice-btn color-choice-dark" onClick={() => handleStartGame(false)}>
                  <div className="color-choice-piece">&#9818;</div>
                  <span>Black</span>
                  <span className="color-choice-hint">Engine first</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className={`app-header ${hasStarted ? 'app-header-hidden' : ''}`}>
        <div className="app-title">
          <Activity className="w-6 h-6" style={{ color: 'var(--accent-indigo)' }} />
          <div>
            <div className="app-title-text">ChessWiz</div>
            <div className="app-title-sub">AI chess engine with full observability</div>
          </div>
        </div>
      </header>

      <main className="main-stage">
        {/* Left: Engine Analysis + AI Coach (scrollable) */}
        <aside className="side-panel side-panel-scroll">
          <div className="glass-panel side-panel-card">
            <div className="section-header-title">
              <Target className="w-4 h-4" style={{ color: 'var(--accent-amber)' }} />
              Engine Analysis
              {(() => {
                const active = DIFFICULTY_LEVELS.find((l) => l.depth === config.engineDepth) || DIFFICULTY_LEVELS[1];
                const dc = DIFFICULTY_COLORS[active.tier.toLowerCase()];
                return <span className="badge" style={{ borderColor: dc, color: dc, marginLeft: 'auto' }}>{active.name}</span>;
              })()}
            </div>
            <div className="side-panel-body">
              <div className="eval-display">
                <div className="eval-display-score" style={{ color: evalScore > 0 ? 'var(--accent-emerald)' : evalScore < 0 ? 'var(--accent-rose)' : 'var(--text-muted)' }}>
                  {evalScore > 0 ? '+' : ''}{evalScore.toFixed(2)}
                </div>
                <div className="eval-bar-container">
                  <div className="eval-bar-fill" style={{ height: `${evalPercentage}%` }} />
                </div>
              </div>

              {bestMoves.length > 0 ? (
                <div className="best-moves-list">
                  <div className="best-moves-header">Best Moves</div>
                  {bestMoves.map((m, i) => (
                    <div key={i} className={`best-move-item ${i === 0 ? 'best-move-primary' : ''}`}>
                      <div className="best-move-left">
                        <span className="best-move-rank">#{i + 1}</span>
                        <span className="best-move-san">{m.san}</span>
                      </div>
                      <button className="best-move-explain-btn" onClick={() => requestCoachExplanation(m.uci)}
                        disabled={isExplaining} title="Ask coach about this move">
                        <Sparkles className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="history-empty">{isEvaluating ? 'Analyzing...' : 'Make a move to see engine analysis'}</span>
              )}
            </div>
          </div>

          {telemetry.spans && telemetry.spans.length > 0 && (
            <div className="glass-panel side-panel-card">
              <div className="section-header-title">
                <Activity className="w-4 h-4" style={{ color: 'var(--accent-cyan)' }} />
                Span Waterfall
                {telemetry.traceId && telemetry.traceUrl && (
                  <a href={telemetry.traceUrl} target="_blank" rel="noopener noreferrer" className="trace-link">View Trace</a>
                )}
              </div>
              <div className="side-panel-body">
                <SpanWaterfall spans={telemetry.spans} totalMs={telemetry.timeMs} />
              </div>
            </div>
          )}

          <div className="glass-panel side-panel-card">
            <div className="section-header-title">
              <Sparkles className="w-4 h-4" style={{ color: 'var(--accent-purple)' }} />
              AI Coach
            </div>
            <div className="side-panel-body">
              <button onClick={() => requestCoachExplanation()} disabled={isExplaining || !telemetry.bestMove}
                className="btn btn-primary btn-interactive controls-grid-wide btn-coach">
                {isExplaining ? 'Thinking...' : 'Explain Move (LLM)'}
              </button>

              {coachExplanation ? (
                <div className="coach-explanation-box">
                  <div className="coach-explanation-label">Coach Explanation</div>
                  <div className="coach-explanation-text">
                    <TypewriterText text={coachExplanation.explanation} speed={15} />
                  </div>
                  {coachExplanation.tokensUsed > 0 && (
                    <div className="coach-explanation-meta">
                      {coachExplanation.tokensUsed} tokens &middot; {coachExplanation.latencyMs}ms
                    </div>
                  )}
                </div>
              ) : (
                <span className="history-empty">Make a move, then ask the coach to explain it.</span>
              )}

              {coachStats.callCount > 0 && (
                <div className="coach-stats-row">
                  <span className="coach-stat">
                    <Coins className="w-3 h-3" />
                    {coachStats.callCount} calls
                  </span>
                  <span className="coach-stat">
                    <Cpu className="w-3 h-3" />
                    {coachStats.totalTokens.toLocaleString()} tokens
                  </span>
                  <span className="coach-stat">
                    <span className="coach-stat-cost">${coachStats.totalCostUsd.toFixed(4)}</span>
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="glass-panel side-panel-card">
            <div className="section-header-title">
              <Timer className="w-4 h-4" style={{ color: 'var(--accent-amber)' }} />
              Game Stats
            </div>
            <div className="side-panel-body">
              <div className="game-stats-grid">
                <div className="game-stat-item">
                  <span className="game-stat-label">Moves</span>
                  <span className="game-stat-value">{gameStats.totalMoves}</span>
                </div>
                <div className="game-stat-item">
                  <span className="game-stat-label">Captures</span>
                  <span className="game-stat-value">{gameStats.captures}</span>
                </div>
                <div className="game-stat-item">
                  <span className="game-stat-label">Checks</span>
                  <span className="game-stat-value">{gameStats.checks}</span>
                </div>
                <div className="game-stat-item">
                  <span className="game-stat-label">Castles</span>
                  <span className="game-stat-value">{gameStats.castles}</span>
                </div>
                <div className="game-stat-item">
                  <span className="game-stat-label">White Avg</span>
                  <span className="game-stat-value">{formatDuration(gameStats.whiteAvgThinkMs)}</span>
                </div>
                <div className="game-stat-item">
                  <span className="game-stat-label">Black Avg</span>
                  <span className="game-stat-value">{formatDuration(gameStats.blackAvgThinkMs)}</span>
                </div>
              </div>
            </div>
          </div>
        </aside>
        <div className="board-column">
          <div className="game-controls-bar">
            <div className="game-controls-primary">
              <button onClick={handleStartStop} className={`btn btn-lg btn-interactive ${isPaused ? 'btn-emerald' : 'btn-danger'}`}>
                {isPaused ? (<><Play className="w-4 h-4" /> Start</>) : (<><Pause className="w-4 h-4" /> Stop</>)}
              </button>
              <button onClick={() => setConfig((prev) => ({ ...prev, autoPlayMode: !prev.autoPlayMode }))}
                disabled={!hasStarted || isPaused}
                className={`btn btn-lg btn-interactive ${config.autoPlayMode ? 'btn-danger' : 'btn-secondary'}`}
                title="Have the engine play both sides">
                <Bot className="w-4 h-4" /> {config.autoPlayMode ? 'Stop Bot vs Bot' : 'Bot vs Bot'}
              </button>
            </div>

            <div className="game-controls-status">
              {config.autoPlayMode && (
                <span className="badge badge-purple">
                  <span className="live-dot" style={{ background: 'var(--accent-purple)' }} /> Engine vs Engine
                </span>
              )}
              <span className={`badge badge-difficulty badge-difficulty-${activeDifficulty?.tier.toLowerCase() || 'medium'}`}>
                {activeDifficulty ? activeDifficulty.name : `Depth ${config.engineDepth}`}
              </span>
              <span className={`badge ${isPaused ? 'badge-amber' : 'badge-emerald'}`}>
                {isPaused ? <Pause className="w-3 h-3" /> : <span className="live-dot" />}
                {statusLabel}
              </span>
              <span className="move-clock" title="Time on the clock for the side to move">
                <Timer className="w-3.5 h-3.5" />{formatClock(liveElapsedMs)}
              </span>
              {isEvaluating && (
                <span className="engine-thinking">
                  <Cpu className="w-3.5 h-3.5" style={{ animation: 'spin 1s linear infinite' }} /> Thinking...
                </span>
              )}
            </div>

            {engineError && (
              <div className="engine-error-banner">
                <span>{engineError}</span>
                <button onClick={() => setEngineError(null)} aria-label="Dismiss">&#10005;</button>
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
            <div ref={boardRef} className={`chessboard ${!hasStarted ? 'chessboard-idle' : ''}`}>
              {boardGrid}
              {showBestMoveArrow && telemetry.bestMove && hasStarted && !isPaused && (
                <BestMoveArrow
                  move={telemetry.bestMove}
                  flipped={!config.playAsWhite}
                  boardRef={boardRef}
                />
              )}
            </div>
          </div>
        </div>

        {/* Right: Players, Controls, History */}
        <aside className="side-panel side-panel-scroll">
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
                  <span className="badge badge-indigo">{activeDifficulty ? activeDifficulty.name : `Depth ${config.engineDepth}`}</span>
                </div>
              </div>
              <div className="player-row">
                <div className="player-row-label">
                  {config.autoPlayMode ? (
                    <Bot className="w-4 h-4" style={{ color: 'var(--accent-rose)' }} />
                  ) : (
                    <User className="w-4 h-4" style={{ color: 'var(--accent-emerald)' }} />
                  )}
                  {config.autoPlayMode
                    ? `Bot (${config.playAsWhite ? 'White' : 'Black'})`
                    : `Human (${config.playAsWhite ? 'White' : 'Black'})`}
                </div>
                <span className="player-row-turn">
                  {game.turn() === 'w' ? 'White to move' : 'Black to move'}
                </span>
              </div>

              <div className="difficulty-current">
                <span className="difficulty-select-label">Difficulty</span>
                {(() => {
                  const active = DIFFICULTY_LEVELS.find((l) => l.depth === config.engineDepth) || DIFFICULTY_LEVELS[1];
                  const ActiveIcon = active.icon;
                  const dc = DIFFICULTY_COLORS[active.tier.toLowerCase()];
                  return (
                    <div className="difficulty-current-card" style={{ borderColor: dc }}>
                      <div className="difficulty-current-header">
                        <ActiveIcon className="w-4 h-4" style={{ color: dc }} />
                        <span className="difficulty-current-name" style={{ color: dc }}>{active.name}</span>
                        <span className="difficulty-current-tier">{active.tier}</span>
                      </div>
                      <div className="difficulty-current-desc">{active.description}</div>
                    </div>
                  );
                })()}
              </div>

              <div className="controls-grid">
                <button onClick={handleResetGame} className="btn btn-secondary btn-interactive">
                  <RotateCcw className="w-3.5 h-3.5" /> Reset
                </button>
                <button onClick={handleUndo} disabled={moveHistory.length === 0 || isEvaluating}
                  className="btn btn-secondary btn-interactive" title="Take back the last move">
                  <Undo2 className="w-3.5 h-3.5" /> Undo
                </button>
                <button onClick={makeEngineMove} disabled={!hasStarted || isEvaluating || isPaused || config.autoPlayMode}
                  className="btn btn-primary btn-interactive controls-grid-wide" title="Ask the engine to move immediately">
                  <Zap className="w-3.5 h-3.5" /> Force Move
                </button>
                <button onClick={() => setSoundEnabled((v) => !v)}
                  className={`btn btn-interactive ${soundEnabled ? 'btn-primary' : 'btn-secondary'}`}>
                  {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => setShowBestMoveArrow((v) => !v)}
                  className={`btn btn-interactive ${showBestMoveArrow ? 'btn-primary' : 'btn-secondary'}`}>
                  <MoveRight className="w-3.5 h-3.5" /> Arrow
                </button>
                <button onClick={() => setShowConfig(true)} className="btn btn-secondary btn-interactive controls-grid-wide">
                  <Settings className="w-3.5 h-3.5" /> Settings
                </button>
              </div>

              {lastEngineBlunder && (
                <div className="blunder-indicator">
                  <Skull className="w-3.5 h-3.5" />
                  <span>Engine played a random blunder (intentional at this difficulty)</span>
                </div>
              )}
            </div>
          </div>

          <div className="glass-panel side-panel-card side-panel-history">
            <div className="section-header-title">
              <History className="w-4 h-4" style={{ color: 'var(--accent-cyan)' }} />
              Move History
              {moveHistory.length > 0 && (
                <span className="badge badge-cyan" style={{ marginLeft: 'auto', fontSize: '0.55rem' }}>{moveHistory.length}</span>
              )}
              {moveHistory.length > 4 && (
                <button className="history-scroll-btn" onClick={() => {
                  if (historyRef.current) {
                    historyRef.current.scrollTo({ top: historyRef.current.scrollHeight, behavior: 'smooth' });
                  }
                }} title="Scroll to latest">
                  &#8595;
                </button>
              )}
            </div>
            <div className="history-list" ref={historyRef}>
              {moveHistory.length === 0 ? (
                <span className="history-empty">No moves played yet</span>
              ) : (
                moveHistory.map((m, idx) => (
                  <span key={idx} className="history-chip" title={`Took ${formatDuration(m.durationMs)} to play${m.classification ? ` - ${m.classification}` : ''}`}>
                    <span className="history-chip-move">{Math.floor(idx / 2) + 1}.{idx % 2 === 0 ? '' : '...'} {m.san}</span>
                    {m.classification && (
                      <span className="history-chip-classification" style={{ color: CLASSIFICATION_COLORS[m.classification] || 'var(--text-dim)' }}>
                        {m.classification === 'Brilliant' ? '!!' : m.classification === 'Blunder' ? '??' : m.classification === 'Mistake' ? '?' : m.classification === 'Inaccuracy' ? '?!' : m.classification === 'Best' ? '!' : ''}
                      </span>
                    )}
                    <span className="history-chip-time">{formatDuration(m.durationMs)}</span>
                  </span>
                ))
              )}
            </div>
          </div>
        </aside>
      </main>

      {showConfig && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-head">
              <h3><Settings className="w-5 h-5" style={{ color: 'var(--accent-indigo)' }} /> ChessWiz Settings</h3>
              <button onClick={() => setShowConfig(false)} className="modal-close-btn">&#10005;</button>
            </div>

            <div className="form-group">
              <label>OTLP Collector Endpoint</label>
              <input type="text" className="form-input" value={config.otlpEndpoint}
                onChange={(e) => setConfig((prev) => ({ ...prev, otlpEndpoint: e.target.value }))}
                placeholder="http://localhost:4318" />
              <span className="form-hint">Supports any OpenTelemetry-compatible collector, local or cloud.</span>
            </div>

            <div className="form-group">
              <label>Trace Dashboard URL</label>
              <input type="text" className="form-input" value={config.traceUiUrl}
                onChange={(e) => setConfig((prev) => ({ ...prev, traceUiUrl: e.target.value }))}
                placeholder="http://localhost:3301" />
            </div>

            <div className="form-group">
              <label>Difficulty</label>
              <div className="difficulty-options" style={{ marginTop: 4 }}>
                {DIFFICULTY_LEVELS.map((level) => {
                  const isActive = config.engineDepth === level.depth;
                  const dc = DIFFICULTY_COLORS[level.tier.toLowerCase()];
                  return (
                    <button key={level.id} className={`difficulty-btn difficulty-btn-${level.tier.toLowerCase()} ${isActive ? 'difficulty-btn-active' : ''}`}
                      onClick={() => setConfig((prev) => ({ ...prev, engineDepth: level.depth }))}>
                      <level.icon className="w-4 h-4" />
                      <span className="difficulty-btn-name">{level.name}</span>
                      <span className="difficulty-btn-tier">{level.tier}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="form-group">
              <label>Play as</label>
              <div className="color-choice-grid" style={{ marginTop: 4 }}>
                <button className={`color-choice-btn-sm ${config.playAsWhite ? 'color-choice-active' : ''}`}
                  onClick={() => setConfig((prev) => ({ ...prev, playAsWhite: true }))}>&#9812; White</button>
                <button className={`color-choice-btn-sm color-choice-dark ${!config.playAsWhite ? 'color-choice-active' : ''}`}
                  onClick={() => setConfig((prev) => ({ ...prev, playAsWhite: false }))}>&#9818; Black</button>
              </div>
            </div>

            <div className="modal-actions">
              <button onClick={() => setShowConfig(false)} className="btn btn-primary btn-interactive">Done</button>
            </div>
          </div>
        </div>
      )}

      {reloadPrompt.open && (
        <div className="modal-overlay">
          <div className="modal-card reload-modal">
            <div className="reload-modal-icon"><History className="w-5 h-5" /></div>
            <div className="reload-modal-eyebrow">Saved Session Detected</div>
            <h3 className="reload-modal-title">Welcome back</h3>
            <p className="reload-modal-body">
              We recovered a game in progress - {reloadPrompt.moveCount} move{reloadPrompt.moveCount === 1 ? '' : 's'} on
              the board. Resume, or clear and start fresh.
            </p>
            <div className="reload-modal-options">
              <button onClick={handleContinueSavedGame} className="reload-option reload-option-primary">
                <Play className="w-5 h-5" />
                <span className="reload-option-title">Resume Game</span>
                <span className="reload-option-sub">Continue from move {reloadPrompt.moveCount}</span>
              </button>
              <button onClick={handleResetOnReload} className="reload-option reload-option-danger">
                <RotateCcw className="w-5 h-5" />
                <span className="reload-option-title">Start Fresh</span>
                <span className="reload-option-sub">Clear the board and reset</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {gameOverModal.open && gameOverModal.result && (() => {
        const r = gameOverModal.result;
        const ResultIcon = RESULT_ICONS[r.icon] || Trophy;
        return (
          <div className="modal-overlay">
            <div className={`modal-card reload-modal result-modal-${r.outcome}`}>
              <div className={`reload-modal-icon result-modal-icon-${r.outcome}`}><ResultIcon className="w-5 h-5" /></div>
              <div className={`reload-modal-eyebrow result-modal-eyebrow-${r.outcome}`}>{r.eyebrow}</div>
              <h3 className="reload-modal-title">{r.title}</h3>
              <p className="reload-modal-body">{r.subtitle}</p>

              <div className="result-modal-side-badges">
                <span className={`result-side-chip ${r.winnerColor === 'w' ? 'result-side-chip-winner' : ''}`}>
                  &#9812; White &middot; {r.whiteLabel}
                </span>
                <span className="result-side-vs">vs</span>
                <span className={`result-side-chip ${r.winnerColor === 'b' ? 'result-side-chip-winner' : ''}`}>
                  &#9818; Black &middot; {r.blackLabel}
                </span>
              </div>

              <div className="result-modal-stats">
                <div className="result-modal-stats-header">Game Stats</div>
                <div className="game-stats-grid">
                  <div className="game-stat-item">
                    <span className="game-stat-label">Moves</span>
                    <span className="game-stat-value">{gameStats.totalMoves}</span>
                  </div>
                  <div className="game-stat-item">
                    <span className="game-stat-label">Captures</span>
                    <span className="game-stat-value">{gameStats.captures}</span>
                  </div>
                  <div className="game-stat-item">
                    <span className="game-stat-label">Checks</span>
                    <span className="game-stat-value">{gameStats.checks}</span>
                  </div>
                  <div className="game-stat-item">
                    <span className="game-stat-label">Castles</span>
                    <span className="game-stat-value">{gameStats.castles}</span>
                  </div>
                  <div className="game-stat-item">
                    <span className="game-stat-label">White Avg</span>
                    <span className="game-stat-value">{formatDuration(gameStats.whiteAvgThinkMs)}</span>
                  </div>
                  <div className="game-stat-item">
                    <span className="game-stat-label">Black Avg</span>
                    <span className="game-stat-value">{formatDuration(gameStats.blackAvgThinkMs)}</span>
                  </div>
                </div>
              </div>

              <div className="reload-modal-options">
                <button onClick={handleDoneNextGame} className="reload-option reload-option-primary">
                  <Play className="w-5 h-5" />
                  <span className="reload-option-title">Done &middot; Next Game</span>
                  <span className="reload-option-sub">Same settings, starts now</span>
                </button>
                <button onClick={handleReviewBoard} className="reload-option">
                  <Target className="w-5 h-5" />
                  <span className="reload-option-title">Review Board</span>
                  <span className="reload-option-sub">Keep looking at the final position</span>
                </button>
                <button onClick={handleNewGameFromResult} className="reload-option">
                  <RotateCcw className="w-5 h-5" />
                  <span className="reload-option-title">New Game Setup</span>
                  <span className="reload-option-sub">Pick a new color / difficulty</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}