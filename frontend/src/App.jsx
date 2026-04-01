import { useState, useRef, useCallback, useEffect } from "react";
import Webcam from "react-webcam";
import { motion as Motion, AnimatePresence } from "framer-motion";
import axios from "axios";
import "./App.css";

const API = "http://localhost:8000";

function b64ToBlob(b64) {
  const [header, data] = b64.split(",");
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(data);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ─── Scan overlay corners + scan line ─────────────────────────────────────────
function ScanOverlay({ phase }) {
  return (
    <div className={`scan-overlay phase-${phase}`}>
      <span className="corner tl" /><span className="corner tr" />
      <span className="corner bl" /><span className="corner br" />
      {phase === "scanning" && <div className="scan-line" />}
      <div className="scan-grid" />
    </div>
  );
}

// ─── Liveness signal bar ──────────────────────────────────────────────────────
function SignalRow({ label, value, max = 1, pass }) {
  const pct = Math.min((value / max) * 100, 100).toFixed(0);
  return (
    <div className="sig-row">
      <span className="sig-label">{label}</span>
      <div className="sig-track">
        <Motion.div
          className={`sig-fill ${pass ? "pass" : "fail"}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
      </div>
      <span className="sig-val">{pct}%</span>
    </div>
  );
}

// ─── Audit Log Modal ──────────────────────────────────────────────────────────
function AuditLogModal({ onClose }) {
  const [entries, setEntries] = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`${API}/audit-log?limit=200`)
      .then(r => { setEntries(r.data.entries); setTotal(r.data.total); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const outcomeStyle = (o) => {
    if (o === "GRANTED")          return { color: "var(--green)",  bg: "rgba(0,255,157,.08)",  icon: "✓" };
    if (o === "DENIED_MISMATCH")  return { color: "#ffc46c",       bg: "rgba(255,196,108,.08)",icon: "✗" };
    if (o === "DENIED_AMBIGUOUS") return { color: "#ffc46c",       bg: "rgba(255,196,108,.08)",icon: "?" };
    if (o === "NO_FACE")          return { color: "var(--muted)",  bg: "rgba(72,96,126,.08)",  icon: "—" };
    return                               { color: "var(--muted)",  bg: "transparent",          icon: "·" };
  };

  const stats = {
    granted:  entries.filter(e => e.outcome === "GRANTED").length,
    mismatch: entries.filter(e => e.outcome === "DENIED_MISMATCH" || e.outcome === "DENIED_AMBIGUOUS").length,
  };

  return (
    <Motion.div
      className="audit-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <Motion.div
        className="audit-modal"
        initial={{ opacity: 0, y: 40, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.97 }}
        transition={{ duration: 0.3 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="audit-header">
          <div className="audit-title-row">
            <h2 className="audit-title">Audit Log</h2>
            <span className="audit-total">{total} total entries</span>
          </div>

          {/* Stats row */}
          <div className="audit-stats">
            <div className="audit-stat granted">
              <span className="stat-num">{stats.granted}</span>
              <span className="stat-label">Granted</span>
            </div>
            <div className="audit-stat mismatch">
              <span className="stat-num">{stats.mismatch}</span>
              <span className="stat-label">Mismatch</span>
            </div>
          </div>

          <button className="audit-close" onClick={onClose}>✕</button>
        </div>

        {/* Table */}
        <div className="audit-body">
          {loading && <p className="audit-empty">Loading…</p>}
          {!loading && entries.length === 0 && (
            <p className="audit-empty">No entries yet. Auth attempts will appear here.</p>
          )}
          {!loading && entries.length > 0 && (
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Outcome</th>
                  <th>User</th>
                  <th>Similarity</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => {
                  const s = outcomeStyle(e.outcome);
                  return (
                    <Motion.tr
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.015, duration: 0.2 }}
                      style={{ background: s.bg }}
                    >
                      <td className="audit-time">{e.timestamp}</td>
                      <td>
                        <span className="outcome-badge" style={{ color: s.color, borderColor: s.color }}>
                          {s.icon} {e.outcome.replace("DENIED_", "")}
                        </span>
                      </td>
                      <td className="audit-user">{e.username_matched || "—"}</td>
                      <td className="audit-num">
                        {e.similarity_score > 0 ? `${(e.similarity_score * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="audit-reason">{e.reason || "—"}</td>
                    </Motion.tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Motion.div>
    </Motion.div>
  );
}

// ─── Dashboard (unlocked after successful auth) ───────────────────────────────
function Dashboard({ user, token, onLock }) {
  const [tick, setTick]         = useState(new Date());
  const [showAudit, setShowAudit] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const teamMembers = ["Aalekh Raghuvanshi", "Prathyusha Reddy", "Reena Akshaya", "Shreya Keshri"];

  useEffect(() => {
    const id = setInterval(() => setTick(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = tick.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const date = tick.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  const tiles = [
    { icon: "◇", label: "Team", color: "#ffc46c", onClick: () => setShowTeam(true) },
    { icon: "📋", label: "Audit Log",  color: "#a78bfa", onClick: () => setShowAudit(true) },
  ];

  return (
    <>
      <Motion.div
        className="dashboard"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        {/* Top bar */}
        <div className="dash-topbar">
          <div className="dash-logo"><span className="logo-hex">⬡</span> NEURALGATE</div>
          <div className="dash-user-pill">
            <span className="dash-user-dot" />
            {user}
          </div>
          <button className="lock-btn" onClick={onLock}>⎋ Lock</button>
        </div>

        {/* Welcome */}
        <div className="dash-welcome">
          <Motion.p className="dash-time" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
            {time}
          </Motion.p>
          <Motion.p className="dash-date" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
            {date}
          </Motion.p>
          <Motion.h1 className="dash-greeting" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            Welcome back, <span className="dash-name">{user}</span>
          </Motion.h1>
          <Motion.p className="dash-sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
            Identity verified · Session active
          </Motion.p>
        </div>

        {/* App tiles */}
        <Motion.div
          className="dash-grid"
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.07, delayChildren: 0.5 } } }}
        >
          {tiles.map((t) => (
            <Motion.div
              key={t.label}
              className="dash-tile"
              style={{ "--tile-accent": t.color, cursor: t.onClick ? "pointer" : "default" }}
              variants={{ hidden: { opacity: 0, y: 18 }, visible: { opacity: 1, y: 0 } }}
              whileHover={{ scale: 1.04, y: -4 }}
              onClick={t.onClick}
            >
              <span className="tile-icon" style={{ color: t.color }}>{t.icon}</span>
              <span className="tile-label">{t.label}</span>
              <div className="tile-glow" style={{ background: t.color }} />
            </Motion.div>
          ))}
        </Motion.div>

        {/* Session token */}
        <Motion.div className="dash-token-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
          <span className="token-tag">SESSION</span>
          <code className="token-val">{token}</code>
        </Motion.div>
      </Motion.div>

      {/* Audit log modal */}
      <AnimatePresence>
        {showTeam && (
          <Motion.div
            className="audit-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowTeam(false)}
          >
            <Motion.div
              className="team-modal"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.22 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="audit-close" onClick={() => setShowTeam(false)}>✕</button>
              <h2 className="audit-title">Team</h2>
              <div className="team-members">
                {teamMembers.map((member) => (
                  <div key={member} className="team-member-card">{member}</div>
                ))}
              </div>
            </Motion.div>
          </Motion.div>
        )}
        {showAudit && <AuditLogModal onClose={() => setShowAudit(false)} />}
      </AnimatePresence>
    </>
  );
}

// ─── Landing screen (before camera opens) ────────────────────────────────────
function Landing({ onStart, enrolled, backendDown }) {
  return (
    <Motion.div
      className="landing"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="landing-icon">⬡</div>
      <h1 className="landing-title">NeuralGate</h1>
      <p className="landing-sub">
        {backendDown
          ? "⚠ Cannot reach server — make sure the backend is running on :8000"
          : enrolled.length > 0
            ? `${enrolled.length} enrolled ${enrolled.length === 1 ? "identity" : "identities"} ready`
            : "No enrolled users — add photos to faces/<name>/ and restart server"}
      </p>

      <div className="landing-chips">
        <span className="chip">ArcFace 512-d</span>
        <span className="chip">Cosine Similarity</span>
        <span className="chip">Session Audit Log</span>
      </div>

      <Motion.button
        className="start-btn"
        onClick={onStart}
        disabled={enrolled.length === 0 || backendDown}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
      >
        Authenticate
      </Motion.button>
    </Motion.div>
  );
}

// ─── Camera + auth screen ─────────────────────────────────────────────────────
function CameraScreen({ onSuccess, onCancel }) {
  const webcamRef               = useRef(null);
  const autoScanStartedRef      = useRef(false);
  const [camReady, setCamReady] = useState(false);
  const [phase, setPhase]       = useState("ready");
  const [countdown, setCountdown] = useState(null);
  const [result, setResult]     = useState(null);

  const runCountdown = (n) => new Promise(res => {
    setCountdown(n);
    const iv = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(iv); setCountdown(null); res(); return null; }
        return c - 1;
      });
    }, 1000);
  });

  const shoot = useCallback(async () => {
    if (!camReady || phase !== "ready") return;
    setPhase("countdown");
    setResult(null);

    await runCountdown(3);

    setPhase("analyzing");

    // Wait a frame so the webcam has a fresh image after the countdown overlay disappears
    await new Promise(r => setTimeout(r, 200));

    const shot = webcamRef.current?.getScreenshot({ width: 1280, height: 720 });
    if (!shot) { setPhase("fail"); setResult({ message: "Camera capture failed" }); return; }

    const fd = new FormData();
    // Send WITHOUT flipping — backend handles both orientations
    fd.append("file", b64ToBlob(shot), "face.jpg");

    try {
      const { data } = await axios.post(`${API}/authenticate`, fd);
      if (data.authenticated) {
        onSuccess(data);
      } else {
        setResult(data);
        setPhase("fail");
      }
    } catch (err) {
      const resp = err.response?.data ?? { message: err.message };
      setResult(resp);
      setPhase("fail");
    }
  }, [camReady, phase, onSuccess]);

  useEffect(() => {
    if (!camReady || phase !== "ready" || autoScanStartedRef.current) return;
    const timeoutId = setTimeout(() => {
      autoScanStartedRef.current = true;
      shoot();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [camReady, phase, shoot]);

  const retry = () => {
    autoScanStartedRef.current = false;
    setPhase("ready");
    setResult(null);
  };

  const overlayPhase = { ready: "idle", countdown: "scanning", analyzing: "scanning", fail: "fail" }[phase] ?? "idle";

  return (
    <Motion.div
      className="cam-screen"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
    >
      <div className="cam-header">
        <button className="back-btn" onClick={onCancel}>← Back</button>
        <h2 className="cam-title">Face Scan</h2>
        <span className="cam-hint">
          {phase === "ready"     && (camReady ? "Position your face in the frame" : "Starting camera…")}
          {phase === "countdown" && "Hold still…"}
          {phase === "analyzing" && "Analyzing…"}
          {phase === "fail"      && "Not recognised"}
        </span>
      </div>

      {/* Camera frame */}
      <div className="cam-frame">
        {/*
          NOTE: webcam is NOT CSS-mirrored here so the captured image matches
          enrolled photos. The visual display is mirrored separately via a
          canvas trick — we simply accept that the live view looks natural and
          the captured frame is the raw (correct) orientation.
        */}
        <Webcam
          ref={webcamRef}
          audio={false}
          screenshotFormat="image/jpeg"
          screenshotQuality={0.95}
          videoConstraints={{ width: 1280, height: 720, facingMode: "user" }}
          onUserMedia={() => setCamReady(true)}
          onUserMediaError={() => setResult({ message: "Camera permission denied" })}
          className="webcam"
          style={{ transform: "scaleX(-1)" }}   // mirror for natural look ONLY — captured bytes are correct
          mirrored={false}                       // react-webcam: do NOT mirror the screenshot
        />
        <ScanOverlay phase={overlayPhase} />

        {/* Countdown number */}
        <AnimatePresence>
          {countdown !== null && (
            <Motion.div
              key={countdown}
              className="countdown"
              initial={{ scale: 1.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={{ duration: 0.22 }}
            >
              {countdown}
            </Motion.div>
          )}
        </AnimatePresence>

        {/* Analyzing spinner */}
        {phase === "analyzing" && (
          <div className="cam-badge scanning-badge">
            <span className="pulse-dot" /> Analyzing…
          </div>
        )}

        {/* Fail badge */}
        {phase === "fail" && (
          <Motion.div
            className="cam-badge fail-badge"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            ✗ Face not recognised
          </Motion.div>
        )}
      </div>

      {/* Action button */}
      <AnimatePresence mode="wait">
        {phase === "ready" && (
          <Motion.div
            key="scan-status"
            className="auth-btn auto-scan-status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {camReady ? "Starting scan automatically…" : "Starting camera…"}
          </Motion.div>
        )}
        {phase === "fail" && (
          <Motion.button
            key="retry"
            className="auth-btn btn-danger"
            onClick={retry}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
          >
            Try Again
          </Motion.button>
        )}
      </AnimatePresence>

      {/* Face mismatch detail card */}
      <AnimatePresence>
        {result && phase === "fail" && (
          <Motion.div
            className="detail-card phase-fail"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: "hidden" }}
          >
            <p className="detail-reason">
              {result.message ?? (
                result.similarity_score != null
                  ? `Best match: ${(result.similarity_score * 100).toFixed(1)}% (need ≥45%)`
                  : "No face detected — check lighting and camera angle"
              )}
            </p>
            {result.all_scores && Object.keys(result.all_scores).length > 0 && (
              <div className="signals-block">
                <p className="sig-heading">Similarity per enrolled user</p>
                {Object.entries(result.all_scores)
                  .sort(([,a],[,b]) => b - a)
                  .map(([name, score]) => (
                    <SignalRow key={name} label={name} value={Math.max(score, 0)} pass={score >= 0.45} />
                  ))}
              </div>
            )}
            {result.det_score != null && (
              <p className="detail-hint">
                Face detection confidence: {(result.det_score * 100).toFixed(0)}%
                {result.det_score < 0.5 ? " — try better lighting or move closer" : ""}
              </p>
            )}
          </Motion.div>
        )}
      </AnimatePresence>
    </Motion.div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen]   = useState("landing");  // landing | camera | dashboard
  const [enrolled, setEnrolled] = useState([]);
  const [backendDown, setBackendDown] = useState(false);
  const [authResult, setAuthResult]   = useState(null);

  useEffect(() => {
    axios.get(`${API}/health`, { timeout: 3000 })
      .then(r => { setEnrolled(r.data.users ?? []); setBackendDown(false); })
      .catch(() => setBackendDown(true));
  }, []);

  const handleSuccess = (data) => {
    setAuthResult(data);
    // Brief pause on camera screen so user sees the success state, then go to dashboard
    setTimeout(() => setScreen("dashboard"), 600);
  };

  const reset = () => {
    setScreen("landing");
    setAuthResult(null);
    // Re-fetch enrolled list
    axios.get(`${API}/health`, { timeout: 3000 })
      .then(r => setEnrolled(r.data.users ?? []))
      .catch(() => {});
  };

  return (
    <div className="app">
      <div className="bg-grid" />
      <div className="bg-glow" />

      <header className="header">
        <div className="logo">
          <span className="logo-icon">⬡</span>
          <span className="logo-text">NEURALGATE</span>
        </div>
        <div className="header-tag">InsightFace · v2.1</div>
      </header>

      <main className="main">
        <AnimatePresence mode="wait">

          {screen === "landing" && (
            <Landing
              key="landing"
              enrolled={enrolled}
              backendDown={backendDown}
              onStart={() => setScreen("camera")}
            />
          )}

          {screen === "camera" && (
            <CameraScreen
              key="camera"
              onSuccess={handleSuccess}
              onCancel={() => setScreen("landing")}
            />
          )}

          {screen === "dashboard" && authResult && (
            <Dashboard
              key="dashboard"
              user={authResult.username}
              token={authResult.session_token}
              onLock={reset}
            />
          )}

        </AnimatePresence>
      </main>
    </div>
  );
}
