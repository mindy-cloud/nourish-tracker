import { useState, useEffect, useRef, useCallback } from "react";

const TARGETS = {
  calories: 1500,
  protein: 150,
  carbs: 145,
  fat: 33,
  fiber: 30,
  water: 85,
};

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || "";

async function parseMealWithAI(text) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `You are a nutrition expert. Parse this food log entry and return ONLY a JSON object, no markdown, no explanation.

Input: "${text}"

Return this exact structure:
{
  "items": [
    { "name": "food name", "amount": "amount with unit", "calories": number, "protein": number, "carbs": number, "fat": number, "fiber": number }
  ],
  "totals": { "calories": number, "protein": number, "carbs": number, "fat": number, "fiber": number },
  "summary": "brief one-line summary"
}

Rules:
- Use your best nutritional knowledge for estimates
- For protein powder: assume 25g protein, 120 cal unless specified otherwise
- For creatine: 0 calories, 0 macros
- For collagen protein: ~10g protein per serving, 45 cal
- For chia seeds (1 tbsp): 60 cal, 2g protein, 5g carbs, 4g fat, 5g fiber
- Return whole numbers for all macros
- If amount unclear, use standard serving sizes`
      }]
    })
  });
  const data = await res.json();
  const raw = data.content?.[0]?.text || "{}";
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch { return null; }
}

async function analyzeWorkoutPhoto(base64, mediaType) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: `This is a workout log. Extract every exercise, set, rep count, and weight visible. Return ONLY JSON, no markdown:
{
  "type": "strength",
  "exercises": [{ "name": "exercise name", "sets": number_or_null, "reps": "reps string", "weight": "weight string or null", "notes": "" }],
  "duration": null,
  "summary": "concise summary e.g. Upper body: bench press, rows, shoulder press"
}
If the image is unclear, do your best to extract what is visible.` }
        ]
      }]
    })
  });
  const data = await res.json();
  const raw = data.content?.[0]?.text || "{}";
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch { return { type: "strength", exercises: [], summary: "Workout logged from photo" }; }
}

const todayKey = () => new Date().toISOString().split("T")[0];

function loadDay(dateKey) {
  try {
    const raw = localStorage.getItem(`nourish:day:${dateKey}`);
    return raw ? JSON.parse(raw) : { meals: [], workout: null, water: 0 };
  } catch { return { meals: [], workout: null, water: 0 }; }
}

function saveDay(dateKey, data) {
  try { localStorage.setItem(`nourish:day:${dateKey}`, JSON.stringify(data)); } catch {}
}

function loadWeekSummary() {
  const results = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    results[key] = loadDay(key);
  }
  return results;
}

