import { useState, useRef, useCallback, useEffect } from "react";
import Webcam from "react-webcam";
import { motion as Motion, AnimatePresence } from "framer-motion";
import axios from "axios";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import "./App.css";

const API = "http://localhost:8000";
const MEDIAPIPE_WASM_URL = "/mediapipe";
const MEDIAPIPE_MODEL_URL = "/models/face_landmarker.task";
const EYE_INDICES = {
  left: [33, 160, 158, 133, 153, 144],
  right: [362, 385, 387, 263, 373, 380],
};
const BLINK_CALIBRATION_FRAMES = 12;
const BLINK_MIN_BASELINE = 0.18;
const BLINK_CLOSED_RATIO = 0.72;
const BLINK_OPEN_RATIO = 0.9;
const BLINK_MIN_CLOSED_FRAMES = 2;

function b64ToBlob(b64) {
  const [header, data] = b64.split(",");
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(data);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeAspectRatio(landmarks, [leftCorner, upperA, upperB, rightCorner, lowerA, lowerB]) {
  const horizontal = pointDistance(landmarks[leftCorner], landmarks[rightCorner]);
  if (!horizontal) return 0;

  const verticalA = pointDistance(landmarks[upperA], landmarks[lowerA]);
  const verticalB = pointDistance(landmarks[upperB], landmarks[lowerB]);
  return (verticalA + verticalB) / (2 * horizontal);
}

function averageEyeAspectRatio(landmarks) {
  const leftEar = eyeAspectRatio(landmarks, EYE_INDICES.left);
  const rightEar = eyeAspectRatio(landmarks, EYE_INDICES.right);
  return (leftEar + rightEar) / 2;
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
    if (o === "DENIED_LIVENESS")  return { color: "var(--danger)", bg: "rgba(255,60,92,.08)",  icon: "!" };
    if (o === "DENIED_MISMATCH")  return { color: "#ffc46c",       bg: "rgba(255,196,108,.08)",icon: "✗" };
    if (o === "DENIED_AMBIGUOUS") return { color: "#ffc46c",       bg: "rgba(255,196,108,.08)",icon: "?" };
    if (o === "NO_FACE")          return { color: "var(--muted)",  bg: "rgba(72,96,126,.08)",  icon: "—" };
    return                               { color: "var(--muted)",  bg: "transparent",          icon: "·" };
  };

  const stats = {
    granted:  entries.filter(e => e.outcome === "GRANTED").length,
    mismatch: entries.filter(e => ["DENIED_MISMATCH", "DENIED_AMBIGUOUS", "DENIED_LIVENESS"].includes(e.outcome)).length,
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
        <span className="chip">Blink Liveness</span>
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
  const webcamRef = useRef(null);
  const autoScanStartedRef = useRef(false);
  const faceLandmarkerRef = useRef(null);
  const animationFrameRef = useRef(null);
  const blinkStateRef = useRef({
    closedFrames: 0,
    blinkCount: 0,
    openSamples: [],
    baselineEar: 0,
    eyesClosed: false,
  });
  const [camReady, setCamReady] = useState(false);
  const [phase, setPhase] = useState("ready");
  const [result, setResult] = useState(null);
  const [liveness, setLiveness] = useState({
    ready: false,
    passed: false,
    blinkCount: 0,
    message: "Loading blink detector…",
  });

  const updateLiveness = useCallback((patch) => {
    setLiveness((current) => {
      const next = { ...current, ...patch };
      if (
        current.ready === next.ready &&
        current.passed === next.passed &&
        current.blinkCount === next.blinkCount &&
        current.message === next.message
      ) {
        return current;
      }
      return next;
    });
  }, []);

  const resetBlinkTracking = useCallback((message = "Blink once to continue.") => {
    blinkStateRef.current = {
      closedFrames: 0,
      blinkCount: 0,
      openSamples: [],
      baselineEar: 0,
      eyesClosed: false,
    };
    updateLiveness({
      ready: !!faceLandmarkerRef.current,
      passed: false,
      blinkCount: 0,
      message: faceLandmarkerRef.current ? "Hold still while blink detection calibrates…" : "Loading blink detector…",
    });
  }, [updateLiveness]);

  const shoot = useCallback(async () => {
    if (!camReady || phase !== "ready" || !liveness.passed) return;
    setPhase("analyzing");
    setResult(null);

    // Wait a frame so the webcam has a fresh image after the countdown overlay disappears
    await new Promise((resolve) => setTimeout(resolve, 200));

    const shot = webcamRef.current?.getScreenshot({ width: 1280, height: 720 });
    if (!shot) {
      setPhase("fail");
      setResult({ message: "Camera capture failed" });
      return;
    }

    const fd = new FormData();
    // Send WITHOUT flipping — backend handles both orientations
    fd.append("file", b64ToBlob(shot), "face.jpg");
    fd.append("liveness_passed", "true");
    fd.append("blink_count", String(liveness.blinkCount || 1));

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
  }, [camReady, liveness.blinkCount, liveness.passed, onSuccess, phase]);

  useEffect(() => {
    let cancelled = false;

    async function initFaceLandmarker() {
      try {
        const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
        if (cancelled) return;

        const detector = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MEDIAPIPE_MODEL_URL },
          runningMode: "VIDEO",
          numFaces: 1,
        });

        if (cancelled) {
          detector.close();
          return;
        }

        faceLandmarkerRef.current = detector;
        resetBlinkTracking();
      } catch (error) {
        console.error("Failed to load blink detector", error);
        if (!cancelled) {
          updateLiveness({
            ready: false,
            passed: false,
            blinkCount: 0,
            message: "Blink detector unavailable. Check your connection and refresh.",
          });
        }
      }
    }

    initFaceLandmarker();

    return () => {
      cancelled = true;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      faceLandmarkerRef.current?.close();
      faceLandmarkerRef.current = null;
    };
  }, [resetBlinkTracking, updateLiveness]);

  useEffect(() => {
    if (!camReady || phase !== "ready" || liveness.passed || !faceLandmarkerRef.current) return undefined;

    const trackBlink = () => {
      const video = webcamRef.current?.video;
      const detector = faceLandmarkerRef.current;

      if (!video || !detector || video.readyState < 2) {
        animationFrameRef.current = requestAnimationFrame(trackBlink);
        return;
      }

      const detection = detector.detectForVideo(video, performance.now());
      const landmarks = detection.faceLandmarks?.[0];

      if (!landmarks) {
        blinkStateRef.current.closedFrames = 0;
        blinkStateRef.current.openSamples = [];
        blinkStateRef.current.baselineEar = 0;
        blinkStateRef.current.eyesClosed = false;
        updateLiveness({
          ready: true,
          passed: false,
          blinkCount: blinkStateRef.current.blinkCount,
          message: "Face not detected. Center your face in the frame.",
        });
        animationFrameRef.current = requestAnimationFrame(trackBlink);
        return;
      }

      const ear = averageEyeAspectRatio(landmarks);
      const blinkState = blinkStateRef.current;
      const samples = [...blinkState.openSamples, ear].slice(-BLINK_CALIBRATION_FRAMES);
      blinkState.openSamples = samples;

      if (samples.length < BLINK_CALIBRATION_FRAMES) {
        updateLiveness({
          ready: true,
          passed: false,
          blinkCount: blinkState.blinkCount,
          message: "Hold still while blink detection calibrates…",
        });
        animationFrameRef.current = requestAnimationFrame(trackBlink);
        return;
      }

      const baselineEar = Math.max(BLINK_MIN_BASELINE, Math.max(...samples));
      const closedThreshold = baselineEar * BLINK_CLOSED_RATIO;
      const openThreshold = baselineEar * BLINK_OPEN_RATIO;
      blinkState.baselineEar = baselineEar;

      if (ear <= closedThreshold) {
        blinkState.closedFrames += 1;
        blinkState.eyesClosed = true;
        updateLiveness({
          ready: true,
          passed: false,
          blinkCount: blinkState.blinkCount,
          message: "Blink detected. Open your eyes to continue.",
        });
      } else if (ear >= openThreshold) {
        if (blinkState.eyesClosed && blinkState.closedFrames >= BLINK_MIN_CLOSED_FRAMES) {
          blinkState.blinkCount += 1;
          blinkState.closedFrames = 0;
          blinkState.eyesClosed = false;
          updateLiveness({
            ready: true,
            passed: true,
            blinkCount: blinkState.blinkCount,
            message: "Liveness verified. Starting scan…",
          });
          return;
        }

        blinkState.closedFrames = 0;
        blinkState.eyesClosed = false;
        updateLiveness({
          ready: true,
          passed: false,
          blinkCount: blinkState.blinkCount,
          message: "Blink once to continue.",
        });
      } else {
        updateLiveness({
          ready: true,
          passed: false,
          blinkCount: blinkState.blinkCount,
          message: "Blink once to continue.",
        });
      }

      animationFrameRef.current = requestAnimationFrame(trackBlink);
    };

    animationFrameRef.current = requestAnimationFrame(trackBlink);

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };
  }, [camReady, liveness.passed, phase, updateLiveness]);

  useEffect(() => {
    if (!camReady || phase !== "ready" || !liveness.passed || autoScanStartedRef.current) return;
    const timeoutId = setTimeout(() => {
      autoScanStartedRef.current = true;
      shoot();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [camReady, liveness.passed, phase, shoot]);

  const retry = () => {
    autoScanStartedRef.current = false;
    setPhase("ready");
    setResult(null);
    resetBlinkTracking();
  };

  const overlayPhase = { ready: "idle", analyzing: "scanning", fail: "fail" }[phase] ?? "idle";

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
          {phase === "ready" && (camReady ? liveness.message : "Starting camera…")}
          {phase === "analyzing" && "Analyzing…"}
          {phase === "fail" && "Authentication failed"}
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
          style={{ transform: "scaleX(-1)" }}
          mirrored={false}
        />
        <ScanOverlay phase={overlayPhase} />

        {phase === "ready" && camReady && (
          <div className={`cam-badge live-badge ${liveness.passed ? "pass" : ""}`}>
            <span className={`pulse-dot ${liveness.passed ? "pass" : ""}`} />
            {liveness.message}
          </div>
        )}

        {phase === "analyzing" && (
          <div className="cam-badge scanning-badge">
            <span className="pulse-dot" /> Analyzing…
          </div>
        )}

        {phase === "fail" && (
          <Motion.div
            className="cam-badge fail-badge"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            ✗ Authentication failed
          </Motion.div>
        )}
      </div>

      <AnimatePresence mode="wait">
        {phase === "ready" && (
          <Motion.div
            key="scan-status"
            className="auth-btn auto-scan-status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {!camReady
              ? "Starting camera…"
              : !liveness.ready
                ? "Loading blink detector…"
                : liveness.passed
                  ? "Liveness verified. Starting scan…"
                  : "Blink once to continue…"}
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
            {result.reason === "DENIED_LIVENESS" && (
              <p className="detail-hint">
                A real blink is required before recognition starts. Keep your face centered and blink naturally once.
              </p>
            )}
            {result.all_scores && Object.keys(result.all_scores).length > 0 && (
              <div className="signals-block">
                <p className="sig-heading">Similarity per enrolled user</p>
                {Object.entries(result.all_scores)
                  .sort(([, a], [, b]) => b - a)
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
    setScreen("dashboard");
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
