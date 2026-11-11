import React, { useEffect, useState } from "react";
import {
    Box,
    Typography,
    Card,
    CircularProgress,
    Alert,
    Chip,
    Grid,
    Paper,
    Stack,
    TextField,
    MenuItem,
    Button
} from "@mui/material";
import { DataGrid, GridToolbar } from "@mui/x-data-grid";
import GroupsIcon from "@mui/icons-material/Groups";
import AssessmentIcon from "@mui/icons-material/Assessment";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import FilterListIcon from "@mui/icons-material/FilterList";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import DescriptionIcon from "@mui/icons-material/Description";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs from "dayjs";
import { api } from "../services/api";

export default function HourlyProductionTracker() {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [selectedDate, setSelectedDate] = useState(dayjs());

    const [filterOptions, setFilterOptions] = useState({
        managers: [],
        tls: [],
        projects: [],
        subprojects: [],
        project_subproject_map: {}
    });

    const [filters, setFilters] = useState({
        manager: "",
        tl: "",
        project: "",
        subproject: ""
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async (appliedFilters = {}, date = null) => {
        try {
            setLoading(true);
            const payload = {
                ...appliedFilters,
                date: (date || selectedDate).format("YYYY-MM-DD")
            };

            const hasPayload = Object.values(payload).some(v => v);
            let res;
            if (hasPayload) {
                res = await api.post("/api/hourly-production/", payload);
            } else {
                res = await api.get("/api/hourly-production/");
            }

            setRows(res.data.rows || []);
            if (res.data.filters) {
                setFilterOptions(res.data.filters);
            }
        } catch (err) {
            setError("Failed to load hourly production data");
        } finally {
            setLoading(false);
        }
    };

    const handleFilterChange = (field, value) => {
        setFilters(prev => {
            const next = { ...prev, [field]: value };
            if (field === "project") {
                next.subproject = "";
            }
            return next;
        });
    };

    const displaySubprojects = filters.project
        ? (filterOptions.project_subproject_map[filters.project] || [])
        : filterOptions.subprojects;

    const handleApplyFilters = () => {
        loadData(filters, selectedDate);
    };

    const handleClearFilters = () => {
        const cleared = { manager: "", tl: "", project: "", subproject: "" };
        setFilters(cleared);
        setSelectedDate(dayjs());
        loadData(cleared, dayjs());
    };

    const handleExportExcel = async () => {
        try {
            setLoading(true);
            const payload = {
                ...filters,
                date: selectedDate.format("YYYY-MM-DD")
            };

            const response = await api.post("/api/export-hourly-production/", payload, {
                responseType: "blob"
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement("a");
            link.href = url;
            link.setAttribute("download", `Hourly_Production_${selectedDate.format("YYYYMMDD")}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err) {
            console.error("Export failed", err);
            setError("Failed to export Excel report");
        } finally {
            setLoading(false);
        }
    };

    // KPI Calculations
    const uniqueMembers = new Set(rows.map(r => r.user_employee_id)).size;
    const totalCharts = rows.reduce((a, b) => a + (Number(b.charts) || 0), 0);
    const totalPages = rows.reduce((a, b) => a + (Number(b.total_pages) || 0), 0);
    const totalDOS = rows.reduce((a, b) => a + (Number(b.total_dos) || 0), 0);
    const totalICD = rows.reduce((a, b) => a + (Number(b.total_icd) || 0), 0);
    const activeHours = new Set(rows.map(r => r.hour_val)).size;

    // Pivot data for the table
    const pivotData = (rawRows) => {
        const userMap = {};
        rawRows.forEach(r => {
            const id = r.user_employee_id;
            if (!userMap[id]) {
                userMap[id] = {
                    id: id,
                    user_employee_id: id,
                    username: r.username,
                    tl_name: r.tl_name,
                    total: 0
                };
                for (let i = 0; i < 24; i++) {
                    userMap[id][`h${i}`] = 0;
                }
            }
            const hour = r.hour_val;
            const charts = Number(r.charts) || 0;
            userMap[id][`h${hour}`] = charts;
            userMap[id].total += charts;
        });
        return Object.values(userMap);
    };

    const pivotedRows = pivotData(rows);

    const hourColumns = Array.from({ length: 24 }).map((_, i) => {
        const hour = i % 12 === 0 ? 12 : i % 12;
        const ampm = i < 12 ? 'am' : 'pm';
        const label = `${hour}${ampm}`;
        return {
            field: `h${i}`,
            headerName: label,
            width: 60,
            align: 'center',
            headerAlign: 'center',
            renderHeader: () => (
                <Typography variant="caption" sx={{ color: '#b91c1c', fontWeight: 'bold', fontSize: '0.75rem' }}>
                    {label}
                </Typography>
            ),
            renderCell: (params) => (
                <Typography variant="body2" sx={{
                    fontWeight: params.value > 0 ? 600 : 400,
                    color: params.value > 0 ? '#000000' : '#94a3b8'
                }}>
                    {params.value || ""}
                </Typography>
            )
        };
    });

    const columns = [
        {
            field: "sno",
            headerName: "S.No",
            width: 50,
            renderCell: (params) =>
                params.api.getRowIndexRelativeToVisibleRows(params.id) + 1
        },
        { field: "user_employee_id", headerName: "Emp ID", width: 80 },
        { field: "username", headerName: "Employee", width: 140 },
        { field: "tl_name", headerName: "TL", width: 120 },
        ...hourColumns,
        {
            field: "total",
            headerName: "Total",
            width: 70,
            align: 'center',
            headerAlign: 'center',
            renderCell: (params) => (
                <Chip
                    size="small"
                    label={params.value}
                    color="primary"
                    sx={{ fontWeight: 'bold', height: 20, fontSize: '0.7rem' }}
                />
            )
        }
    ];

    if (loading)
        return (
            <Box p={6} textAlign="center">
                <CircularProgress size={40} />
            </Box>
        );

    if (error)
        return (
            <Box p={4}>
                <Alert severity="error">{error}</Alert>
            </Box>
        );

    return (
        <Box sx={{ p: 3 }}>
            {/* Page Header */}
            <Box
                sx={{
                    mb: 4,
                    p: 3,
                    borderRadius: 3,
                    background: "linear-gradient(135deg, #0f766e, #14b8a6)",
                    color: "#fff",
                    boxShadow: 3
                }}
            >
                <Typography variant="h5" fontWeight="bold">
                    Hourly Production Tracker
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                    Track team production by hour for any day
                </Typography>
            </Box>

            {/* Filter Panel */}
            <Card
                sx={{
                    mb: 4,
                    p: 0,
                    borderRadius: 4,
                    overflow: "hidden",
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 8px 30px rgba(0,0,0,0.06)"
                }}
            >
                <Box
                    sx={{
                        px: 2,
                        py: 1,
                        background: "linear-gradient(90deg, #f8fafc, #ffffff)",
                        borderBottom: "1px solid #e2e8f0",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                    }}
                >
                    <Stack direction="row" spacing={2} alignItems="center">
                        <FilterListIcon sx={{ color: "#0d9488" }} />
                        <Typography variant="h6" fontWeight="bold">
                            Filter Panel
                        </Typography>
                    </Stack>
                    <Chip
                        label={`${Object.values(filters).filter(v => v).length} Active`}
                        size="small"
                        sx={{
                            backgroundColor: "#f0fdfa",
                            color: "#134e4a",
                            fontWeight: 600
                        }}
                    />
                </Box>

                <LocalizationProvider dateAdapter={AdapterDayjs}>
                    <Box sx={{ p: 2 }}>
                        <Grid container spacing={2} alignItems="center">

                            {/* Date */}
                            <Grid item xs={12} md={2}>
                                <DatePicker
                                    label="Date"
                                    value={selectedDate}
                                    onChange={(v) => setSelectedDate(v)}
                                    format="MM/DD/YYYY"
                                    slotProps={{
                                        textField: {
                                            size: "small",
                                            fullWidth: true,
                                            sx: modernField
                                        }
                                    }}
                                />
                            </Grid>

                            {/* Manager */}
                            <Grid item xs={12} md={2}>
                                <TextField
                                    select fullWidth size="small" label="Manager"
                                    value={filters.manager}
                                    onChange={(e) => handleFilterChange("manager", e.target.value)}
                                    sx={modernField}
                                >
                                    <MenuItem value="">All Managers</MenuItem>
                                    {filterOptions.managers.map((m) => (
                                        <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>
                                    ))}
                                </TextField>
                            </Grid>

                            {/* TL */}
                            <Grid item xs={12} md={2}>
                                <TextField
                                    select fullWidth size="small" label="Team Lead"
                                    value={filters.tl}
                                    onChange={(e) => handleFilterChange("tl", e.target.value)}
                                    sx={modernField}
                                >
                                    <MenuItem value="">All TLs</MenuItem>
                                    {filterOptions.tls.map((t) => (
                                        <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                                    ))}
                                </TextField>
                            </Grid>

                            {/* Project */}
                            <Grid item xs={12} md={1.5}>
                                <TextField
                                    select fullWidth size="small" label="Project"
                                    value={filters.project}
                                    onChange={(e) => handleFilterChange("project", e.target.value)}
                                    sx={modernField}
                                >
                                    <MenuItem value="">All Projects</MenuItem>
                                    {filterOptions.projects.map((p) => (
                                        <MenuItem key={p} value={p}>{p}</MenuItem>
                                    ))}
                                </TextField>
                            </Grid>

                            {/* SubProject */}
                            <Grid item xs={12} md={1.5}>
                                <TextField
                                    select fullWidth size="small" label="Sub Project"
                                    value={filters.subproject}
                                    onChange={(e) => handleFilterChange("subproject", e.target.value)}
                                    sx={modernField}
                                >
                                    <MenuItem value="">All SubProjects</MenuItem>
                                    {displaySubprojects.map((s) => (
                                        <MenuItem key={s} value={s}>{s}</MenuItem>
                                    ))}
                                </TextField>
                            </Grid>

                            {/* Apply */}
                            <Grid item xs={4} md={1}>
                                <Button
                                    fullWidth variant="contained"
                                    onClick={handleApplyFilters}
                                    sx={{
                                        height: 40, borderRadius: 2,
                                        textTransform: "none", fontWeight: 600,
                                        background: "#0d9488"
                                    }}
                                >
                                    Apply
                                </Button>
                            </Grid>

                            {/* Reset */}
                            <Grid item xs={4} md={1}>
                                <Button
                                    fullWidth variant="outlined"
                                    onClick={handleClearFilters}
                                    sx={{
                                        height: 40, borderRadius: 2,
                                        textTransform: "none", fontWeight: 600
                                    }}
                                >
                                    Reset
                                </Button>
                            </Grid>

                            {/* Export */}
                            <Grid item xs={4} md={2}>
                                <Button
                                    fullWidth variant="contained" color="success"
                                    onClick={handleExportExcel}
                                    startIcon={<DescriptionIcon />}
                                    sx={{
                                        height: 40, borderRadius: 2,
                                        textTransform: "none", fontWeight: 600,
                                        background: "#10b981"
                                    }}
                                >
                                    Export Excel
                                </Button>
                            </Grid>

                            {/* KPI Summary Cards */}
                            <Grid container spacing={2} sx={{ mt: 1, px: 1 }}>
                                <Grid item xs={6} md={2}>
                                    <Paper sx={kpiStyle}>
                                        <GroupsIcon sx={{ color: "#0d9488" }} />
                                        <Typography variant="h6">{uniqueMembers}</Typography>
                                        <Typography variant="body2">Team Members</Typography>
                                    </Paper>
                                </Grid>
                                <Grid item xs={6} md={2}>
                                    <Paper sx={kpiStyle}>
                                        <TrendingUpIcon sx={{ color: "#7c3aed" }} />
                                        <Typography variant="h6">{totalCharts}</Typography>
                                        <Typography variant="body2">Total Charts</Typography>
                                    </Paper>
                                </Grid>
                                <Grid item xs={6} md={2}>
                                    <Paper sx={kpiStyle}>
                                        <AssessmentIcon color="success" />
                                        <Typography variant="h6">{totalPages}</Typography>
                                        <Typography variant="body2">Total Pages</Typography>
                                    </Paper>
                                </Grid>
                                <Grid item xs={6} md={2}>
                                    <Paper sx={kpiStyle}>
                                        <AssessmentIcon color="warning" />
                                        <Typography variant="h6">{totalDOS}</Typography>
                                        <Typography variant="body2">Total DOS</Typography>
                                    </Paper>
                                </Grid>
                                <Grid item xs={6} md={2}>
                                    <Paper sx={kpiStyle}>
                                        <AssessmentIcon color="info" />
                                        <Typography variant="h6">{totalICD}</Typography>
                                        <Typography variant="body2">Total ICD</Typography>
                                    </Paper>
                                </Grid>
                                <Grid item xs={6} md={2}>
                                    <Paper sx={kpiStyle}>
                                        <AccessTimeIcon sx={{ color: "#ea580c" }} />
                                        <Typography variant="h6">{activeHours}</Typography>
                                        <Typography variant="body2">Active Hours</Typography>
                                    </Paper>
                                </Grid>
                            </Grid>

                        </Grid>
                    </Box>
                </LocalizationProvider>
            </Card>

            {/* Data Table */}
            <Card
                sx={{
                    height: 650,
                    borderRadius: 3,
                    boxShadow: 3,
                    overflow: "hidden"
                }}
            >
                <DataGrid
                    rows={pivotedRows}
                    columns={columns}
                    getRowId={(row) => row.id}
                    slots={{ toolbar: GridToolbar }}
                    pageSizeOptions={[10, 25, 50]}
                    initialState={{
                        pagination: { paginationModel: { pageSize: 25 } }
                    }}
                    rowHeight={40}
                    columnHeaderHeight={45}
                    showColumnVerticalBorder={true}
                    showCellVerticalBorder={true}
                    sx={{
                        border: "1px solid #cbd5e1",
                        "& .MuiDataGrid-columnHeaders": {
                            backgroundColor: "#dbeafe",
                            color: "#000",
                            fontWeight: "bold",
                            borderBottom: "1px solid #94a3b8"
                        },
                        "& .MuiDataGrid-columnHeader": {
                            backgroundColor: "#dbeafe",
                            borderRight: "1px solid #cbd5e1"
                        },
                        "& .MuiDataGrid-cell": {
                            borderRight: "1px solid #cbd5e1",
                            borderBottom: "1px solid #cbd5e1"
                        },
                        "& .MuiDataGrid-row:hover": {
                            backgroundColor: "#f0fdfa"
                        }
                    }}
                />
            </Card>
        </Box>
    );
}

// KPI Card Styling
const kpiStyle = {
    p: 3,
    borderRadius: 3,
    textAlign: "center",
    boxShadow: 2,
    transition: "0.2s",
    "&:hover": {
        transform: "translateY(-4px)",
        boxShadow: 6
    }
};

const modernField = {
    "& .MuiOutlinedInput-root": {
        borderRadius: 2.5,
        backgroundColor: "#ffffff",
        "& fieldset": { borderColor: "#e2e8f0" },
        "&:hover fieldset": { borderColor: "#0d9488" },
        "&.Mui-focused fieldset": { borderColor: "#0d9488", borderWidth: "2px" }
    }
};
