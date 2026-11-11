import { useEffect, useState, useCallback, useRef } from "react";
import { api, baseURL } from "../services/api";
import { useToast } from "../context/ToastContext";
import * as XLSX from "xlsx";

/* ─── Constants ─────────────────────────────────────────── */
const STATUS_META = {
  pending: { label: "Pending", bg: "rgba(245,158,11,0.15)", color: "#fbbf24", border: "rgba(251,191,36,0.35)" },
  responded: { label: "Responded", bg: "rgba(99,102,241,0.15)", color: "#818cf8", border: "rgba(129,140,248,0.35)" },
  closed: { label: "Closed", bg: "rgba(16,185,129,0.12)", color: "#34d399", border: "rgba(52,211,153,0.35)" },
};

/* ─── Tiny helpers ───────────────────────────────────────── */
function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.pending;
  return (
    <span style={{
      display: "inline-block", padding: "3px 11px", borderRadius: 20, fontSize: 11,
      fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5,
      background: m.bg, color: m.color, border: `1px solid ${m.border}`,
    }}>
      {m.label}
    </span>
  );
}

function ResponseThread({ responses }) {
  if (!responses || responses.length === 0)
    return <p style={{ color: "#64748b", fontStyle: "italic", fontSize: 13 }}>No responses yet.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {responses.map((r) => (
        <div key={r.id} style={{
          background: "rgba(99,102,241,0.08)", border: "1px solid rgba(129,140,248,0.2)",
          borderRadius: 10, padding: "10px 14px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#7c3aed,#4f46e5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 11, fontWeight: 700,
            }}>
              {(r.responded_by_name || "?").charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ color: "#a5b4fc", fontSize: 12, fontWeight: 700 }}>{r.responded_by_name}</div>
              <div style={{ color: "#475569", fontSize: 11 }}>{r.responded_at}</div>
            </div>
          </div>
          <div style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.5 }}>{r.response_text}</div>
        </div>
      ))}
    </div>
  );
}

