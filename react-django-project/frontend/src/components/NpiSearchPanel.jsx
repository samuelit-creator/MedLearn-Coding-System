import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";

/**
 * NpiSearchPanel - reusable NPI provider lookup widget.
 * Props:
 *   enabled      {boolean}  - if false, renders nothing
 *   npi          {string}   - controlled NPI input value
 *   onNpiChange  {fn}       - called with raw text when user types in NPI field
 *   onSelectNpi  {fn}       - called with (npiNumber) when a result is chosen
 *   onNpiBlur    {fn}       - called with raw text on NPI field blur
 */
export default function NpiSearchPanel({ enabled, npi, onNpiChange, onSelectNpi, onNpiBlur }) {
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [state, setState] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!enabled) return null;

  const handleFind = async () => {
    if (!firstName && !middleName && !lastName && !state) {
      setError("Please enter at least one search field.");
      return;
    }
    setError("");
    setLoading(true);
    setResults([]);
    setShowDropdown(false);
    try {
      const params = new URLSearchParams({ limit: 10 });
      if (firstName) params.set("first_name", firstName);
      if (middleName) params.set("middle_name", middleName);
      if (lastName) params.set("last_name", lastName);
      if (state) params.set("state", state);
      const res = await api.get(`/api/npi-search/?${params.toString()}`);
      const data = res.data.results || [];
      if (data.length === 0) {
        setError("No providers found. Try different search terms.");
      } else {
        setResults(data);
        setShowDropdown(true);
      }
    } catch (err) {
      setError("NPI search failed: " + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (provider) => {
    setShowDropdown(false);
    const npiNum = provider.npi || "";
    onNpiChange?.(npiNum);
    onSelectNpi?.(npiNum);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); handleFind(); }
  };

  return (
    <div
      className="card border-0 mb-3"
      style={{ background: "linear-gradient(135deg,#f0f9ff 0%,#e0f2fe 100%)", border: "1px solid #bae6fd" }}
    >
      <div
        className="card-header py-2 fw-semibold"
        style={{ background: "linear-gradient(90deg,#0ea5e9,#38bdf8)", color: "#fff", fontSize: "0.85rem", borderBottom: "none" }}
      >
        🔍 NPI Provider Search
      </div>
      <div className="card-body py-2 px-3">
        <div className="row g-2 align-items-end">
          <div className="col">
            <label className="form-label small mb-1 fw-semibold" style={{ color: "#0369a1" }}>First Name</label>
            <input type="text" className="form-control form-control-sm" placeholder="e.g. John"
              value={firstName} onChange={(e) => setFirstName(e.target.value)} onKeyDown={handleKeyDown} />
          </div>
          <div className="col">
            <label className="form-label small mb-1 fw-semibold" style={{ color: "#0369a1" }}>Middle Name</label>
            <input type="text" className="form-control form-control-sm" placeholder="e.g. A"
              value={middleName} onChange={(e) => setMiddleName(e.target.value)} onKeyDown={handleKeyDown} />
          </div>
          <div className="col">
            <label className="form-label small mb-1 fw-semibold" style={{ color: "#0369a1" }}>Last Name</label>
            <input type="text" className="form-control form-control-sm" placeholder="e.g. Smith"
              value={lastName} onChange={(e) => setLastName(e.target.value)} onKeyDown={handleKeyDown} />
          </div>
          <div className="col-auto" style={{ minWidth: 80 }}>
            <label className="form-label small mb-1 fw-semibold" style={{ color: "#0369a1" }}>State</label>
            <input type="text" className="form-control form-control-sm" placeholder="NY"
              maxLength={2} value={state}
              onChange={(e) => setState(e.target.value.toUpperCase())} onKeyDown={handleKeyDown}
              style={{ textTransform: "uppercase" }} />
          </div>
          <div className="col-auto">
            <button type="button" className="btn btn-sm"
              style={{ background: "linear-gradient(90deg,#0ea5e9,#0284c7)", color: "#fff", border: "none", fontWeight: 600, minWidth: 64, boxShadow: "0 2px 6px rgba(14,165,233,.3)" }}
              onClick={handleFind} disabled={loading}>
              {loading ? <span className="spinner-border spinner-border-sm" role="status" /> : "Find"}
            </button>
          </div>
        </div>

        {error && <div className="text-danger small mt-1">{error}</div>}

        {showDropdown && results.length > 0 && (
          <div ref={dropdownRef} className="border rounded shadow-sm mt-2"
            style={{ maxHeight: 240, overflowY: "auto", background: "#fff", zIndex: 1100, position: "relative" }}>
            {results.map((p, idx) => (
              <button key={idx} type="button"
                className="w-100 text-start px-3 py-2 border-0 border-bottom"
                style={{ cursor: "pointer", background: "transparent", transition: "background .15s" }}
                onMouseDown={() => handleSelect(p)}
                onMouseEnter={(e) => e.currentTarget.style.background = "#f0f9ff"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <div className="d-flex justify-content-between align-items-start">
                  <div>
                    <span className="badge me-2" style={{ background: "#0ea5e9", fontSize: "0.73rem" }}>{p.npi}</span>
                    <strong style={{ fontSize: "0.82rem" }}>
                      {[p.first_name, p.middle_name, p.last_name].filter(Boolean).join(" ")}
                    </strong>
                    {p.credential && <span className="text-muted ms-1" style={{ fontSize: "0.78rem" }}>({p.credential})</span>}
                  </div>
                  <span className="text-muted ms-2" style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                    {[p.city, p.state].filter(Boolean).join(", ")}
                  </span>
                </div>
                {p.specialty && <div className="text-secondary" style={{ fontSize: "0.73rem", marginTop: 2 }}>{p.specialty}</div>}
              </button>
            ))}
          </div>
        )}

        <div className="mt-2">
          <label className="form-label small mb-1 fw-semibold" style={{ color: "#0369a1" }}>NPI Number</label>
          <input type="text" className="form-control form-control-sm"
            placeholder="Auto-filled on selection, or enter manually"
            value={npi || ""} onChange={(e) => onNpiChange?.(e.target.value)}
            onBlur={(e) => onNpiBlur?.(e.target.value)}
            style={{ fontFamily: "monospace", letterSpacing: "0.05em" }} />
        </div>
      </div>
    </div>
  );
}
