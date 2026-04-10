import { useState, useEffect, useRef, useCallback } from "react";

const GAME_DURATION = 30;
const MARK_LIFETIME = 1200;
const SPAWN_INTERVAL_MIN = 400;
const SPAWN_INTERVAL_MAX = 900;

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
function randomPos(padding = 40) {
  return {
    x: padding + Math.random() * (100 - padding * 2 / window.innerWidth * 100),
    y: padding + Math.random() * (100 - padding * 2 / window.innerHeight * 100),
  };
}

const markShapes = [
  (s) => <circle cx={s/2} cy={s/2} r={s/2} fill="currentColor" />,
  (s) => <rect width={s} height={s} fill="currentColor" />,
  (s) => <polygon points={`${s/2},0 ${s},${s} 0,${s}`} fill="currentColor" />,
  (s) => <polygon points={`${s/2},0 ${s},${s/2} ${s/2},${s} 0,${s/2}`} fill="currentColor" />,
];

function Mark({ mark, onTap, theme, rgbColor }) {
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

  const size = 36;
  const opacity = 1 - progress * 0.7;
  const ring = progress;
  const shape = markShapes[mark.shape];
  const fillColor = rgbColor || theme.fg;
  const ringStroke = rgbColor ? `${rgbColor}30` : theme.fgFaint;

  return (
    <div onPointerDown={(e) => { e.preventDefault(); onTap(mark.id); }}
      style={{
        position: "absolute", left: `${mark.x}%`, top: `${mark.y}%`,
        transform: "translate(-50%,-50%)", width: size + 16, height: size + 16,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", WebkitTapHighlightColor: "transparent", touchAction: "manipulation",
      }}>
      <svg width={size+16} height={size+16} viewBox={`0 0 ${size+16} ${size+16}`} style={{ position:"absolute" }}>
        <circle cx={(size+16)/2} cy={(size+16)/2} r={(size+12)/2} fill="none" stroke={ringStroke} strokeWidth="2"
          strokeDasharray={`${(1-ring)*Math.PI*(size+12)} ${Math.PI*(size+12)}`}
          style={{ transition:"stroke-dasharray 0.1s linear" }} />
      </svg>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{ color: fillColor, opacity, transition:"opacity 0.05s" }}>
        {shape(size)}
      </svg>
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
    <div onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      style={{
        padding: "14px 24px", fontSize: 10, letterSpacing: 2,
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

  const markBirths = useRef({});
  const markColors = useRef({});
  const spawnTimer = useRef();
  const gameTimer = useRef();
  const livesRef = useRef(RGB_MAX_LIVES);
  const pressureRef = useRef(0);
  const t = themes[mode];

  const cleanup = () => { clearTimeout(spawnTimer.current); clearInterval(gameTimer.current); };

  // --- Classic spawning ---
  const spawnClassicMark = useCallback(() => {
    const pos = randomPos();
    const id = Date.now() + Math.random();
    const shape = Math.floor(Math.random() * markShapes.length);
    const mark = { id, ...pos, lifetime: MARK_LIFETIME, shape };
    markBirths.current[id] = Date.now();
    setMarks((prev) => [...prev, mark]);
    setTimeout(() => {
      setMarks((prev) => {
        if (prev.find((m) => m.id === id)) setMisses((m) => m + 1);
        return prev.filter((m) => m.id !== id);
      });
      delete markBirths.current[id];
    }, MARK_LIFETIME);
  }, []);

  const scheduleClassic = useCallback(() => {
    const delay = SPAWN_INTERVAL_MIN + Math.random() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN);
    spawnTimer.current = setTimeout(() => { spawnClassicMark(); scheduleClassic(); }, delay);
  }, [spawnClassicMark]);

  // --- RGB spawning (pressure-driven) ---
  const spawnRgbMark = useCallback(() => {
    const pos = randomPos();
    const id = Date.now() + Math.random();
    const shape = Math.floor(Math.random() * markShapes.length);
    const colorIdx = Math.floor(Math.random() * 3);
    const diff = rgbDifficulty(pressureRef.current);
    const mark = { id, ...pos, lifetime: diff.lifetime, shape };
    markBirths.current[id] = Date.now();
    markColors.current[id] = colorIdx;
    setMarks((prev) => [...prev, mark]);
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
    setTimeLeft(GAME_DURATION); markBirths.current = {}; setGameMode("classic"); setScreen("play");
    scheduleClassic();
    gameTimer.current = setInterval(() => {
      setTimeLeft((tt) => {
        if (tt <= 1) { cleanup(); setTimeout(() => setScreen("end"), 300); return 0; }
        return tt - 1;
      });
    }, 1000);
  }, [scheduleClassic]);

  const startRgb = useCallback(() => {
    setScore(0); setMarks([]); setFloats([]); setTaps(0); setMisses(0);
    setLives(RGB_MAX_LIVES); livesRef.current = RGB_MAX_LIVES;
    setRgbNext(0); setRgbChains(0); setTimeLeft(0);
    setPressure(0); pressureRef.current = 0; setPeakPressure(0);
    markBirths.current = {}; markColors.current = {};
    setGameMode("rgb"); setScreen("play");
    scheduleRgb();
  }, [scheduleRgb]);

  useEffect(() => cleanup, []);

  // --- Classic tap ---
  const handleClassicTap = useCallback((id) => {
    const birth = markBirths.current[id];
    if (!birth) return;
    const pts = scoreFromReaction(Date.now() - birth, MARK_LIFETIME);
    delete markBirths.current[id];
    setMarks((prev) => {
      const m = prev.find((mk) => mk.id === id);
      if (m) {
        setFloats((f) => [...f, { id: Date.now(), x: m.x, y: m.y, value: pts }]);
        setTimeout(() => setFloats((f) => f.slice(1)), 700);
      }
      return prev.filter((mk) => mk.id !== id);
    });
    setScore((s) => s + pts); setTaps((tt) => tt + 1);
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
        if (next === 0) setRgbChains((c) => c + 1);
        return next;
      } else {
        // Wrong tap — lose life, drop pressure, reset to R
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
          if (next <= 0) {
            cleanup();
            setTimeout(() => setScreen("end"), 400);
          }
          return next;
        });
        return 0; // reset to R
      }
    });
  }, []);

  const handleTap = gameMode === "rgb" ? handleRgbTap : handleClassicTap;

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
  `;

  const ThemeToggle = () => (
    <div onPointerDown={toggleMode} style={{
      position:"absolute", top:52, right:20, zIndex:20, fontSize:9,
      color:t.fgLow, letterSpacing:1, cursor:"pointer",
      WebkitTapHighlightColor:"transparent", touchAction:"manipulation",
    }}>{mode === "night" ? "DAY" : "NIGHT"}</div>
  );

  // ===== TITLE =====
  if (screen === "title") {
    return (
      <div style={base}>
        <style>{globalStyles}</style>
        <ThemeToggle />
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", gap:4 }}>
          <h1 style={{ fontSize:38, fontWeight:400, letterSpacing:6, lineHeight:1.3 }}>TAP</h1>
          <h1 style={{ fontSize:38, fontWeight:400, letterSpacing:6, lineHeight:1.3 }}>APP</h1>
          <h1 style={{ fontSize:38, fontWeight:400, letterSpacing:6, lineHeight:1.3 }}>POP</h1>
          <div style={{ display:"flex", flexDirection:"column", gap:12, marginTop:48 }}>
            <Btn label="CLASSIC" onClick={startClassic} theme={t} />
            <Btn label="RGB" onClick={startRgb} theme={t} ghost />
          </div>
        </div>
      </div>
    );
  }

  // ===== END =====
  if (screen === "end") {
    const avg = taps > 0 ? Math.round(score / taps) : 0;
    const isRgb = gameMode === "rgb";
    const accuracy = !isRgb && taps + misses > 0 ? Math.round((taps / (taps + misses)) * 100) : 0;
    const startFn = isRgb ? startRgb : startClassic;
    return (
      <div style={base}>
        <style>{globalStyles}</style>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", gap:0 }}>
          <p style={{ fontSize:10, color:t.fgMid, letterSpacing:4, marginBottom:8 }}>
            {isRgb ? "RGB" : "CLASSIC"}
          </p>
          <h1 style={{ fontSize:48, fontWeight:400, letterSpacing:4 }}>{score}</h1>
          <div style={{ display:"flex", gap:32, marginTop:32 }}>
            {isRgb ? (
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

  return (
    <div style={base}>
      <style>{globalStyles}</style>
      {/* HUD */}
      <div style={{ position:"absolute", top:0, left:0, right:0, display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"52px 20px 0", zIndex:10, pointerEvents:"none" }}>
        <span style={{ fontSize:14, letterSpacing:2 }}>{score}</span>
        {isRgb ? (
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

      {/* Time bar (classic) / Pressure bar (RGB) */}
      {!isRgb ? (
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
            rgbColor={isRgb ? RGB_COLORS[markColors.current[m.id]]?.color : null} />
        ))}
        {floats.map((f) => (
          <FloatingText key={f.id} x={f.x} y={f.y} value={f.value} text={f.text} color={f.color} />
        ))}
      </div>
    </div>
  );
}
