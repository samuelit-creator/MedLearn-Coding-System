import { createContext, useContext, useState, useCallback, useRef } from "react";

/* ─── Context ─────────────────────────────────────────────── */
const ToastContext = createContext(null);

/* ─── Severity config ─────────────────────────────────────── */
const SEVERITY = {
  success: { bg: "#10b981", border: "#059669", icon: "✓" },
  error:   { bg: "#ef4444", border: "#dc2626", icon: "✕" },
  warning: { bg: "#f59e0b", border: "#d97706", icon: "⚠" },
  info:    { bg: "#6366f1", border: "#4f46e5", icon: "💬" },
};

/* ─── Provider ────────────────────────────────────────────── */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const showToast = useCallback((message, severity = "success", duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, severity }]);
    timers.current[id] = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      delete timers.current[id];
    }, duration);
  }, []);

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}

      {/* ─── Toast Stack ─── */}
      <div style={{
        position: "fixed",
        bottom: 28,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 99999,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        alignItems: "center",
        pointerEvents: "none",
      }}>
        {toasts.map((t) => {
          const cfg = SEVERITY[t.severity] || SEVERITY.info;
          return (
            <div
              key={t.id}
              onClick={() => dismiss(t.id)}
              style={{
                pointerEvents: "auto",
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: cfg.bg,
                border: `1px solid ${cfg.border}`,
                color: "#fff",
                padding: "12px 18px 12px 14px",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "'Inter', 'Segoe UI', sans-serif",
                boxShadow: "0 8px 28px rgba(0,0,0,0.22)",
                minWidth: 270,
                maxWidth: 420,
                cursor: "pointer",
                animation: "toastSlideUp 0.3s cubic-bezier(0.4,0,0.2,1)",
                userSelect: "none",
              }}
            >
              <span style={{ fontSize: 17, flexShrink: 0 }}>{cfg.icon}</span>
              <span style={{ flex: 1, lineHeight: 1.4 }}>{t.message}</span>
              <span style={{
                opacity: 0.75, fontSize: 18, marginLeft: 8,
                fontWeight: 400, lineHeight: 1,
              }}>×</span>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes toastSlideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

/* ─── Hook ────────────────────────────────────────────────── */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
