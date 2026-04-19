import { Fragment, useState, useEffect, useRef, useCallback, useMemo } from "react";

// ============================================================
// Audio Engine — Web Audio API chiptune synth, zero audio files
// ============================================================
const audio = (() => {
  let ctx, masterGain, sfxGain;

  function ensureCtx() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain(); masterGain.gain.value = 0.5; masterGain.connect(ctx.destination);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.6; sfxGain.connect(masterGain);
  }

  // --- Synth helpers ---
  function playNote(freq, dur, type, vol, dest, startTime) {
    if (!ctx) return;
    const t = startTime || ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + dur);
  }

  function playNoise(dur, vol, dest, startTime) {
    if (!ctx) return;
    const t = startTime || ctx.currentTime;
    const bufSize = ctx.sampleRate * dur;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(g); g.connect(dest);
    src.start(t); src.stop(t + dur);
  }

  // --- SFX ---
  function sfxTap() {
    ensureCtx();
    playNote(880, 0.06, "square", 0.3, sfxGain);
    playNote(1320, 0.04, "square", 0.15, sfxGain, ctx.currentTime + 0.02);
  }
  function sfxMiss() {
    ensureCtx();
    playNote(150, 0.12, "square", 0.25, sfxGain);
  }
  function sfxLifeLost() {
    ensureCtx();
    playNote(440, 0.1, "square", 0.3, sfxGain);
    playNote(220, 0.15, "square", 0.25, sfxGain, ctx.currentTime + 0.1);
  }
  function sfxChainComplete() {
    ensureCtx();
    playNote(523, 0.08, "triangle", 0.3, sfxGain);
    playNote(659, 0.08, "triangle", 0.3, sfxGain, ctx.currentTime + 0.08);
    playNote(784, 0.12, "triangle", 0.35, sfxGain, ctx.currentTime + 0.16);
  }
  function sfxBatchComplete() {
    ensureCtx();
    const notes = [523, 587, 659, 698, 784];
    notes.forEach((f, i) => playNote(f, 0.06, "triangle", 0.25, sfxGain, ctx.currentTime + i * 0.05));
  }
  function sfxGameOver() {
    ensureCtx();
    const notes = [523, 440, 349, 262];
    notes.forEach((f, i) => playNote(f, 0.15, "triangle", 0.3, sfxGain, ctx.currentTime + i * 0.15));
  }
  function sfxButtonClick() {
    ensureCtx();
    playNote(660, 0.03, "square", 0.15, sfxGain);
  }

  // --- Music (MP3-based) ---
  let currentMusic = null;
  let musicElement = null;

  function stopMusic() {
    if (musicElement) { musicElement.pause(); musicElement.currentTime = 0; }
    currentMusic = null;
  }

  function playTrack(name, src) {
    if (currentMusic === name) return;
    stopMusic();
    currentMusic = name;
    musicElement = new Audio(src);
    musicElement.loop = true;
    musicElement.volume = 0.35;
    if (masterGain && masterGain.gain.value < 0.01) musicElement.muted = true;
    musicElement.play().catch(() => {});
  }

  function playMain() { playTrack("main", "/music/mainmusic.mp3"); }
  function playGameplay() { playTrack("game", "/music/gamemusic.mp3"); }

  function toggleMute() {
    if (!masterGain) return false;
    const muted = masterGain.gain.value < 0.01;
    masterGain.gain.value = muted ? 0.5 : 0;
    if (musicElement) musicElement.muted = !muted;
    return !muted;
  }
  function isMuted() { return masterGain ? masterGain.gain.value < 0.01 : false; }

  return {
    ensureCtx, sfxTap, sfxMiss, sfxLifeLost, sfxChainComplete,
    sfxBatchComplete, sfxGameOver, sfxButtonClick,
    playMain, playGameplay, stopMusic, toggleMute, isMuted,
  };
})();

const GAME_DURATION = 30;
// Classic difficulty ramp: t = elapsed seconds (0–30)
const classicDifficulty = (t) => {
  const n = Math.min(t / GAME_DURATION, 1); // 0 → 1
  return {
    lifetime: Math.round(1800 - n * 900),      // 1800ms → 900ms
    spawnMin: Math.round(800 - n * 500),        // 800ms → 300ms
    spawnMax: Math.round(1200 - n * 700),       // 1200ms → 500ms
  };
};

// RGB dynamic difficulty
const RGB_PRESSURE_PER_TAP = 1;
const RGB_PRESSURE_DROP = 3;
const RGB_MAX_PRESSURE = 30;
const rgbDifficulty = (pressure) => {
  const p = Math.min(pressure, RGB_MAX_PRESSURE);
  const n = p / RGB_MAX_PRESSURE;
  return {
    lifetime: Math.round(2800 - n * 1900),   // 2800ms → 900ms
    spawnMin: Math.round(700 - n * 450),      // 700ms → 250ms
    spawnMax: Math.round(1200 - n * 750),     // 1200ms → 450ms
    multiplier: 1 + Math.floor(p / 5) * 0.25, // x1.00 → x2.50
  };
};
const SCORE_MAX = 100;
const SCORE_MIN = 5;
const RGB_MAX_LIVES = 5;

// Combo-based multiplier: shared across modes; in RGB it drives scoring.
// combo 0-4 -> x1.00, 5-9 -> x1.25, ..., 25-29 -> x2.25, 30+ -> x2.50
const comboMultiplier = (combo) => 1 + Math.min(Math.floor(combo / 5) * 0.25, 1.5);

// MATH mode
const MATH_MAX_LIVES = 5;
const MATH_BATCH_SIZE = 5;
const MATH_BASE_LIFETIME = 4000;
const mathDifficulty = (round) => ({
  lifetime: Math.max(1500, MATH_BASE_LIFETIME - round * 200),
  batchSize: Math.min(MATH_BATCH_SIZE + Math.floor(round / 3), 9),
});

const RGB_COLORS = [
  { name: "R", color: "#ef4444" },
  { name: "B", color: "#3b82f6" },
  { name: "G", color: "#22c55e" },
];

// ============================================================
// History persistence — localStorage, versioned
// ============================================================
const HISTORY_KEY = "tapapppop:history:v1";
const HISTORY_MAX = 50;

function loadHistory() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return { version: 1, runs: [] };
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return { version: 1, runs: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.runs)) return { version: 1, runs: [] };
    return parsed;
  } catch {
    return { version: 1, runs: [] };
  }
}

function saveHistory(history) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {}
}

function appendRun(run) {
  const current = loadHistory();
  const runs = [run, ...current.runs].slice(0, HISTORY_MAX);
  saveHistory({ version: 1, runs });
  return runs;
}

function clearHistoryStorage() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.removeItem(HISTORY_KEY);
  } catch {}
}

function triggerHaptic(ms = 10) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try { navigator.vibrate(ms); } catch {}
  }
}

function makeRunId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildRun(mode, stats) {
  const base = { id: makeRunId(), mode, ts: Date.now(), score: stats.score, taps: stats.taps };
  if (mode === "classic") {
    const accuracy = stats.taps + stats.misses > 0
      ? Math.round((stats.taps / (stats.taps + stats.misses)) * 100) : 0;
    const avg = stats.taps > 0 ? Math.round(stats.score / stats.taps) : 0;
    return { ...base, misses: stats.misses, accuracy, avg };
  }
  if (mode === "rgb") {
    return {
      ...base,
      rgbChains: stats.rgbChains,
      peakPressure: stats.peakPressure,
      peakMultiplier: rgbDifficulty(stats.peakPressure).multiplier,
    };
  }
  if (mode === "math") {
    const avg = stats.taps > 0 ? Math.round(stats.score / stats.taps) : 0;
    return { ...base, mathRounds: stats.mathRounds, avg };
  }
  return base;
}

