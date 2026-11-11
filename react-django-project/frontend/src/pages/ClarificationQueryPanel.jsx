import { useState, useEffect, useRef } from "react";
import { api, baseURL } from "../services/api";
import { getDropdownOptions } from "../config/projectFieldsConfig";
import { useToast } from "../context/ToastContext";

const SCENARIOS = [
  "Code Leading Concept",
  "Conflictual Scenario",
  "Medication Concept",
  "Flag",
  "NVPS",
  "Format",
  "Others",
];

const PANEL_STYLES = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 9000,
    background: "rgba(0,0,0,0.55)",
    backdropFilter: "blur(4px)",
    display: "flex",
    justifyContent: "flex-end",
  },
  panel: (open) => ({
    width: "min(480px, 95vw)",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    background: "linear-gradient(165deg, #0f172a 0%, #1e1b4b 100%)",
    boxShadow: "-8px 0 40px rgba(0,0,0,0.6)",
    transform: open ? "translateX(0)" : "translateX(100%)",
    transition: "transform 0.35s cubic-bezier(0.4,0,0.2,1)",
    overflowY: "auto",
  }),
  header: {
    background: "linear-gradient(90deg, #7c3aed, #4f46e5)",
    padding: "18px 20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexShrink: 0,
  },
  headerTitle: {
    color: "#fff",
    fontWeight: 700,
    fontSize: 17,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  closeBtn: {
    background: "rgba(255,255,255,0.15)",
    border: "none",
    borderRadius: 8,
    color: "#fff",
    width: 32,
    height: 32,
    cursor: "pointer",
    fontSize: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.2s",
  },
  body: { padding: "20px 20px 16px", flex: 1 },
  label: {
    display: "block",
    color: "#a5b4fc",
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 5,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  input: {
    width: "100%",
    background: "rgba(255,255,255,0.07)",
    border: "1px solid rgba(167,139,250,0.3)",
    borderRadius: 8,
    color: "#e2e8f0",
    padding: "9px 12px",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
    transition: "border 0.2s",
  },
  select: {
    width: "100%",
    background: "#1e1b4b",
    border: "1px solid rgba(167,139,250,0.3)",
    borderRadius: 8,
    color: "#e2e8f0",
    padding: "9px 12px",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
    cursor: "pointer",
  },
  row: { display: "flex", gap: 10 },
  half: { flex: 1 },
  mb: { marginBottom: 14 },
  submitBtn: {
    width: "100%",
    padding: "11px",
    background: "linear-gradient(90deg, #7c3aed, #4f46e5)",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
    transition: "opacity 0.2s, transform 0.1s",
    marginTop: 6,
  },
  divider: {
    borderColor: "rgba(255,255,255,0.08)",
    margin: "20px 0 14px",
  },
  sectionTitle: {
    color: "#a78bfa",
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  prevCard: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(167,139,250,0.2)",
    borderRadius: 8,
    padding: "10px 12px",
    marginBottom: 8,
  },
  badge: (status) => ({
    display: "inline-block",
    padding: "2px 9px",
    borderRadius: 20,
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    background:
      status === "pending"
        ? "rgba(245,158,11,0.2)"
        : status === "responded"
        ? "rgba(99,102,241,0.25)"
        : "rgba(16,185,129,0.2)",
    color:
      status === "pending"
        ? "#fbbf24"
        : status === "responded"
        ? "#818cf8"
        : "#34d399",
    border: `1px solid ${
      status === "pending"
        ? "rgba(251,191,36,0.4)"
        : status === "responded"
        ? "rgba(129,140,248,0.4)"
        : "rgba(52,211,153,0.4)"
    }`,
  }),
};

export default function ClarificationQueryPanel({ open, onClose, chartId, project, subproject, chart }) {
  const [form, setForm] = useState({
    dx_location: "",
    doubt_page_from: "",
    doubt_page_to: "",
    doubt_scenario: "",
    description: "",
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [prevQueries, setPrevQueries] = useState([]);
  const fileRef = useRef();
  const toast = useToast();

  // Load previous queries for this chart
  useEffect(() => {
    if (open && chartId) {
      api.get("/api/clarification/").then((res) => {
        const all = res.data.requests || [];
        // Filter to just this chart
        setPrevQueries(all.filter((q) => q.chart_id === chartId));
      }).catch(() => {});
    }
  }, [open, chartId]);

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleSubmit = async () => {
    if (!form.doubt_scenario || !form.description.trim()) {
      toast("Please fill Doubt Scenario and Description.", "warning");
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("chart_id", chartId);
      fd.append("project", project || chart?.project || "");
      fd.append("subproject", subproject || chart?.subproject || "");
      fd.append("dx_location", form.dx_location);
      fd.append("doubt_page_from", form.doubt_page_from);
      fd.append("doubt_page_to", form.doubt_page_to);
      fd.append("doubt_scenario", form.doubt_scenario);
      fd.append("description", form.description);
      if (imageFile) fd.append("image", imageFile);

      await api.post("/api/clarification/", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setSuccess(true);
      toast("Query submitted successfully! Your TL/SME will be notified.", "success");
      setForm({ dx_location: "", doubt_page_from: "", doubt_page_to: "", doubt_scenario: "", description: "" });
      setImageFile(null);
      setImagePreview(null);
      // Refresh previous queries
      const res = await api.get("/api/clarification/");
      const all = res.data.requests || [];
      setPrevQueries(all.filter((q) => q.chart_id === chartId));
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      toast("Failed to submit: " + (err.response?.data?.error || err.message), "error");
    } finally {
      setSubmitting(false);
    }
  };

  const dxLocationOpts = getDropdownOptions(project, subproject, "dx_location");

  if (!open) return null;

  return (
    <div style={PANEL_STYLES.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={PANEL_STYLES.panel(open)}>
        {/* Header */}
        <div style={PANEL_STYLES.header}>
          <div style={PANEL_STYLES.headerTitle}>
            <span style={{ fontSize: 20 }}>💬</span>
            Clarification Query
          </div>
          <button style={PANEL_STYLES.closeBtn} onClick={onClose} title="Close">✕</button>
        </div>

        {/* Chart meta strip */}
        <div style={{ background: "rgba(124,58,237,0.15)", padding: "8px 20px", borderBottom: "1px solid rgba(124,58,237,0.2)", display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span style={{ color: "#c4b5fd", fontSize: 12 }}>
            <strong style={{ color: "#a78bfa" }}>Chart ID:</strong> {chartId}
          </span>
          {project && <span style={{ color: "#c4b5fd", fontSize: 12 }}><strong style={{ color: "#a78bfa" }}>Project:</strong> {project}</span>}
          {subproject && <span style={{ color: "#c4b5fd", fontSize: 12 }}><strong style={{ color: "#a78bfa" }}>Sub:</strong> {subproject}</span>}
        </div>

        {/* Body */}
        <div style={PANEL_STYLES.body}>
          {success && (
            <div style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(52,211,153,0.4)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, color: "#34d399", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
              ✅ Query raised successfully!
            </div>
          )}

          {/* DX Location */}
          <div style={PANEL_STYLES.mb}>
            <label style={PANEL_STYLES.label}>Dx Location</label>
            <select
              style={PANEL_STYLES.select}
              value={form.dx_location}
              onChange={(e) => setForm((s) => ({ ...s, dx_location: e.target.value }))}
            >
              <option value="">-- Select --</option>
              {dxLocationOpts.length > 0
                ? dxLocationOpts.map((o) => <option key={o} value={o}>{o}</option>)
                : ["Office Note", "Hospital Record", "Lab Report", "Discharge Summary", "Other"].map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
            </select>
          </div>

          {/* Page range */}
          <div style={{ ...PANEL_STYLES.mb }}>
            <label style={PANEL_STYLES.label}>Doubt Page Number</label>
            <div style={PANEL_STYLES.row}>
              <div style={PANEL_STYLES.half}>
                <input
                  type="number"
                  style={PANEL_STYLES.input}
                  placeholder="From page"
                  value={form.doubt_page_from}
                  onChange={(e) => setForm((s) => ({ ...s, doubt_page_from: e.target.value }))}
                />
              </div>
              <div style={PANEL_STYLES.half}>
                <input
                  type="number"
                  style={PANEL_STYLES.input}
                  placeholder="To page"
                  value={form.doubt_page_to}
                  onChange={(e) => setForm((s) => ({ ...s, doubt_page_to: e.target.value }))}
                />
              </div>
            </div>
          </div>

          {/* Doubt scenario */}
          <div style={PANEL_STYLES.mb}>
            <label style={PANEL_STYLES.label}>Doubt Scenario <span style={{ color: "#f87171" }}>*</span></label>
            <select
              style={PANEL_STYLES.select}
              value={form.doubt_scenario}
              onChange={(e) => setForm((s) => ({ ...s, doubt_scenario: e.target.value }))}
            >
              <option value="">-- Select scenario --</option>
              {SCENARIOS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Description */}
          <div style={PANEL_STYLES.mb}>
            <label style={PANEL_STYLES.label}>Description <span style={{ color: "#f87171" }}>*</span></label>
            <textarea
              style={{ ...PANEL_STYLES.input, minHeight: 90, resize: "vertical" }}
              placeholder="Describe your doubt clearly..."
              value={form.description}
              onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
            />
          </div>

          {/* Image upload */}
          <div style={PANEL_STYLES.mb}>
            <label style={PANEL_STYLES.label}>Image (optional)</label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleImageChange}
            />
            <button
              type="button"
              style={{ ...PANEL_STYLES.input, cursor: "pointer", textAlign: "left", color: "#a5b4fc" }}
              onClick={() => fileRef.current.click()}
            >
              {imageFile ? `📎 ${imageFile.name}` : "Click to upload image..."}
            </button>
            {imagePreview && (
              <div style={{ marginTop: 8, position: "relative" }}>
                <img src={imagePreview} alt="preview" style={{ width: "100%", borderRadius: 8, maxHeight: 160, objectFit: "cover", border: "1px solid rgba(167,139,250,0.3)" }} />
                <button onClick={() => { setImageFile(null); setImagePreview(null); }} style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.6)", border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", padding: "2px 7px", fontSize: 12 }}>✕</button>
              </div>
            )}
          </div>

          {/* Submit */}
          <button
            style={{ ...PANEL_STYLES.submitBtn, opacity: submitting ? 0.7 : 1 }}
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? "Raising Query..." : "🚀 Raise Clarification Query"}
          </button>

          {/* Previous queries for this chart */}
          {prevQueries.length > 0 && (
            <>
              <hr style={PANEL_STYLES.divider} />
              <div style={PANEL_STYLES.sectionTitle}>Previous Queries — This Chart</div>
              {prevQueries.map((q) => (
                <div key={q.id} style={PANEL_STYLES.prevCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ color: "#c4b5fd", fontSize: 12, fontWeight: 600 }}>{q.doubt_scenario}</span>
                    <span style={PANEL_STYLES.badge(q.status)}>{q.status}</span>
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 4 }}>{q.description}</div>
                  <div style={{ color: "#64748b", fontSize: 11 }}>
                    {q.raised_at} · Pages {q.doubt_page_from}–{q.doubt_page_to}
                  </div>
                  {q.responses && q.responses.length > 0 && (
                    <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 6 }}>
                      {q.responses.map((r) => (
                        <div key={r.id} style={{ background: "rgba(99,102,241,0.1)", borderRadius: 6, padding: "6px 10px", marginTop: 5 }}>
                          <div style={{ color: "#a5b4fc", fontSize: 11, fontWeight: 600 }}>{r.responded_by_name} · {r.responded_at}</div>
                          <div style={{ color: "#cbd5e1", fontSize: 12, marginTop: 2 }}>{r.response_text}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