export default function App() {
  const [tab, setTab] = useState("log");
  const [dayData, setDayData] = useState({ meals: [], workout: null, water: 0 });
  const [weekData, setWeekData] = useState({});
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAnalyzingPhoto, setIsAnalyzingPhoto] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [lastAdded, setLastAdded] = useState(null);
  const [error, setError] = useState("");
  const [waterInput, setWaterInput] = useState(8);
  const [noApiKey, setNoApiKey] = useState(!ANTHROPIC_API_KEY);
  const recognitionRef = useRef(null);
  const photoInputRef = useRef(null);
  const dateKey = todayKey();

  useEffect(() => {
    setDayData(loadDay(dateKey));
    setWeekData(loadWeekSummary());
  }, []);

  const saveDayData = useCallback((updated) => {
    setDayData(updated);
    saveDay(dateKey, updated);
    setWeekData(loadWeekSummary());
  }, [dateKey]);

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setError("Voice not supported in this browser. Try Chrome or Safari."); return; }
    const rec = new SR();
    rec.continuous = false; rec.interimResults = true; rec.lang = "en-US";
    rec.onresult = (e) => setTranscript(Array.from(e.results).map(r => r[0].transcript).join(" "));
    rec.onend = () => setIsListening(false);
    rec.onerror = (ev) => {
      setIsListening(false);
      if (ev.error === "not-allowed") setError("Microphone blocked. Check browser permissions for this site.");
      else setError("Microphone error: " + ev.error);
    };
    rec.start();
    recognitionRef.current = rec;
    setIsListening(true); setTranscript(""); setError("");
  };

  const stopAndParse = async () => {
    recognitionRef.current?.stop();
    setIsListening(false);
    if (!transcript.trim()) return;
    if (noApiKey) { setError("Add your VITE_ANTHROPIC_API_KEY to the .env file first."); return; }
    setIsProcessing(true); setError("");
    try {
      const result = await parseMealWithAI(transcript);
      if (!result?.totals) { setError("Couldn't parse that. Try again with more detail."); return; }
      const meal = { id: Date.now(), time: new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}), raw: transcript, summary: result.summary, items: result.items || [], totals: result.totals };
      const updated = { ...dayData, meals: [...dayData.meals, meal] };
      saveDayData(updated);
      setLastAdded(meal); setTranscript("");
    } catch (err) { setError("AI parsing failed. Check your API key and connection."); }
    finally { setIsProcessing(false); }
  };

  const deleteMeal = (id) => {
    saveDayData({ ...dayData, meals: dayData.meals.filter(m => m.id !== id) });
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (noApiKey) { setError("Add your VITE_ANTHROPIC_API_KEY to the .env file first."); return; }
    setIsAnalyzingPhoto(true); setError("");
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const result = await analyzeWorkoutPhoto(base64, file.type);
      const workout = { id: Date.now(), time: new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}), source: "photo", ...result };
      saveDayData({ ...dayData, workout });
    } catch { setError("Couldn't analyze the photo. Try a clearer image."); }
    finally { setIsAnalyzingPhoto(false); e.target.value = ""; }
  };

  const clearWorkout = () => saveDayData({ ...dayData, workout: null });
  const addWater = () => saveDayData({ ...dayData, water: (dayData.water || 0) + waterInput });

  const totals = dayData.meals.reduce((acc, m) => ({
    calories: acc.calories + (m.totals?.calories || 0),
    protein: acc.protein + (m.totals?.protein || 0),
    carbs: acc.carbs + (m.totals?.carbs || 0),
    fat: acc.fat + (m.totals?.fat || 0),
    fiber: acc.fiber + (m.totals?.fiber || 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });

  const pct = (v, t) => Math.min(100, Math.round((v / t) * 100));

  const s = {
    app: { minHeight: "100vh", background: "#0f1923", color: "#e8e0d4", fontFamily: "'Georgia', 'Times New Roman', serif", maxWidth: 480, margin: "0 auto", paddingBottom: 80 },
    header: { background: "linear-gradient(135deg, #1a2d3d 0%, #0f1923 100%)", borderBottom: "1px solid #2a3d4f", padding: "20px 20px 16px" },
    headerTitle: { fontSize: 22, fontWeight: 700, color: "#c8a96e", letterSpacing: "0.05em", margin: 0 },
    headerSub: { fontSize: 12, color: "#6b8a9a", marginTop: 2, letterSpacing: "0.1em", textTransform: "uppercase" },
    headerDate: { fontSize: 13, color: "#8aafbf", marginTop: 4 },
    tabs: { display: "flex", background: "#0f1923", borderBottom: "1px solid #2a3d4f", position: "sticky", top: 0, zIndex: 10 },
    tab: (active) => ({ flex: 1, padding: "12px 8px", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", background: "none", border: "none", color: active ? "#c8a96e" : "#4a6a7a", borderBottom: active ? "2px solid #c8a96e" : "2px solid transparent", cursor: "pointer", transition: "all 0.2s" }),
    section: { padding: "16px 20px" },
    card: { background: "#1a2d3d", border: "1px solid #2a3d4f", borderRadius: 12, padding: 16, marginBottom: 12 },
    label: { fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6b8a9a", marginBottom: 6 },
    macroRow: { display: "flex", gap: 8, marginBottom: 12 },
    macroBox: (color) => ({ flex: 1, background: "#0f1923", border: `1px solid ${color}30`, borderRadius: 8, padding: "10px 8px", textAlign: "center" }),
    macroVal: { fontSize: 22, fontWeight: 700, color: "#e8e0d4", lineHeight: 1 },
    macroLabel: { fontSize: 10, color: "#6b8a9a", marginTop: 3, letterSpacing: "0.1em", textTransform: "uppercase" },
    macroTarget: { fontSize: 10, color: "#4a6a7a", marginTop: 1 },
    bar: { height: 6, background: "#0f1923", borderRadius: 3, overflow: "hidden", marginBottom: 8 },
    barFill: (p, color) => ({ height: "100%", width: `${p}%`, background: color, borderRadius: 3, transition: "width 0.5s ease" }),
    btn: (color, outline) => ({ width: "100%", padding: "14px 20px", borderRadius: 10, fontSize: 15, fontWeight: 600, background: outline ? "transparent" : color, border: `2px solid ${color}`, color: outline ? color : "#0f1923", cursor: "pointer", letterSpacing: "0.05em", transition: "all 0.2s" }),
    btnSm: (color) => ({ padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "transparent", border: `1px solid ${color}`, color, cursor: "pointer", letterSpacing: "0.05em" }),
    transcriptBox: { background: "#0f1923", border: "1px solid #2a3d4f", borderRadius: 8, padding: 12, minHeight: 60, fontSize: 14, color: "#c8e0e8", marginBottom: 10, lineHeight: 1.5, fontStyle: isListening ? "italic" : "normal" },
    mealCard: { background: "#0f1923", border: "1px solid #2a3d4f", borderRadius: 10, padding: 12, marginBottom: 8 },
    mealTime: { fontSize: 11, color: "#6b8a9a", letterSpacing: "0.1em" },
    mealSummary: { fontSize: 14, color: "#e8e0d4", margin: "4px 0 8px", lineHeight: 1.4 },
    mealMacros: { display: "flex", gap: 8, flexWrap: "wrap" },
    pill: (c) => ({ fontSize: 11, padding: "3px 8px", borderRadius: 12, background: `${c}20`, color: c, fontWeight: 600 }),
    pulseRing: { display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: "#ef4444", animation: "pulse 1s infinite", marginRight: 6 },
    progressFill: (p, color) => ({ height: "100%", width: `${Math.min(100,p)}%`, background: p >= 90 ? "#22c55e" : p >= 60 ? color : "#ef4444", borderRadius: 4, transition: "width 0.6s ease" }),
    weekRow: { display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderBottom: "1px solid #1a2d3d" },
    dot: (on) => ({ width: 10, height: 10, borderRadius: "50%", background: on ? "#22c55e" : "#2a3d4f", flexShrink: 0 }),
  };

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div style={s.app}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.6;transform:scale(1.2)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0f1923; }
        ::-webkit-scrollbar-thumb { background: #2a3d4f; border-radius: 2px; }
      `}</style>

      {/* API Key warning banner */}
      {noApiKey && (
        <div style={{ background: "#2d1a00", borderBottom: "1px solid #c8a96e40", padding: "10px 20px", fontSize: 12, color: "#c8a96e", lineHeight: 1.5 }}>
          ⚠️ <strong>API key missing.</strong> Add <code>VITE_ANTHROPIC_API_KEY=your_key</code> to a <code>.env</code> file in the project root, then restart the dev server.
        </div>
      )}

      {/* Header */}
      <div style={s.header}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={s.headerTitle}>NOURISH</h1>
            <div style={s.headerSub}>Nutrition & Fitness Tracker</div>
            <div style={s.headerDate}>{dateStr}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: totals.calories > TARGETS.calories ? "#ef4444" : "#c8a96e" }}>{totals.calories}</div>
            <div style={{ fontSize: 10, color: "#6b8a9a", letterSpacing: "0.1em" }}>/ {TARGETS.calories} CAL</div>
          </div>
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
          {[["PRO", totals.protein, TARGETS.protein, "#4ade80"], ["CARB", totals.carbs, TARGETS.carbs, "#60a5fa"], ["FAT", totals.fat, TARGETS.fat, "#f59e0b"]].map(([label, val, target, color]) => (
            <div key={label} style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                <span style={{ fontSize: 9, color: "#6b8a9a", letterSpacing: "0.1em" }}>{label}</span>
                <span style={{ fontSize: 9, color }}>{val}g</span>
              </div>
              <div style={s.bar}><div style={s.barFill(pct(val, target), color)} /></div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        {[["log","🥗 Log Meal"],["workout","💪 Workout"],["progress","📊 Progress"]].map(([key,label]) => (
          <button key={key} style={s.tab(tab===key)} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {/* ── LOG MEAL TAB ─────────────────────────────────────────── */}
      {tab === "log" && (
        <div style={s.section}>
          <div style={s.card}>
            <div style={s.label}>Voice Log</div>
            <div style={s.transcriptBox}>
              {isListening && <span style={s.pulseRing} />}
              {transcript || (isListening ? "Listening... speak your meal" : "Tap mic, then speak your food intake")}
            </div>
            {error && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 8 }}>{error}</div>}
            {!isListening ? (
              <button style={s.btn("#c8a96e")} onClick={startListening} disabled={isProcessing}>🎙 Start Speaking</button>
            ) : (
              <button style={s.btn("#ef4444")} onClick={stopAndParse}>⏹ Stop & Log</button>
            )}
            {isProcessing && <div style={{ textAlign: "center", color: "#c8a96e", fontSize: 13, marginTop: 10 }}>✦ Calculating macros...</div>}
          </div>

          {/* Water */}
          <div style={s.card}>
            <div style={s.label}>Water — {dayData.water || 0} oz / {TARGETS.water} oz target</div>
            <div style={s.bar}><div style={s.barFill(pct(dayData.water||0, TARGETS.water), "#38bdf8")} /></div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
              <select value={waterInput} onChange={e => setWaterInput(Number(e.target.value))}
                style={{ background: "#0f1923", border: "1px solid #2a3d4f", color: "#e8e0d4", padding: "8px 12px", borderRadius: 8, fontSize: 14, flex: 1 }}>
                {[4,8,12,16,20,24,32].map(v => <option key={v} value={v}>{v} oz</option>)}
              </select>
              <button style={{ ...s.btnSm("#38bdf8"), padding: "8px 20px" }} onClick={addWater}>+ Add</button>
            </div>
          </div>

          {/* Macros */}
          <div style={{ ...s.card, marginBottom: 16 }}>
            <div style={s.label}>Today's Macros</div>
            <div style={s.macroRow}>
              {[["Protein",totals.protein,TARGETS.protein,"#4ade80"],["Carbs",totals.carbs,TARGETS.carbs,"#60a5fa"],["Fat",totals.fat,TARGETS.fat,"#f59e0b"],["Fiber",totals.fiber,TARGETS.fiber,"#a78bfa"]].map(([label,val,target,color]) => (
                <div key={label} style={s.macroBox(color)}>
                  <div style={s.macroVal}>{val}</div>
                  <div style={s.macroLabel}>{label}</div>
                  <div style={s.macroTarget}>/ {target}g</div>
                </div>
              ))}
            </div>
          </div>

          {lastAdded && (
            <div style={{ ...s.card, border:"1px solid #4ade8040", background:"#0f2318", animation:"fadeIn 0.3s ease", marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#4ade80", letterSpacing: "0.1em", marginBottom: 4 }}>✓ LOGGED</div>
              <div style={{ fontSize: 14, color: "#e8e0d4", marginBottom: 8 }}>{lastAdded.summary}</div>
              <div style={s.mealMacros}>
                {[["cal",lastAdded.totals.calories,"#c8a96e"],["pro",lastAdded.totals.protein+"g","#4ade80"],["carb",lastAdded.totals.carbs+"g","#60a5fa"],["fat",lastAdded.totals.fat+"g","#f59e0b"]].map(([l,v,c]) => (
                  <span key={l} style={s.pill(c)}>{v} {l}</span>
                ))}
              </div>
              <button style={{ ...s.btnSm("#6b8a9a"), marginTop: 8, fontSize: 11 }} onClick={() => setLastAdded(null)}>dismiss</button>
            </div>
          )}

          {dayData.meals.length > 0 ? (
            <>
              <div style={s.label}>Today's Meals ({dayData.meals.length})</div>
              {[...dayData.meals].reverse().map(meal => (
                <div key={meal.id} style={s.mealCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={s.mealTime}>{meal.time}</div>
                    <button onClick={() => deleteMeal(meal.id)} style={{ background: "none", border: "none", color: "#4a6a7a", cursor: "pointer", fontSize: 14, padding: 0 }}>×</button>
                  </div>
                  <div style={s.mealSummary}>{meal.summary}</div>
                  <div style={s.mealMacros}>
                    {[["cal",meal.totals.calories,"#c8a96e"],["pro",meal.totals.protein+"g","#4ade80"],["carb",meal.totals.carbs+"g","#60a5fa"],["fat",meal.totals.fat+"g","#f59e0b"],["fiber",meal.totals.fiber+"g","#a78bfa"]].map(([l,v,c]) => (
                      <span key={l} style={s.pill(c)}>{v} {l}</span>
                    ))}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div style={{ textAlign: "center", color: "#4a6a7a", fontSize: 14, padding: "30px 0" }}>
              No meals logged yet today.<br />
              <span style={{ fontSize: 12 }}>Tap the mic and describe what you ate.</span>
            </div>
          )}
        </div>
      )}

      {/* ── WORKOUT TAB ──────────────────────────────────────────── */}
      {tab === "workout" && (
        <div style={s.section}>
          {!dayData.workout && (
            <div style={s.card}>
              <div style={s.label}>Log Workout from Screenshot</div>
              <div style={{ fontSize: 13, color: "#8aafbf", marginBottom: 16, lineHeight: 1.6 }}>
                Take a screenshot or photo of your completed workout log. The AI will read every exercise, set, rep, and weight automatically.
              </div>
              {isAnalyzingPhoto ? (
                <div style={{ textAlign: "center", padding: "30px 0" }}>
                  <div style={{ fontSize: 28, animation: "spin 1s linear infinite", display: "inline-block", marginBottom: 10 }}>⟳</div>
                  <div style={{ color: "#c8a96e", fontSize: 14 }}>Analyzing your workout log...</div>
                  <div style={{ color: "#6b8a9a", fontSize: 12, marginTop: 4 }}>This takes about 5 seconds</div>
                </div>
              ) : (
                <>
                  <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: "none" }} />
                  <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                    <button style={{ ...s.btn("#c8a96e"), flex: 1 }}
                      onClick={() => { if (photoInputRef.current) { photoInputRef.current.removeAttribute("capture"); photoInputRef.current.setAttribute("capture", "environment"); photoInputRef.current.click(); } }}>
                      📷 Take Photo
                    </button>
                    <button style={{ ...s.btn("#c8a96e", true), flex: 1 }}
                      onClick={() => { if (photoInputRef.current) { photoInputRef.current.removeAttribute("capture"); photoInputRef.current.click(); } }}>
                      🖼 Upload Screenshot
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: "#4a6a7a", textAlign: "center" }}>Supports handwritten logs, app screenshots, printed sheets</div>
                </>
              )}
              {error && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 10 }}>{error}</div>}
            </div>
          )}

          {dayData.workout && (
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#4ade80", letterSpacing: "0.1em", marginBottom: 4 }}>✓ WORKOUT LOGGED — {dayData.workout.time}</div>
                  <div style={{ fontSize: 16, color: "#e8e0d4", fontWeight: 700, lineHeight: 1.3 }}>{dayData.workout.summary}</div>
                </div>
                <span style={{ ...s.pill("#4ade80"), fontSize: 10, textTransform: "uppercase", flexShrink: 0, marginLeft: 8 }}>{dayData.workout.type}</span>
              </div>
              {dayData.workout.exercises?.length > 0 && (
                <>
                  <div style={{ ...s.label, marginBottom: 8 }}>Exercises Logged</div>
                  {dayData.workout.exercises.map((ex, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid #1a2d3d", fontSize: 13 }}>
                      <span style={{ color: "#e8e0d4", fontWeight: 600 }}>{ex.name}</span>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {ex.sets && <span style={s.pill("#6b8a9a")}>{ex.sets}×{ex.reps}</span>}
                        {ex.weight && <span style={s.pill("#c8a96e")}>{ex.weight}</span>}
                      </div>
                    </div>
                  ))}
                </>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button style={{ ...s.btn("#c8a96e", true), flex: 1 }}
                  onClick={() => { if (photoInputRef.current) { photoInputRef.current.removeAttribute("capture"); photoInputRef.current.click(); } }}
                  disabled={isAnalyzingPhoto}>
                  📷 Replace with New Photo
                </button>
                <button style={s.btnSm("#ef4444")} onClick={clearWorkout}>Clear</button>
              </div>
              <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: "none" }} />
            </div>
          )}

          <div style={{ ...s.card, background: "#111d28" }}>
            <div style={s.label}>Tips for Best Results</div>
            {["Screenshot your app's workout summary for instant parsing","Handwritten logs work great — write clearly, one exercise per line","Include sets × reps × weight on each line for full detail","You can replace today's workout log at any time"].map((tip, i) => (
              <div key={i} style={{ fontSize: 12, color: "#6b8a9a", padding: "5px 0", paddingLeft: 14, borderBottom: i < 3 ? "1px solid #1a2d3d" : "none", lineHeight: 1.5 }}>
                <span style={{ color: "#c8a96e", marginRight: 6 }}>▸</span>{tip}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── PROGRESS TAB ─────────────────────────────────────────── */}
      {tab === "progress" && (
        <div style={s.section}>
          <div style={s.card}>
            <div style={s.label}>Today at a Glance</div>
            {[["Calories",totals.calories,TARGETS.calories,"#c8a96e","kcal"],["Protein",totals.protein,TARGETS.protein,"#4ade80","g"],["Carbs",totals.carbs,TARGETS.carbs,"#60a5fa","g"],["Fat",totals.fat,TARGETS.fat,"#f59e0b","g"],["Fiber",totals.fiber,TARGETS.fiber,"#a78bfa","g"],["Water",dayData.water||0,TARGETS.water,"#38bdf8","oz"]].map(([label,val,target,color,unit]) => {
              const p = pct(val, target);
              return (
                <div key={label} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: "#e8e0d4" }}>{label}</span>
                    <span style={{ fontSize: 13 }}>
                      <span style={{ color }}>{val}{unit}</span>
                      <span style={{ color: "#4a6a7a" }}> / {target}{unit}</span>
                      <span style={{ fontSize: 11, color: p >= 90 ? "#22c55e" : p >= 60 ? "#f59e0b" : "#ef4444", marginLeft: 6 }}>{p}%</span>
                    </span>
                  </div>
                  <div style={{ height: 8, background: "#0f1923", borderRadius: 4, overflow: "hidden" }}>
                    <div style={s.progressFill(p, color)} />
                  </div>
                </div>
              );
            })}
          </div>

          <div style={s.card}>
            <div style={s.label}>This Week</div>
            {Object.entries(weekData).map(([dateK, data]) => {
              const d = new Date(dateK + "T12:00:00");
              const dayName = DAYS[d.getDay()];
              const isToday = dateK === todayKey();
              const dayTotals = (data.meals || []).reduce((acc, m) => ({ calories: acc.calories + (m.totals?.calories||0), protein: acc.protein + (m.totals?.protein||0) }), { calories: 0, protein: 0 });
              const hasData = data.meals?.length > 0;
              const proHit = dayTotals.protein >= TARGETS.protein * 0.85;
              const calHit = dayTotals.calories >= TARGETS.calories * 0.85 && dayTotals.calories <= TARGETS.calories * 1.1;
              const workedOut = !!data.workout;
              return (
                <div key={dateK} style={s.weekRow}>
                  <div style={{ width: 36, fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? "#c8a96e" : "#8aafbf" }}>{dayName}</div>
                  <div style={{ flex: 1 }}>
                    {hasData ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span style={s.pill(calHit ? "#4ade80" : "#ef4444")}>{dayTotals.calories} cal</span>
                        <span style={s.pill(proHit ? "#4ade80" : "#ef4444")}>{dayTotals.protein}g pro</span>
                        {workedOut && <span style={s.pill("#c8a96e")}>💪 lift</span>}
                      </div>
                    ) : <span style={{ fontSize: 12, color: "#2a3d4f" }}>no data</span>}
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <div style={s.dot(hasData && calHit)} />
                    <div style={s.dot(hasData && proHit)} />
                    <div style={s.dot(workedOut)} />
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: 10, color: "#4a6a7a", marginTop: 8 }}>Dots: ● Calories  ● Protein  ● Workout</div>
          </div>

          <div style={s.card}>
            <div style={s.label}>Coaching Notes</div>
            {(() => {
              const notes = [];
              const days7 = Object.values(weekData);
              const daysWithData = days7.filter(d => d.meals?.length > 0);
              const avgPro = daysWithData.length ? Math.round(daysWithData.reduce((a, d) => a + (d.meals||[]).reduce((s, m) => s + (m.totals?.protein||0), 0), 0) / daysWithData.length) : 0;
              const workoutDays = days7.filter(d => d.workout).length;
              if (totals.protein < TARGETS.protein * 0.7) notes.push({ text: `Protein is running low today — ${TARGETS.protein - totals.protein}g still needed. Add a cottage cheese snack or another shake.`, color: "#ef4444" });
              else if (totals.protein >= TARGETS.protein * 0.9) notes.push({ text: `Protein on track today. Great work on the most important macro.`, color: "#4ade80" });
              if (totals.calories > TARGETS.calories * 1.1) notes.push({ text: `Calories are over target by ~${totals.calories - TARGETS.calories}. Consider a lighter dinner.`, color: "#f59e0b" });
              if (avgPro > 0 && avgPro < TARGETS.protein * 0.8) notes.push({ text: `Average protein this week is ${avgPro}g — below your 150g target. The daily shake is your most reliable lever.`, color: "#f59e0b" });
              else if (avgPro >= TARGETS.protein * 0.9) notes.push({ text: `Weekly protein average of ${avgPro}g is solid. Muscle-building conditions are in place.`, color: "#4ade80" });
              if (workoutDays >= 4) notes.push({ text: `${workoutDays} workouts logged this week — hitting your 4–5x target.`, color: "#4ade80" });
              else if (daysWithData.length >= 3) notes.push({ text: `${workoutDays} of 7 days with workouts logged. Aim for 4–5 to hit your strength targets.`, color: "#6b8a9a" });
              if ((dayData.water||0) < TARGETS.water * 0.5 && new Date().getHours() > 14) notes.push({ text: `Water is behind pace for this time of day. Aim to finish 80% before 6 PM.`, color: "#38bdf8" });
              if (notes.length === 0) notes.push({ text: "Keep logging — coaching insights appear once you have a few days of data.", color: "#6b8a9a" });
              return notes.map((n, i) => (
                <div key={i} style={{ padding: "10px 0", borderBottom: i < notes.length-1 ? "1px solid #1a2d3d" : "none", fontSize: 13, color: "#c8d8e0", lineHeight: 1.5 }}>
                  <span style={{ color: n.color, marginRight: 6 }}>▸</span>{n.text}
                </div>
              ));
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