function computeBests(runs) {
  const result = {
    classic: { count: 0, bestScore: 0, bestAccuracy: 0 },
    rgb: { count: 0, bestScore: 0, mostChains: 0, peakMultiplier: 1 },
    math: { count: 0, bestScore: 0, mostRounds: 0 },
  };
  for (const r of runs) {
    const b = result[r.mode];
    if (!b) continue;
    b.count += 1;
    if ((r.score || 0) > b.bestScore) b.bestScore = r.score || 0;
    if (r.mode === "classic" && (r.accuracy || 0) > b.bestAccuracy) b.bestAccuracy = r.accuracy;
    if (r.mode === "rgb") {
      if ((r.rgbChains || 0) > b.mostChains) b.mostChains = r.rgbChains;
      if ((r.peakMultiplier || 1) > b.peakMultiplier) b.peakMultiplier = r.peakMultiplier;
    }
    if (r.mode === "math" && (r.mathRounds || 0) > b.mostRounds) b.mostRounds = r.mathRounds;
  }
  return result;
}

function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

const MODE_LABEL = { classic: "CLASSIC", rgb: "RBG", math: "MATH" };
const MODES = ["classic", "rgb", "math"];

const themes = {
  night: { bg: "#0a0a0a", fg: "#ffffff", fgMid: "rgba(255,255,255,0.5)", fgLow: "rgba(255,255,255,0.3)", fgFaint: "rgba(255,255,255,0.12)", fgSubtle: "rgba(255,255,255,0.08)", bar: "rgba(255,255,255,0.35)" },
  day:   { bg: "#f0ede8", fg: "#1a1a1a", fgMid: "rgba(0,0,0,0.45)", fgLow: "rgba(0,0,0,0.25)", fgFaint: "rgba(0,0,0,0.12)", fgSubtle: "rgba(0,0,0,0.06)", bar: "rgba(0,0,0,0.3)" },
};

const lerp = (a, b, t) => a + (b - a) * t;
function scoreFromReaction(elapsed, lifetime) {
  return Math.round(lerp(SCORE_MAX, SCORE_MIN, Math.min(elapsed / lifetime, 1)));
}
const MIN_DIST = 8; // minimum % distance between mark centers
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~137.5° in radians
let spawnIndex = 0; // global spawn counter for golden-angle sequence

function randomPos(existing = []) {
  const PAD_X = 10;
  const PAD_Y_TOP = 5;
  const PAD_Y_BOTTOM = 12;
  const rangeX = 100 - PAD_X * 2;
  const rangeY = 100 - PAD_Y_TOP - PAD_Y_BOTTOM;
  for (let attempt = 0; attempt < 30; attempt++) {
    // golden-angle candidate: deterministic spiral mapped to rectangle
    const idx = spawnIndex + attempt;
    const r = 0.15 + 0.35 * Math.sqrt(idx);
    const theta = idx * GOLDEN_ANGLE;
    // map polar to rectangular, wrap into playable area
    let x = PAD_X + (((50 + r * rangeX * Math.cos(theta)) % rangeX) + rangeX) % rangeX;
    let y = PAD_Y_TOP + (((50 + r * rangeY * Math.sin(theta)) % rangeY) + rangeY) % rangeY;
    const tooClose = existing.some((m) => Math.hypot(m.x - x, m.y - y) < MIN_DIST);
    if (!tooClose) { spawnIndex++; return { x, y }; }
  }
  // fallback — random placement
  spawnIndex++;
  return {
    x: PAD_X + Math.random() * rangeX,
    y: PAD_Y_TOP + Math.random() * rangeY,
  };
}

const markShapes = [
  (s) => <rect width={s} height={s} fill="currentColor" />,
];

function Mark({ mark, onTap, theme, rgbColor, label }) {
  const [progress, setProgress] = useState(0);
  const frameRef = useRef();
  const startRef = useRef(Date.now());

  useEffect(() => {
    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      setProgress(Math.min(elapsed / mark.lifetime, 1));
      if (elapsed < mark.lifetime) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [mark.lifetime]);

  const size = 54;
  const opacity = 1 - progress * 0.7;
  const shape = markShapes[mark.shape];
  const fillColor = rgbColor || theme.fg;

  return (
    <div onPointerDown={(e) => { e.preventDefault(); onTap(mark.id); }}
      style={{
        position: "absolute", left: `${mark.x}%`, top: `${mark.y}%`,
        transform: "translate(-50%,-50%)", width: size, height: size,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", WebkitTapHighlightColor: "transparent", touchAction: "manipulation",
      }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{ color: fillColor, opacity, transition:"opacity 0.05s" }}>
        {shape(size)}
      </svg>
      {label != null && (
        <span style={{
          position:"absolute", fontSize:20, fontWeight:400,
          fontFamily:"'Press Start 2P', monospace",
          color: theme.bg, pointerEvents:"none", opacity,
        }}>{label}</span>
      )}
    </div>
  );
}

function FloatingText({ x, y, value, text, color }) {
  return (
    <div style={{
      position: "absolute", left: `${x}%`, top: `${y}%`, transform: "translate(-50%,-50%)",
      color: color || (value >= 70 ? "#4ade80" : value >= 30 ? "#fbbf24" : "#f87171"),
      fontFamily: "'Press Start 2P', monospace", fontSize: 11,
      pointerEvents: "none", animation: "floatUp 0.6s ease-out forwards",
    }}>{text || `+${value}`}</div>
  );
}

function Btn({ label, onClick, theme, ghost }) {
  return (
    <div onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); audio.sfxButtonClick(); onClick(); }}
      style={{
        padding: "14px 24px", fontSize: 10, letterSpacing: 2, minWidth: 180, textAlign: "center", boxSizing: "border-box",
        color: ghost ? theme.fgMid : theme.bg,
        backgroundColor: ghost ? "transparent" : theme.fg,
        border: ghost ? `1px solid ${theme.fgFaint}` : "none",
        cursor: "pointer", WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation", fontFamily: "'Press Start 2P', monospace",
      }}>{label}</div>
  );
}

function Lives({ lives, max }) {
  return (
    <div style={{ display:"flex", gap:6 }}>
      {Array.from({ length: max }, (_, i) => (
        <div key={i} style={{
          width: 8, height: 8, borderRadius: 1,
          backgroundColor: i < lives ? "#ef4444" : "rgba(255,255,255,0.1)",
          transition: "background-color 0.2s",
        }} />
      ))}
    </div>
  );
}

function SequenceIndicator({ nextIndex, missedStep, theme }) {
  const missScale = missedStep === 0 ? 1 : missedStep === 1 ? 0.6 : 0.2;
  return (
    <div style={{ display:"flex", gap:10, alignItems:"center" }}>
      {RGB_COLORS.map((c, i) => {
        const isNext = i === nextIndex;
        return (
          <div key={c.name} style={{
            width: 12, height: 12, borderRadius: 2,
            backgroundColor: c.color,
            opacity: isNext ? 1 : 0.2,
            transition: "opacity 0.15s, transform 0.18s ease-out",
            transform: isNext ? `scale(${1.3 * missScale})` : "scale(1)",
          }} />
        );
      })}
    </div>
  );
}

