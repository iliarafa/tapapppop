import { useState, useEffect, useRef, useCallback } from "react";

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

function SequenceIndicator({ nextIndex, theme }) {
  return (
    <div style={{ display:"flex", gap:10, alignItems:"center" }}>
      {RGB_COLORS.map((c, i) => (
        <div key={c.name} style={{
          width: 12, height: 12, borderRadius: 2,
          backgroundColor: c.color,
          opacity: i === nextIndex ? 1 : 0.2,
          transition: "opacity 0.15s",
          transform: i === nextIndex ? "scale(1.3)" : "scale(1)",
        }} />
      ))}
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
  // MATH state
  const [mathNext, setMathNext] = useState(1);
  const [mathRounds, setMathRounds] = useState(0);

  const markBirths = useRef({});
  const markColors = useRef({});
  const markLabels = useRef({});
  const mathRoundRef = useRef(0);
  const mathCounterRef = useRef(1); // running number counter, resets on life loss
  const mathTimers = useRef([]);
  const classicStartRef = useRef(0);
  const spawnTimer = useRef();
  const gameTimer = useRef();
  const livesRef = useRef(RGB_MAX_LIVES);
  const pressureRef = useRef(0);
  const t = themes[mode];

  const cleanup = () => { clearTimeout(spawnTimer.current); clearInterval(gameTimer.current); mathTimers.current.forEach(clearTimeout); mathTimers.current = []; };

  // --- Classic spawning ---
  const spawnClassicMark = useCallback(() => {
    const elapsed = (Date.now() - classicStartRef.current) / 1000;
    const diff = classicDifficulty(elapsed);
    const id = Date.now() + Math.random();
    const shape = Math.floor(Math.random() * markShapes.length);
    markBirths.current[id] = Date.now();
    setMarks((prev) => {
      const pos = randomPos(prev);
      return [...prev, { id, ...pos, lifetime: diff.lifetime, shape }];
    });
    setTimeout(() => {
      setMarks((prev) => {
        if (prev.find((m) => m.id === id)) { setMisses((m) => m + 1); audio.sfxMiss(); }
        return prev.filter((m) => m.id !== id);
      });
      delete markBirths.current[id];
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
    const colorIdx = Math.floor(Math.random() * 3);
    const diff = rgbDifficulty(pressureRef.current);
    markBirths.current[id] = Date.now();
    markColors.current[id] = colorIdx;
    setMarks((prev) => {
      const pos = randomPos(prev);
      return [...prev, { id, ...pos, lifetime: diff.lifetime, shape }];
    });
    setTimeout(() => {
      setMarks((prev) => prev.filter((m) => m.id !== id));
      delete markBirths.current[id];
      delete markColors.current[id];
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
    setScore(0); setMarks([]); setFloats([]); setTaps(0); setMisses(0);
    setTimeLeft(GAME_DURATION); markBirths.current = {}; spawnIndex = 0; setGameMode("classic"); setScreen("play");
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
    setScore(0); setMarks([]); setFloats([]); setTaps(0); setMisses(0);
    setLives(RGB_MAX_LIVES); livesRef.current = RGB_MAX_LIVES;
    setRgbNext(0); setRgbChains(0); setTimeLeft(0);
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
    setMarks(() => {
      const next = [];
      for (let i = 0; i < batchSize; i++) {
        const num = startNum + i;
        const id = Date.now() + Math.random() + i;
        const pos = randomPos(next);
        const mark = { id, ...pos, lifetime: diff.lifetime, shape: 0 };
        markBirths.current[id] = Date.now();
        markLabels.current[id] = num;
        next.push(mark);
      }
      return next;
    });
    // single batch expiry — clear all remaining, lose a life, reset counter
    const timer = setTimeout(() => {
      setMarks((prev) => {
        if (prev.length === 0) return prev;
        prev.forEach((m) => { delete markBirths.current[m.id]; delete markLabels.current[m.id]; });
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
    setScore(0); setMarks([]); setFloats([]); setTaps(0); setMisses(0);
    setLives(MATH_MAX_LIVES); livesRef.current = MATH_MAX_LIVES;
    setMathNext(1); setMathRounds(0); mathRoundRef.current = 0; mathCounterRef.current = 1;
    markBirths.current = {}; markLabels.current = {}; spawnIndex = 0;
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

  // --- Classic tap ---
  const handleClassicTap = useCallback((id) => {
    const birth = markBirths.current[id];
    if (!birth) return;
    audio.sfxTap();
    delete markBirths.current[id];
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
  }, []);

  // --- RGB tap ---
  const handleRgbTap = useCallback((id) => {
    const birth = markBirths.current[id];
    if (birth == null) return;
    const colorIdx = markColors.current[id];
    delete markBirths.current[id];
    delete markColors.current[id];

    setRgbNext((expected) => {
      if (colorIdx === expected) {
        // Correct tap — increase pressure
        audio.sfxTap();
        const diff = rgbDifficulty(pressureRef.current);
        const pts = Math.round(scoreFromReaction(Date.now() - birth, diff.lifetime) * diff.multiplier);
        const newP = Math.min(pressureRef.current + RGB_PRESSURE_PER_TAP, RGB_MAX_PRESSURE);
        pressureRef.current = newP;
        setPressure(newP);
        setPeakPressure((prev) => Math.max(prev, newP));
        setMarks((prev) => {
          const m = prev.find((mk) => mk.id === id);
          if (m) {
            const label = diff.multiplier > 1 ? `+${pts} x${diff.multiplier.toFixed(2)}` : `+${pts}`;
            setFloats((f) => [...f, { id: Date.now(), x: m.x, y: m.y, value: pts, text: label }]);
            setTimeout(() => setFloats((f) => f.slice(1)), 700);
          }
          return prev.filter((mk) => mk.id !== id);
        });
        setScore((s) => s + pts);
        setTaps((tt) => tt + 1);
        const next = (expected + 1) % 3;
        if (next === 0) { setRgbChains((c) => c + 1); audio.sfxChainComplete(); }
        return next;
      } else {
        // Wrong tap — lose life, drop pressure, reset to R
        audio.sfxMiss();
        const newP = Math.max(pressureRef.current - RGB_PRESSURE_DROP, 0);
        pressureRef.current = newP;
        setPressure(newP);
        setMarks((prev) => {
          const m = prev.find((mk) => mk.id === id);
          if (m) {
            setFloats((f) => [...f, { id: Date.now(), x: m.x, y: m.y, value: 0, text: "X", color: "#ef4444" }]);
            setTimeout(() => setFloats((f) => f.slice(1)), 700);
          }
          return prev.filter((mk) => mk.id !== id);
        });
        setLives((l) => {
          const next = l - 1;
          livesRef.current = next;
          audio.sfxLifeLost();
          if (next <= 0) {
            cleanup();
            audio.sfxGameOver();
            setTimeout(() => setScreen("end"), 400);
          }
          return next;
        });
        return 0; // reset to R
      }
    });
  }, []);

  // --- MATH tap ---
  const handleMathTap = useCallback((id) => {
    const birth = markBirths.current[id];
    if (birth == null) return;
    const num = markLabels.current[id];

    setMathNext((expected) => {
      if (num === expected) {
        // Correct
        audio.sfxTap();
        const diff = mathDifficulty(mathRoundRef.current);
        const pts = scoreFromReaction(Date.now() - birth, diff.lifetime);
        delete markBirths.current[id];
        delete markLabels.current[id];
        setMarks((prev) => {
          const m = prev.find((mk) => mk.id === id);
          if (m) {
            setFloats((f) => [...f, { id: Date.now(), x: m.x, y: m.y, value: pts }]);
            setTimeout(() => setFloats((f) => f.slice(1)), 700);
          }
          return prev.filter((mk) => mk.id !== id);
        });
        setScore((s) => s + pts);
        setTaps((tt) => tt + 1);
        const next = expected + 1;
        const batchEnd = mathCounterRef.current + diff.batchSize;
        if (next >= batchEnd) {
          // Round complete
          audio.sfxBatchComplete();
          mathCounterRef.current = batchEnd;
          mathRoundRef.current += 1;
          setMathRounds((r) => r + 1);
          mathTimers.current.forEach(clearTimeout);
          mathTimers.current = [];
          setTimeout(() => spawnMathBatch(), 400);
          return batchEnd;
        }
        return next;
      } else {
        // Wrong tap — lose life, reset counter to 1
        audio.sfxMiss();
        mathCounterRef.current = 1;
        setMarks((prev) => {
          const m = prev.find((mk) => mk.id === id);
          if (m) {
            setFloats((f) => [...f, { id: Date.now(), x: m.x, y: m.y, value: 0, text: "X", color: "#ef4444" }]);
            setTimeout(() => setFloats((f) => f.slice(1)), 700);
          }
          return [];
        });
        markBirths.current = {};
        markLabels.current = {};
        mathTimers.current.forEach(clearTimeout);
        mathTimers.current = [];
        setLives((l) => {
          const next = l - 1;
          livesRef.current = next;
          audio.sfxLifeLost();
          if (next <= 0) {
            cleanup();
            audio.sfxGameOver();
            setTimeout(() => setScreen("end"), 400);
          } else {
            setTimeout(() => spawnMathBatch(), 400);
          }
          return next;
        });
        return 1;
      }
    });
  }, [spawnMathBatch]);

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
            <div onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setScreen("settings"); }}
              style={{ fontSize:7, color:t.fgLow, letterSpacing:2, cursor:"pointer", WebkitTapHighlightColor:"transparent", touchAction:"manipulation" }}>SETTINGS</div>
            <div onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setScreen("title"); }}
              style={{ fontSize:7, color:t.fgLow, letterSpacing:2, cursor:"pointer", WebkitTapHighlightColor:"transparent", touchAction:"manipulation" }}>BACK</div>
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
          </div>
          <div onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setScreen("menu"); }}
            style={{ marginTop:48, fontSize:7, color:t.fgLow, letterSpacing:2, cursor:"pointer", WebkitTapHighlightColor:"transparent", touchAction:"manipulation" }}>BACK</div>
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
        <span style={{ fontSize:14, letterSpacing:2 }}>{score}</span>
        {isMathPlay ? (
          <div style={{ display:"flex", alignItems:"center", gap:16 }}>
            <span style={{ fontSize:9, color:t.fgMid, letterSpacing:1 }}>NEXT: {mathNext}</span>
            <Lives lives={lives} max={MATH_MAX_LIVES} />
          </div>
        ) : isRgb ? (
          <div style={{ display:"flex", alignItems:"center", gap:16 }}>
            {rgbDifficulty(pressure).multiplier > 1 && (
              <span style={{ fontSize:9, color:"#fbbf24", letterSpacing:1 }}>
                x{rgbDifficulty(pressure).multiplier.toFixed(2)}
              </span>
            )}
            <SequenceIndicator nextIndex={rgbNext} theme={t} />
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
      <div style={{ position:"absolute", inset:0, top:96, bottom:0 }}>
        {marks.map((m) => (
          <Mark key={m.id} mark={m} onTap={handleTap} theme={t}
            rgbColor={isRgb ? RGB_COLORS[markColors.current[m.id]]?.color : null}
            label={isMathPlay ? markLabels.current[m.id] : null} />
        ))}
        {floats.map((f) => (
          <FloatingText key={f.id} x={f.x} y={f.y} value={f.value} text={f.text} color={f.color} />
        ))}
      </div>
    </div>
  );
}