/* ─── Responder Action Modal ─────────────────────────────── */
function ActionModal({ requestId, onClose, onResponded }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [responseText, setResponseText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setLoading(true);
    api.get(`/api/clarification/${requestId}/`).then((res) => {
      setDetail(res.data.request);
    }).catch(() => { }).finally(() => setLoading(false));
  }, [requestId]);

  const handleRespond = async () => {
    if (!responseText.trim()) { toast("Please enter a response.", "warning"); return; }
    setSubmitting(true);
    try {
      await api.post(`/api/clarification/${requestId}/`, { response_text: responseText });
      toast("Response sent successfully! ✅", "success");
      onResponded?.();   // refresh the portal list
      onClose();         // close modal → back to portal initial view
    } catch (err) {
      toast("Failed: " + (err.response?.data?.error || err.message), "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "stretch",
    }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        display: "flex", width: "100%", height: "100%",
        background: "#0f172a",
        animation: "slideUp 0.25s ease",
      }}>
        {/* LEFT — PDF Viewer */}
        <div style={{
          flex: "0 0 60%", background: "#0a0f1e",
          borderRight: "1px solid rgba(124,58,237,0.25)",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{
            background: "linear-gradient(90deg,#1e1b4b,#0f172a)",
            padding: "12px 18px", display: "flex", alignItems: "center", gap: 10,
            borderBottom: "1px solid rgba(124,58,237,0.2)",
          }}>
            <span style={{ fontSize: 18 }}>📄</span>
            <span style={{ color: "#a5b4fc", fontWeight: 700, fontSize: 14 }}>
              Chart PDF — {detail?.chart_id || "Loading…"}
            </span>
          </div>
          {loading ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569" }}>
              Loading PDF…
            </div>
          ) : detail?.pdf_path ? (
            <iframe
              title="chart-pdf"
              src={`${baseURL}/media/${detail.pdf_path}`}
              style={{ flex: 1, border: "none" }}
            />
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 13 }}>
              PDF not available for this chart
            </div>
          )}
        </div>

        {/* RIGHT — Request Detail + Respond */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto" }}>
          {/* Modal Header */}
          <div style={{
            background: "linear-gradient(90deg,#7c3aed,#4f46e5)",
            padding: "14px 20px", display: "flex", alignItems: "center",
            justifyContent: "space-between", flexShrink: 0,
          }}>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
              💬 Clarification Detail
            </div>
            <button onClick={onClose} style={{
              background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 8,
              color: "#fff", width: 30, height: 30, cursor: "pointer", fontSize: 16,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>✕</button>
          </div>

          {loading ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
              Loading…
            </div>
          ) : detail ? (
            <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>
              {/* Meta grid */}
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px",
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(124,58,237,0.2)",
                borderRadius: 12, padding: "14px 16px",
              }}>
                {[
                  ["Chart ID", detail.chart_id],
                  ["Project", detail.project],
                  ["Sub Project", detail.subproject],
                  ["Dx Location", detail.dx_location],
                  ["Page Range", `${detail.doubt_page_from || "—"} → ${detail.doubt_page_to || "—"}`],
                  ["Scenario", detail.doubt_scenario],
                  ["Raised By", detail.raised_by_name],
                  ["Date & Time", detail.raised_at],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ color: "#64748b", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{k}</div>
                    <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 500, marginTop: 2 }}>{v || "—"}</div>
                  </div>
                ))}
                <div style={{ gridColumn: "1/-1" }}>
                  <div style={{ color: "#64748b", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Status</div>
                  <div style={{ marginTop: 4 }}><StatusBadge status={detail.status} /></div>
                </div>
              </div>

              {/* Description */}
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(124,58,237,0.15)", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ color: "#a78bfa", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>Description</div>
                <div style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.6 }}>{detail.description}</div>
              </div>

              {/* Image */}
              {detail.image_path && (
                <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(124,58,237,0.15)", borderRadius: 10, padding: 10 }}>
                  <div style={{ color: "#a78bfa", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>Attached Image</div>
                  <img
                    src={`${baseURL}/media/${detail.image_path}`}
                    alt="attachment"
                    style={{ width: "100%", borderRadius: 8, border: "1px solid rgba(124,58,237,0.25)" }}
                  />
                </div>
              )}

              {/* Response thread */}
              <div>
                <div style={{ color: "#a78bfa", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>
                  Responses ({detail.responses?.length || 0})
                </div>
                <ResponseThread responses={detail.responses} />
              </div>

              {/* Add response */}
              <div style={{
                background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.25)",
                borderRadius: 12, padding: "14px 16px", marginTop: "auto",
              }}>
                <div style={{ color: "#a78bfa", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>
                  Add Response
                </div>
                <textarea
                  rows={4}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(167,139,250,0.3)",
                    borderRadius: 8, color: "#e2e8f0", padding: "9px 12px", fontSize: 13,
                    outline: "none", resize: "vertical",
                  }}
                  placeholder="Type your response here…"
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                />
                <button
                  onClick={handleRespond}
                  disabled={submitting}
                  style={{
                    marginTop: 10, padding: "10px 22px",
                    background: "linear-gradient(90deg,#7c3aed,#4f46e5)",
                    color: "#fff", border: "none", borderRadius: 8,
                    fontWeight: 700, fontSize: 13, cursor: "pointer",
                    opacity: submitting ? 0.7 : 1,
                  }}
                >
                  {submitting ? "Sending…" : "✉️ Send Response"}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
              Request not found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────── */
export default function ClarificationPortal() {
  const role = localStorage.getItem("role")?.trim() || "";
  const isCoder = role === "Coder";

  const [requests, setRequests] = useState([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [filterTL, setFilterTL] = useState("all");
  const [filterResponder, setFilterResponder] = useState("all");
  const [filterScenario, setFilterScenario] = useState("all");
  const [expandedRow, setExpandedRow] = useState(null);
  const [actionId, setActionId] = useState(null);
  const toast = useToast();

  /* ─── Export to Excel ─── */
  const exportToExcel = () => {
    if (filtered.length === 0) {
      toast("No data to export.", "warning");
      return;
    }

    // Find the maximum number of responses across all rows
    const maxResponses = Math.max(0, ...filtered.map((req) => (req.responses || []).length));

    const rows = filtered.map((req, idx) => {
      const responses = req.responses || [];

      // Base columns (common for all roles)
      const row = {
        "#": idx + 1,
        "Date & Time": req.raised_at || "",
        "Chart ID": req.chart_id || "",
        "Project": req.project || "",
        "Sub Project": req.subproject || "",
        "DX Location": req.dx_location || "",
        "Scenario": req.doubt_scenario || "",
        "Description": req.description || "",
        "Status": req.status ? req.status.charAt(0).toUpperCase() + req.status.slice(1) : "",
      };

      // Role-specific columns
      if (!isCoder) {
        row["Raised By"] = req.raised_by_name || "";
        row["Team Lead"] = req.tl_name || "";
        row["Page From"] = req.doubt_page_from || "";
        row["Page To"] = req.doubt_page_to || "";
      } else {
        row["Page From"] = req.doubt_page_from || "";
        row["Page To"] = req.doubt_page_to || "";
      }

      // Separate columns for each response
      for (let i = 0; i < maxResponses; i++) {
        const r = responses[i];
        const n = i + 1;
        row[`Response ${n}`] = r ? r.response_text || "" : "";
        row[`Responder Name ${n}`] = r ? r.responded_by_name || "" : "";
        row[`Employee ID ${n}`] = r ? (r.responded_by || "") : "";
        row[`Response Time ${n}`] = r ? r.responded_at || "" : "";
      }

      return row;
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clarification Portal");

    // Auto column widths
    const colWidths = Object.keys(rows[0] || {}).map((key) => ({
      wch: Math.max(
        key.length,
        ...rows.map((r) => String(r[key] ?? "").length)
      ),
    }));
    ws["!cols"] = colWidths;

    const fileName = `Clarification_Portal_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    toast(`✅ Exported ${filtered.length} row(s) to Excel.`, "success");
  };

  // Tracks previous request state to detect status transitions
  const prevRequestsRef = useRef([]);

  // Compare new vs previous requests and notify on status changes
  const checkForNewResponses = useCallback((newRequests) => {
    const prev = prevRequestsRef.current;
    if (prev.length === 0) {
      // First load — just store, don't notify (avoids spam on login)
      prevRequestsRef.current = newRequests;
      return;
    }
    if (isCoder) {
      // Coder: notify when their request gets a response
      newRequests.forEach((newReq) => {
        const prevReq = prev.find((r) => r.id === newReq.id);
        if (prevReq && prevReq.status === "pending" && newReq.status === "responded") {
          toast(`💬 New response received for Chart: ${newReq.chart_id}!`, "info", 6000);
        }
      });
    } else {
      // SME/TL/Manager: notify when a new pending request appears
      newRequests.forEach((newReq) => {
        const existed = prev.find((r) => r.id === newReq.id);
        if (!existed && newReq.status === "pending") {
          toast(`📬 New clarification request from ${newReq.raised_by_name} — Chart: ${newReq.chart_id}`, "info", 6000);
        }
      });
    }
    prevRequestsRef.current = newRequests;
  }, [isCoder, toast]);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/api/clarification/").then((res) => {
      const newRequests = res.data.requests || [];
      checkForNewResponses(newRequests);
      setRequests(newRequests);
      setCurrentUserId(res.data.current_user_id || "");
    }).catch(() => { }).finally(() => setLoading(false));
  }, [checkForNewResponses]);

  useEffect(() => { load(); }, [load]);

  // Background silent poll every 60s to detect new responses
  useEffect(() => {
    const silentPoll = () => {
      api.get("/api/clarification/")
        .then((res) => {
          const newRequests = res.data.requests || [];
          checkForNewResponses(newRequests);
          setRequests(newRequests);
        })
        .catch(() => {});
    };
    const interval = setInterval(silentPoll, 60000);
    return () => clearInterval(interval);
  }, [checkForNewResponses]);

  // Derive unique TLs from loaded data
  const uniqueTLs = Array.from(
    new Map(requests.filter((r) => r.tl_name).map((r) => [r.tl_employee_id, r.tl_name])).entries()
  ).map(([id, name]) => ({ id, name }));

  // Derive unique responder names from all responses across all requests
  const uniqueResponders = Array.from(
    new Set(
      requests.flatMap((r) => (r.responses || []).map((res) => res.responded_by_name).filter(Boolean))
    )
  ).sort();

  // Derive unique scenario types from all requests
  const uniqueScenarios = Array.from(
    new Set(requests.map((r) => r.doubt_scenario).filter(Boolean))
  ).sort();

  const filtered = requests.filter((r) => {
    const matchStatus = filterStatus === "all" || r.status === filterStatus;
    const q = search.toLowerCase();
    const matchSearch = !q || [r.chart_id, r.project, r.subproject, r.doubt_scenario, r.description, r.raised_by_name]
      .some((f) => (f || "").toLowerCase().includes(q));
    // Date filters — compare only the date portion of raised_at ("YYYY-MM-DD HH:mm:ss")
    const raisedDate = r.raised_at ? r.raised_at.substring(0, 10) : "";
    const matchFrom = !fromDate || raisedDate >= fromDate;
    const matchTo = !toDate || raisedDate <= toDate;
    // TL filter
    const matchTL = filterTL === "all" || r.tl_employee_id === filterTL;
    // Responder filter — match if any response was made by the selected person
    const matchResponder = filterResponder === "all" ||
      (r.responses || []).some((res) => res.responded_by_name === filterResponder);
    // Scenario type filter
    const matchScenario = filterScenario === "all" || r.doubt_scenario === filterScenario;
    return matchStatus && matchSearch && matchFrom && matchTo && matchTL && matchResponder && matchScenario;
  });

  /* ─── Styles ─── */
  const S = {
    page: {
      minHeight: "100vh",
      background: "linear-gradient(160deg,#0f172a 0%,#1e1b4b 100%)",
      padding: "28px 24px",
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
    },
    header: {
      display: "flex", alignItems: "flex-start", justifyContent: "space-between",
      flexWrap: "wrap", gap: 14, marginBottom: 24,
    },
    title: { color: "#e2e8f0", fontSize: 22, fontWeight: 800, letterSpacing: -0.5 },
    subtitle: { color: "#64748b", fontSize: 13, marginTop: 4 },
    pill: (active) => ({
      padding: "6px 16px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
      border: active ? "none" : "1px solid rgba(255,255,255,0.1)",
      background: active ? "linear-gradient(90deg,#7c3aed,#4f46e5)" : "rgba(255,255,255,0.04)",
      color: active ? "#fff" : "#94a3b8",
      transition: "all 0.2s",
    }),
    searchBar: {
      flex: 1, maxWidth: 320,
      background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 8, color: "#e2e8f0", padding: "8px 12px", fontSize: 13, outline: "none",
      boxSizing: "border-box",
    },
    card: {
      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 14, overflow: "hidden",
    },
    th: {
      padding: "12px 14px", background: "rgba(124,58,237,0.12)",
      color: "#a78bfa", fontSize: 11, fontWeight: 700, textTransform: "uppercase",
      letterSpacing: 0.7, whiteSpace: "nowrap", textAlign: "left",
    },
    td: {
      padding: "11px 14px", color: "#cbd5e1", fontSize: 13,
      borderTop: "1px solid rgba(255,255,255,0.05)", verticalAlign: "middle",
    },
    trHover: {
      transition: "background 0.15s",
      cursor: "pointer",
    },
    expandBtn: {
      background: "none", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 6,
      color: "#a5b4fc", padding: "3px 8px", cursor: "pointer", fontSize: 12,
      transition: "all 0.15s",
    },
    actionBtn: {
      background: "linear-gradient(90deg,#7c3aed,#4f46e5)",
      border: "none", borderRadius: 7, color: "#fff",
      padding: "5px 13px", cursor: "pointer", fontWeight: 600, fontSize: 12,
      display: "flex", alignItems: "center", gap: 5,
      transition: "opacity 0.15s",
    },
    emptyState: {
      textAlign: "center", padding: "60px 20px",
      color: "#475569",
    },
  };

  const coderCols = ["#", "Date & Time", "Chart ID", "Project", "Sub Project", "Dx Location", "Pages", "Scenario", "Description", "Status", "Responses"];
  const responderCols = ["#", "Date & Time", "Chart ID", "Project", "Sub Project", "Raised By", "Scenario", "Status", "Responses", "Action"];

  const cols = isCoder ? coderCols : responderCols;

  return (
    <div style={S.page}>
      {/* Page Header */}
      <div style={S.header}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: "linear-gradient(135deg,#7c3aed,#4f46e5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20,
            }}>💬</div>
            <div>
              <div style={S.title}>Clarification Portal</div>
              <div style={S.subtitle}>
                {isCoder ? "Track your doubt queries and view responses from SME / TL" : "Review and respond to coder clarification queries"}
              </div>
            </div>
          </div>
        </div>

        {/* Filters row 1 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <input
            type="text"
            style={S.searchBar}
            placeholder="🔍  Search by chart, project, scenario…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {["all", "pending", "responded", "closed"].map((s) => (
            <button key={s} style={S.pill(filterStatus === s)} onClick={() => setFilterStatus(s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
          <button
            onClick={load}
            style={{
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8, color: "#94a3b8", padding: "7px 12px", cursor: "pointer", fontSize: 13,
            }}
            title="Refresh"
          >⟳</button>

          {/* Export Excel */}
          <button
            onClick={exportToExcel}
            title={`Export ${filtered.length} row(s) to Excel`}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "linear-gradient(135deg, #16a34a, #15803d)",
              border: "1px solid rgba(22,163,74,0.4)",
              borderRadius: 8, color: "#fff",
              padding: "7px 14px", cursor: "pointer",
              fontSize: 12, fontWeight: 700,
              boxShadow: "0 2px 8px rgba(22,163,74,0.25)",
              transition: "opacity 0.2s, transform 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; e.currentTarget.style.transform = "scale(1.03)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "scale(1)"; }}
          >
            <span style={{ fontSize: 15 }}>📥</span>
            Export Excel
            {filtered.length > 0 && (
              <span style={{
                background: "rgba(255,255,255,0.2)", borderRadius: 10,
                padding: "1px 7px", fontSize: 11, fontWeight: 800,
              }}>
                {filtered.length}
              </span>
            )}
          </button>
        </div>

        {/* Filters row 2 — Date range & Team Lead */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              style={{
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 8, color: "#e2e8f0", padding: "6px 10px", fontSize: 12,
                outline: "none", cursor: "pointer",
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              style={{
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 8, color: "#e2e8f0", padding: "6px 10px", fontSize: 12,
                outline: "none", cursor: "pointer",
              }}
            />
          </div>
          {uniqueTLs.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label style={{ color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>Team Lead</label>
              <select
                value={filterTL}
                onChange={(e) => setFilterTL(e.target.value)}
                style={{
                  background: "#1e1b4b", border: "1px solid rgba(167,139,250,0.3)",
                  borderRadius: 8, color: "#e2e8f0", padding: "6px 10px",
                  fontSize: 12, outline: "none", cursor: "pointer",
                }}
              >
                <option value="all">All TLs</option>
                {uniqueTLs.map((tl) => (
                  <option key={tl.id} value={tl.id}>{tl.name}</option>
                ))}
              </select>
            </div>
          )}
          {/* Responder filter */}
          {uniqueResponders.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label style={{ color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>Response Person</label>
              <select
                value={filterResponder}
                onChange={(e) => setFilterResponder(e.target.value)}
                style={{
                  background: "#1e1b4b", border: "1px solid rgba(167,139,250,0.3)",
                  borderRadius: 8, color: "#e2e8f0", padding: "6px 10px",
                  fontSize: 12, outline: "none", cursor: "pointer",
                }}
              >
                <option value="all">All Responders</option>
                {uniqueResponders.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Scenario type filter */}
          {uniqueScenarios.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label style={{ color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>Scenario Type</label>
              <select
                value={filterScenario}
                onChange={(e) => setFilterScenario(e.target.value)}
                style={{
                  background: "#1e1b4b", border: "1px solid rgba(167,139,250,0.3)",
                  borderRadius: 8, color: "#e2e8f0", padding: "6px 10px",
                  fontSize: 12, outline: "none", cursor: "pointer",
                }}
              >
                <option value="all">All Scenarios</option>
                {uniqueScenarios.map((sc) => (
                  <option key={sc} value={sc}>{sc}</option>
                ))}
              </select>
            </div>
          )}

          {(fromDate || toDate || filterTL !== "all" || filterResponder !== "all" || filterScenario !== "all") && (
            <button
              onClick={() => { setFromDate(""); setToDate(""); setFilterTL("all"); setFilterResponder("all"); setFilterScenario("all"); }}
              style={{
                background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)",
                borderRadius: 8, color: "#f87171", padding: "6px 12px",
                cursor: "pointer", fontSize: 12, fontWeight: 600,
              }}
            >
              ✕ Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Stats strip */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "Total", count: requests.length, color: "#818cf8" },
          { label: "Pending", count: requests.filter((r) => r.status === "pending").length, color: "#fbbf24" },
          { label: "Responded", count: requests.filter((r) => r.status === "responded").length, color: "#6366f1" },
          { label: "Closed", count: requests.filter((r) => r.status === "closed").length, color: "#34d399" },
        ].map(({ label, count, color }) => (
          <div key={label} style={{
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10, padding: "10px 18px", display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{ color, fontSize: 22, fontWeight: 800 }}>{count}</div>
            <div style={{ color: "#64748b", fontSize: 12, fontWeight: 600 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={S.card}>
        {loading ? (
          <div style={S.emptyState}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
            <div>Loading clarification requests…</div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={S.emptyState}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
            <div style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 6 }}>No queries found</div>
            <div style={{ fontSize: 13 }}>
              {isCoder ? "Raise a query from any chart using the Query button." : "No pending clarification requests yet."}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
              <thead>
                <tr>
                  {cols.map((c) => <th key={c} style={S.th}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map((req, idx) => (
                  <>
                    <tr
                      key={req.id}
                      style={{ ...S.trHover, background: expandedRow === req.id ? "rgba(124,58,237,0.06)" : "transparent" }}
                      onClick={() => setExpandedRow(expandedRow === req.id ? null : req.id)}
                    >
                      <td style={{ ...S.td, color: "#475569", fontWeight: 600 }}>{idx + 1}</td>
                      <td style={{ ...S.td, fontSize: 11, whiteSpace: "nowrap" }}>{req.raised_at}</td>
                      <td style={{ ...S.td, color: "#a5b4fc", fontWeight: 600, whiteSpace: "nowrap" }}>{req.chart_id}</td>
                      <td style={S.td}>{req.project}</td>
                      <td style={S.td}>{req.subproject}</td>
                      {isCoder ? (
                        <td style={S.td}>{req.dx_location || "—"}</td>
                      ) : (
                        <td style={{ ...S.td, fontWeight: 500, color: "#e2e8f0" }}>{req.raised_by_name}</td>
                      )}
                      {isCoder && (
                        <td style={{ ...S.td, whiteSpace: "nowrap" }}>{req.doubt_page_from}–{req.doubt_page_to}</td>
                      )}
                      <td style={{ ...S.td }}>
                        <span style={{
                          display: "inline-block",
                          background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)",
                          borderRadius: 6, padding: "2px 8px", fontSize: 11, color: "#c4b5fd", fontWeight: 600,
                        }}>
                          {req.doubt_scenario}
                        </span>
                      </td>
                      {isCoder && (
                        <td style={{ ...S.td, maxWidth: 200 }}>
                          <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                            {req.description}
                          </span>
                        </td>
                      )}
                      <td style={S.td}><StatusBadge status={req.status} /></td>
                      <td style={S.td} onClick={(e) => e.stopPropagation()}>
                        <button
                          style={S.expandBtn}
                          onClick={() => setExpandedRow(expandedRow === req.id ? null : req.id)}
                        >
                          {req.responses?.length || 0} {expandedRow === req.id ? "▲" : "▼"}
                        </button>
                      </td>
                      {!isCoder && (
                        <td style={S.td} onClick={(e) => e.stopPropagation()}>
                          {/* Hide Action button if the current user is the one who raised the request */}
                          {req.raised_by !== currentUserId ? (
                            <button
                              style={S.actionBtn}
                              onClick={() => setActionId(req.id)}
                            >
                              ✍️ Respond
                            </button>
                          ) : (
                            <span style={{ color: "#475569", fontSize: 12, fontStyle: "italic" }}>Own query</span>
                          )}
                        </td>
                      )}
                    </tr>

                    {/* Expanded responses row */}
                    {expandedRow === req.id && (
                      <tr key={`exp-${req.id}`}>
                        <td colSpan={cols.length} style={{ padding: "0 14px 14px", background: "rgba(30,27,75,0.4)" }}>
                          {/* Full details card */}
                          <div style={{
                            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
                            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(124,58,237,0.15)",
                            borderRadius: 10, padding: "14px 16px", marginBottom: 12, marginTop: 8,
                          }}>
                            {[
                              ["Chart ID", req.chart_id],
                              ["Project", req.project],
                              ["Sub Project", req.subproject],
                              ["Dx Location", req.dx_location],
                              ["Page Range", `${req.doubt_page_from || "—"} → ${req.doubt_page_to || "—"}`],
                              ["Scenario", req.doubt_scenario],
                              ["Raised By", req.raised_by_name],
                              ["Date & Time", req.raised_at],
                            ].map(([k, v]) => (
                              <div key={k}>
                                <div style={{ color: "#475569", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{k}</div>
                                <div style={{ color: "#e2e8f0", fontSize: 13, marginTop: 2 }}>{v || "—"}</div>
                              </div>
                            ))}
                            <div style={{ gridColumn: "1/-1" }}>
                              <div style={{ color: "#475569", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Description</div>
                              <div style={{ color: "#cbd5e1", fontSize: 13, marginTop: 2, lineHeight: 1.5 }}>{req.description}</div>
                            </div>
                            {req.image_path && (
                              <div style={{ gridColumn: "1/-1" }}>
                                <div style={{ color: "#475569", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Attached Image</div>
                                <img src={`${baseURL}/media/${req.image_path}`} alt="attachment" style={{ maxWidth: 280, borderRadius: 8, border: "1px solid rgba(124,58,237,0.25)" }} />
                              </div>
                            )}
                          </div>
                          {/* Responses */}
                          <div style={{ color: "#a78bfa", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>
                            Responses ({req.responses?.length || 0})
                          </div>
                          <ResponseThread responses={req.responses} />
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Action Modal (Responder) */}
      {actionId && (
        <ActionModal
          requestId={actionId}
          onClose={() => setActionId(null)}
          onResponded={() => { load(); }}
        />
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        table tbody tr:hover td { background: rgba(124,58,237,0.05) !important; }
        input::placeholder, textarea::placeholder { color: #475569; }
        textarea:focus, input:focus { border-color: rgba(124,58,237,0.6) !important; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
        ::-webkit-scrollbar-thumb { background: rgba(124,58,237,0.4); border-radius: 3px; }
      `}</style>
    </div>
  );
}
