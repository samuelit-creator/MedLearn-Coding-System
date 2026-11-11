import { useState, useEffect } from "react";
import { api, baseURL } from "../services/api";
import { ALL_FIELD_OPTIONS, fetchAndCacheProjectConfigs, getFieldsFromCache } from "../config/projectFieldsConfig";

export default function SearchChart() {
    const [chartId, setChartId] = useState("");
    const [data, setData] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchAndCacheProjectConfigs(api);
    }, []);

    const handleSearch = async () => {
        setError("");
        setData(null);
        setLoading(true);

        if (!chartId) {
            setError("Please enter Chart ID");
            setLoading(false);
            return;
        }

        try {
            const res = await api.get(`/api/search-chart/${chartId}/`);
            setData(res.data);
        } catch (err) {
            setError("Chart ID not found or error fetching data");
        } finally {
            setLoading(false);
        }
    };

    const activeFields = data ? getFieldsFromCache(data.project, data.subproject) : [];

    const renderCell = (r, key) => {
        if (key === 'dxcode') return <strong>{r[key]}</strong>;
        return r[key] || "";
    };

    const TableModule = ({ title, status, name, date, rows, errors }) => (
        <div style={{ marginBottom: "30px", border: "1px solid #eee", padding: "15px", borderRadius: "8px", backgroundColor: "#f9f9f9" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <h3 style={{ margin: 0, color: "#2c3e50" }}>{title}</h3>
                <span style={{ padding: "4px 10px", borderRadius: "12px", fontSize: "0.85rem", fontWeight: "bold", backgroundColor: status?.toLowerCase().includes("complete") ? "#d4edda" : "#fff3cd", color: status?.toLowerCase().includes("complete") ? "#155724" : "#856404" }}>
                    Status: {status || "Unknown"}
                </span>
            </div>

            {(name || date) && (
                <div style={{ marginBottom: "15px", fontSize: "0.85rem", color: "#555", borderBottom: "1px solid #eee", paddingBottom: "10px" }}>
                    {name && <span><strong>User:</strong> {name}</span>}
                    {date && <span style={{ marginLeft: "20px" }}><strong>Date:</strong> {date}</span>}
                </div>
            )}

            {/* Coding Rows */}
            <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "15px", fontSize: "0.9rem" }}>
                    <thead>
                        <tr style={{ backgroundColor: "#e9ecef", textAlign: "left" }}>
                            {activeFields.map(key => {
                                const opt = ALL_FIELD_OPTIONS.find(o => o.key === key);
                                return <th key={key} style={thStyle}>{opt ? opt.label : key}</th>;
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {rows && rows.length > 0 ? rows.map((r, i) => (
                            <tr key={i} style={{ borderBottom: "1px solid #ddd" }}>
                                {activeFields.map(key => (
                                    <td key={key} style={tdStyle}>{renderCell(r, key)}</td>
                                ))}
                            </tr>
                        )) : (
                            <tr><td colSpan={activeFields.length || 8} style={{ ...tdStyle, textAlign: "center", color: "#666" }}>No coding entries found</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Error Log (if applicable) */}
            {errors && errors.length > 0 && (
                <div style={{ marginTop: "15px" }}>
                    <h4 style={{ margin: "0 0 8px 0", fontSize: "0.95rem", color: "#c0392b" }}>Detected Errors / Changes</h4>
                    <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", backgroundColor: "#fff5f5" }}>
                            <thead>
                                <tr style={{ backgroundColor: "#fee2e2", textAlign: "left" }}>
                                    <th style={thStyle}>Type</th>
                                    <th style={thStyle}>DX</th>
                                    <th style={thStyle}>Pages</th>
                                    <th style={thStyle}>Comment</th>
                                    <th style={thStyle}>State</th>
                                </tr>
                            </thead>
                            <tbody>
                                {errors.map((e, i) => (
                                    <tr key={i} style={{ borderBottom: "1px solid #fecaca" }}>
                                        <td style={tdStyle}>{e.error_type}</td>
                                        <td style={tdStyle}><strong>{e.dxcode || "N/A"}</strong></td>
                                        <td style={tdStyle}>{e.start_page ?? "N/A"}-{e.end_page ?? "N/A"}</td>
                                        <td style={tdStyle}>{e.error_command || e.details}</td>
                                        <td style={tdStyle}>{e.user_action_command || e.coder_action || "logged"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );

    const thStyle = { padding: "10px", borderBottom: "2px solid #dee2e6" };
    const tdStyle = { padding: "10px" };

    return (
        <div style={{ padding: "30px", maxWidth: "1400px", margin: "0 auto", fontFamily: "Segoe UI, Tahoma, Geneva, Verdana, sans-serif" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "30px" }}>
                <h1 style={{ margin: 0, color: "#333" }}>Chart Audit Explorer</h1>
                <div style={{ display: "flex", gap: "10px" }}>
                    <input
                        type="text"
                        placeholder="Enter Chart ID (e.g. 29169809)"
                        value={chartId}
                        onChange={(e) => setChartId(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                        style={{ padding: "10px 15px", width: "250px", borderRadius: "6px", border: "1px solid #ccc", outline: "none" }}
                    />
                    <button
                        onClick={handleSearch}
                        disabled={loading}
                        style={{ padding: "10px 25px", borderRadius: "6px", border: "none", backgroundColor: "#007bff", color: "white", cursor: "pointer", fontWeight: "bold", opacity: loading ? 0.7 : 1 }}
                    >
                        {loading ? "Searching..." : "Search"}
                    </button>
                </div>
            </div>

            {error && (
                <div style={{ padding: "15px", backgroundColor: "#f8d7da", color: "#721c24", borderRadius: "6px", marginBottom: "20px", border: "1px solid #f5c6cb" }}>
                    {error}
                </div>
            )}

            {data && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 450px", gap: "30px" }}>
                    {/* Left Side: Data Tables */}
                    <div>
                        <TableModule
                            title="1. Coder's Coding"
                            status={data.coder.status}
                            name={data.coder.name}
                            date={data.coder.date}
                            rows={data.coder.rows}
                        />
                        <TableModule
                            title="2. Auditor's Coding & Errors"
                            status={data.auditor.status}
                            name={data.auditor.name}
                            date={data.auditor.date}
                            rows={data.auditor.rows}
                            errors={data.auditor.errors}
                        />
                        <TableModule
                            title="3. AT-Auditor's Coding & Errors"
                            status={data.at_auditor.status}
                            name={data.at_auditor.name}
                            date={data.at_auditor.date}
                            rows={data.at_auditor.rows}
                            errors={data.at_auditor.errors}
                        />
                    </div>

                    {/* Right Side: PDF Preview */}
                    <div>
                        <div style={{ position: "sticky", top: "20px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "15px" }}>
                                <h3 style={{ margin: 0 }}>Chart Preview</h3>
                                <a href={`${baseURL}${data.pdf_url}`} target="_blank" rel="noreferrer" style={{ fontSize: "0.85rem", color: "#007bff", textDecoration: "none" }}>Open in New Window ↗</a>
                            </div>
                            <iframe
                                src={`${baseURL}${data.pdf_url}`}
                                width="100%"
                                height="800px"
                                title="Chart PDF"
                                style={{ border: "1px solid #ccc", borderRadius: "8px", boxShadow: "0 4px 6px rgba(0,0,0,0.1)" }}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
