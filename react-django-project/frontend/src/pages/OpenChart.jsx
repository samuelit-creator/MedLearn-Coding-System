import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { api, baseURL } from "../services/api";
import { getFieldsForProject, fetchAndCacheProjectConfigs, getDropdownOptions, getNpiEnabled } from "../config/projectFieldsConfig";
import NpiSearchPanel from "../components/NpiSearchPanel";
import { useNavigate, useParams } from "react-router-dom";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { TextField, FormControl, InputLabel, Select, MenuItem } from "@mui/material";
import dayjs from "dayjs";
import ClarificationQueryPanel from "./ClarificationQueryPanel";
/* ---------------- helpers ---------------- */
const emptyAddForm = {
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
};

const emptyFinalForm = {
  chart_status: "",
  complete_command: "",
  reject_reason: "",
  reject_command: "",
  hold_command: "",
};

function groupRows(rows) {
  return (rows || []).reduce((acc, r) => {
    const key = `${r.from_date || ""} – ${r.to_date || ""} | ${r.pos || ""} | Pages: ${r.start_page || ""}-${r.end_page || ""}`.trim();
    (acc[key] ||= []).push(r);
    return acc;
  }, {});
}

/* ---------------- reusable DX autocomplete input ---------------- */
function DxAutocomplete({
  dxcode,
  details,
  onChangeDxcode,
  onPickSuggestion,
  onChangeDetails,
  results,
  onSearch,
  onCloseResults,
}) {
  const wrapRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) onCloseResults?.();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onCloseResults]);

  return (
    <>
      <div className="mb-3 position-relative" ref={wrapRef}>
        <label className="form-label">DX Code<span className="text-danger">*</span></label>
        <input
          type="text"
          className="form-control"
          autoComplete="off"
          value={dxcode}
          onChange={(e) => {
            const v = e.target.value;
            onChangeDxcode(v);
            onSearch(v);
          }}
        />

        {!!results?.length && (
          <div
            className="list-group position-absolute w-100 shadow-sm"
            style={{ zIndex: 1000, maxHeight: 250, overflowY: "auto" }}
          >
            {results.map((d) => (
              <button
                type="button"
                key={d[0]}
                className="list-group-item list-group-item-action"
                onMouseDown={() => onPickSuggestion(d[0], d[1])}
              >
                {d[0]} - {d[1]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-3">
        <label className="form-label">DX Description</label>
        <input
          type="text"
          className="form-control"
          value={details}
          onChange={(e) => onChangeDetails(e.target.value)}
        />
      </div>
    </>
  );
}

export default function OpenChart() {
  const { chartId } = useParams();
  const navigate = useNavigate();

  const [chart, setChart] = useState(null);
  const [rows, setRows] = useState([]);
  const [project, setProject] = useState("");
  const [subproject, setSubproject] = useState("");
  const [queryPanelOpen, setQueryPanelOpen] = useState(false);

  const [addForm, setAddForm] = useState(emptyAddForm);

  const [editRowId, setEditRowId] = useState(null);
  const [editForm, setEditForm] = useState(emptyAddForm);

  const [finalForm, setFinalForm] = useState(emptyFinalForm);

  const [addDxResults, setAddDxResults] = useState([]);
  const [editDxResults, setEditDxResults] = useState([]);

  const [editingGroupKey, setEditingGroupKey] = useState(null);
  const [groupEditDraft, setGroupEditDraft] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const addDebounceRef = useRef(null);
  const editDebounceRef = useRef(null);

  useEffect(() => {
    loadChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartId]);

  const loadChart = async () => {
    await fetchAndCacheProjectConfigs(api);
    const res = await api.get(`/api/chart/${chartId}/`);
    setChart(res.data);
    setRows(res.data.rows || []);
    setProject(res.data.project || "");
    setSubproject(res.data.subproject || "");
    if (res.data.chart_status) {
      setFinalForm(s => ({ ...s, chart_status: res.data.chart_status }));
    }
  };

  /* ---------------- DX AUTOCOMPLETE ---------------- */
  const fetchDx = async (q, setResults) => {
    const query = (q || "").trim();
    if (!query) return setResults([]);

    try {
      // Using 'api' instance which includes credentials and auth headers
      const res = await api.get(`/api/icd10-search/?terms=${encodeURIComponent(query)}&project=${encodeURIComponent(project)}&subproject=${encodeURIComponent(subproject)}`);
      setResults(res.data || []);
    } catch (err) {
      console.error("ICD-10 Search Error:", err);
      setResults([]);
    }
  };


  const searchDxAdd = (q) => {
    if (addDebounceRef.current) clearTimeout(addDebounceRef.current);
    addDebounceRef.current = setTimeout(() => {
      fetchDx(q, setAddDxResults).catch(() => setAddDxResults([]));
    }, 150);
  };

  const searchDxEdit = (q) => {
    if (editDebounceRef.current) clearTimeout(editDebounceRef.current);
    editDebounceRef.current = setTimeout(() => {
      fetchDx(q, setEditDxResults).catch(() => setEditDxResults([]));
    }, 150);
  };

  /* ---------------- CRUD ACTIONS ---------------- */
  const validateForm = (form) => {
    const activeFields = getFieldsForProject(project, subproject);
    const required = [
      { key: "from_date", label: "From DOS" },
      { key: "to_date", label: "To DOS" },
      { key: "dxcode", label: "DX Code" },
      { key: "dx_location", label: "DX Location" },
      { key: "start_page", label: "Start Page" },
      { key: "end_page", label: "End Page" },
    ].filter(f => activeFields.includes(f.key) || f.key === "dxcode");
    const missing = required.filter(f => !form[f.key] || String(form[f.key]).trim() === "");
    if (missing.length > 0) {
      alert("Please fill in the following mandatory fields:\n- " + missing.map(f => f.label).join("\n- "));
      return false;
    }
    return true;
  };

  const validateFinalForm = (form) => {
    const missing = [];
    if (!form.chart_status) missing.push("Chart Status");
    if (form.chart_status === "complete" && !form.complete_command) missing.push("Complete Command");
    if (form.chart_status === "reject" && !form.reject_reason) missing.push("Reject Reason");
    // Hold: no extra mandatory fields

    if (missing.length > 0) {
      alert("Please fill in the following mandatory fields:\n- " + missing.join("\n- "));
      return false;
    }
    return true;
  };
  const submit = async (action, payload) => {
    if ((action === "add" || action === "edit") && !validateForm(payload)) {
      return;
    }
    if (action === "save" && !validateFinalForm(payload)) {
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const resp = await api.post(`/api/chart/${chartId}/`, { action, ...payload });
      if (resp.data.error) {
        alert("Error: " + resp.data.error);
      } else if (action === "save") {
        alert("Chart saved successfully!");
      }
    } catch (err) {
      console.error(err);
      alert("Submission failed: " + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }

    setEditRowId(null);
    setEditForm(emptyAddForm);
    setAddDxResults([]);
    setEditDxResults([]);

    if (action === "add") {
      // Smart reset: preserve npi, dates, pages, pos — only clear DX-specific fields
      setAddForm((s) => ({
        ...s,
        dxcode: "",
        details: "",
        eo: "",
        provider: "",
        meat_dec: "",
        dx_location: "",
        DOS_Flag: "",
        // npi intentionally NOT cleared — user may be adding multiple DX for same provider
      }));
    }
    if (action === "save") {
      // Only navigate away on complete/reject, stay on hold
      if (payload.chart_status !== "hold") {
        navigate("/coder");
      }
      return;
    }

    await loadChart();
  };

  const startGroupEdit = (key, items) => {
    setEditingGroupKey(key);
    setGroupEditDraft({
      from_date: items[0].from_date || "",
      to_date: items[0].to_date || "",
      start_page: items[0].start_page || "",
      end_page: items[0].end_page || "",
      pos: items[0].pos || "",
    });
  };

  const saveGroupEdit = async (items) => {
    if (!groupEditDraft) return;
    const rowIds = items.map((r) => r.id);

    if (submitting) return;
    setSubmitting(true);
    try {
      await api.post(`/api/chart/${chartId}/`, {
        action: "bulk_update",
        row_ids: rowIds,
        updates: groupEditDraft
      });
      setEditingGroupKey(null);
      setGroupEditDraft(null);
      await loadChart();
    } catch (err) {
      console.error(err);
      alert("Bulk update failed: " + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------------- PDF POPUP ---------------- */
  const openPopup = () => {
    if (!chart) return;

    const w = window.open(
      "",
      "PDFPopup",
      "width=900,height=700,scrollbars=yes,resizable=yes"
    );
    if (!w) return;

    w.document.write(`
      <html>
        <head>
          <title>PDF Viewer</title>
          <style>
            html, body { margin:0; height:100%; user-select: none; }
            iframe { width:100%; height:100%; border:none; }
          </style>
        </head>
        <body oncontextmenu="return false;">
          <iframe src="${baseURL}/media/${chart.pdf_path.split('/').map(encodeURIComponent).join('/')}"></iframe>
        </body>
      </html>
    `);
    w.document.close();
  };

  const groupedRows = useMemo(() => groupRows(rows), [rows]);

  const isLocked = ["complete", "completed", "reject", "rejected"].includes(chart?.chart_status?.toLowerCase());

  if (!chart) return null;

  const activeFields = getFieldsForProject(project, subproject);
  const npiEnabled = getNpiEnabled(project, subproject);

  const renderField = (fieldName, label, element, colWidth = "col-md-6", isRequired = false) => {
    if (!activeFields.includes(fieldName)) return null;
    return (
      <div className={colWidth}>
        <label className="form-label">
          {label}
          {isRequired && <span className="text-danger">*</span>}
        </label>
        {element}
      </div>
    );
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <div
        className="container-fluid py-3"
        onContextMenu={(e) => e.preventDefault()}
        style={{ userSelect: "none" }}
      >
        {/* HEADER */}
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div className="d-flex gap-2">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={openPopup}
            >
              Open in New Window
            </button>
            <button
              type="button"
              className="btn btn-sm"
              style={{ background: "linear-gradient(90deg,#7c3aed,#4f46e5)", color: "#fff", border: "none", fontWeight: 600 }}
              onClick={() => setQueryPanelOpen(true)}
            >
              💬 Query
            </button>
          </div>
          <div className="fw-semibold">
            ID: <span className="fw-bold">{chart.chart_id}</span>
          </div>
        </div>

        {/* CLARIFICATION PANEL */}
        <ClarificationQueryPanel
          open={queryPanelOpen}
          onClose={() => setQueryPanelOpen(false)}
          chartId={chart.chart_id}
          project={project}
          subproject={subproject}
          chart={chart}
        />

        <div className="row g-3">
          {/* Audit Feedback */}
          {chart.audit_log && chart.audit_log.length > 0 && (
            <div className="col-12">
              <div className="card mb-3">
                <div className="card-header bg-info text-white">Audit Feedback</div>
                <div className="card-body p-0">
                  <div className="table-responsive">
                    <table className="table table-sm table-bordered mb-0">
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
                        {chart.audit_log.map((e, idx) => (
                          <tr key={idx}>
                            <td className="small">{e.created_at}</td>
                            <td>{e.dxcode}</td>
                            <td>{e.error_type}</td>
                            <td>{e.error_count}</td>
                            <td>{e.error_command}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* RIGHT: PDF */}
          <div className="col-lg-7 order-lg-1">
            <div className="card h-100">
              <div className="card-header py-2">Chart PDF</div>
              <div className="card-body p-0">
                <iframe
                  title="pdf"
                  src={`${baseURL}/media/${chart.pdf_path.split('/').map(encodeURIComponent).join('/')}`}
                  className="w-100"
                  style={{ height: "100%", border: "none" }}
                />
              </div>
            </div>
          </div>

          {/* LEFT: Forms & Tables */}
          <div className="col-lg-5 order-lg-2">
            {/* ADD FORM - Hidden if locked */}
            {!isLocked && (
              <div className="card mb-4">
                <div className="card-header">Add DX</div>
                <div className="card-body">
                  <div className="row g-3">
                    {renderField("pos", "POS", (
                      <select
                        className="form-select"
                        value={addForm.pos}
                        onChange={(e) => {
                          const newPos = e.target.value;
                          setAddForm((s) => {
                            const updated = { ...s, pos: newPos };
                            if (newPos && newPos !== "Inpatient" && newPos !== "HI" && newPos !== "HO" && s.from_date) {
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
                    ), "col-md-3", false)}

                    {renderField("from_date", "From DOS", (
                      <DatePicker
                        format="MM-DD-YYYY"
                        slotProps={{ textField: { size: "small", fullWidth: true } }}
                        value={addForm.from_date ? dayjs(addForm.from_date) : null}
                        onChange={(val) => {
                          const d = val ? val.format("YYYY-MM-DD") : "";
                          setAddForm((s) => ({
                            ...s,
                            from_date: d,
                            to_date: s.pos && s.pos !== "Inpatient" && s.pos !== "HI" && s.pos !== "HO" ? d : s.to_date,
                          }));
                        }}
                      />
                    ), "col-md-6", true)}

                    {renderField("to_date", "To DOS", (
                      <DatePicker
                        format="MM-DD-YYYY"
                        disabled={addForm.pos !== "" && addForm.pos !== "Inpatient" && addForm.pos !== "HI" && addForm.pos !== "HO"}
                        slotProps={{ textField: { size: "small", fullWidth: true } }}
                        value={addForm.to_date ? dayjs(addForm.to_date) : null}
                        onChange={(val) =>
                          setAddForm((s) => ({
                            ...s,
                            to_date: val ? val.format("YYYY-MM-DD") : "",
                          }))
                        }
                      />
                    ), "col-md-6", true)}

                    {renderField("start_page", "Start Page", (
                      <input
                        className="form-control"
                        value={addForm.start_page}
                        onChange={(e) =>
                          setAddForm((s) => ({
                            ...s,
                            start_page: e.target.value,
                          }))
                        }
                      />
                    ), "col-md-6", true)}

                    {renderField("end_page", "End Page", (
                      <input
                        className="form-control"
                        value={addForm.end_page}
                        onChange={(e) =>
                          setAddForm((s) => ({
                            ...s,
                            end_page: e.target.value,
                          }))
                        }
                      />
                    ), "col-md-6", true)}

                    <div className="col-12">
                      <NpiSearchPanel
                        enabled={npiEnabled}
                        npi={addForm.npi}
                        onNpiChange={(v) => setAddForm((s) => ({ ...s, npi: v }))}
                        onSelectNpi={(v) => setAddForm((s) => ({ ...s, npi: v }))}
                      />
                      <DxAutocomplete
                        dxcode={addForm.dxcode}
                        details={addForm.details}
                        results={addDxResults}
                        onSearch={searchDxAdd}
                        onCloseResults={() => setAddDxResults([])}
                        onChangeDxcode={(v) =>
                          setAddForm((s) => ({ ...s, dxcode: v }))
                        }
                        onChangeDetails={(v) =>
                          setAddForm((s) => ({ ...s, details: v }))
                        }
                        onPickSuggestion={(code, name) => {
                          setAddForm((s) => ({ ...s, dxcode: code, details: name }));
                          setAddDxResults([]);
                        }}
                      />
                    </div>

                    {renderField("eo", "DX Flag", (
                      <select
                        className="form-select"
                        value={addForm.eo}
                        onChange={(e) =>
                          setAddForm((s) => ({ ...s, eo: e.target.value }))
                        }
                      >
                        <option value=""></option>
                        {getDropdownOptions(project, subproject, "eo").map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ), "col-md-3", false)}

                    {renderField("provider", "Meat Flag", (
                      <select
                        className="form-select"
                        value={addForm.provider}
                        onChange={(e) =>
                          setAddForm((s) => ({ ...s, provider: e.target.value }))
                        }
                      >
                        <option value=""></option>
                        {getDropdownOptions(project, subproject, "provider").map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ), "col-md-6", false)}

                    {renderField("meat_dec", "Meat Details", (
                      <input
                        type="text"
                        className="form-control"
                        value={addForm.meat_dec}
                        onChange={(e) =>
                          setAddForm((s) => ({ ...s, meat_dec: e.target.value }))
                        }
                      />
                    ), "col-md-6", false)}

                    {renderField("dx_location", "DX Location", (
                      <select
                        className="form-select"
                        value={addForm.dx_location}
                        onChange={(e) =>
                          setAddForm((s) => ({
                            ...s,
                            dx_location: e.target.value,
                          }))
                        }
                      >
                        <option value=""></option>
                        {getDropdownOptions(project, subproject, "dx_location").map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ), "col-md-4", false)}

                    {renderField("DOS_Flag", "DOS Flag", (
                      <select
                        className="form-select"
                        value={addForm.DOS_Flag}
                        onChange={(e) =>
                          setAddForm((s) => ({
                            ...s,
                            DOS_Flag: e.target.value,
                          }))
                        }
                      >
                        <option value=""></option>
                        {getDropdownOptions(project, subproject, "DOS_Flag").map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ), "col-md-4", false)}
                  </div>

                  <div className="mt-3">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => submit("add", addForm)}
                      disabled={submitting}
                    >
                      {submitting ? "Adding..." : "Add DX"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* GROUPED TABLES */}
            {Object.keys(groupedRows).length === 0 ? (
              <p className="text-muted fst-italic">No DX entries</p>
            ) : (
              Object.entries(groupedRows).map(([group, items]) => (
                <div className="card mb-3" key={group}>
                  <div className="card-header bg-light">
                    <div className="d-flex justify-content-between align-items-center">
                      {editingGroupKey === group ? (
                        <div className="d-flex gap-2 align-items-center flex-wrap w-100 py-1" onClick={(e) => e.stopPropagation()}>
                          <div style={{ minWidth: 150, flex: "1 1 0" }}>
                            <DatePicker
                              label="From DOS"
                              format="MM-DD-YYYY"
                              slotProps={{ textField: { size: "small", fullWidth: true } }}
                              value={groupEditDraft.from_date ? dayjs(groupEditDraft.from_date) : null}
                              onChange={(val) => {
                                const newFrom = val ? val.format("YYYY-MM-DD") : "";
                                setGroupEditDraft(s => {
                                  const updated = { ...s, from_date: newFrom };
                                  if (s.pos && s.pos !== "Inpatient" && s.pos !== "HI" && s.pos !== "HO") {
                                    updated.to_date = newFrom;
                                  }
                                  return updated;
                                });
                              }}
                            />
                          </div>
                          <div style={{ minWidth: 150, flex: "1 1 0" }}>
                            <DatePicker
                              label="To DOS"
                              format="MM-DD-YYYY"
                              disabled={groupEditDraft.pos !== "" && groupEditDraft.pos !== "Inpatient" && groupEditDraft.pos !== "HI" && groupEditDraft.pos !== "HO"}
                              slotProps={{ textField: { size: "small", fullWidth: true } }}
                              value={groupEditDraft.to_date ? dayjs(groupEditDraft.to_date) : null}
                              onChange={(val) => setGroupEditDraft(s => ({ ...s, to_date: val ? val.format("YYYY-MM-DD") : "" }))}
                            />
                          </div>
                          <div style={{ width: 100 }}>
                            <TextField
                              label="Start Page"
                              size="small"
                              type="number"
                              fullWidth
                              value={groupEditDraft.start_page || ""}
                              onChange={(e) => setGroupEditDraft(s => ({ ...s, start_page: e.target.value }))}
                            />
                          </div>
                          <div style={{ width: 100 }}>
                            <TextField
                              label="End Page"
                              size="small"
                              type="number"
                              fullWidth
                              value={groupEditDraft.end_page || ""}
                              onChange={(e) => setGroupEditDraft(s => ({ ...s, end_page: e.target.value }))}
                            />
                          </div>
                          <div style={{ width: 120 }}>
                            <FormControl fullWidth size="small">
                              <InputLabel>POS</InputLabel>
                              <Select
                                value={groupEditDraft.pos || ""}
                                label="POS"
                                onChange={(e) => {
                                  const newPos = e.target.value;
                                  setGroupEditDraft(s => {
                                    const updated = { ...s, pos: newPos };
                                    if (newPos && newPos !== "Inpatient" && newPos !== "HI" && newPos !== "HO" && s.from_date) {
                                      updated.to_date = s.from_date;
                                    }
                                    return updated;
                                  });
                                }}
                              >
                                <MenuItem value=""></MenuItem>
                                {getDropdownOptions(project, subproject, "pos").map(opt => (
                                  <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                                ))}
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
                          <div
                            onClick={(e) => {
                              if (items.length > 0) {
                                const first = items[0];
                                setAddForm((s) => ({
                                  ...s,
                                  from_date: first.from_date || "",
                                  to_date: first.to_date || "",
                                  pos: first.pos || "",
                                  start_page: first.start_page || "",
                                  end_page: first.end_page || "",
                                }));
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }
                            }}
                          >
                            <strong>{group}</strong>
                            {npiEnabled && (() => {
                              const npiVals = [...new Set(items.map(r => r.npi).filter(Boolean))];
                              return npiVals.length > 0 ? (
                                <span className="ms-2">
                                  {npiVals.map(n => (
                                    <span key={n} className="badge ms-1" style={{ background: "#0ea5e9", fontSize: "0.72rem" }}>NPI: {n}</span>
                                  ))}
                                </span>
                              ) : null;
                            })()}
                          </div>
                          {!isLocked && (
                            <button
                              className="btn btn-sm btn-outline-primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                startGroupEdit(group, items);
                              }}
                            >
                              Edit Group
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="card-body p-0">
                    <div className="table-responsive">
                      <table className="table table-sm mb-0">
                        <thead className="table-secondary">
                          <tr>
                            <th style={{ width: "25%" }}>DX</th>
                            {npiEnabled && <th style={{ width: "12%" }}>NPI</th>}
                            {activeFields.includes("provider") && <th style={{ width: "20%" }}>Meat Flag</th>}
                            {activeFields.includes("eo") && <th style={{ width: "15%" }}>Flag</th>}
                            {activeFields.includes("dx_location") && <th style={{ width: "20%" }}>DX Location</th>}
                            {activeFields.includes("DOS_Flag") && <th style={{ width: "15%" }}>DOS Flag</th>}
                            <th style={{ width: "10%" }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((r) => (
                            <Fragment key={r.id}>
                              <tr>
                                <td>{r.dxcode}</td>
                                {npiEnabled && <td><span className="badge" style={{ background: "#0ea5e9", fontSize: "0.72rem" }}>{r.npi || "-"}</span></td>}
                                {activeFields.includes("provider") && <td>{r.provider}</td>}
                                {activeFields.includes("eo") && <td>{r.eo}</td>}
                                {activeFields.includes("dx_location") && <td>{r.dx_location}</td>}
                                {activeFields.includes("DOS_Flag") && <td>{r.DOS_Flag}</td>}
                                <td className="text-nowrap">
                                  {!isLocked && (
                                    <>
                                      <button
                                        type="button"
                                        className="btn btn-outline-primary btn-sm me-1"
                                        onClick={() => {
                                          setEditRowId(r.id);
                                          setEditForm({
                                            from_date: r.from_date || "",
                                            to_date: r.to_date || "",
                                            start_page: r.start_page || "",
                                            end_page: r.end_page || "",
                                            dxcode: r.dxcode || "",
                                            details: r.details || "",
                                            provider: r.provider || "",
                                            meat_dec: r.meat_dec || "",
                                            eo: r.eo || "",
                                            pos: r.pos || "",
                                            dx_location: r.dx_location || "",
                                            DOS_Flag: r.DOS_Flag || "",
                                            npi: r.npi || "",
                                          });
                                          setEditDxResults([]);
                                        }}
                                      >
                                        Edit
                                      </button>

                                      <button
                                        type="button"
                                        className="btn btn-outline-danger btn-sm"
                                        onClick={() => {
                                          if (!window.confirm("Delete this DX?"))
                                            return;
                                          submit("delete", { row_id: r.id });
                                        }}
                                      >
                                        Delete
                                      </button>
                                    </>
                                  )}
                                  {isLocked && <span className="text-muted small">Locked</span>}
                                </td>
                              </tr>

                              {editRowId === r.id && (
                                <tr>
                                  <td colSpan="6">
                                    <div className="card border-primary mb-2">
                                      <div className="card-header py-1 bg-primary text-white">
                                        Edit DX
                                      </div>
                                      <div className="card-body p-2">
                                        <div className="row g-2">
                                          {renderField("from_date", "From DOS", (
                                            <DatePicker
                                              format="MM-DD-YYYY"
                                              slotProps={{ textField: { size: "small", fullWidth: true } }}
                                              value={editForm.from_date ? dayjs(editForm.from_date) : null}
                                              onChange={(val) => {
                                                const d = val ? val.format("YYYY-MM-DD") : "";
                                                setEditForm((s) => ({
                                                  ...s,
                                                  from_date: d,
                                                  to_date: s.pos !== "Inpatient" && s.pos !== "HI" && s.pos !== "HO" ? d : s.to_date
                                                }));
                                              }}
                                            />
                                          ), "col-md-3", true)}

                                          {renderField("to_date", "To DOS", (
                                            <DatePicker
                                              format="MM-DD-YYYY"
                                              slotProps={{ textField: { size: "small", fullWidth: true } }}
                                              value={editForm.to_date ? dayjs(editForm.to_date) : null}
                                              onChange={(val) => {
                                                const d = val ? val.format("YYYY-MM-DD") : "";
                                                setEditForm((s) => ({ ...s, to_date: d }));
                                              }}
                                            />
                                          ), "col-md-3", true)}

                                          {renderField("start_page", "Start Page", (
                                            <input
                                              className="form-control form-control-sm"
                                              value={editForm.start_page}
                                              onChange={(e) => setEditForm((s) => ({ ...s, start_page: e.target.value }))}
                                            />
                                          ), "col-md-3", true)}

                                          {renderField("end_page", "End Page", (
                                            <input
                                              className="form-control form-control-sm"
                                              value={editForm.end_page}
                                              onChange={(e) => setEditForm((s) => ({ ...s, end_page: e.target.value }))}
                                            />
                                          ), "col-md-3", true)}

                                          <div className="col-12">
                                            <NpiSearchPanel
                                              enabled={npiEnabled}
                                              npi={editForm.npi}
                                              onNpiChange={(v) => setEditForm((s) => ({ ...s, npi: v }))}
                                              onSelectNpi={(v) => setEditForm((s) => ({ ...s, npi: v }))}
                                            />
                                            <DxAutocomplete
                                              dxcode={editForm.dxcode}
                                              details={editForm.details}
                                              results={editDxResults}
                                              onSearch={searchDxEdit}
                                              onCloseResults={() => setEditDxResults([])}
                                              onChangeDxcode={(v) => setEditForm((s) => ({ ...s, dxcode: v }))}
                                              onChangeDetails={(v) => setEditForm((s) => ({ ...s, details: v }))}
                                              onPickSuggestion={(code, name) => {
                                                setEditForm((s) => ({ ...s, dxcode: code, details: name }));
                                                setEditDxResults([]);
                                              }}
                                            />
                                          </div>

                                          {renderField("eo", "DX Flag", (
                                            <select
                                              className="form-select"
                                              value={editForm.eo}
                                              onChange={(e) => setEditForm((s) => ({ ...s, eo: e.target.value }))}
                                            >
                                              <option value=""></option>
                                              {getDropdownOptions(project, subproject, "eo").map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                              ))}
                                            </select>
                                          ), "col-md-3", false)}

                                          {renderField("pos", "POS", (
                                            <select
                                              className="form-select"
                                              value={editForm.pos}
                                              onChange={(e) => setEditForm((s) => ({ ...s, pos: e.target.value }))}
                                            >
                                              <option value=""></option>
                                              {getDropdownOptions(project, subproject, "pos").map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                              ))}
                                            </select>
                                          ), "col-md-3", false)}

                                          {renderField("provider", "Meat Flag", (
                                            <select
                                              className="form-select"
                                              value={editForm.provider}
                                              onChange={(e) => setEditForm((s) => ({ ...s, provider: e.target.value }))}
                                            >
                                              <option value=""></option>
                                              {getDropdownOptions(project, subproject, "provider").map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                              ))}
                                            </select>
                                          ), "col-md-6", false)}

                                          {renderField("meat_dec", "Meat Details", (
                                            <input
                                              type="text"
                                              className="form-control"
                                              value={editForm.meat_dec}
                                              onChange={(e) => setEditForm((s) => ({ ...s, meat_dec: e.target.value }))}
                                            />
                                          ), "col-md-6", false)}

                                          {renderField("dx_location", "DX Location", (
                                            <select
                                              className="form-select"
                                              value={editForm.dx_location}
                                              onChange={(e) => setEditForm((s) => ({ ...s, dx_location: e.target.value }))}
                                            >
                                              <option value=""></option>
                                              {getDropdownOptions(project, subproject, "dx_location").map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                              ))}
                                            </select>
                                          ), "col-md-4", false)}

                                          {renderField("DOS_Flag", "DOS Flag", (
                                            <select
                                              className="form-select"
                                              value={editForm.DOS_Flag}
                                              onChange={(e) => setEditForm((s) => ({ ...s, DOS_Flag: e.target.value }))}
                                            >
                                              <option value=""></option>
                                              {getDropdownOptions(project, subproject, "DOS_Flag").map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                              ))}
                                            </select>
                                          ), "col-md-4", false)}
                                        </div>

                                        <div className="mt-3">
                                          <button
                                            type="button"
                                            className="btn btn-primary btn-sm me-2"
                                            onClick={() =>
                                              submit("edit", {
                                                row_id: r.id,
                                                ...editForm,
                                              })
                                            }
                                          >
                                            Save
                                          </button>
                                          <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => {
                                              setEditRowId(null);
                                              setEditForm(emptyAddForm);
                                              setEditDxResults([]);
                                            }}
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ))
            )}

            {/* FINAL SAVE - Disabled if locked */}
            <div className="card">
              <div className="card-header">Finalize Chart</div>
              <div className="card-body">
                {isLocked ? (
                  <div className="alert alert-info mb-0">
                    This chart is finalized (Status: <strong>{chart.chart_status}</strong>). Modifications are disabled.
                  </div>
                ) : (
                  <div className="row g-3">
                    <div className="col-md-4">
                      <label className="form-label">Chart Status</label>
                      <select
                        className="form-select"
                        value={finalForm.chart_status}
                        onChange={(e) =>
                          setFinalForm((s) => ({
                            ...s,
                            chart_status: e.target.value,
                            complete_command: "",
                            reject_reason: "",
                            reject_command: "",
                            hold_command: "",
                          }))
                        }

                      >
                        <option value=""></option>
                        <option value="complete">Complete</option>
                        <option value="reject">Reject</option>
                        {/*<option value="hold">Hold</option> */}
                      </select>
                    </div>

                    {finalForm.chart_status === "complete" && (
                      <div className="col-md-8">
                        <label className="form-label">Complete Command</label>
                        <select
                          className="form-select"
                          value={finalForm.complete_command}
                          onChange={(e) =>
                            setFinalForm((s) => ({
                              ...s,
                              complete_command: e.target.value,
                            }))
                          }

                        >
                          <option value=""></option>
                          {getDropdownOptions(project, subproject, "complete_command").map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {finalForm.chart_status === "reject" && (
                      <>
                        <div className="col-md-6">
                          <label className="form-label">Reject Reason</label>
                          <select
                            className="form-select"
                            value={finalForm.reject_reason}
                            onChange={(e) =>
                              setFinalForm((s) => ({
                                ...s,
                                reject_reason: e.target.value,
                              }))
                            }

                          >
                            <option value=""></option>
                            {getDropdownOptions(project, subproject, "reject_reason").map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </div>

                        <div className="col-md-6">
                          <label className="form-label">Reject Notes</label>
                          <textarea
                            className="form-control"
                            rows="3"
                            value={finalForm.reject_command}
                            onChange={(e) =>
                              setFinalForm((s) => ({
                                ...s,
                                reject_command: e.target.value,
                              }))
                            }

                          />
                        </div>
                      </>
                    )}

                    {finalForm.chart_status === "hold" && (
                      <div className="col-12">
                        <label className="form-label">Hold Notes</label>
                        <textarea
                          className="form-control"
                          rows="3"
                          placeholder="Reason for holding this chart..."
                          value={finalForm.hold_command}
                          onChange={(e) =>
                            setFinalForm((s) => ({
                              ...s,
                              hold_command: e.target.value,
                            }))
                          }
                        />
                      </div>
                    )}

                    <div className="mt-3">
                      <button
                        type="button"
                        className={`btn ${finalForm.chart_status === "hold" ? "btn-warning" : "btn-success"}`}
                        onClick={() => submit("save", finalForm)}
                      >
                        {finalForm.chart_status === "hold" ? "Put on Hold" : "Submit Chart"}
                      </button>
                    </div>

                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </LocalizationProvider>
  );
}