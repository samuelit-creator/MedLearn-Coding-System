import { useEffect, useState } from "react";
import { api } from "../services/api";
import {
    Box, Table, TableHead, TableRow, TableCell,
    TableBody, Button, Typography, Paper, Grid,
    FormControl, InputLabel, Select, MenuItem,
    Chip, Avatar, Divider, Tooltip, IconButton, Stack,
    Card, CardContent, Fade, Zoom
} from "@mui/material";
import {
    PendingActions,
    AssignmentTurnedIn,
    BarChart,
    GetApp,
    FilterList,
    HistoryEdu,
    AccountCircle,
    ChatBubbleOutline,
    OpenInNew
} from "@mui/icons-material";
import QualityActionDialog from "../components/QualityActionDialog";
import { Link } from "react-router-dom";

export default function RebuttalStatus() {
    const [rows, setRows] = useState([]);
    const [selected, setSelected] = useState(null);
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    const [fType, setFType] = useState("");
    const [fLevel, setFLevel] = useState("");
    const [fProject, setFProject] = useState("");
    const [fSubproject, setFSubproject] = useState("");
    const [fTlName, setFTlName] = useState("");
    const [fActionStatus, setFActionStatus] = useState("");
    const [filterOptions, setFilterOptions] = useState({ projects: [], subprojects: [], reviewers: [] });

    const load = async () => {
        try {
            const params = {
                from_date: fromDate,
                to_date: toDate,
                source: fType,
                level: fLevel,
                project: fProject,
                subproject: fSubproject,
                reviewer_id: fTlName
            };
            const res = await api.get("/api/quality/rebuttal-status/", { params });
            setRows(res.data.rows);
            if (res.data.filter_options) {
                setFilterOptions(res.data.filter_options);
            }
        } catch (err) {
            console.error("Failed to load rebuttal status", err);
        }
    };

    const handleExport = async () => {
        if (fromDate && !toDate || !fromDate && toDate) {
            alert("Please select both dates for the filter.");
            return;
        }
        try {
            const params = {
                from_date: fromDate,
                to_date: toDate,
                source: fType,
                level: fLevel,
                project: fProject,
                subproject: fSubproject,
                reviewer_id: fTlName
            };

            const response = await api.get("/api/quality/export-rebuttal-status/", {
                params,
                responseType: "blob",
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement("a");
            link.href = url;
            const fileName = fromDate
                ? `Rebuttal_Status_${fromDate}_to_${toDate}.xlsx`
                : "Rebuttal_Status_All.xlsx";
            link.setAttribute("download", fileName);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err) {
            console.error("Export failed", err);
            alert("Export failed. Please check console for details.");
        }
    };

    useEffect(() => {
        load();
    }, []);

    const stats = {
        total: rows.length,
        standard: rows.filter(r => r.source === 'audit').length,
        at: rows.filter(r => r.source === 'at_audit').length
    };

    return (
        <Box p={4} sx={{ background: "#f8fafc", minHeight: "100vh" }}>
            {/* Header Area */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
                <Box>
                    <Typography variant="h4" sx={{ fontWeight: 800, color: "#1e293b", letterSpacing: "-0.02em" }}>
                        Rebuttal Dashboard
                    </Typography>
                    <Typography variant="body1" color="text.secondary">
                        Manage and track pending quality review rebuttals
                    </Typography>
                </Box>
                <Button
                    variant="contained"
                    startIcon={<GetApp />}
                    onClick={handleExport}
                    sx={{
                        bgcolor: "#0ea5e9",
                        "&:hover": { bgcolor: "#0284c7" },
                        borderRadius: "10px",
                        px: 3,
                        py: 1.2,
                        textTransform: "none",
                        fontWeight: 600,
                        boxShadow: "0 4px 12px rgba(14, 165, 233, 0.25)"
                    }}
                >
                    Export Report
                </Button>
            </Box>

            {/* Quick Stats */}
            <Grid container spacing={3} mb={4}>
                {[
                    { label: "Total Pending", value: stats.total, icon: <PendingActions />, color: "#6366f1" },
                    { label: "Standard Audit", value: stats.standard, icon: <AssignmentTurnedIn />, color: "#10b981" },
                    { label: "AT Audit", value: stats.at, icon: <BarChart />, color: "#f59e0b" }
                ].map((s, idx) => (
                    <Grid item xs={12} sm={4} key={idx}>
                        <Zoom in style={{ transitionDelay: `${idx * 150}ms` }}>
                            <Card sx={{
                                borderRadius: "16px",
                                border: "1px solid #e2e8f0",
                                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                                overflow: "visible",
                                position: "relative"
                            }}>
                                <CardContent sx={{ p: 3 }}>
                                    <Box display="flex" alignItems="center">
                                        <Avatar sx={{
                                            bgcolor: `${s.color}15`,
                                            color: s.color,
                                            width: 56,
                                            height: 56,
                                            borderRadius: "12px",
                                            mr: 2
                                        }}>
                                            {s.icon}
                                        </Avatar>
                                        <Box>
                                            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: "uppercase" }}>
                                                {s.label}
                                            </Typography>
                                            <Typography variant="h4" sx={{ fontWeight: 800, color: "#1e293b" }}>
                                                {s.value}
                                            </Typography>
                                        </Box>
                                    </Box>
                                </CardContent>
                            </Card>
                        </Zoom>
                    </Grid>
                ))}
            </Grid>

            {/* Filter Section */}
            <Paper elevation={0} sx={{ p: 3, mb: 4, borderRadius: "16px", border: "1px solid #e2e8f0", bgcolor: "#fff" }}>
                <Box display="flex" alignItems="center" mb={2.5}>
                    <FilterList sx={{ color: "#64748b", mr: 1 }} />
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, color: "#334155" }}>Filters</Typography>
                </Box>
                <Grid container spacing={2.5}>
                    <Grid item xs={12} sm={6} md={2}>
                        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.8, display: "block", fontWeight: 600 }}>From Date</Typography>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                            style={{
                                width: "100%",
                                padding: "10px",
                                borderRadius: "8px",
                                border: "1px solid #cbd5e1",
                                outline: "none",
                                fontSize: "14px",
                                background: "#f8fafc"
                            }}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6} md={2}>
                        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.8, display: "block", fontWeight: 600 }}>To Date</Typography>
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                            style={{
                                width: "100%",
                                padding: "10px",
                                borderRadius: "8px",
                                border: "1px solid #cbd5e1",
                                outline: "none",
                                fontSize: "14px",
                                background: "#f8fafc"
                            }}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6} md={1.3}>
                        <FormControl fullWidth variant="outlined" size="small">
                            <InputLabel sx={{ fontWeight: 500 }}>Type</InputLabel>
                            <Select value={fType} label="Type" onChange={(e) => setFType(e.target.value)} sx={{ borderRadius: "8px" }}>
                                <MenuItem value="">All</MenuItem>
                                <MenuItem value="audit">Standard</MenuItem>
                                <MenuItem value="at_audit">AT</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6} md={1.3}>
                        <FormControl fullWidth size="small">
                            <InputLabel sx={{ fontWeight: 500 }}>Level</InputLabel>
                            <Select value={fLevel} label="Level" onChange={(e) => setFLevel(e.target.value)} sx={{ borderRadius: "8px" }}>
                                <MenuItem value="">All</MenuItem>
                                <MenuItem value="coder_tl">Coder TL</MenuItem>
                                <MenuItem value="auditor">Auditor</MenuItem>
                                <MenuItem value="audit_tl">Auditor TL</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6} md={1.4}>
                        <FormControl fullWidth size="small">
                            <InputLabel sx={{ fontWeight: 500 }}>Project</InputLabel>
                            <Select value={fProject} label="Project" onChange={(e) => setFProject(e.target.value)} sx={{ borderRadius: "8px" }}>
                                <MenuItem value="">All Projects</MenuItem>
                                {filterOptions.projects.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6} md={1.5}>
                        <FormControl fullWidth size="small">
                            <InputLabel sx={{ fontWeight: 500 }}>Subproject</InputLabel>
                            <Select value={fSubproject} label="Subproject" onChange={(e) => setFSubproject(e.target.value)} sx={{ borderRadius: "8px" }}>
                                <MenuItem value="">All Subprojects</MenuItem>
                                {filterOptions.subprojects.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6} md={1.5}>
                        <FormControl fullWidth size="small">
                            <InputLabel sx={{ fontWeight: 500 }}>TL Name</InputLabel>
                            <Select value={fTlName} label="TL Name" onChange={(e) => setFTlName(e.target.value)} sx={{ borderRadius: "8px" }}>
                                <MenuItem value="">All TLs</MenuItem>
                                {filterOptions.reviewers.map(r => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6} md={1.5}>
                        <FormControl fullWidth size="small">
                            <InputLabel sx={{ fontWeight: 500 }}>Action Status</InputLabel>
                            <Select value={fActionStatus} label="Action Status" onChange={(e) => setFActionStatus(e.target.value)} sx={{ borderRadius: "8px" }}>
                                <MenuItem value="">All</MenuItem>
                                <MenuItem value="rebuttal">Rebuttal</MenuItem>
                                <MenuItem value="reviewed">Reviewed</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>
                </Grid>
                <Box mt={3} display="flex" justifyContent="flex-end">
                    <Button
                        variant="contained"
                        onClick={load}
                        sx={{
                            bgcolor: "#1e293b",
                            "&:hover": { bgcolor: "#0f172a" },
                            borderRadius: "10px",
                            px: 4,
                            py: 1,
                            textTransform: "none",
                            fontWeight: 600
                        }}
                    >
                        Apply Filters
                    </Button>
                </Box>
            </Paper>

            {/* Table Section */}
            <Fade in>
                <Paper elevation={0} sx={{
                    borderRadius: "20px",
                    overflow: "hidden",
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 10px 15px -3px rgba(0,0,0,0.05)"
                }}>
                    <Table>
                        <TableHead sx={{ bgcolor: "#f1f5f9" }}>
                            <TableRow>
                                <TableCell sx={{ fontWeight: 700, color: "#475569", py: 2.5 }}>Chart Details</TableCell>
                                <TableCell sx={{ fontWeight: 700, color: "#475569" }}>Personnel</TableCell>
                                <TableCell sx={{ fontWeight: 700, color: "#475569" }}>Error Profile</TableCell>
                                <TableCell sx={{ fontWeight: 700, color: "#475569" }}>Status & Action</TableCell>
                                <TableCell sx={{ fontWeight: 700, color: "#475569" }}>Discussion Log</TableCell>
                                <TableCell align="right" sx={{ fontWeight: 700, color: "#475569", pr: 4 }}>Operations</TableCell>
                            </TableRow>
                        </TableHead>

                        <TableBody>
                            {(() => {
                                const displayRows = rows.filter(r => {
                                    if (!fActionStatus) return true;
                                    const isReviewed = (r.level === 'coder_tl' && !!r.coder_tl_action) ||
                                        (r.level === 'auditor' && !!r.audit_action) ||
                                        (r.level === 'audit_tl' && !!r.audit_tl_action) ||
                                        r.pending_level === 'completed' || r.is_reviewed;

                                    if (fActionStatus === 'rebuttal') return !isReviewed;
                                    if (fActionStatus === 'reviewed') return isReviewed;
                                    return true;
                                });

                                if (displayRows.length === 0) {
                                    return (
                                        <TableRow>
                                            <TableCell colSpan={6} align="center" sx={{ py: 10 }}>
                                                <Box display="flex" flexDirection="column" alignItems="center" color="text.secondary">
                                                    <HistoryEdu sx={{ fontSize: 64, mb: 2, opacity: 0.1 }} />
                                                    <Typography variant="h6" sx={{ opacity: 0.5 }}>No results match your local filters</Typography>
                                                </Box>
                                            </TableCell>
                                        </TableRow>
                                    );
                                }

                                return displayRows.map((r, idx) => (
                                    <TableRow key={`${r.source}_${r.level}_${r.id}`} hover sx={{ "&:hover": { bgcolor: "#f8fafc" } }}>
                                        {/* Chart & Project */}
                                        <TableCell sx={{ py: 3, verticalAlign: "top" }}>
                                            <Box>
                                                <Link
                                                    to={r.source === 'at_audit' ? `/at-audit/quality/chart/${r.encrypted_chart_id || r.chart_id}` : `/quality/chart/${r.encrypted_chart_id || r.chart_id}`}
                                                    style={{ color: "#3b82f6", textDecoration: "none", fontWeight: 800, fontSize: "1rem" }}
                                                >
                                                    #{r.chart_id}
                                                </Link>

                                                <Stack direction="row" spacing={1} mt={1} mb={0.5}>
                                                    <Chip
                                                        label={r.source === 'audit' ? 'Standard' : 'AT'}
                                                        size="small"
                                                        sx={{
                                                            bgcolor: r.source === 'audit' ? "#e0f2fe" : "#fef3c7",
                                                            color: r.source === 'audit' ? "#0369a1" : "#92400e",
                                                            fontWeight: 700,
                                                            fontSize: "11px",
                                                            height: "22px"
                                                        }}
                                                    />
                                                </Stack>
                                                <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 500, display: "block" }}>
                                                    {r.project}
                                                </Typography>
                                                <Typography variant="caption" sx={{ color: "#94a3b8", display: "block" }}>
                                                    {r.subproject}
                                                </Typography>
                                                <Typography variant="caption" sx={{ color: "#cbd5e1", display: "block", mt: 1 }}>
                                                    Audited: {r.created_at?.replace("T", " ").substring(0, 16)}
                                                </Typography>
                                            </Box>
                                        </TableCell>

                                        {/* Personnel */}
                                        <TableCell sx={{ verticalAlign: "top" }}>
                                            <Stack spacing={2}>
                                                <Box display="flex" alignItems="center">
                                                    <Avatar sx={{ width: 32, height: 32, mr: 1.5, bgcolor: "#slate.100", color: "#64748b" }}>
                                                        <AccountCircle />
                                                    </Avatar>
                                                    <Box>
                                                        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: "#1e293b", lineHeight: 1 }}>
                                                            {r.reviewer_name}
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary">
                                                            {r.reviewer_id}
                                                        </Typography>
                                                    </Box>
                                                </Box>
                                                <Divider sx={{ borderStyle: "dashed", opacity: 0.5 }} />
                                                <Box>
                                                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: "block", mb: 0.5 }}>IDENTIFIED BY</Typography>
                                                    <Typography variant="caption" sx={{ color: "#475569", fontWeight: 500 }}>
                                                        {r.auditor_name || "System"}
                                                    </Typography>
                                                </Box>
                                            </Stack>
                                        </TableCell>

                                        {/* Error Profile */}
                                        <TableCell sx={{ verticalAlign: "top" }}>
                                            <Box>
                                                <Typography variant="h6" color="error.main" sx={{ fontWeight: 800 }}>
                                                    {r.dxcode}
                                                </Typography>
                                                <Chip
                                                    label={r.error_type}
                                                    variant="outlined"
                                                    size="small"
                                                    sx={{
                                                        color: "#ef4444",
                                                        borderColor: "#fee2e2",
                                                        bgcolor: "#fef2f2",
                                                        fontWeight: 600,
                                                        fontSize: "11px",
                                                        mt: 0.5
                                                    }}
                                                />
                                            </Box>
                                        </TableCell>

                                        {/* Status & Action */}
                                        <TableCell sx={{ verticalAlign: "top" }}>
                                            <Stack spacing={1.5}>
                                                <Box>
                                                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5, fontWeight: 600 }}>CURRENT STATE</Typography>
                                                    {r.pending_level === 'completed' ? (
                                                        <Chip label="Completed" color="success" size="small" sx={{ fontWeight: 700 }} />
                                                    ) : (
                                                        <Chip
                                                            label={
                                                                r.source === "audit"
                                                                    ? (r.pending_level === "coder_tl" ? "Coder TL Review" : r.pending_level === "auditor" ? "Auditor Review" : "Auditor TL Review")
                                                                    : (r.pending_level === "coder_tl" ? "Auditor TL Review" : r.pending_level === "auditor" ? "AT-Auditor Review" : "AT-Auditor TL Review")
                                                            }
                                                            size="small"
                                                            sx={{ bgcolor: "#eff6ff", color: "#1d4ed8", fontWeight: 700, px: 0.5 }}
                                                        />
                                                    )}
                                                </Box>
                                                <Box>
                                                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5, fontWeight: 600 }}>LAST DECISION</Typography>
                                                    <Chip
                                                        label={r.last_action?.toUpperCase() || "PENDING"}
                                                        size="small"
                                                        sx={{
                                                            bgcolor: r.last_action === "agree" ? "#dcfce7" : "#fee2e2",
                                                            color: r.last_action === "agree" ? "#166534" : "#991b1b",
                                                            fontWeight: 800,
                                                            fontSize: "10px"
                                                        }}
                                                    />
                                                </Box>
                                            </Stack>
                                        </TableCell>

                                        {/* Discussion Log */}
                                        <TableCell sx={{ maxWidth: 300, verticalAlign: "top" }}>
                                            <Paper elevation={0} sx={{ bgcolor: "#f8fafc", p: 1.5, borderRadius: "12px", border: "1px solid #f1f5f9" }}>
                                                <Stack spacing={1.5}>
                                                    {[
                                                        { role: "Auditor (Orig)", name: r.auditor_name, id: r.auditor_emp_id, text: r.original_auditor_comment, color: "#94a3b8", date: r.created_at },
                                                        { role: "Coder", name: r.coder_name, id: r.coder_emp_id, text: r.coder_comment, color: "#6366f1", date: r.coder_action_date },
                                                        { role: "Coder TL", name: r.coder_tl_name, id: r.coder_tl_emp_id, text: r.coder_tl_comment, color: "#8b5cf6", date: r.coder_tl_action_date },
                                                        { role: "Auditor (Rev)", name: r.auditor_name, id: r.auditor_emp_id, text: r.audit_comment, color: "#0ea5e9", date: r.audit_action_date },
                                                        { role: "Auditor TL", name: r.auditor_tl_name, id: r.auditor_tl_emp_id, text: r.audit_tl_comment, color: "#10b981", date: r.audit_tl_action_date }
                                                    ].filter(x => x.text).map((msg, i) => (
                                                        <Box key={i}>
                                                            <Box display="flex" alignItems="center" mb={0.2} justifyContent="space-between">
                                                                <Box display="flex" alignItems="center">
                                                                    <ChatBubbleOutline sx={{ fontSize: 12, mr: 0.5, color: msg.color }} />
                                                                    <Typography variant="caption" sx={{ fontWeight: 700, color: msg.color }}>
                                                                        {msg.role} - {msg.name} ({msg.id})
                                                                    </Typography>
                                                                </Box>
                                                                {msg.date && (
                                                                    <Typography variant="caption" sx={{ color: "#94a3b8", fontSize: "9px" }}>
                                                                        {msg.date.replace("T", " ").substring(0, 16)}
                                                                    </Typography>
                                                                )}
                                                            </Box>
                                                            <Typography variant="caption" sx={{ display: "block", color: "#475569", lineHeight: 1.3, pl: 2 }}>
                                                                {msg.text}
                                                            </Typography>
                                                        </Box>
                                                    ))}
                                                </Stack>
                                            </Paper>
                                        </TableCell>

                                        {/* Operations */}
                                        < TableCell align="right" sx={{ pr: 4, verticalAlign: "top" }}>
                                            <Stack direction="row" spacing={1} justifyContent="flex-end">
                                                <Tooltip title="Take Action">
                                                    <span>
                                                        <Button
                                                            variant="contained"
                                                            size="small"
                                                            onClick={() => setSelected(r)}
                                                            disabled={
                                                                (r.level === 'coder_tl' && !!r.coder_tl_action) ||
                                                                (r.level === 'auditor' && !!r.audit_action) ||
                                                                (r.level === 'audit_tl' && !!r.audit_tl_action) ||
                                                                r.pending_level === 'completed'
                                                            }
                                                            sx={{
                                                                borderRadius: "8px",
                                                                textTransform: "none",
                                                                fontWeight: 700,
                                                                boxShadow: "none",
                                                                bgcolor: "#1e293b",
                                                                "&:hover": { bgcolor: "#334155", boxShadow: "none" }
                                                            }}
                                                        >
                                                            {((r.level === 'coder_tl' && !!r.coder_tl_action) ||
                                                                (r.level === 'auditor' && !!r.audit_action) ||
                                                                (r.level === 'audit_tl' && !!r.audit_tl_action)) ? "Reviewed" : "Rebuttal"}
                                                        </Button>
                                                    </span>
                                                </Tooltip>
                                            </Stack>
                                        </TableCell>
                                    </TableRow>
                                ))
                            })()}
                        </TableBody>
                    </Table>
                </Paper>
            </Fade >

            {selected && (
                <QualityActionDialog
                    row={selected}
                    onClose={() => setSelected(null)}
                    onSaved={() => {
                        load();
                        setSelected(null);
                    }}
                />
            )
            }
        </Box >
    );
}