const TITLE_COLORS = ["#ef4444", "#3b82f6", "#22c55e"];
const TITLE_SIZES = [16, 22, 30, 40, 52];

function TitleBgSquares() {
  const [squares, setSquares] = useState([]);
  const squaresRef = useRef([]);

  useEffect(() => {
    const spawn = () => {
      const id = Date.now() + Math.random();
      const size = TITLE_SIZES[Math.floor(Math.random() * TITLE_SIZES.length)];
      const color = TITLE_COLORS[Math.floor(Math.random() * TITLE_COLORS.length)];
      const x = 5 + Math.random() * 90;
      const y = 5 + Math.random() * 90;
      const lifetime = 1800 + Math.random() * 1200;
      const sq = { id, x, y, size, color, lifetime };
      squaresRef.current = [...squaresRef.current, sq];
      setSquares([...squaresRef.current]);
      setTimeout(() => {
        squaresRef.current = squaresRef.current.filter((s) => s.id !== id);
        setSquares([...squaresRef.current]);
      }, lifetime);
    };
    spawn();
    const interval = setInterval(spawn, 600);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ position:"absolute", inset:0, pointerEvents:"none", zIndex:0 }}>
      {squares.map((sq) => (
        <div key={sq.id} style={{
          position:"absolute", left:`${sq.x}%`, top:`${sq.y}%`,
          width:sq.size, height:sq.size,
          backgroundColor:sq.color, opacity:0,
          transform:"translate(-50%,-50%)",
          animation:`squarePulse ${sq.lifetime}ms ease-in-out forwards`,
        }} />
      ))}
    </div>
  );
}

