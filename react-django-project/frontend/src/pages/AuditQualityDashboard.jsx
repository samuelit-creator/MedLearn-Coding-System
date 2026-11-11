import { useEffect, useState } from "react";
import { api } from "../services/api";
import {
  Box, Table, TableHead, TableRow, TableCell,
  TableBody, Button, Typography, Paper, TableContainer, TextField, Chip, Fade, Tabs, Tab
} from "@mui/material";
import QualityActionDialog from "../components/QualityActionDialog";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";

export default function AuditQualityDashboard() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [project, setProject] = useState("");
  const [subproject, setSubproject] = useState("");

  const [rows, setRows] = useState([]);
  const [fullRows, setFullRows] = useState([]);
  const [summary, setSummary] = useState([]);
  const [selected, setSelected] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [tabValue, setTabValue] = useState(0);

  // Project / subproject dropdown options
  const [projectOptions, setProjectOptions] = useState([]);
  const [subprojectOptions, setSubprojectOptions] = useState([]);
  const [allConfigs, setAllConfigs] = useState([]);

  const load = async (overrides = {}) => {
    const params = {
      from_date: overrides.fromDate !== undefined ? (overrides.fromDate || undefined) : (fromDate || undefined),
      to_date: overrides.toDate !== undefined ? (overrides.toDate || undefined) : (toDate || undefined),
      project: overrides.project !== undefined ? (overrides.project || undefined) : (project || undefined),
      subproject: overrides.subproject !== undefined ? (overrides.subproject || undefined) : (subproject || undefined),
      source: 'at_audit',  // Only show errors AT-Auditors put on Auditors (at_audit_errors table)
    };

    const [dashRes, sumRes, fullRes] = await Promise.all([
      api.get("/api/quality/dashboard/", { params }),
      api.get("/api/quality/summary/", { params }),
      api.get("/api/quality/dashboard/", { params: { ...params, include_all: 'true' } })
    ]);

    setRows(dashRes.data.rows);
    setSummary(sumRes.data.rows);
    setFullRows(fullRes.data.rows);
  };

  useEffect(() => {
    load();
    // Load project-field-config for dropdown options
    api.get("/api/project-field-config/").then(res => {
      const configs = res.data.configs || [];
      setAllConfigs(configs);
      const uniqueProjects = [...new Set(configs.map(c => c.project).filter(Boolean))].sort();
      setProjectOptions(uniqueProjects);
    }).catch(() => {});
  }, []);

  // When project changes, update subproject options
  const handleProjectChange = (val) => {
    setProject(val);
    setSubproject("");
    const subs = [...new Set(
      allConfigs.filter(c => c.project === val).map(c => c.subproject).filter(Boolean)
    )].sort();
    setSubprojectOptions(subs);
  };

  // ── Helper: derive review level label (same logic as table render) ──
  const getReviewLevel = (r) => {
    let level = "Pending " + (r.source === "audit" ? "Coder" : "Auditor");
    if (r.coder_action === "disagree") {
      if (r.source === "audit") {
        if (!r.coder_tl_action) level = "Coder TL Review";
        else if (!r.audit_action) level = "Original Auditor Review";
        else if (!r.audit_tl_action) level = "Auditor TL Review";
      } else {
        if (!r.coder_tl_action) level = "Auditor TL Review";
        else if (!r.audit_action) level = "AT-Auditor Review";
        else if (!r.audit_tl_action) level = "AT-Auditor TL Review";
      }
    }
    return level;
  };

  const exportToExcel = async () => {
    setExporting(true);
    try {
      // Always re-fetch fresh data so export is never dependent on stale state
      const params = {
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        project: project || undefined,
        subproject: subproject || undefined,
        source: 'at_audit',  // Only at_audit_errors (at-auditor → auditor)
      };

      const [dashRes, sumRes, fullRes] = await Promise.all([
        api.get("/api/quality/dashboard/", { params }),
        api.get("/api/quality/summary/", { params }),
        api.get("/api/quality/dashboard/", { params: { ...params, include_all: 'true' } })
      ]);

      const exportRows = fullRes.data.rows || [];
      const exportSummary = sumRes.data.rows || [];

      const wb = XLSX.utils.book_new();

      // ── Sheet 1: Quality Summary ──
      const summaryHeaders = ["S.No", "Project", "Sub Project", "Total Audited", "Total ICD", "Total Error", "Quality %"];
      const summaryDataRows = exportSummary.map((r, idx) => [
        idx + 1,
        r.project ?? "-",
        r.subproject ?? "-",
        r.total_audited ?? 0,
        r.total_icd ?? 0,
        r.total_error ?? 0,
        r.quality_percent ?? 100,
      ]);
      const ws1 = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryDataRows]);
      ws1["!cols"] = summaryHeaders.map(h => ({ wch: Math.max(h.length + 2, 14) }));
      XLSX.utils.book_append_sheet(wb, ws1, "Quality Summary");

      // ── Sheet 2: Error Details ──
      const detailHeaders = [
        "Chart ID", "Project", "Sub Project", "DX Code",
        "Start Page", "End Page", "Error Type", "DX Location",
        "Error Count", "Error Comment (Auditor)", "Chart Date", "Source",
        "Coder Action", "Coder Comment", "Coder Action Date",
        "Coder TL Action", "Coder TL Comment", "Coder TL Action Date",
        "Auditor Action", "Auditor Comment", "Auditor Action Date",
        "Auditor TL Action", "Auditor TL Comment", "Auditor TL Action Date",
      ];
      const detailDataRows = exportRows.map((r) => [
        String(r.chart_id ?? "-"),
        String(r.project ?? "-"),
        String(r.subproject ?? "-"),
        String(r.dxcode ?? "-"),
        r.start_page ?? "-",
        r.end_page ?? "-",
        String(r.error_type ?? "-"),
        String(r.dx_location ?? "-"),
        Number(r.error_count ?? 0),
        String(r.error_command ?? "-"),
        String(r.chart_date ?? "-"),
        String(r.source ?? "-"),
        String(r.coder_action ?? "Pending"),
        String(r.coder_comment ?? "-"),
        String(r.coder_action_date ?? "-"),
        String(r.coder_tl_action ?? "-"),
        String(r.coder_tl_comment ?? "-"),
        String(r.coder_tl_action_date ?? "-"),
        String(r.audit_action ?? "-"),
        String(r.audit_comment ?? "-"),
        String(r.audit_action_date ?? "-"),
        String(r.audit_tl_action ?? "-"),
        String(r.audit_tl_comment ?? "-"),
        String(r.audit_tl_action_date ?? "-"),
      ]);
      const ws2 = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailDataRows]);
      ws2["!cols"] = detailHeaders.map(h => ({ wch: Math.max(h.length + 2, 16) }));
      XLSX.utils.book_append_sheet(wb, ws2, "Error Details");

      // ── Filename with applied filters ──
      const parts = ["AuditQualityDashboard"];
      if (project) parts.push(project);
      if (subproject) parts.push(subproject);
      if (fromDate) parts.push(`from_${fromDate}`);
      if (toDate) parts.push(`to_${toDate}`);
      const filename = parts.join("_") + ".xlsx";

      XLSX.writeFile(wb, filename);
    } catch (err) {
      console.error("Export failed:", err);
      alert("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };


  return (
    <Box sx={{ minHeight: "100vh", p: { xs: 2, md: 4 }, background: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)" }}>
      <Fade in={true} timeout={800}>
        <Box maxWidth="xl" mx="auto">

          <Paper elevation={3} sx={{
            mb: 4, p: 3, borderRadius: 4,
            backgroundColor: "rgba(255, 255, 255, 0.9)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255, 255, 255, 0.5)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.05)"
          }}>
            <Typography variant="h5" sx={{ mb: 3, fontWeight: 700, color: "#1e293b", letterSpacing: "-0.5px" }}>
              Filter Dashboard
            </Typography>

            <Box display="flex" gap={2.5} flexWrap="wrap" alignItems="center">
              <TextField
                label="From Date"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                size="small"
                sx={{ minWidth: 160, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
              />

              <TextField
                label="To Date"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                size="small"
                sx={{ minWidth: 160, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
              />

              <TextField
                select
                label="Project"
                value={project}
                onChange={e => handleProjectChange(e.target.value)}
                size="small"
                SelectProps={{ native: true }}
                sx={{ minWidth: 180, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
              >
                <option value="">All Projects</option>
                {projectOptions.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </TextField>

              <TextField
                select
                label="Sub Project"
                value={subproject}
                onChange={e => setSubproject(e.target.value)}
                size="small"
                SelectProps={{ native: true }}
                disabled={!project}
                sx={{ minWidth: 180, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
              >
                <option value="">All Sub Projects</option>
                {subprojectOptions.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </TextField>

              <Box display="flex" gap={1.5} ml="auto">
                <Button
                  variant="contained"
                  onClick={() => load({ fromDate, toDate, project, subproject })}
                  sx={{
                    borderRadius: 8,
                    px: 3,
                    fontWeight: 600,
                    textTransform: "none",
                    boxShadow: "0 4px 14px 0 rgba(0,118,255,0.39)",
                    background: "linear-gradient(90deg, #1976d2 0%, #1565c0 100%)",
                    "&:hover": { background: "linear-gradient(90deg, #1565c0 0%, #0d47a1 100%)", boxShadow: "0 6px 20px rgba(0,118,255,0.23)" }
                  }}
                >
                  Filter
                </Button>

                <Button
                  variant="outlined"
                  onClick={() => {
                    setFromDate("");
                    setToDate("");
                    setProject("");
                    setSubproject("");
                    setSubprojectOptions([]);
                    load({ fromDate: "", toDate: "", project: "", subproject: "" });
                  }}
                  sx={{
                    borderRadius: 8,
                    px: 3,
                    fontWeight: 600,
                    textTransform: "none",
                    borderColor: "#cbd5e1",
                    color: "#475569",
                    "&:hover": { borderColor: "#94a3b8", backgroundColor: "#f1f5f9" }
                  }}
                >
                  Reset
                </Button>

                <Button
                  variant="outlined"
                  onClick={exportToExcel}
                  disabled={exporting}
                  sx={{
                    borderRadius: 8,
                    px: 3,
                    fontWeight: 600,
                    textTransform: "none",
                    borderColor: "#16a34a",
                    color: "#16a34a",
                    "&:hover": { borderColor: "#15803d", backgroundColor: "rgba(22,163,74,0.06)" },
                    "&:disabled": { borderColor: "#d1fae5", color: "#a7f3d0" }
                  }}
                >
                  {exporting ? "Exporting..." : "📥 Export Excel"}
                </Button>
              </Box>
            </Box>
          </Paper>

          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
            <Tabs value={tabValue} onChange={(e, newValue) => setTabValue(newValue)} aria-label="quality dashboard tabs">
              <Tab label="Dashboard Overview" sx={{ fontWeight: 600, textTransform: 'none', fontSize: '1rem' }} />
              <Tab label="Full Error Details" sx={{ fontWeight: 600, textTransform: 'none', fontSize: '1rem' }} />
            </Tabs>
          </Box>

          {tabValue === 0 && (
              <Box>
                <Paper elevation={3} sx={{
                  mb: 4, p: { xs: 2, md: 3 }, borderRadius: 4,
            backgroundColor: "rgba(255, 255, 255, 0.9)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255, 255, 255, 0.5)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.05)",
            overflow: "hidden"
          }}>
            <Typography variant="h5" sx={{ mb: 3, fontWeight: 700, color: "#1e293b", letterSpacing: "-0.5px" }}>
              Quality Summary
            </Typography>

            <TableContainer sx={{ borderRadius: 2, border: "1px solid #e2e8f0" }}>
              <Table sx={{ minWidth: 650 }}>
                <TableHead>
                  <TableRow sx={{ backgroundColor: "#f8fafc" }}>
                    {["S.No", "Project", "Sub Project", "Total Audited", "Total ICD", "Total Error", "Quality %"].map(head => (
                      <TableCell key={head} sx={{ fontWeight: 600, color: "#475569", textTransform: "uppercase", fontSize: "0.75rem", letterSpacing: "0.5px", py: 2 }}>{head}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>

                <TableBody>
                  {summary.length > 0 ? summary.map((r, idx) => (
                    <TableRow
                      key={idx}
                      hover
                      sx={{ '&:hover': { backgroundColor: "#f1f5f9", transform: "scale(1.002)", transition: "all 0.2s" } }}
                    >
                      <TableCell sx={{ color: "#334155" }}>{idx + 1}</TableCell>
                      <TableCell sx={{ color: "#334155", fontWeight: 500 }}>{r.project}</TableCell>
                      <TableCell sx={{ color: "#334155" }}>{r.subproject}</TableCell>
                      <TableCell sx={{ color: "#334155" }}>{r.total_audited}</TableCell>
                      <TableCell sx={{ color: "#334155" }}>{r.total_icd}</TableCell>
                      <TableCell sx={{ color: "#334155" }}>{r.total_error}</TableCell>
                      <TableCell>
                        <Chip
                          label={`${r.quality_percent}%`}
                          size="small"
                          sx={{
                            fontWeight: 700,
                            borderRadius: 1.5,
                            backgroundColor: r.quality_percent >= 95 ? "rgba(34, 197, 94, 0.15)" : r.quality_percent >= 90 ? "rgba(249, 115, 22, 0.15)" : "rgba(239, 68, 68, 0.15)",
                            color: r.quality_percent >= 95 ? "#15803d" : r.quality_percent >= 90 ? "#c2410c" : "#b91c1c",
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ py: 4, color: "#64748b" }}>No summary data available</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          <Paper elevation={3} sx={{
            mb: 4, p: { xs: 2, md: 3 }, borderRadius: 4,
            backgroundColor: "rgba(255, 255, 255, 0.9)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255, 255, 255, 0.5)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.05)",
            overflow: "hidden"
          }}>
            <Typography variant="h5" sx={{ mb: 3, fontWeight: 700, color: "#1e293b", letterSpacing: "-0.5px" }}>
              Quality Dashboard Details
            </Typography>

            <TableContainer sx={{ borderRadius: 2, border: "1px solid #e2e8f0" }}>
              <Table sx={{ minWidth: 650 }}>
                <TableHead>
                  <TableRow sx={{ backgroundColor: "#1e293b" }}>
                    {["Chart ID", "DX Code", "Pages", "Error Type", "Location", "Error Count", "Error Comment", "Review Level", "Review Status"].map(head => (
                      <TableCell key={head} sx={{ fontWeight: 600, color: "#ffffff", textTransform: "uppercase", fontSize: "0.75rem", letterSpacing: "0.5px", py: 2 }}>{head}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>

                <TableBody>
                  {rows.length > 0 ? rows.map(r => {
                    let reviewLevel = "Pending " + (r.source === "audit" ? "Coder" : "Auditor");
                    if (r.coder_action === "disagree") {
                      if (r.source === "audit") {
                        if (!r.coder_tl_action) reviewLevel = "Coder TL Review";
                        else if (!r.audit_action) reviewLevel = "Original Auditor Review";
                        else if (!r.audit_tl_action) reviewLevel = "Auditor TL Review";
                      } else {
                        if (!r.coder_tl_action) reviewLevel = "Auditor TL Review";
                        else if (!r.audit_action) reviewLevel = "AT-Auditor Review";
                        else if (!r.audit_tl_action) reviewLevel = "AT-Auditor TL Review";
                      }
                    }

                    const role = localStorage.getItem("role");

                    return (
                      <TableRow
                        key={`${r.source}_${r.id}`}
                        hover
                        sx={{ '&:hover': { backgroundColor: "#f8fafc", transition: "all 0.2s" } }}
                      >
                        <TableCell>
                          <Link
                            to={`/at-audit/quality/chart/${r.encrypted_chart_id || r.chart_id}`}
                            style={{ color: "#3b82f6", textDecoration: "none", fontWeight: "600" }}
                          >
                            {r.chart_id}
                          </Link>

                        </TableCell>
                        <TableCell sx={{ color: "#334155", fontWeight: 500 }}>{r.dxcode}</TableCell>
                        <TableCell sx={{ color: "#64748b", fontSize: "0.85rem" }}>{r.start_page === r.end_page ? r.start_page : `${r.start_page}–${r.end_page}`}</TableCell>
                        <TableCell sx={{ color: "#334155" }}>
                          <Chip label={r.error_type} size="small" sx={{ borderRadius: 1.5, backgroundColor: "#e2e8f0", color: "#475569", fontWeight: 500 }} />
                        </TableCell>
                        <TableCell sx={{ color: "#334155" }}>{r.dx_location}</TableCell>
                        <TableCell align="center">
                          <Typography variant="body2" sx={{ fontWeight: 600, color: r.error_count > 0 ? "#dc2626" : "#475569" }}>
                            {r.error_count}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ color: "#475569", maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {r.error_command || "-"}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={reviewLevel}
                            size="small"
                            variant={r.coder_action ? "filled" : "outlined"}
                            sx={{
                              borderRadius: 1.5,
                              fontWeight: 500,
                              borderColor: "#cbd5e1",
                              ...(r.coder_action && { backgroundColor: "#f1f5f9", color: "#64748b" })
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant={r.coder_action ? "text" : "contained"}
                            onClick={() => setSelected(r)}
                            disabled={!!r.coder_action}
                            size="small"
                            sx={!r.coder_action ? {
                              borderRadius: 4,
                              textTransform: "none",
                              fontWeight: 600,
                              px: 2,
                              backgroundColor: "#0f172a",
                              color: "#fff",
                              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
                              "&:hover": { backgroundColor: "#1e293b", boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)" }
                            } : { fontWeight: 600, color: "#94a3b8" }}
                          >
                            {r.coder_action ? r.coder_action.toUpperCase() : "Review"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  }) : (
                    <TableRow>
                      <TableCell colSpan={9} align="center" sx={{ py: 4, color: "#64748b" }}>No dashboard data available!</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>

          </Paper>
              </Box>
          )}

          {tabValue === 1 && (
              <Paper elevation={3} sx={{
                mb: 4, p: { xs: 2, md: 3 }, borderRadius: 4,
                backgroundColor: "rgba(255, 255, 255, 0.9)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(255, 255, 255, 0.5)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.05)",
                overflow: "hidden"
              }}>
                <Typography variant="h5" sx={{ mb: 1, fontWeight: 700, color: "#1e293b", letterSpacing: "-0.5px" }}>
                  Full Error Details (Debug: {fullRows.length} rows)
                </Typography>

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3, p: 2, backgroundColor: '#f8fafc', borderRadius: 2, border: '1px solid #e2e8f0' }}>
                  <Box>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: '#64748b', display: 'block', mb: 0.5 }}>CODER ACTIONS</Typography>
                    <Chip size="small" label={`Agrees: ${fullRows.filter(r => r.coder_action?.toLowerCase() === 'agree').length}`} sx={{ mr: 1, backgroundColor: '#dcfce7', color: '#166534', fontWeight: 600 }} />
                    <Chip size="small" label={`Disagrees: ${fullRows.filter(r => r.coder_action?.toLowerCase() === 'disagree').length}`} sx={{ backgroundColor: '#fee2e2', color: '#991b1b', fontWeight: 600 }} />
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: '#64748b', display: 'block', mb: 0.5 }}>CODER TL ACTIONS</Typography>
                    <Chip size="small" label={`Agrees: ${fullRows.filter(r => r.coder_tl_action?.toLowerCase() === 'agree').length}`} sx={{ mr: 1, backgroundColor: '#dcfce7', color: '#166534', fontWeight: 600 }} />
                    <Chip size="small" label={`Disagrees: ${fullRows.filter(r => r.coder_tl_action?.toLowerCase() === 'disagree').length}`} sx={{ backgroundColor: '#fee2e2', color: '#991b1b', fontWeight: 600 }} />
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: '#64748b', display: 'block', mb: 0.5 }}>AUDITOR ACTIONS</Typography>
                    <Chip size="small" label={`Agrees: ${fullRows.filter(r => r.audit_action?.toLowerCase() === 'agree').length}`} sx={{ mr: 1, backgroundColor: '#dcfce7', color: '#166534', fontWeight: 600 }} />
                    <Chip size="small" label={`Disagrees: ${fullRows.filter(r => r.audit_action?.toLowerCase() === 'disagree').length}`} sx={{ backgroundColor: '#fee2e2', color: '#991b1b', fontWeight: 600 }} />
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: '#64748b', display: 'block', mb: 0.5 }}>AUDITOR TL ACTIONS</Typography>
                    <Chip size="small" label={`Agrees: ${fullRows.filter(r => r.audit_tl_action?.toLowerCase() === 'agree').length}`} sx={{ mr: 1, backgroundColor: '#dcfce7', color: '#166534', fontWeight: 600 }} />
                    <Chip size="small" label={`Disagrees: ${fullRows.filter(r => r.audit_tl_action?.toLowerCase() === 'disagree').length}`} sx={{ backgroundColor: '#fee2e2', color: '#991b1b', fontWeight: 600 }} />
                  </Box>
                </Box>

                <TableContainer sx={{ borderRadius: 2, border: "1px solid #e2e8f0" }}>
                  <Table sx={{ minWidth: 1500 }}>
                    <TableHead>
                      <TableRow sx={{ backgroundColor: "#1e293b" }}>
                        {[
                          "Chart ID", "Project", "Sub Project", "DX Code",
                          "Start Page", "End Page", "Error Type", "DX Location",
                          "Error Count", "Error Comment (Auditor)", "Chart Date", "Source",
                          "Coder Action", "Coder Comment", "Coder Action Date",
                          "Coder TL Action", "Coder TL Comment", "Coder TL Action Date",
                          "Auditor Action", "Auditor Comment", "Auditor Action Date",
                          "Auditor TL Action", "Auditor TL Comment", "Auditor TL Action Date"
                        ].map(head => (
                          <TableCell key={head} sx={{ fontWeight: 600, color: "#ffffff", textTransform: "uppercase", fontSize: "0.75rem", letterSpacing: "0.5px", py: 2, whiteSpace: 'nowrap' }}>
                            {head}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>

                    <TableBody>
                      {fullRows.length > 0 ? fullRows.map(r => (
                        <TableRow
                          key={`${r.source}_${r.id}_full`}
                          hover
                          sx={{ '&:hover': { backgroundColor: "#f8fafc", transition: "all 0.2s" } }}
                        >
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.chart_id || "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.project || "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.subproject || "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.dxcode || "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.start_page ?? "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.end_page ?? "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.error_type || "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.dx_location || "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.error_count ?? 0}</TableCell>
                          <TableCell sx={{ maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.error_command || "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.chart_date || "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.source || "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.coder_action || "Pending"}</TableCell>
                          <TableCell sx={{ maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.coder_comment || "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.coder_action_date || "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.coder_tl_action || "-"}</TableCell>
                          <TableCell sx={{ maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.coder_tl_comment || "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.coder_tl_action_date || "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.audit_action || "-"}</TableCell>
                          <TableCell sx={{ maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.audit_comment || "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.audit_action_date || "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.audit_tl_action || "-"}</TableCell>
                          <TableCell sx={{ maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.audit_tl_comment || "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.audit_tl_action_date || "-"}</TableCell>
                        </TableRow>
                      )) : (
                        <TableRow>
                          <TableCell colSpan={21} align="center" sx={{ py: 4, color: "#64748b" }}>No details available</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
          )}

          {selected && (
            <QualityActionDialog
              row={selected}
              onClose={() => setSelected(null)}
              onSaved={() => {
                load();
                setSelected(null);
              }}
              apiUrl="/api/quality/action/"
            />
          )}

        </Box>
      </Fade>
    </Box>
  );
}
