import { useEffect, useMemo, useRef, useState } from "react";
import { api, baseURL } from "../services/api";
import { getFieldsForProject, fetchAndCacheProjectConfigs, getDropdownOptions, getNpiEnabled } from "../config/projectFieldsConfig";
import NpiSearchPanel from "../components/NpiSearchPanel";
import { useNavigate, useParams } from "react-router-dom";
import { Button, TextField, FormControl, InputLabel, Select, MenuItem } from "@mui/material";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import dayjs from "dayjs";
import ClarificationQueryPanel from "./ClarificationQueryPanel";
/** Small helper: debounce without extra libs */
function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function groupRowsByDateRange(rows) {
  // Mimic your Django grouping: "from_date - to_date"
  const map = new Map();
  for (const r of rows || []) {
    const key = `${r.from_date || ""} – ${r.to_date || ""} | ${r.pos || ""} | Pages: ${r.start_page || ""}-${r.end_page || ""}`.trim();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return Array.from(map.entries()); // [ [dateRange, items], ... ]
}

function rowClass(state) {
  if (state === "correct") return "table-success";
  if (state === "missed") return "table-danger";
  if (state === "modified") return "table-warning";
  if (state === "Deleted") return " -secondary";
  return "";
}

export default function AuditOpenChart({ mode = "audit" }) {
  const { chartId } = useParams();
  const [data, setData] = useState(null);
  const [project, setProject] = useState("");
  const [subproject, setSubproject] = useState("");
  const navigate = useNavigate();
  const [queryPanelOpen, setQueryPanelOpen] = useState(false);

  // Add form
  const [add, setAdd] = useState({
    from_date: "",
    to_date: "",
    start_page: "",
    end_page: "",
    dxcode: "",
    details: "",
    provider: "",
    meat_dec: "",
    eo: "",
    pos: "",
    dx_location: "",
    DOS_Flag: "",
    npi: "",
  });
  const [activeTab, setActiveTab] = useState("chart"); // "chart" | "code_log" | "audit_log"
  const openSaveEditModal = (rowId, fields) => {
    let type = "";
    if (fields.includes("dxcode")) {
      type = "Modified";
    } else if (fields.some(f => ["eo", "provider", "meat_dec"].includes(f))) {
      type = "Flag Error";
    } else if (fields.includes("dx_location") || fields.includes("npi")) {
      type = "Admin Error";
    } else if (fields.includes("DOS_Flag")) {
      type = "DOS Error";
    }

    setErrorType(type);
    setErrorCount(type ? 1 : "");
    setErrorCommand("");
    setModal({
      open: true,
      action: "save_edit",
      payload: {
        row_id: rowId,
        fields,
      },
    });
  };

  // Finalize
  const [chartStatus, setChartStatus] = useState("");
  const [completeCommand, setCompleteCommand] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [rejectCommand, setRejectCommand] = useState("");
  const [holdCommand, setHoldCommand] = useState("");

  // Editing (inline expand)
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);

  // Modal (Error Info) reused for add/wrong/edit if you want
  const [modal, setModal] = useState({ open: false, action: null, payload: null });
  const [errorType, setErrorType] = useState("");
  const [errorCount, setErrorCount] = useState("");
  const [errorCommand, setErrorCommand] = useState("");

  // ICD10 autocomplete
  const [dxQuery, setDxQuery] = useState(""); // drive search from whichever input is active
  const debouncedDxQuery = useDebouncedValue(dxQuery, 200);
  const [dxResults, setDxResults] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const activeDxTargetRef = useRef(null); // "add" | "edit"

  // use shared `api` instance from services/api (baseURL is `/`)

  const load = async () => {
    await fetchAndCacheProjectConfigs(api);
    const url = mode === "quality" ? `/api/quality/chart/${chartId}/` : `/api/audit/chart/${chartId}/`;
    const res = await api.get(url);
    setData(res.data);
    setProject(res.data.project || "");
    setSubproject(res.data.subproject || "");
  };

  // Group editing
  const [editingGroupKey, setEditingGroupKey] = useState(null);
  const [groupEditDraft, setGroupEditDraft] = useState(null);

  // helper for date comparison
  const toISO = (dateStr) => {
    if (!dateStr) return "";
    if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
      const [m, d, y] = dateStr.split("-");
      return `${y}-${m}-${d}`;
    }
    return dateStr;
  };

  const startGroupEdit = (key, items) => {
    setEditingGroupKey(key);
    setGroupEditDraft({
      from_date: toISO(items[0].from_date),
      to_date: toISO(items[0].to_date),
      start_page: items[0].start_page || "",
      end_page: items[0].end_page || "",
      pos: items[0].pos,
    });
  };

  const saveGroupEdit = async (items) => {
    if (!groupEditDraft) return;
    const rowIds = items.map((r) => r.id);

    // CHECK FOR CHANGES
    const first = items[0];
    const originalFrom = toISO(first.from_date);
    const originalTo = toISO(first.to_date);
    const originalStart = String(first.start_page || "");
    const originalEnd = String(first.end_page || "");
    const originalPos = first.pos || "";

    const newFrom = groupEditDraft.from_date || "";
    const newTo = groupEditDraft.to_date || "";
    const newStart = String(groupEditDraft.start_page || "");
    const newEnd = String(groupEditDraft.end_page || "");
    const newPos = groupEditDraft.pos || "";

    const hasChanges =
      originalFrom !== newFrom ||
      originalTo !== newTo ||
      originalStart !== newStart ||
      originalEnd !== newEnd ||
      originalPos !== newPos;

    if (hasChanges) {
      // Trigger Modal
      setErrorType("Admin Error");
      setErrorCount(1);
      setErrorCommand("");
      setModal({
        open: true,
        action: "save_group_edit",
        payload: {
          row_ids: rowIds,
          updates: groupEditDraft
        }
      });
      return;
    }

    // If no changes, standard save (or just close)
    await post({
      action: "bulk_update",
      row_ids: rowIds,
      updates: groupEditDraft,
    });
    setEditingGroupKey(null);
    setGroupEditDraft(null);
  };

  const refillAddForm = (firstItem) => {
    if (!firstItem) return;

    const toISO = (dateStr) => {
      if (!dateStr) return "";
      // If it's MM-DD-YYYY (returned by backend strftime)
      if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
        const [m, d, y] = dateStr.split("-");
        return `${y}-${m}-${d}`;
      }
      // Otherwise try native dayjs or return as is
      const parsed = dayjs(dateStr);
      return parsed.isValid() ? parsed.format("YYYY-MM-DD") : dateStr;
    };

    setAdd((prev) => ({
      ...prev,
      from_date: toISO(firstItem.from_date),
      to_date: toISO(firstItem.to_date),
      start_page: firstItem.start_page || "",
      end_page: firstItem.end_page || "",
      pos: firstItem.pos || "",
    }));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartId]);

  const post = async (payload, { reload = true, showSuccess = false } = {}) => {
    const url = mode === "quality" ? `/api/quality/chart/${chartId}/` : `/api/audit/chart/${chartId}/`;
    try {
      const resp = await api.post(url, payload);
      if (resp.data.error) {
        alert("Error: " + resp.data.error);
      } else if (showSuccess) {
        alert("Action completed successfully!");
      }
      if (reload) await load();
    } catch (err) {
      console.error(err);
      alert("Action failed: " + (err.response?.data?.error || err.message));
    }
  };

  // --- Autocomplete (ClinicalTables ICD10CM) ---
  useEffect(() => {
    let cancelled = false;

    async function run() {
      const q = (debouncedDxQuery || "").trim();
      if (!q) {
        setDxResults([]);
        return;
      }
      try {
        const res = await api.get(`/api/icd10-search/?terms=${encodeURIComponent(q)}&project=${encodeURIComponent(project)}&subproject=${encodeURIComponent(subproject)}`);
        if (!cancelled) setDxResults(res.data || []);
      } catch (err) {
        console.error("ICD-10 Search Error:", err);
        if (!cancelled) setDxResults([]);
      }
    }

    run().catch(() => {
      if (!cancelled) setDxResults([]);
    });

    return () => {
      cancelled = true;
    };
  }, [debouncedDxQuery]);

  const grouped = useMemo(() => groupRowsByDateRange(data?.rows), [data?.rows]);

  const viewOnly = mode === "quality" || !!data?.view_only;

  // --- Actions (match your Django "action" names) ---
  const markCorrect = (rowId) => {
    // Find the current row to check its state
    const currentRow = data?.rows?.find(row => row.id === rowId);

    // If it's already correct, toggle it back to empty/null. Otherwise, set to correct.
    const newState = currentRow?.state === "correct" ? "" : "correct";

    post({
      action: "update_state",
      row_id: rowId,
      state: newState
    });
  };

  const openWrongModal = (rowId) => {
    setErrorType("Deleted");
    setErrorCount(1);
    setErrorCommand("");
    setModal({ open: true, action: "update_state_wrong", payload: { row_id: rowId } });
  };

  const deleteDx = (rowId) => {
    if (!window.confirm("From Database Delete this DX?")) return;
    post({ action: "delete_dx", row_id: rowId });
  };

  const undoDelete = (rowId) => {
    if (!window.confirm("Undo Delete?")) return;
    post({
      action: "update_state",
      row_id: rowId,
      state: "" // Reset state to empty/null
    });
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    setEditDraft({ ...row }); // clone for controlled inputs
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
    setDxResults([]);
    setDxQuery("");
  };

  const validateForm = (form) => {
    const activeFields = getFieldsForProject(project, subproject);
    const required = [
      { key: "from_date", label: "From DOS" },
      { key: "to_date", label: "To DOS" },
      { key: "dxcode", label: "DX Code" },
      { key: "details", label: "Code Description" },
      { key: "dx_location", label: "DX Location" },
      { key: "start_page", label: "Start Page" },
      { key: "end_page", label: "End Page" },
    ].filter(f => activeFields.includes(f.key) || f.key === "dxcode" || f.key === "details");

    const missing = required.filter(f => !form[f.key] || String(form[f.key]).trim() === "");
    if (missing.length > 0) {
      alert("Please fill in the following mandatory fields:\n- " + missing.map(f => f.label).join("\n- "));
      return false;
    }
    return true;
  };

  const saveEdit = async (fields) => {
    // If your backend expects fields/values like your template:
    // fields: ["dxcode","details"], values: {dxcode:"", details:""}
    const values = {};
    fields.forEach((f) => (values[f] = editDraft?.[f] ?? ""));

    if (!validateForm(editDraft)) return;

    // If you want the same modal behavior for save_edit, open modal here.
    // Otherwise just post directly (simpler):
    await post({
      action: "save_edit",
      row_id: editingId,
      fields,
      values,
    });

    // Keep edit panel open or close it — your choice:
    // cancelEdit();
  };

  const openAddModal = () => {
    setErrorType("Missed");
    setErrorCount(1);
    setErrorCommand("");
    setModal({ open: true, action: "add_dx", payload: null });
  };

  const submitModal = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (modal.action === "add_dx") {
        if (!validateForm(add)) return;
        await post({
          action: "add_dx",
          ...add,
          error_type: errorType,
          error_count: errorCount,
          error_command: errorCommand,
        });
        // ✅ SMART RESET: preserve DOS/Pages/POS/Location, clear DX-specific fields
        setAdd((s) => ({
          ...s,
          dxcode: "",
          details: "",
          eo: "",
          provider: "",
          meat_dec: "",
          // npi intentionally NOT cleared — stays for next DX of same provider
        }));
        setModal({ open: false, action: null, payload: null });
        return;
      }

      else if (modal.action === "update_state_wrong") {
        await post({
          action: "update_state",
          row_id: modal.payload.row_id,
          state: "Deleted",
          error_type: errorType,
          error_count: errorCount,
          error_command: errorCommand,
        });
        setModal({ open: false, action: null, payload: null });
        return;
      }
      // ✅ INLINE EDIT SAVE (NEW)
      else if (modal.action === "save_edit") {
        if (!editDraft) return;
        const { row_id, fields } = modal.payload;

        const values = {};
        fields.forEach((f) => {
          values[f] = editDraft?.[f] ?? "";
        });

        await post({
          action: "save_edit",
          row_id,
          fields,
          values,
          error_type: errorType,
          error_count: errorCount,
          error_command: errorCommand,
        });

        setEditingId(null);
        setEditDraft(null);
      }

      else if (modal.action === "chart_complete" || modal.action === "chart_reject" || modal.action === "chart_hold") {
        await saveChart();
        // saveChart navigates away, so we don't strictly need to close the modal, but good practice if nav fails
        setModal({ open: false, action: null, payload: null });
        return;
      }
      // HANDLE GROUP EDIT SAVE
      else if (modal.action === "save_group_edit") {
        const { row_ids, updates } = modal.payload;
        await post({
          action: "bulk_update",
          row_ids,
          updates,
          error_type: errorType,
          error_count: errorCount,
          error_command: errorCommand,
        });
        setEditingGroupKey(null);
        setGroupEditDraft(null);
      }

      setModal({ open: false, action: null, payload: null });
      setErrorType("");
      setErrorCount("");
      setErrorCommand("");
    } finally {
      setSubmitting(false);
    }
  };
  const isDisabled = ["update_state_wrong", "add_dx"].includes(modal.action);
  const saveChart = async () => {
    const missing = [];
    if (!chartStatus) missing.push("Final Chart Status");
    if (chartStatus === "complete" && !completeCommand) missing.push("Complete Command");
    if (chartStatus === "reject" && !rejectReason) missing.push("Reject Reason");
    // hold: no mandatory extra fields

    if (missing.length > 0) {
      alert("Please fill in the following mandatory fields:\n- " + missing.join("\n- "));
      return;
    }

    await post({
      action: "save_chart",
      chart_status: chartStatus,
      complete_command: completeCommand || "",
      reject_reason: rejectReason || "",
      reject_command: rejectCommand || "",
      hold_command: holdCommand || "",
    });

    if (chartStatus !== "hold") {
      alert("Chart finalized successfully!");
      navigate("/audit/dashboard");
    } else {
      alert("Chart put on hold.");
    }
  };


  const openPdfInPopup = () => {
    const pdfUrl = `${baseURL}/media/${data.pdf_path}`;
    const popup = window.open("", "PDFPopup", "width=1000,height=800,scrollbars=yes,resizable=yes");
    if (!popup) return;
    popup.document.write(`
      <html>
        <head>
          <title>PDF Viewer</title>
          <style>html,body{margin:0;height:100%} iframe{width:100%;height:100%;border:none}</style>
        </head>
        <body>
          <iframe src="${pdfUrl}"></iframe>
        </body>
      </html>
    `);
    popup.document.close();
  };

  if (!data) return <div className="p-3">Loading…</div>;

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <div className="container-fluid" style={{ height: "100vh", width: "auto" }}>
        {/* Header */}
        <div
          className="d-flex justify-content-between align-items-center px-3 py-2"
          style={{ background: "#393939", color: "white" }}
        >
          <button className="btn btn-light btn-sm" onClick={openPdfInPopup}>
            Open in New Window
          </button>
          <button
            className="btn btn-sm"
            style={{ background: "linear-gradient(90deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", fontWeight: 600 }}
            onClick={() => setQueryPanelOpen(true)}
          >
            💬 Query
          </button>
          <div className="d-flex align-items-center">
            ID: <strong>{data.chart_id}</strong>
            {data.audit_status && (
              <span
                className={`badge ms-2 ${data.audit_status === 'complete' ? 'bg-success' : 'bg-danger'}`}
                style={{ fontSize: '0.75rem' }}
              >
                {data.audit_status.toUpperCase()}
              </span>
            )}
          </div>
        </div>

        {/* CLARIFICATION PANEL */}
        <ClarificationQueryPanel
          open={queryPanelOpen}
          onClose={() => setQueryPanelOpen(false)}
          chartId={data.chart_id}
          project={project}
          subproject={subproject}
          chart={data}
        />

        <div className="row" style={{ height: "calc(100vh - 44px)" }}>
          {/* PDF - Only show on Chart tab */}
          {activeTab === "chart" && (
            <div className="col-md-7 p-0 border-end" style={{ height: "100%" }}>
              <iframe
                title="pdf"
                src={`${baseURL}/media/${data.pdf_path}`}
                style={{ width: "100%", height: "100%", border: "none" }}
              />
            </div>
          )}

          {/* RIGHT PANEL - Full width if not Chart tab */}
          <div className={`${activeTab === "chart" ? "col-md-5" : "col-md-12"} p-3 overflow-auto`} style={{ height: "100%" }}>

            {/* TABS NAVIGATION */}
            <div className="d-flex gap-2 mb-3 border-bottom pb-2">
              <button
                className={`btn btn-sm ${activeTab === 'chart' ? 'btn-primary' : 'btn-outline-primary'}`}
                onClick={() => setActiveTab('chart')}
              >
                Chart
              </button>
              <button
                className={`btn btn-sm ${activeTab === 'code_log' ? 'btn-primary' : 'btn-outline-primary'}`}
                onClick={() => setActiveTab('code_log')}
              >
                Code Log
              </button>
              <button
                className={`btn btn-sm ${activeTab === 'audit_log' ? 'btn-primary' : 'btn-outline-primary'}`}
                onClick={() => setActiveTab('audit_log')}
              >
                Audit Log
              </button>
              {!viewOnly && (
                <>
                  <button
                    className="btn btn-sm btn-success"
                    onClick={() => {
                      setChartStatus("complete");
                      setModal({ open: true, action: "chart_complete", payload: null });
                    }}
                  >
                    Complete
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => {
                      setChartStatus("reject");
                      setModal({ open: true, action: "chart_reject", payload: null });
                    }}
                  >
                    Reject
                  </button>
                  {/*
                  <button
                    className="btn btn-sm btn-warning"
                    onClick={() => {
                      setChartStatus("hold");
                      setHoldCommand("");
                      setModal({ open: true, action: "chart_hold", payload: null });
                    }}
                  >
                    Hold
                  </button>
                  */}
                </>
              )}

            </div>


            {activeTab === "chart" && (
              <>
                {!viewOnly && (
                  <>

                    {/* ADD DX */}
                    {(() => {
                      const activeFields = getFieldsForProject(project, subproject);
                      const renderField = (fieldName, label, element, colWidth = "col-6", isRequired = false) => {
                        if (!activeFields.includes(fieldName)) return null;
                        return (
                          <div className={colWidth}>
                            <label className="form-label small">
                              {label}
                              {isRequired && <span className="text-danger">*</span>}
                            </label>
                            {element}
                          </div>
                        );
                      };

                      return (
                        <div className="card mb-3">
                          <div className="card-header fw-bold">Add New DX</div>
                          <div className="card-body">
                            {(() => {
                              const npiEnabled = getNpiEnabled(project, subproject);
                              return (
                                <NpiSearchPanel
                                  enabled={npiEnabled}
                                  npi={add.npi}
                                  onNpiChange={(v) => setAdd((s) => ({ ...s, npi: v }))}
                                  onSelectNpi={(v) => setAdd((s) => ({ ...s, npi: v }))}
                                />
                              );
                            })()}
                            <div className="row g-2">
                              {renderField("from_date", "From DOS", (
                                <DatePicker
                                  format="MM-DD-YYYY"
                                  slotProps={{ textField: { size: "small", fullWidth: true } }}
                                  value={add.from_date ? dayjs(add.from_date) : null}
                                  onChange={(val) => {
                                    const d = val ? val.format("YYYY-MM-DD") : "";
                                    setAdd((s) => ({
                                      ...s,
                                      from_date: d,
                                      to_date: s.pos && s.pos !== "Inpatient" ? d : s.to_date,
                                    }));
                                  }}
                                />
                              ), "col-6", true)}

                              {renderField("to_date", "To DOS", (
                                <DatePicker
                                  format="MM-DD-YYYY"
                                  disabled={add.pos !== "" && add.pos !== "Inpatient"}
                                  slotProps={{ textField: { size: "small", fullWidth: true } }}
                                  value={add.to_date ? dayjs(add.to_date) : null}
                                  onChange={(val) => setAdd((s) => ({ ...s, to_date: val ? val.format("YYYY-MM-DD") : "" }))}
                                />
                              ), "col-6", true)}

                              {renderField("start_page", "Start Page", (
                                <input
                                  className="form-control form-control-sm"
                                  value={add.start_page}
                                  onChange={(e) => setAdd((s) => ({ ...s, start_page: e.target.value }))}
                                />
                              ), "col-6", true)}

                              {renderField("end_page", "End Page", (
                                <input
                                  className="form-control form-control-sm"
                                  value={add.end_page}
                                  onChange={(e) => setAdd((s) => ({ ...s, end_page: e.target.value }))}
                                />
                              ), "col-6", true)}

                              <div className="col-6 position-relative">
                                <label className="form-label small">DX Code <span className="text-danger">*</span></label>
                                <input
                                  className="form-control form-control-sm"
                                  value={add.dxcode}
                                  onFocus={() => (activeDxTargetRef.current = "add")}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setAdd((s) => ({ ...s, dxcode: v }));
                                    setDxQuery(v);
                                  }}
                                  placeholder="DX Code"
                                  autoComplete="off"
                                />
                                {activeDxTargetRef.current === "add" && dxResults.length > 0 && (
                                  <div
                                    className="position-absolute bg-white border w-100"
                                    style={{ zIndex: 1000, maxHeight: 240, overflowY: "auto" }}
                                  >
                                    {dxResults.map(([code, name]) => (
                                      <div
                                        key={code}
                                        className="px-2 py-1"
                                        style={{ cursor: "pointer" }}
                                        onMouseDown={() => {
                                          setAdd((s) => ({ ...s, dxcode: code, details: name }));
                                          setDxResults([]);
                                          setDxQuery("");
                                        }}
                                      >
                                        {code} - {name}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="col-6">
                                <label className="form-label small">Code Description <span className="text-danger">*</span></label>
                                <input
                                  className="form-control form-control-sm"
                                  value={add.details}
                                  onChange={(e) => setAdd((s) => ({ ...s, details: e.target.value }))}
                                  placeholder="Details"
                                />
                              </div>

                              {renderField("pos", "POS", (
                                <select
                                  className="form-select form-select-sm"
                                  value={add.pos}
                                  onChange={(e) => {
                                    const newPos = e.target.value;
                                    setAdd((s) => {
                                      const updated = { ...s, pos: newPos };
                                      if (newPos && newPos !== "Inpatient" && s.from_date) {
                                        updated.to_date = s.from_date;
                                      }
                                      return updated;
                                    });
                                  }}
                                >
                                  <option value=""></option>
                                  {getDropdownOptions(project, subproject, "pos").map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                </select>
                              ), "col-6", false)}

                              {renderField("dx_location", "DX Location", (
                                <select
                                  className="form-select form-select-sm"
                                  value={add.dx_location}
                                  onChange={(e) => setAdd((s) => ({ ...s, dx_location: e.target.value }))}
                                >
                                  <option value=""></option>
                                  {getDropdownOptions(project, subproject, "dx_location").map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                </select>
                              ), "col-6", false)}

                              {renderField("DOS_Flag", "DOS Flag", (
                                <select
                                  className="form-select form-select-sm"
                                  value={add.DOS_Flag}
                                  onChange={(e) => setAdd((s) => ({ ...s, DOS_Flag: e.target.value }))}
                                >
                                  <option value=""></option>
                                  {getDropdownOptions(project, subproject, "DOS_Flag").map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                </select>
                              ), "col-6", false)}

                              {renderField("eo", "DX Flag", (
                                <select
                                  className="form-select form-select-sm"
                                  value={add.eo}
                                  onChange={(e) => setAdd((s) => ({ ...s, eo: e.target.value }))}
                                >
                                  <option value=""></option>
                                  {getDropdownOptions(project, subproject, "eo").map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                </select>
                              ), "col-6", false)}

                              {renderField("provider", "Meat Flag", (
                                <select
                                  className="form-select form-select-sm"
                                  value={add.provider}
                                  onChange={(e) => setAdd((s) => ({ ...s, provider: e.target.value }))}
                                >
                                  <option value=""></option>
                                  {getDropdownOptions(project, subproject, "provider").map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                </select>
                              ), "col-6", false)}

                              {renderField("meat_dec", "Meat Details", (
                                <input
                                  type="text"
                                  className="form-control"
                                  placeholder="Enter (Evidence Name & Page Number)"
                                  value={add.meat_dec}
                                  onChange={(e) =>
                                    setAdd((s) => ({ ...s, meat_dec: e.target.value }))
                                  }
                                />
                              ), "col-12", false)}
                            </div>

                            <div className="mt-3 text-end">
                              <button className="btn btn-primary" onClick={openAddModal}>
                                Add DX
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                  </>
                )}

                {/* GROUPED ROWS */}
                {grouped.length === 0 ? (
                  <p className="text-muted">No DX entries</p>
                ) : (
                  grouped.map(([dateRange, items]) => (
                    <div key={dateRange} className="mb-3">
                      <div
                        className="card-header d-flex justify-content-between align-items-center fw-bold"
                        style={{ cursor: "pointer" }}
                        title="Click to refill form with these values"
                      >
                        {editingGroupKey === dateRange ? (
                          <div className="d-flex gap-2 align-items-center flex-wrap w-100 py-1" onClick={(e) => e.stopPropagation()}>
                            <div style={{ minWidth: 120, flex: "1 1 0" }}>
                              <DatePicker
                                label="From"
                                format="MM-DD-YYYY"
                                slotProps={{ textField: { size: "small", fullWidth: true } }}
                                value={groupEditDraft.from_date ? dayjs(groupEditDraft.from_date) : null}
                                onChange={(val) => {
                                  const newFrom = val ? val.format("YYYY-MM-DD") : "";
                                  setGroupEditDraft(s => {
                                    const updated = { ...s, from_date: newFrom };
                                    if (s.pos && s.pos !== "Inpatient") {
                                      updated.to_date = newFrom;
                                    }
                                    return updated;
                                  });
                                }}
                              />
                            </div>
                            <div style={{ minWidth: 120, flex: "1 1 0" }}>
                              <DatePicker
                                label="To"
                                format="MM-DD-YYYY"
                                disabled={groupEditDraft.pos !== "" && groupEditDraft.pos !== "Inpatient"}
                                slotProps={{ textField: { size: "small", fullWidth: true } }}
                                value={groupEditDraft.to_date ? dayjs(groupEditDraft.to_date) : null}
                                onChange={(val) => setGroupEditDraft(s => ({ ...s, to_date: val ? val.format("YYYY-MM-DD") : "" }))}
                              />
                            </div>
                            <div style={{ width: 80 }}>
                              <TextField
                                label="Start"
                                size="small"
                                fullWidth
                                type="number"
                                value={groupEditDraft.start_page || ""}
                                onChange={(e) => setGroupEditDraft(s => ({ ...s, start_page: e.target.value }))}
                              />
                            </div>
                            <div style={{ width: 80 }}>
                              <TextField
                                label="End"
                                size="small"
                                fullWidth
                                type="number"
                                value={groupEditDraft.end_page || ""}
                                onChange={(e) => setGroupEditDraft(s => ({ ...s, end_page: e.target.value }))}
                              />
                            </div>
                            <div style={{ width: 110 }}>
                              <FormControl fullWidth size="small">
                                <InputLabel>POS</InputLabel>
                                <Select
                                  value={groupEditDraft.pos || ""}
                                  label="POS"
                                  onChange={(e) => {
                                    const newPos = e.target.value;
                                    setGroupEditDraft(s => {
                                      const updated = { ...s, pos: newPos };
                                      if (newPos && newPos !== "Inpatient" && s.from_date) {
                                        updated.to_date = s.from_date;
                                      }
                                      return updated;
                                    });
                                  }}
                                >
                                  <MenuItem value=""></MenuItem>
                                  <MenuItem value="Inpatient">Inpatient</MenuItem>
                                  <MenuItem value="OutPatient">OutPatient</MenuItem>
                                  <MenuItem value="Telehealth">Telehealth</MenuItem>
                                  <MenuItem value="HO">HO</MenuItem>
                                </Select>
                              </FormControl>
                            </div>
                            <div className="d-flex gap-1">
                              <button className="btn btn-success btn-sm px-3" onClick={() => saveGroupEdit(items)}>Save</button>
                              <button className="btn btn-secondary btn-sm" onClick={() => setEditingGroupKey(null)}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <span onClick={() => refillAddForm(items[0])}>{dateRange}</span>
                            {(() => {
                              const npiEnabled = getNpiEnabled(project, subproject);
                              if (!npiEnabled) return null;
                              const npiVals = [...new Set(items.map(r => r.npi).filter(Boolean))];
                              return npiVals.length > 0 ? (
                                <span className="ms-2">
                                  {npiVals.map(n => (
                                    <span key={n} className="badge ms-1" style={{ background: "#0ea5e9", fontSize: "0.72rem" }}>NPI: {n}</span>
                                  ))}
                                </span>
                              ) : null;
                            })()}
                            {!viewOnly && (
                              <button
                                className="btn btn-sm btn-outline-primary py-0"
                                onClick={(e) => { e.stopPropagation(); startGroupEdit(dateRange, items); }}
                              >
                                Edit Group
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      <div className="table-responsive">
                        <table className="table table-sm table-bordered mb-0">
                          <thead className="table-light">
                            <tr>
                              <th>DX Code</th>
                              {getNpiEnabled(project, subproject) && <th>NPI</th>}
                              {getFieldsForProject(project, subproject).includes("provider") && <th>Meat Flag</th>}
                              {getFieldsForProject(project, subproject).includes("eo") && <th>DX Flag</th>}
                              {getFieldsForProject(project, subproject).includes("DOS_Flag") && <th>DOS Flag</th>}
                              <th>State</th>
                              {!viewOnly && <th>Action</th>}
                            </tr>
                          </thead>

                          <tbody>
                            {items.map((r) => (
                              <FragmentRow
                                key={r.id}
                                r={r}
                                viewOnly={viewOnly}
                                isEditing={editingId === r.id}
                                editDraft={editingId === r.id ? editDraft : null}
                                onMarkCorrect={() => markCorrect(r.id)}
                                onMarkWrong={() => openWrongModal(r.id)}
                                onDelete={() => deleteDx(r.id)}
                                onUndoDelete={() => undoDelete(r.id)}
                                onStartEdit={() => startEdit(r)}
                                onCancelEdit={cancelEdit}
                                onEditChange={(patch) => setEditDraft((s) => ({ ...s, ...patch }))}
                                onSaveEditWithError={openSaveEditModal}
                                onSaveEdit={saveEdit}
                                dxResults={dxResults}
                                npiEnabled={getNpiEnabled(project, subproject)}
                                setDxQuery={(q) => {
                                  activeDxTargetRef.current = "edit";
                                  setDxQuery(q);
                                }}
                                onPickDx={(code, name) => {
                                  setEditDraft((s) => ({ ...s, dxcode: code, details: name }));
                                  setDxResults([]);
                                  setDxQuery("");
                                  // Trigger modal after selection
                                  openSaveEditModal(r.id, ["dxcode", "details"]);
                                }}
                                project={project}
                                subproject={subproject}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}


            {activeTab === "code_log" && (
              <div className="table-responsive">
                <div className="d-flex justify-content-between align-items-center">
                  <h5>Coding Details (Coder's Data)</h5>
                  {(data.reject_reason || data.reject_command) && (
                    <div className="badge bg-danger p-2">
                      REJECTED CHART info
                    </div>
                  )}
                </div>

                {(data.reject_reason || data.reject_command) && (
                  <div className="alert alert-danger py-2 mt-2">
                    {data.reject_reason && <div><strong>Reject Reason:</strong> {data.reject_reason}</div>}
                    {data.reject_command && <div><strong>Coder's Note:</strong> {data.reject_command}</div>}
                  </div>
                )}

                <table className="table table-sm table-bordered mb-0 mt-2">
                  <thead className="table-light">
                    <tr>
                      <th>From DOS</th>
                      <th>To DOS</th>
                      <th>DX Code</th>
                      {getNpiEnabled(project, subproject) && <th>NPI</th>}
                      <th>Description</th>
                      <th>Pages</th>
                      <th>EO</th>
                      <th>POS</th>
                      <th>Meat Flag</th>
                      <th>DX Location</th>
                      <th>DOS Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.coder_rows || []).map((r, idx) => (
                      <tr key={idx}>
                        <td>{r.from_date}</td>
                        <td>{r.to_date}</td>
                        <td>{r.dxcode}</td>
                        {getNpiEnabled(project, subproject) && <td><span className="badge" style={{ background: "#0ea5e9", fontSize: "0.72rem" }}>{r.npi || "-"}</span></td>}
                        <td className="small">{r.details}</td>
                        <td>{r.start_page} - {r.end_page}</td>
                        <td>{r.eo}</td>
                        <td>{r.pos}</td>
                        <td>{r.provider}</td>
                        <td>{r.dx_location}</td>
                        <td>{r.DOS_Flag}</td>
                      </tr>
                    ))}
                    {(!data.coder_rows || data.coder_rows.length === 0) && (
                      <tr><td colSpan="11" className="text-center text-muted">No coder rows found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === "audit_log" && (
              <div className="table-responsive">
                <h5>Audit Log (Auditor's Changes)</h5>

                <table className="table table-sm table-bordered mb-0 mt-2" style={{ minWidth: 1200 }}>
                  <thead className="table-light text-nowrap">
                    <tr>
                      <th>Date Time</th>
                      <th>From DOS</th>
                      <th>To DOS</th>
                      <th>DX Code</th>
                      {getNpiEnabled(project, subproject) && <th>NPI</th>}
                      <th>Description</th>
                      <th>Pages</th>
                      <th>POS</th>
                      <th>Meat Flag</th>
                      <th>DX Location</th>
                      <th>DX Flag</th>
                      <th>Meat Details</th>
                      <th>DOS Flag</th>
                      <th>State</th>
                      <th>Error Type</th>
                      <th>Count</th>
                      <th>Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.audit_log || []).map((e, idx) => {
                      const changes = e.changes || {};
                      const hasChanged = (field) => {
                        return changes.new && field in changes.new;
                      };
                      const highlightStyle = (field) => {
                        return hasChanged(field) ? { backgroundColor: "#ffffcc", fontWeight: "bold", border: "1px solid orange" } : {};
                      };

                      return (
                        <tr key={idx} className={rowClass(e.state)}>
                          <td className="small">{e.created_at}</td>
                          <td style={highlightStyle("from_date")}>{e.from_date}</td>
                          <td style={highlightStyle("to_date")}>{e.to_date}</td>
                          <td style={highlightStyle("dxcode")}>{e.dxcode}</td>
                          {getNpiEnabled(project, subproject) && <td style={highlightStyle("npi")}><span className="badge" style={{ background: "#0ea5e9", fontSize: "0.72rem" }}>{e.npi || "-"}</span></td>}
                          <td style={highlightStyle("details")} className="small">{e.details}</td>
                          <td style={highlightStyle("start_page") || highlightStyle("end_page")}>
                            {e.start_page} - {e.end_page}
                          </td>
                          <td style={highlightStyle("pos")}>{e.pos}</td>
                          <td style={highlightStyle("provider")}>{e.provider}</td>
                          <td style={highlightStyle("dx_location")}>{e.dx_location}</td>
                          <td style={highlightStyle("eo")}>{e.eo}</td>
                          <td style={highlightStyle("meat_dec")}>{e.meat_dec}</td>
                          <td style={highlightStyle("DOS_Flag")}>{e.DOS_Flag}</td>
                          <td>{e.state}</td>
                          <td>{e.error_type}</td>
                          <td>{e.error_count}</td>
                          <td>{e.error_command}</td>
                        </tr>
                      );
                    })}
                    {(!data.audit_log || data.audit_log.length === 0) && (
                      <tr><td colSpan="15" className="text-center text-muted">No audit entries found</td></tr>
                    )}
                  </tbody>
                </table>

                <br />
                {/* Keep existing Error Log Table style but rename if needed */}
                <h5>Summary Error Log</h5>
                <table className="table table-sm table-bordered mb-0 mt-2">
                  <thead className="table-light">
                    <tr>
                      <th>From DOS</th>
                      <th>To DOS</th>
                      <th>Pages</th>
                      <th>Error Type</th>
                      <th>Count</th>
                      <th>Comment</th>
                      {!viewOnly && <th>Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(data.errors || []).map((e, idx) => (
                      <tr key={idx}>
                        <td>{e.from_date}</td>
                        <td>{e.to_date}</td>
                        <td>{e.start_page} - {e.end_page}</td>
                        <td>{e.error_type}</td>
                        <td>{e.error_count}</td>
                        <td>{e.error_command}</td>
                        <td className="text-center">
                          {!viewOnly && (
                            <button
                              className="btn btn-outline-danger btn-sm"
                              onClick={() => {
                                if (!window.confirm("Delete this error?")) return;
                                post({ action: "delete_error", row_id: e.id });
                              }}
                            >
                              🗑
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {data.at_audit_log && data.at_audit_log.length > 0 && (
                  <>
                    <br />
                    <h5 className="text-danger">AT Audit Feedback (Quality Review)</h5>
                    <table className="table table-sm table-bordered mb-0 mt-2">
                      <thead className="table-light">
                        <tr>
                          <th>Date Time</th>
                          <th>DX Code</th>
                          <th>Error Type</th>
                          <th>Count</th>
                          <th>Comment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.at_audit_log.map((e, idx) => (
                          <tr key={idx} className="table-warning">
                            <td className="small">{e.created_at}</td>
                            <td>{e.dxcode}</td>
                            <td>{e.error_type}</td>
                            <td>{e.error_count}</td>
                            <td>{e.error_command}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {data.standard_audit_log && data.standard_audit_log.length > 0 && (
                  <>
                    <br />
                    <h5 className="text-info">Standard Audit Context (Auditor's Original Log)</h5>
                    <table className="table table-sm table-bordered mb-0 mt-2">
                      <thead className="table-light">
                        <tr>
                          <th>Date Time</th>
                          <th>DX Code</th>
                          <th>Error Type</th>
                          <th>Count</th>
                          <th>Comment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.standard_audit_log.map((e, idx) => (
                          <tr key={idx} className="table-info">
                            <td className="small">{e.created_at}</td>
                            <td>{e.dxcode}</td>
                            <td>{e.error_type}</td>
                            <td>{e.error_count}</td>
                            <td>{e.error_command}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* MODAL (custom, no bootstrap JS needed) */}
        {modal.open && (
          <div
            className="position-fixed top-0 start-0 w-100 h-100"
            style={{ background: "rgba(0,0,0,0.4)", zIndex: 2000 }}
            onMouseDown={() => setModal({ open: false, action: null, payload: null })}
          >
            <div
              className="bg-white p-3 rounded"
              style={{ width: 480, maxWidth: "95vw", margin: "10vh auto" }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h5 className="m-0">
                  {modal.action === "item_history" ? "Item History" :
                    modal.action === "chart_complete" ? "Complete Chart" :
                      modal.action === "chart_reject" ? "Reject Chart" :
                        modal.action === "chart_hold" ? "Hold Chart" :
                          "Error Info"}
                </h5>
                <button
                  className="btn-close"
                  onClick={() => setModal({ open: false, action: null, payload: null })}
                />
              </div>

              {/* RENDER BODY based on action */}
              {(modal.action === "chart_complete") && (
                <div className="mb-2">
                  <label className="form-label small">Complete Command <span className="text-danger">*</span></label>
                  <select
                    className="form-select"
                    value={completeCommand}
                    onChange={(e) => setCompleteCommand(e.target.value)}
                  >
                    <option value=""></option>
                    {getDropdownOptions(project, subproject, "complete_command").map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              )}

              {(modal.action === "chart_reject") && (
                <>
                  <div className="mb-2">
                    <label className="form-label small">Reject Reason <span className="text-danger">*</span></label>
                    <select
                      className="form-select"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    >
                      <option value=""></option>
                      {getDropdownOptions(project, subproject, "reject_reason").map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                  <div className="mb-2">
                    <label className="form-label small">Reject Notes</label>
                    <textarea
                      className="form-control"
                      placeholder="Reject Notes"
                      value={rejectCommand}
                      onChange={(e) => setRejectCommand(e.target.value)}
                    />
                  </div>
                </>
              )}
              {modal.action === "chart_hold" && (
                <div className="mb-2">
                  <label className="form-label small">Hold Notes</label>
                  <textarea
                    className="form-control"
                    rows="3"
                    placeholder="Reason for holding this chart..."
                    value={holdCommand}
                    onChange={(e) => setHoldCommand(e.target.value)}
                  />
                </div>
              )}

              {/* Default "Error Info" fields if NOT complete/reject */}
              {!["chart_complete", "chart_reject", "chart_hold"].includes(modal.action) && (
                <>
                  <select
                    className="form-select mb-2"
                    value={errorType}
                    onChange={(e) => setErrorType(e.target.value)}
                  >
                    <option value="Missed">Missed</option>
                    <option value="Modified">Modified</option>
                    <option value="Deleted">Deleted</option>
                    <option value="DOS Error">DOS Error</option>
                    <option value="Page No Error">Page No Error</option>
                    <option value="Flag Error">Flag Error</option>
                    <option value="Admin Error">Admin Error</option>
                  </select>
                  <input type="number" className="form-select mb-2"
                    value={errorCount}
                    onChange={(e) => setErrorCount(e.target.value)}>
                  </input>
                  <textarea
                    className="form-control"
                    placeholder="Error Command"
                    value={errorCommand}
                    onChange={(e) => setErrorCommand(e.target.value)}
                  />
                </>
              )}

              <div className="mt-3 d-flex justify-content-end gap-2">
                <button
                  className="btn btn-secondary"
                  onClick={() => setModal({ open: false, action: null, payload: null })}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={submitModal} disabled={submitting}>
                  {submitting ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </LocalizationProvider>
  );
}

/** Extracted row + inline edit panel to keep main component readable */
/** Extracted row + inline edit panel to keep main component readable */
function FragmentRow({
  r,
  viewOnly,
  isEditing,
  editDraft,
  onMarkCorrect,
  onMarkWrong,
  onDelete,
  onStartEdit,
  onCancelEdit,
  onEditChange,
  onSaveEditWithError,
  onSaveEdit,
  dxResults,
  setDxQuery,

  onPickDx,
  onUndoDelete,
  project,
  subproject,
  npiEnabled,
}) {
  // Determine if this specific row is marked as correct
  const isCorrect = r.state === "correct";

  return (
    <>
      <tr className={rowClass(r.state)}>
        <td>{r.dxcode}</td>
        {npiEnabled && <td><span className="badge" style={{ background: "#0ea5e9", fontSize: "0.72rem" }}>{r.npi || "-"}</span></td>}
        {getFieldsForProject(project, subproject).includes("provider") && <td>{r.provider}</td>}
        {getFieldsForProject(project, subproject).includes("eo") && <td>{r.eo}</td>}
        {getFieldsForProject(project, subproject).includes("DOS_Flag") && <td>{r.DOS_Flag || ""}</td>}
        <td>{r.state || ""}</td>

        {!viewOnly && (
          <td className="text-nowrap">
            {/* If marked correct, only show the checkmark (as a toggle) */}
            {isCorrect ? (
              null
            ) : (
              /* If NOT marked correct, show all buttons (unless it's an 'added' state) */
              r.state !== "added" && (
                <>
                  {/* If state is Deleted, show Undo button. Else show Deleted button */}
                  {["Deleted", "deleted"].includes(r.state) ? (
                    <button className="btn btn-warning btn-sm me-1" onClick={onUndoDelete}>
                      Undo
                    </button>
                  ) : (
                    <button className="btn btn-danger btn-sm me-1" onClick={onMarkWrong}>
                      Deleted
                    </button>
                  )}
                  <button className="btn btn-outline-secondary btn-sm me-1" onClick={onStartEdit}>
                    ✏️
                  </button>
                  {["Missed", "missed"].includes(r.state) && (
                    <button
                      className="btn btn-dark btn-sm me-1"
                      onClick={onDelete}
                      title="Delete from Database"
                    >
                      🗑
                    </button>
                  )}
                </>
              )
            )}
          </td>
        )}
      </tr>

      {/* ... rest of the inline edit panel code remains the same ... */}
      {/* Inline edit panel */}
      {isEditing && editDraft && (
        <tr>
          <td colSpan={viewOnly ? 5 : 6}>
            <div className="border rounded p-2">
              <div className="row g-2">
                {(() => {
                  const activeFields = getFieldsForProject(project, subproject);
                  const renderField = (fieldName, label, element, colWidth = "col-6", isRequired = false) => {
                    if (!activeFields.includes(fieldName)) return null;
                    return (
                      <div className={colWidth}>
                        <label className="form-label small">
                          {label}
                          {isRequired && <span className="text-danger">*</span>}
                        </label>
                        {element}
                      </div>
                    );
                  };

                  return (
                    <>
                      <div className="col-12 mb-2">
                        {npiEnabled && (
                          <NpiSearchPanel
                            enabled={true}
                            npi={editDraft.npi || ""}
                            onNpiChange={(v) => onEditChange({ npi: v })}
                            onSelectNpi={(v) => {
                              onEditChange({ npi: v });
                              if ((r.npi || "") !== (v || "")) {
                                onSaveEditWithError(r.id, ["npi"]);
                              }
                            }}
                            onNpiBlur={(v) => {
                              if ((r.npi || "") !== (v || "")) {
                                onSaveEditWithError(r.id, ["npi"]);
                              }
                            }}
                          />
                        )}
                      </div>

                      <div className="col-6 position-relative">
                        <label className="form-label small">DX Code <span className="text-danger">*</span></label>
                        <input
                          className="form-control form-control-sm"
                          value={editDraft.dxcode || ""}
                          onChange={(e) => {
                            onEditChange({ dxcode: e.target.value });
                            setDxQuery(e.target.value);
                          }}
                          onBlur={() => {
                            if ((r.dxcode || "") !== (editDraft.dxcode || "")) {
                              onSaveEditWithError(r.id, ["dxcode"]);
                            }
                          }}
                          autoComplete="off"
                        />
                        {dxResults.length > 0 && (
                          <div
                            className="position-absolute bg-white border w-100"
                            style={{ zIndex: 1000, maxHeight: 240, overflowY: "auto" }}
                          >
                            {dxResults.map(([code, name]) => (
                              <div
                                key={code}
                                className="px-2 py-1"
                                style={{ cursor: "pointer" }}
                                onMouseDown={() => onPickDx(code, name)}
                              >
                                {code} - {name}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {renderField("from_date", "From DOS", (
                        <DatePicker
                          format="MM-DD-YYYY"
                          slotProps={{ textField: { size: "small", fullWidth: true } }}
                          value={editDraft.from_date ? dayjs(editDraft.from_date) : null}
                          onChange={(val) => {
                            const d = val ? val.format("YYYY-MM-DD") : "";
                            onEditChange({
                              from_date: d,
                              to_date: editDraft.pos !== "Inpatient" ? d : editDraft.to_date,
                            });
                            onSaveEditWithError(r.id, ["from_date", "to_date"]);
                          }}
                        />
                      ), "col-3", true)}

                      {renderField("to_date", "To DOS", (
                        <DatePicker
                          format="MM-DD-YYYY"
                          disabled={editDraft.pos !== "" && editDraft.pos !== "Inpatient"}
                          slotProps={{ textField: { size: "small", fullWidth: true } }}
                          value={editDraft.to_date ? dayjs(editDraft.to_date) : null}
                          onChange={(val) => {
                            const d = val ? val.format("YYYY-MM-DD") : "";
                            onEditChange({ to_date: d });
                            onSaveEditWithError(r.id, ["to_date"]);
                          }}
                        />
                      ), "col-3", true)}

                      {renderField("start_page", "Start Page", (
                        <input
                          type="number"
                          className="form-control form-control-sm"
                          value={editDraft.start_page || ""}
                          onChange={(e) => {
                            onEditChange({ start_page: e.target.value });
                          }}
                          onBlur={() => {
                            if (String(r.start_page || "") !== String(editDraft.start_page || "")) {
                              onSaveEditWithError(r.id, ["start_page"]);
                            }
                          }}
                        />
                      ), "col-3", true)}

                      {renderField("end_page", "End Page", (
                        <input
                          type="number"
                          className="form-control form-control-sm"
                          value={editDraft.end_page || ""}
                          onChange={(e) => {
                            onEditChange({ end_page: e.target.value });
                          }}
                          onBlur={() => {
                            if (String(r.end_page || "") !== String(editDraft.end_page || "")) {
                              onSaveEditWithError(r.id, ["end_page"]);
                            }
                          }}
                        />
                      ), "col-3", true)}

                      {renderField("pos", "POS", (
                        <select
                          className="form-select form-select-sm"
                          value={editDraft.pos || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            onEditChange({ pos: val });
                            onSaveEditWithError(r.id, ["pos"]);
                          }}
                        >
                          <option value=""></option>
                          {getDropdownOptions(project, subproject, "pos").map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ), "col-3")}

                      <div className="col-6">
                        <label className="form-label small">Details <span className="text-danger">*</span></label>
                        <input
                          className="form-control form-control-sm"
                          value={editDraft.details || ""}
                          onChange={(e) => onEditChange({ details: e.target.value })}
                          onBlur={() => {
                            if ((r.details || "") !== (editDraft.details || "")) {
                              onSaveEditWithError(r.id, ["details"]);
                            }
                          }}
                        />
                      </div>

                      {renderField("eo", "DX Flag", (
                        <select
                          className="form-select form-select-sm"
                          value={editDraft.eo || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            onEditChange({ eo: val });
                            if ((r.eo || "") !== (val || "")) {
                              onSaveEditWithError(r.id, ["eo"]);
                            }
                          }}
                        >
                          <option value=""></option>
                          {getDropdownOptions(project, subproject, "eo").map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ), "col-6")}

                      {renderField("dx_location", "DX Location", (
                        <select
                          className="form-select form-select-sm"
                          value={editDraft.dx_location || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            onEditChange({ dx_location: val });
                            if ((r.dx_location || "") !== (val || "")) {
                              onSaveEditWithError(r.id, ["dx_location"]);
                            }
                          }}
                        >
                          <option value=""></option>
                          {getDropdownOptions(project, subproject, "dx_location").map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ), "col-6", true)}

                      {renderField("DOS_Flag", "DOS Flag", (
                        <select
                          className="form-select form-select-sm"
                          value={editDraft.DOS_Flag || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            onEditChange({ DOS_Flag: val });
                            if ((r.DOS_Flag || "") !== (val || "")) {
                              onSaveEditWithError(r.id, ["DOS_Flag"]);
                            }
                          }}
                        >
                          <option value=""></option>
                          {getDropdownOptions(project, subproject, "DOS_Flag").map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ), "col-6", true)}

                      {renderField("provider", "Meat Flag", (
                        <select
                          className="form-select form-select-sm"
                          value={editDraft.provider || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            onEditChange({ provider: val });
                            if ((r.provider || "") !== (val || "")) {
                              onSaveEditWithError(r.id, ["provider"]);
                            }
                          }}
                        >
                          <option value=""></option>
                          {getDropdownOptions(project, subproject, "provider").map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ), "col-6")}

                      {renderField("meat_dec", "Meat Details", (
                        <input
                          className="form-control form-control-sm"
                          value={editDraft.meat_dec || ""}
                          onChange={(e) => onEditChange({ meat_dec: e.target.value })}
                          onBlur={() => {
                            if ((r.meat_dec || "") !== (editDraft.meat_dec || "")) {
                              onSaveEditWithError(r.id, ["meat_dec"]);
                            }
                          }}
                        />
                      ), "col-6")}
                    </>
                  );
                })()}
              </div>

              <div className="mt-2 text-end">
                <button className="btn btn-outline-secondary btn-sm" onClick={onCancelEdit}>
                  Cancel Edit
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}