export default function TapAppPop() {
  const [screen, setScreen] = useState("title");
  const [gameMode, setGameMode] = useState("classic");
  const [mode, setMode] = useState("night");
  const [score, setScore] = useState(0);
  const [marks, setMarks] = useState([]);
  const [floats, setFloats] = useState([]);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [taps, setTaps] = useState(0);
  const [misses, setMisses] = useState(0);
  // RGB state
  const [lives, setLives] = useState(RGB_MAX_LIVES);
  const [rgbNext, setRgbNext] = useState(0); // index into RGB_COLORS
  const [rgbChains, setRgbChains] = useState(0);
  const [pressure, setPressure] = useState(0);
  const [peakPressure, setPeakPressure] = useState(0);
  const [missed, setMissed] = useState(0);
  // MATH state
  const [mathNext, setMathNext] = useState(1);
  const [mathRounds, setMathRounds] = useState(0);
  // Combo & FX state
  const [combo, setCombo] = useState(0);
  const [comboBump, setComboBump] = useState(0);
  const [particles, setParticles] = useState([]);
  const [shake, setShake] = useState(0);
  // Tap-feedback FX: per-tap squash/glow ghosts and full-screen flashes
  const [tapPops, setTapPops] = useState([]);
  const [flashes, setFlashes] = useState([]);
  // History
  const [history, setHistory] = useState(() => loadHistory().runs);
  const [confirmClear, setConfirmClear] = useState(false);
  const confirmClearTimer = useRef();
  const bests = useMemo(() => computeBests(history), [history]);
  const [selectedMode, setSelectedMode] = useState("classic");
  const [dragDx, setDragDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ pointerId: null, startX: 0, startIndex: 0, lastSnappedIndex: 0 });

  const markBirths = useRef({});
  const markColors = useRef({});
  const markLabels = useRef({});
  const markPositions = useRef({});
  const mathRoundRef = useRef(0);
  const mathCounterRef = useRef(1); // running number counter, resets on life loss
  const mathTimers = useRef([]);
  const classicStartRef = useRef(0);
  const spawnTimer = useRef();
  const gameTimer = useRef();
  const livesRef = useRef(RGB_MAX_LIVES);
  const pressureRef = useRef(0);
  const comboRef = useRef(0);
  const rgbNextRef = useRef(0);
  const missedRef = useRef(0);
  const mathNextRef = useRef(1);
  const t = themes[mode];

  const cleanup = () => { clearTimeout(spawnTimer.current); clearInterval(gameTimer.current); mathTimers.current.forEach(clearTimeout); mathTimers.current = []; };

  // --- Combo + particle + shake helpers ---
  const resetCombo = () => {
    if (comboRef.current === 0) return;
    comboRef.current = 0;
    setCombo(0);
  };
  const triggerShake = () => setShake((s) => s + 1);
  // gravity (px) is added to each particle's final dy so they drift slightly downward
  // as they fade — a hint of weight without a per-frame physics loop.
  const spawnParticles = (x, y, color, count, spread, gravity = 0) => {
    const batchId = Date.now() + Math.random();
    const batch = Array.from({ length: count }).map((_, i) => {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const dist = spread * (0.6 + Math.random() * 0.4);
      const accent = Math.random();
      return {
        id: `${batchId}-${i}`,
        batchId,
        x, y,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist + gravity,
        color: accent < 0.25 ? "#ffffff" : accent < 0.5 ? "#fbbf24" : color,
        size: 2 + Math.floor(Math.random() * 2),
      };
    });
    setParticles((p) => [...p, ...batch]);
    setTimeout(() => {
      setParticles((p) => p.filter((pp) => pp.batchId !== batchId));
    }, 450);
  };
  // ──────────────────────────────────────────────────────────────────────────
  // Reusable per-tap visual feedback. Fires for every successful tap in any mode.
  // Tweak the constants below to dial intensity up/down. Total duration < 400ms.
  //   • squash & stretch ghost     — `tapPop`     (150ms)
  //   • rim glow ring              — `tapGlow`    (200ms)
  //   • particle burst (with grav) — spawnParticles (~450ms)
  //   • subtle full-screen flash   — `flashFade`  (150ms)
  // ──────────────────────────────────────────────────────────────────────────
  const playTapFeedback = (x, y, color, label) => {
    const id = Date.now() + Math.random();
    // Ghost mark + rim glow share an entry so they animate together.
    const popEntry = { id, x, y, color, label };
    setTapPops((p) => [...p, popEntry]);
    setTimeout(() => setTapPops((p) => p.filter((pp) => pp.id !== id)), 220);
    // Particles: 14 dots in a ring with a small downward drift so they feel weighty.
    spawnParticles(x, y, color, 14, 38, 6);
    // Full-screen color flash — extremely subtle (opacity 0.06, fades in ~150ms).
    const flashId = id + 0.5;
    setFlashes((f) => [...f, { id: flashId, color }]);
    setTimeout(() => setFlashes((f) => f.filter((ff) => ff.id !== flashId)), 160);
  };

  // Bumps combo (RGB only), triggers bump animation, fires milestone burst + shake at x2.00/x2.50.
  const bumpCombo = (x, y, markColor) => {
    comboRef.current += 1;
    const newCombo = comboRef.current;
    setCombo(newCombo);
    setComboBump((b) => b + 1);
    if (newCombo === 20 || newCombo === 30) {
      spawnParticles(x, y, markColor, 40, 120);
      triggerShake();
    }
  };

  // --- Classic spawning ---
  const spawnClassicMark = useCallback(() => {
    const elapsed = (Date.now() - classicStartRef.current) / 1000;
    const diff = classicDifficulty(elapsed);
    const id = Date.now() + Math.random();
    const shape = Math.floor(Math.random() * markShapes.length);
    // Compute position OUTSIDE setMarks so StrictMode's double-invocation of the
    // updater can't advance spawnIndex twice (which would desync markPositions from the rendered mark).
    const pos = randomPos(Object.values(markPositions.current));
    markPositions.current[id] = pos;
    markBirths.current[id] = Date.now();
    setMarks((prev) => [...prev, { id, ...pos, lifetime: diff.lifetime, shape }]);
    setTimeout(() => {
      setMarks((prev) => {
        if (prev.find((m) => m.id === id)) { setMisses((m) => m + 1); audio.sfxMiss(); }
        return prev.filter((m) => m.id !== id);
      });
      delete markBirths.current[id];
      delete markPositions.current[id];
    }, diff.lifetime);
  }, []);

  const scheduleClassic = useCallback(() => {
    const elapsed = (Date.now() - classicStartRef.current) / 1000;
    const diff = classicDifficulty(elapsed);
    const delay = diff.spawnMin + Math.random() * (diff.spawnMax - diff.spawnMin);
    spawnTimer.current = setTimeout(() => { spawnClassicMark(); scheduleClassic(); }, delay);
  }, [spawnClassicMark]);

  // --- RGB spawning (pressure-driven) ---
  const spawnRgbMark = useCallback(() => {
    const id = Date.now() + Math.random();
    const shape = Math.floor(Math.random() * markShapes.length);
    // Guarantee the currently-expected color stays reachable: if none is on screen,
    // force this spawn to be that color. Otherwise random.
    const expected = rgbNextRef.current;
    const hasExpectedOnScreen = Object.values(markColors.current).includes(expected);
    const colorIdx = hasExpectedOnScreen ? Math.floor(Math.random() * 3) : expected;
    const diff = rgbDifficulty(pressureRef.current);
    // Compute position OUTSIDE setMarks for StrictMode safety (see Classic spawn).
    const pos = randomPos(Object.values(markPositions.current));
    markPositions.current[id] = pos;
    markBirths.current[id] = Date.now();
    markColors.current[id] = colorIdx;
    setMarks((prev) => [...prev, { id, ...pos, lifetime: diff.lifetime, shape }]);
    setTimeout(() => {
      const wasExpected = markColors.current[id] === rgbNextRef.current;
      setMarks((prev) => prev.filter((m) => m.id !== id));
      delete markBirths.current[id];
      delete markColors.current[id];
      delete markPositions.current[id];

      if (wasExpected && livesRef.current > 0) {
        missedRef.current += 1;
        if (missedRef.current >= 3) {
          missedRef.current = 0;
          setMissed(0);
          resetCombo();
          livesRef.current -= 1;
          audio.sfxLifeLost();
          setLives(livesRef.current);
          if (livesRef.current <= 0) {
            cleanup();
            audio.sfxGameOver();
            setTimeout(() => setScreen("end"), 400);
          }
        } else {
          setMissed(missedRef.current);
        }
      }
    }, diff.lifetime);
  }, []);

  const scheduleRgb = useCallback(() => {
    const diff = rgbDifficulty(pressureRef.current);
    const delay = diff.spawnMin + Math.random() * (diff.spawnMax - diff.spawnMin);
    spawnTimer.current = setTimeout(() => {
      if (livesRef.current > 0) { spawnRgbMark(); scheduleRgb(); }
    }, delay);
  }, [spawnRgbMark]);

  // --- Start games ---
  const startClassic = useCallback(() => {
    setScore(0); setMarks([]); setFloats([]); setParticles([]); setTapPops([]); setFlashes([]); setTaps(0); setMisses(0);
    setCombo(0); comboRef.current = 0;
    setTimeLeft(GAME_DURATION); markBirths.current = {}; markPositions.current = {}; spawnIndex = 0; setGameMode("classic"); setScreen("play");
    classicStartRef.current = Date.now();
    scheduleClassic();
    gameTimer.current = setInterval(() => {
      setTimeLeft((tt) => {
        if (tt <= 1) { cleanup(); audio.sfxGameOver(); setTimeout(() => setScreen("end"), 300); return 0; }
        return tt - 1;
      });
    }, 1000);
  }, [scheduleClassic]);

  const startRgb = useCallback(() => {
    setScore(0); setMarks([]); setFloats([]); setParticles([]); setTapPops([]); setFlashes([]); setTaps(0); setMisses(0);
    setCombo(0); comboRef.current = 0;
    setLives(RGB_MAX_LIVES); livesRef.current = RGB_MAX_LIVES;
    setRgbNext(0); rgbNextRef.current = 0; setRgbChains(0); setTimeLeft(0);
    setMissed(0); missedRef.current = 0;
    setPressure(0); pressureRef.current = 0; setPeakPressure(0);
    markBirths.current = {}; markColors.current = {}; spawnIndex = 0;
    setGameMode("rgb"); setScreen("play");
    scheduleRgb();
  }, [scheduleRgb]);

  // --- MATH spawning ---
  const spawnMathBatch = useCallback(() => {
    const diff = mathDifficulty(mathRoundRef.current);
    const batchSize = diff.batchSize;
    const startNum = mathCounterRef.current;
    setMathNext(startNum);
    mathNextRef.current = startNum;
    // Compute positions OUTSIDE setMarks for StrictMode safety (see Classic spawn).
    const placed = [];
    const batchMarks = [];
    for (let i = 0; i < batchSize; i++) {
      const num = startNum + i;
      const id = Date.now() + Math.random() + i;
      const pos = randomPos(placed);
      placed.push(pos);
      markBirths.current[id] = Date.now();
      markLabels.current[id] = num;
      markPositions.current[id] = pos;
      batchMarks.push({ id, ...pos, lifetime: diff.lifetime, shape: 0 });
    }
    setMarks(() => batchMarks);
    // single batch expiry — clear all remaining, lose a life, reset counter
    const timer = setTimeout(() => {
      setMarks((prev) => {
        if (prev.length === 0) return prev;
        prev.forEach((m) => { delete markBirths.current[m.id]; delete markLabels.current[m.id]; delete markPositions.current[m.id]; });
        return [];
      });
      mathCounterRef.current = 1;
      audio.sfxLifeLost();
      setLives((l) => {
        const next = l - 1;
        livesRef.current = next;
        if (next <= 0) { cleanup(); audio.sfxGameOver(); setTimeout(() => setScreen("end"), 400); }
        else { setTimeout(() => spawnMathBatch(), 400); }
        return next;
      });
    }, diff.lifetime);
    mathTimers.current.push(timer);
  }, []);

  const startMath = useCallback(() => {
    setScore(0); setMarks([]); setFloats([]); setParticles([]); setTapPops([]); setFlashes([]); setTaps(0); setMisses(0);
    setCombo(0); comboRef.current = 0;
    setLives(MATH_MAX_LIVES); livesRef.current = MATH_MAX_LIVES;
    setMathNext(1); mathNextRef.current = 1; setMathRounds(0); mathRoundRef.current = 0; mathCounterRef.current = 1;
    markBirths.current = {}; markLabels.current = {}; markPositions.current = {}; spawnIndex = 0;
    mathTimers.current.forEach(clearTimeout); mathTimers.current = [];
    setGameMode("math"); setScreen("play");
    setTimeout(() => spawnMathBatch(), 100);
  }, [spawnMathBatch]);

  useEffect(() => cleanup, []);

  // --- Music: main track for menus, game track for gameplay ---
  useEffect(() => {
    audio.ensureCtx();
    if (screen === "play") audio.playGameplay();
    else audio.playMain();
  }, [screen]);

  // --- Record run to history when a game ends ---
  useEffect(() => {
    if (screen !== "end") return;
    const run = buildRun(gameMode, { score, taps, misses, rgbChains, peakPressure, mathRounds });
    setHistory(appendRun(run));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // --- Classic tap ---
  const handleClassicTap = useCallback((id) => {
    const birth = markBirths.current[id];
    if (!birth) return;
    audio.sfxTap();
    const pos = markPositions.current[id]; // captured before delete so visuals fire even after the mark is gone
    delete markBirths.current[id];
    delete markPositions.current[id];
    setMarks((prev) => {
      const m = prev.find((mk) => mk.id === id);
      if (m) {
        const pts = scoreFromReaction(Date.now() - birth, m.lifetime);
        setFloats((f) => [...f, { id: Date.now(), x: m.x, y: m.y, value: pts }]);
        setTimeout(() => setFloats((f) => f.slice(1)), 700);
        setScore((s) => s + pts);
        setTaps((tt) => tt + 1);
      }
      return prev.filter((mk) => mk.id !== id);
    });
    // Visual flair fires OUTSIDE the state updater so StrictMode double-invocation can't double the burst.
    if (pos) playTapFeedback(pos.x, pos.y, t.fg);
  }, [t.fg]);

  // --- RGB tap ---
  const handleRgbTap = useCallback((id) => {
    const birth = markBirths.current[id];
    if (birth == null) return;
    const colorIdx = markColors.current[id];
    const pos = markPositions.current[id];
    delete markBirths.current[id];
    delete markColors.current[id];
    delete markPositions.current[id];

    const expected = rgbNextRef.current;
    if (colorIdx === expected) {
      // Correct tap — increase pressure and combo
      audio.sfxTap();
      const diff = rgbDifficulty(pressureRef.current);
      const mult = comboMultiplier(comboRef.current);
      const pts = Math.round(scoreFromReaction(Date.now() - birth, diff.lifetime) * mult);
      const newP = Math.min(pressureRef.current + RGB_PRESSURE_PER_TAP, RGB_MAX_PRESSURE);
      pressureRef.current = newP;
      setPressure(newP);
      setPeakPressure((prev) => Math.max(prev, newP));
      const markColor = RGB_COLORS[colorIdx].color;
      if (pos) {
        const label = mult > 1 ? `+${pts} x${mult.toFixed(2)}` : `+${pts}`;
        const floatId = Date.now() + Math.random();
        setFloats((f) => [...f, { id: floatId, x: pos.x, y: pos.y, value: pts, text: label }]);
        setTimeout(() => setFloats((f) => f.filter((ff) => ff.id !== floatId)), 700);
        playTapFeedback(pos.x, pos.y, markColor); // shared tap-feedback (squash + glow + 14 particles + flash)
        bumpCombo(pos.x, pos.y, markColor);
      }
      setMarks((prev) => prev.filter((mk) => mk.id !== id));
      setScore((s) => s + pts);
      setTaps((tt) => tt + 1);
      const next = (expected + 1) % 3;
      rgbNextRef.current = next;
      setRgbNext(next);
      missedRef.current = 0;
      setMissed(0);
      if (next === 0) { setRgbChains((c) => c + 1); audio.sfxChainComplete(); }
    } else {
      // Wrong tap — lose life, drop pressure, reset combo, reset to R
      audio.sfxMiss();
      const newP = Math.max(pressureRef.current - RGB_PRESSURE_DROP, 0);
      pressureRef.current = newP;
      setPressure(newP);
      resetCombo();
      if (pos) {
        const floatId = Date.now() + Math.random();
        setFloats((f) => [...f, { id: floatId, x: pos.x, y: pos.y, value: 0, text: "X", color: "#ef4444" }]);
        setTimeout(() => setFloats((f) => f.filter((ff) => ff.id !== floatId)), 700);
      }
      setMarks((prev) => prev.filter((mk) => mk.id !== id));
      livesRef.current -= 1;
      audio.sfxLifeLost();
      const livesAfter = livesRef.current;
      setLives(livesAfter);
      if (livesAfter <= 0) {
        cleanup();
        audio.sfxGameOver();
        setTimeout(() => setScreen("end"), 400);
      }
      rgbNextRef.current = 0;
      setRgbNext(0);
      missedRef.current = 0;
      setMissed(0);
    }
  }, []);

  // --- MATH tap ---
  // Refactored from a setMathNext-updater pattern to ref-based reads so all
  // side effects (audio, particles, playTapFeedback) fire exactly once per tap
  // even under React StrictMode (which double-invokes state updaters).
  const handleMathTap = useCallback((id) => {
    const birth = markBirths.current[id];
    if (birth == null) return;
    const num = markLabels.current[id];
    const pos = markPositions.current[id];
    const expected = mathNextRef.current;

    if (num === expected) {
      // Correct tap
      audio.sfxTap();
      const diff = mathDifficulty(mathRoundRef.current);
      const pts = scoreFromReaction(Date.now() - birth, diff.lifetime);
      delete markBirths.current[id];
      delete markLabels.current[id];
      delete markPositions.current[id];

      if (pos) {
        const floatId = Date.now() + Math.random();
        setFloats((f) => [...f, { id: floatId, x: pos.x, y: pos.y, value: pts }]);
        setTimeout(() => setFloats((f) => f.filter((ff) => ff.id !== floatId)), 700);
      }
      setMarks((prev) => prev.filter((mk) => mk.id !== id));
      setScore((s) => s + pts);
      setTaps((tt) => tt + 1);

      const next = expected + 1;
      const batchEnd = mathCounterRef.current + diff.batchSize;
      if (next >= batchEnd) {
        // Round complete — schedule the next batch
        audio.sfxBatchComplete();
        mathCounterRef.current = batchEnd;
        mathRoundRef.current += 1;
        setMathRounds((r) => r + 1);
        mathTimers.current.forEach(clearTimeout);
        mathTimers.current = [];
        setTimeout(() => spawnMathBatch(), 400);
        mathNextRef.current = batchEnd;
        setMathNext(batchEnd);
      } else {
        mathNextRef.current = next;
        setMathNext(next);
      }

      // Visual flair for the successful tap (outside of any state updater).
      if (pos) playTapFeedback(pos.x, pos.y, t.fg, num);
    } else {
      // Wrong tap — clear batch, lose a life, reset counter
      audio.sfxMiss();
      mathCounterRef.current = 1;
      if (pos) {
        const floatId = Date.now() + Math.random();
        setFloats((f) => [...f, { id: floatId, x: pos.x, y: pos.y, value: 0, text: "X", color: "#ef4444" }]);
        setTimeout(() => setFloats((f) => f.filter((ff) => ff.id !== floatId)), 700);
      }
      setMarks([]);
      markBirths.current = {};
      markLabels.current = {};
      markPositions.current = {};
      mathTimers.current.forEach(clearTimeout);
      mathTimers.current = [];

      livesRef.current -= 1;
      audio.sfxLifeLost();
      const livesAfter = livesRef.current;
      setLives(livesAfter);
      if (livesAfter <= 0) {
        cleanup();
        audio.sfxGameOver();
        setTimeout(() => setScreen("end"), 400);
      } else {
        setTimeout(() => spawnMathBatch(), 400);
      }
      mathNextRef.current = 1;
      setMathNext(1);
    }
  }, [spawnMathBatch, t.fg]);

  const handleTap = gameMode === "math" ? handleMathTap : gameMode === "rgb" ? handleRgbTap : handleClassicTap;

  const toggleMode = (e) => { e.preventDefault(); e.stopPropagation(); setMode((m) => m === "night" ? "day" : "night"); };

  const base = {
    position: "fixed", inset: 0, backgroundColor: t.bg, color: t.fg,
    fontFamily: "'Press Start 2P', monospace", overflow: "hidden",
    touchAction: "manipulation", cursor: "default", transition: "background-color 0.3s, color 0.3s",
  };

  const globalStyles = `
    @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
    * { box-sizing:border-box; margin:0; padding:0; user-select:none; -webkit-user-select:none; }
    @keyframes floatUp { 0% { opacity:1; transform:translate(-50%,-50%) translateY(0); } 100% { opacity:0; transform:translate(-50%,-50%) translateY(-32px); } }
    @keyframes pulse { 0%,100% { opacity:0.3; } 50% { opacity:0.6; } }
    @keyframes shake { 0%,100% { transform:translateX(0); } 20% { transform:translateX(-4px); } 40% { transform:translateX(4px); } 60% { transform:translateX(-3px); } 80% { transform:translateX(3px); } }
    @keyframes squarePulse { 0% { opacity:0; transform:translate(-50%,-50%) scale(0.5); } 20% { opacity:0.18; transform:translate(-50%,-50%) scale(1); } 80% { opacity:0.18; transform:translate(-50%,-50%) scale(1); } 100% { opacity:0; transform:translate(-50%,-50%) scale(0.5); } }
    @keyframes comboPop { 0% { transform:scale(1); } 40% { transform:scale(1.25); } 100% { transform:scale(1); } }
    @keyframes particleFly { 0% { transform:translate(-50%,-50%); opacity:1; } 100% { transform:translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))); opacity:0; } }
    @keyframes screenShake { 0% { transform:translate(0,0); } 20% { transform:translate(-6px,3px); } 40% { transform:translate(5px,-4px); } 60% { transform:translate(-4px,2px); } 80% { transform:translate(3px,-3px); } 100% { transform:translate(0,0); } }
    /* Tap feedback: quick squash & stretch ghost (replaces the tapped mark briefly). */
    @keyframes tapPop { 0% { transform:translate(-50%,-50%) scale(1); opacity:1; } 15% { transform:translate(-50%,-50%) scale(0.7); opacity:0.95; } 60% { transform:translate(-50%,-50%) scale(1.1); opacity:0.55; } 100% { transform:translate(-50%,-50%) scale(1.0); opacity:0; } }
    /* Tap feedback: short rim glow expanding outward from the tap point. */
    @keyframes tapGlow { 0% { transform:translate(-50%,-50%) scale(1); opacity:0.6; } 100% { transform:translate(-50%,-50%) scale(1.6); opacity:0; } }
    /* Tap feedback: extremely subtle full-screen colored flash. */
    @keyframes flashFade { 0% { opacity:0.06; } 100% { opacity:0; } }
  `;

  const [muted, setMuted] = useState(false);

  // ===== TITLE =====
  if (screen === "title") {
    return (
      <div style={base}>
        <style>{globalStyles}</style>
        <TitleBgSquares />
        <div onPointerDown={(e) => { e.preventDefault(); setScreen("menu"); }}
          style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", gap:4, position:"relative", zIndex:1, cursor:"pointer" }}>
          <h1 style={{ fontSize:38, fontWeight:400, letterSpacing:6, lineHeight:1.3 }}>TAP</h1>
          <h1 style={{ fontSize:38, fontWeight:400, letterSpacing:6, lineHeight:1.3 }}>TAP</h1>
          <h1 style={{ fontSize:38, fontWeight:400, letterSpacing:6, lineHeight:1.3 }}>APP</h1>
          <p style={{ fontSize:7, color:t.fgLow, letterSpacing:3, marginTop:48, animation:"pulse 2s ease-in-out infinite" }}>TAP TO START</p>
        </div>
      </div>
    );
  }

  // ===== MENU =====
  if (screen === "menu") {
    return (
      <div style={base}>
        <style>{globalStyles}</style>
        <TitleBgSquares />
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", gap:12, position:"relative", zIndex:1 }}>
          <Btn label="CLASSIC" onClick={startClassic} theme={t} />
          <Btn label="RBG" onClick={startRgb} theme={t} ghost />
          <Btn label="MATH" onClick={startMath} theme={t} ghost />
          <div style={{ display:"flex", justifyContent:"space-between", width:180, marginTop:32 }}>
            <div onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setScreen("title"); }}
              style={{ fontSize:7, color:t.fgLow, letterSpacing:2, cursor:"pointer", WebkitTapHighlightColor:"transparent", touchAction:"manipulation" }}>BACK</div>
            <div onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setScreen("settings"); }}
              style={{ fontSize:7, color:t.fgLow, letterSpacing:2, cursor:"pointer", WebkitTapHighlightColor:"transparent", touchAction:"manipulation" }}>SETTINGS</div>
          </div>
        </div>
      </div>
    );
  }

  // ===== SETTINGS =====
  if (screen === "settings") {
    return (
      <div style={base}>
        <style>{globalStyles}</style>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", gap:0 }}>
          <p style={{ fontSize:12, letterSpacing:4, marginBottom:48 }}>SETTINGS</p>
          <div style={{ display:"flex", flexDirection:"column", gap:24, width:"60%", maxWidth:280 }}>
            {/* Theme */}
            <div onPointerDown={(e) => { e.preventDefault(); toggleMode(e); }}
              style={{ display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", WebkitTapHighlightColor:"transparent", touchAction:"manipulation" }}>
              <span style={{ fontSize:8, letterSpacing:2, color:t.fgMid }}>THEME</span>
              <span style={{ fontSize:8, letterSpacing:2 }}>{mode === "night" ? "NIGHT" : "DAY"}</span>
            </div>
            {/* Sound */}
            <div onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); const on = audio.toggleMute(); setMuted(!on); }}
              style={{ display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", WebkitTapHighlightColor:"transparent", touchAction:"manipulation" }}>
              <span style={{ fontSize:8, letterSpacing:2, color:t.fgMid }}>SOUND</span>
              <span style={{ fontSize:8, letterSpacing:2 }}>{muted ? "OFF" : "ON"}</span>
            </div>
            {/* History */}
            <div onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setScreen("history"); }}
              style={{ display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", WebkitTapHighlightColor:"transparent", touchAction:"manipulation" }}>
              <span style={{ fontSize:8, letterSpacing:2, color:t.fgMid }}>HISTORY</span>
              <span style={{ fontSize:8, letterSpacing:2 }}>→</span>
            </div>
          </div>
          <div onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setScreen("menu"); }}
            style={{ marginTop:48, fontSize:7, color:t.fgLow, letterSpacing:2, cursor:"pointer", WebkitTapHighlightColor:"transparent", touchAction:"manipulation" }}>BACK</div>
        </div>
      </div>
    );
  }

  // ===== HISTORY =====
  if (screen === "history") {
    const ITEM_W = 160;
    const VIEWPORT_W = 160;
    const baseOffset = 0;
    const selectedIndex = MODES.indexOf(selectedMode);
    const modeRuns = history.filter((r) => r.mode === selectedMode);
    const b = bests[selectedMode];

    const handleClearHistory = () => {
      if (confirmClear) {
        const remaining = history.filter((r) => r.mode !== selectedMode);
        saveHistory({ version: 1, runs: remaining });
        setHistory(remaining);
        setConfirmClear(false);
        clearTimeout(confirmClearTimer.current);
      } else {
        setConfirmClear(true);
        clearTimeout(confirmClearTimer.current);
        confirmClearTimer.current = setTimeout(() => setConfirmClear(false), 3000);
      }
    };
    const secondaryStat = (r) => {
      if (r.mode === "classic") return `ACC ${r.accuracy ?? 0}%`;
      if (r.mode === "rgb") return `x${(r.peakMultiplier ?? 1).toFixed(2)} · ${r.rgbChains ?? 0}C`;
      if (r.mode === "math") return `R ${r.mathRounds ?? 0}`;
      return "";
    };

    const onCarouselDown = (e) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startIndex: selectedIndex,
        lastSnappedIndex: selectedIndex,
      };
      setDragging(true);
      setDragDx(0);
    };
    const onCarouselMove = (e) => {
      const r = dragRef.current;
      if (r.pointerId !== e.pointerId) return;
      const dx = e.clientX - r.startX;
      setDragDx(dx);
      const raw = r.startIndex - dx / ITEM_W;
      const nearest = Math.max(0, Math.min(MODES.length - 1, Math.round(raw)));
      if (nearest !== r.lastSnappedIndex) {
        r.lastSnappedIndex = nearest;
        triggerHaptic();
      }
    };
    const onCarouselUp = (e) => {
      const r = dragRef.current;
      if (r.pointerId !== e.pointerId) return;
      const finalIndex = r.lastSnappedIndex;
      dragRef.current.pointerId = null;
      setDragging(false);
      setDragDx(0);
      if (MODES[finalIndex] !== selectedMode) setSelectedMode(MODES[finalIndex]);
    };

    const bestSecondary = selectedMode === "classic"
      ? [["ACC", `${b.bestAccuracy}%`], ["PLAYS", `${b.count}`]]
      : selectedMode === "rgb"
        ? [["CHAINS", `${b.mostChains}`], ["PEAK", `x${b.peakMultiplier.toFixed(2)}`], ["PLAYS", `${b.count}`]]
        : [["ROUNDS", `${b.mostRounds}`], ["PLAYS", `${b.count}`]];

    return (
      <div style={base}>
        <style>{globalStyles}</style>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", height:"100%", padding:"52px 20px 24px", boxSizing:"border-box" }}>
          <p style={{ fontSize:12, letterSpacing:4, marginBottom:20 }}>HISTORY</p>

          <div
            onPointerDown={onCarouselDown}
            onPointerMove={onCarouselMove}
            onPointerUp={onCarouselUp}
            onPointerCancel={onCarouselUp}
            style={{
              width: VIEWPORT_W, height: 40, overflow: "hidden", position: "relative",
              touchAction: "pan-y", cursor: "grab", WebkitTapHighlightColor: "transparent",
              userSelect: "none", marginBottom: 20,
            }}
          >
            <div style={{
              display: "flex", width: MODES.length * ITEM_W, height: "100%", alignItems: "center",
              transform: `translateX(${baseOffset - selectedIndex * ITEM_W + dragDx}px)`,
              transition: dragging ? "none" : "transform 180ms cubic-bezier(.2,.8,.2,1)",
            }}>
              {MODES.map((m) => (
                <div key={m}
                  onClick={() => { if (!dragging && m !== selectedMode) { triggerHaptic(); setSelectedMode(m); } }}
                  style={{
                    width: ITEM_W, textAlign: "center", fontSize: 12, letterSpacing: 4,
                    color: m === selectedMode ? t.fg : t.fgLow,
                    transition: "color 180ms",
                  }}>
                  {MODE_LABEL[m]}
                </div>
              ))}
            </div>
          </div>

          <p style={{ fontSize:7, color:t.fgLow, letterSpacing:3, marginBottom:10 }}>BEST</p>
          <div style={{
            display:"flex", flexDirection:"column", gap:10, width:"100%", maxWidth:320, marginBottom:20,
            padding:"14px 14px", border:`1px solid ${t.fgFaint}`,
          }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
              <span style={{ fontSize:8, color:t.fgMid, letterSpacing:2 }}>{MODE_LABEL[selectedMode]}</span>
              <span style={{ fontSize:22 }}>{b.bestScore}</span>
            </div>
            <div style={{ height:1, background:t.fgFaint }} />
            <div style={{ display:"flex", justifyContent:"space-between", gap:8 }}>
              {bestSecondary.map(([lbl, val]) => (
                <div key={lbl} style={{ display:"flex", flexDirection:"column", gap:3, alignItems:"flex-start", flex:1 }}>
                  <span style={{ fontSize:6, color:t.fgLow, letterSpacing:2 }}>{lbl}</span>
                  <span style={{ fontSize:10, color:t.fg, letterSpacing:1 }}>{val}</span>
                </div>
              ))}
            </div>
          </div>

          <p style={{ fontSize:7, color:t.fgLow, letterSpacing:3, marginBottom:10 }}>RECENT</p>
          <div style={{
            width:"100%", maxWidth:320, flex:1,
            overflowY:"auto", display:"flex", flexDirection:"column",
          }}>
            {modeRuns.length === 0 ? (
              <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", padding:"20px 0" }}>
                <span style={{ fontSize:9, color:t.fgLow, letterSpacing:3 }}>NO {MODE_LABEL[selectedMode]} RUNS YET</span>
              </div>
            ) : modeRuns.map((r) => (
              <div key={r.id} style={{
                display:"flex", justifyContent:"space-between", alignItems:"center",
                padding:"8px 10px", borderBottom:`1px solid ${t.fgSubtle}`,
              }}>
                <div style={{ display:"flex", flexDirection:"column", gap:3, minWidth:48 }}>
                  <span style={{ fontSize:8, color:t.fgMid, letterSpacing:2 }}>{MODE_LABEL[r.mode] ?? r.mode.toUpperCase()}</span>
                  <span style={{ fontSize:6, color:t.fgLow, letterSpacing:2 }}>{timeAgo(r.ts)} AGO</span>
                </div>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:3 }}>
                  <span style={{ fontSize:10 }}>{r.score}</span>
                  <span style={{ fontSize:6, color:t.fgLow, letterSpacing:2 }}>{secondaryStat(r)}</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16, marginTop:20 }}>
            <Btn label="BACK" onClick={() => { setConfirmClear(false); clearTimeout(confirmClearTimer.current); setScreen("settings"); }} theme={t} ghost />
            {modeRuns.length > 0 && (
              <div onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handleClearHistory(); }}
                style={{ fontSize:7, color: confirmClear ? "#f87171" : t.fgLow, letterSpacing:2, cursor:"pointer", WebkitTapHighlightColor:"transparent", touchAction:"manipulation" }}>
                {confirmClear ? "TAP AGAIN TO CONFIRM" : `CLEAR ${MODE_LABEL[selectedMode]} RUNS`}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ===== END =====
  if (screen === "end") {
    const avg = taps > 0 ? Math.round(score / taps) : 0;
    const isRgb = gameMode === "rgb";
    const isMath = gameMode === "math";
    const accuracy = !isRgb && !isMath && taps + misses > 0 ? Math.round((taps / (taps + misses)) * 100) : 0;
    const startFn = isMath ? startMath : isRgb ? startRgb : startClassic;
    return (
      <div style={base}>
        <style>{globalStyles}</style>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", gap:0 }}>
          <p style={{ fontSize:10, color:t.fgMid, letterSpacing:4, marginBottom:8 }}>
            {isMath ? "MATH" : isRgb ? "RBG" : "CLASSIC"}
          </p>
          <h1 style={{ fontSize:48, fontWeight:400, letterSpacing:4 }}>{score}</h1>
          <div style={{ display:"flex", gap:32, marginTop:32 }}>
            {isMath ? (
              <>
                {[[taps,"TAPS"],[mathRounds,"ROUNDS"],[avg,"AVG"]].map(([val,lbl])=>(
                  <div key={lbl} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:16 }}>{val}</span>
                    <span style={{ fontSize:7, color:t.fgLow, letterSpacing:2 }}>{lbl}</span>
                  </div>
                ))}
              </>
            ) : isRgb ? (
              <>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:16 }}>{taps}</span>
                  <span style={{ fontSize:7, color:t.fgLow, letterSpacing:2 }}>TAPS</span>
                </div>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:16 }}>{rgbChains}</span>
                  <span style={{ fontSize:7, color:t.fgLow, letterSpacing:2 }}>CHAINS</span>
                </div>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:16 }}>x{rgbDifficulty(peakPressure).multiplier.toFixed(2)}</span>
                  <span style={{ fontSize:7, color:t.fgLow, letterSpacing:2 }}>PEAK</span>
                </div>
              </>
            ) : (
              <>
                {[[taps,"TAPS"],[avg,"AVG"],[`${accuracy}%`,"HIT"]].map(([val,label])=>(
                  <div key={label} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:16 }}>{val}</span>
                    <span style={{ fontSize:7, color:t.fgLow, letterSpacing:2 }}>{label}</span>
                  </div>
                ))}
              </>
            )}
          </div>
          <div style={{ display:"flex", gap:16, marginTop:48 }}>
            <Btn label="RETRY" onClick={startFn} theme={t} />
            <Btn label="MENU" onClick={() => { cleanup(); setScreen("title"); }} theme={t} ghost />
          </div>
        </div>
      </div>
    );
  }

  // ===== PLAY =====
  const isRgb = gameMode === "rgb";
  const isMathPlay = gameMode === "math";

  return (
    <div style={base}>
      <style>{globalStyles}</style>
      {/* HUD */}
      <div style={{ position:"absolute", top:0, left:0, right:0, display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"52px 20px 0", zIndex:10, pointerEvents:"none" }}>
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          <span style={{ fontSize:14, letterSpacing:2 }}>{score}</span>
          {isRgb && combo >= 2 && (
            <span key={comboBump} style={{ fontSize:16, letterSpacing:2, color:"#fbbf24", animation:"comboPop 0.18s ease-out" }}>
              {combo}×
            </span>
          )}
        </div>
        {isMathPlay ? (
          <div style={{ display:"flex", alignItems:"center", gap:16 }}>
            <span style={{ fontSize:9, color:t.fgMid, letterSpacing:1 }}>NEXT: {mathNext}</span>
            <Lives lives={lives} max={MATH_MAX_LIVES} />
          </div>
        ) : isRgb ? (
          <div style={{ display:"flex", alignItems:"center", gap:16 }}>
            {comboMultiplier(combo) > 1 && (
              <span style={{ fontSize:9, color:"#fbbf24", letterSpacing:1 }}>
                x{comboMultiplier(combo).toFixed(2)}
              </span>
            )}
            <SequenceIndicator nextIndex={rgbNext} missedStep={missed} theme={t} />
            <Lives lives={lives} max={RGB_MAX_LIVES} />
          </div>
        ) : (
          <span style={{ fontSize:14, letterSpacing:2, color:t.fgMid }}>{timeLeft}</span>
        )}
      </div>

      {/* Time bar (classic) / Pressure bar (RGB) / Round indicator (MATH) */}
      {isMathPlay ? (
        <div style={{ position:"absolute", top:88, left:20, right:20, height:2, backgroundColor:t.fgSubtle, zIndex:10 }}>
          <div style={{ height:"100%", width:`${(mathNext - 1) / mathDifficulty(mathRoundRef.current).batchSize * 100}%`,
            backgroundColor:"#4ade80", transition:"width 0.3s ease-out" }} />
        </div>
      ) : !isRgb ? (
        <div style={{ position:"absolute", top:88, left:20, right:20, height:2, backgroundColor:t.fgSubtle, zIndex:10 }}>
          <div style={{ height:"100%", width:`${(timeLeft/GAME_DURATION)*100}%`,
            backgroundColor: timeLeft<=5?"#f87171":timeLeft<=10?"#fbbf24":t.bar,
            transition:"width 1s linear, background-color 0.5s" }} />
        </div>
      ) : (
        <div style={{ position:"absolute", top:88, left:20, right:20, height:2, backgroundColor:t.fgSubtle, zIndex:10 }}>
          <div style={{ height:"100%", width:`${(pressure/RGB_MAX_PRESSURE)*100}%`,
            backgroundColor: pressure >= 20 ? "#f87171" : pressure >= 10 ? "#fbbf24" : "#4ade80",
            transition:"width 0.3s ease-out, background-color 0.3s" }} />
        </div>
      )}

      {/* Canvas */}
      <div key={`canvas-${shake}`} style={{ position:"absolute", inset:0, top:96, bottom:0, animation: shake > 0 ? "screenShake 0.18s ease-out" : undefined }}>
        {marks.map((m) => (
          <Mark key={m.id} mark={m} onTap={handleTap} theme={t}
            rgbColor={isRgb ? RGB_COLORS[markColors.current[m.id]]?.color : null}
            label={isMathPlay ? markLabels.current[m.id] : null} />
        ))}
        {floats.map((f) => (
          <FloatingText key={f.id} x={f.x} y={f.y} value={f.value} text={f.text} color={f.color} />
        ))}
        {particles.map((p) => (
          <span key={p.id} style={{
            position:"absolute", left:`${p.x}%`, top:`${p.y}%`,
            width:p.size, height:p.size, backgroundColor:p.color,
            pointerEvents:"none",
            ["--dx"]:`${p.dx}px`, ["--dy"]:`${p.dy}px`,
            transform:"translate(-50%,-50%)",
            animation:"particleFly 0.4s ease-out forwards",
          }} />
        ))}
        {/* Tap-feedback ghosts: squashing square + expanding rim glow at the tapped position. */}
        {tapPops.map((p) => (
          <Fragment key={p.id}>
            {/* Squash & stretch ghost — replaces the just-removed mark for ~150ms. */}
            <div style={{
              position:"absolute", left:`${p.x}%`, top:`${p.y}%`,
              width:54, height:54, backgroundColor:p.color,
              pointerEvents:"none",
              transform:"translate(-50%,-50%)",
              animation:"tapPop 0.15s ease-out forwards",
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>
              {p.label != null && (
                <span style={{ fontSize:20, color:t.bg, fontFamily:"'Press Start 2P', monospace" }}>{p.label}</span>
              )}
            </div>
            {/* Rim glow — outline ring expanding outward, fading to 0 in ~80–200ms. */}
            <div style={{
              position:"absolute", left:`${p.x}%`, top:`${p.y}%`,
              width:54, height:54, border:`2px solid ${p.color}`,
              pointerEvents:"none",
              transform:"translate(-50%,-50%)",
              animation:"tapGlow 0.2s ease-out forwards",
            }} />
          </Fragment>
        ))}
      </div>
      {/* Full-screen color flashes — extremely subtle (opacity 0.06), ~150ms each. */}
      {flashes.map((f) => (
        <div key={f.id} style={{
          position:"absolute", inset:0,
          backgroundColor:f.color, pointerEvents:"none", zIndex:5,
          animation:"flashFade 0.15s ease-out forwards",
        }} />
      ))}
    </div>
  );
}
