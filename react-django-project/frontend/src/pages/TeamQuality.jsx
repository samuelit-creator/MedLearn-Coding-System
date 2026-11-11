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
import ErrorIcon from "@mui/icons-material/Error";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import FilterListIcon from "@mui/icons-material/FilterList";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs from "dayjs";
import { api } from "../services/api";

export default function TeamQuality() {
    const [rows, setRows] = useState([]);
    const [summary, setSummary] = useState({
        members_count: 0,
        audited_count: 0,
        charts: 0,
        errors: 0,
        quality: 100
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [filterOptions, setFilterOptions] = useState({
        managers: [],
        tls: [],
        projects: [],
        subprojects: []
    });

    const [filters, setFilters] = useState({
        manager: "",
        tl: "",
        project: "",
        subproject: "",
        from_date: null,
        to_date: null
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async (appliedFilters = {}) => {
        try {
            setLoading(true);
            const hasFilters = Object.values(appliedFilters).some(v => v);
            const payload = {
                ...appliedFilters,
                from_date: appliedFilters.from_date ? dayjs(appliedFilters.from_date).format("YYYY-MM-DD") : null,
                to_date: appliedFilters.to_date ? dayjs(appliedFilters.to_date).format("YYYY-MM-DD") : null
            };

            const res = await api.post("/api/team-quality/", payload);
            
            const rawRows = res.data.rows || [];
            const consolidateQuality = (data) => {
                const map = {};
                data.forEach(row => {
                    const key = `${row.user_employee_id}-${row.project}-${row.subproject}`;
                    if (!map[key]) {
                        map[key] = { ...row, _count: 1 };
                    } else {
                        map[key].total_audited = (Number(map[key].total_audited) || 0) + (Number(row.total_audited) || 0);
                        map[key].total_icd = (Number(map[key].total_icd) || 0) + (Number(row.total_icd) || 0);
                        map[key].coding_errors = (Number(map[key].coding_errors) || 0) + (Number(row.coding_errors) || 0);
                        map[key].admin_errors = (Number(map[key].admin_errors) || 0) + (Number(row.admin_errors) || 0);
                        map[key].total_errors = (Number(map[key].total_errors) || 0) + (Number(row.total_errors) || 0);
                        map[key].total_quality = (Number(map[key].total_quality) || 0) + (Number(row.total_quality) || 0);
                        
                        map[key]._count += 1;
                    }
                });

                return Object.values(map).map(row => {
                    if (row.total_icd > 0) {
                        row.total_quality = Number(((1 - (row.total_errors / row.total_icd)) * 100).toFixed(2));
                    } else {
                        row.total_quality = 100;
                    }
                    return row;
                });
            };
            
            if (hasFilters) {
                setRows(consolidateQuality(rawRows));
                setSummary(res.data.summary || {});
            } else {
                setRows([]);
                setSummary({
                    members_count: 0,
                    audited_count: 0,
                    charts: 0,
                    errors: 0,
                    quality: 100
                });
            }

            // Set filter options from the same API response
            if (res.data.filters) {
                setFilterOptions(res.data.filters);
            }
        } catch (err) {
            setError("Failed to load team quality data");
        } finally {
            setLoading(false);
        }
    };

    const handleFilterChange = (field, value) => {
        setFilters(prev => ({ ...prev, [field]: value }));
    };

    const handleApplyFilters = () => {
        loadData(filters);
    };

    const handleClearFilters = () => {
        const clearedFilters = {
            manager: "",
            tl: "",
            project: "",
            subproject: "",
            from_date: null,
            to_date: null
        };
        setFilters(clearedFilters);
        loadData(clearedFilters);
    };

    const columns = [
        {
            field: "sno",
            headerName: "S.No",
            width: 70,
            renderCell: (params) => params.api.getRowIndexRelativeToVisibleRows(params.id) + 1
        },
        { field: "user_employee_id", headerName: "Emp ID", width: 100 },
        { field: "username", headerName: "Employee Name", width: 160 },
        { field: "tl_name", headerName: "TL Name", width: 160 },
        { field: "project", headerName: "Project", width: 150 },
        { field: "subproject", headerName: "Sub Project", width: 150 },
        { field: "total_audited", headerName: "Total Audited", width: 110 },
        { field: "total_icd", headerName: "Total ICD", width: 100 },
        { field: "coding_errors", headerName: "Coding Errors", width: 120 },
        { field: "admin_errors", headerName: "Admin Errors", width: 120 },
        { field: "total_errors", headerName: "Total Errors", width: 110 },
        {
            field: "total_quality",
            headerName: "Quality %",
            width: 100,
            renderCell: (params) => {
                const val = params.value ?? 100;
                const color = val >= 95 ? "success" : val >= 90 ? "warning" : "error";
                return <Chip label={`${val}%`} color={color} size="small" sx={{ fontWeight: 'bold' }} />;
            }
        }
    ];

    const handleExport = async () => {
        try {
            setLoading(true);
            const payload = {
                ...filters,
                from_date: filters.from_date ? dayjs(filters.from_date).format("YYYY-MM-DD") : null,
                to_date: filters.to_date ? dayjs(filters.to_date).format("YYYY-MM-DD") : null
            };

            const response = await api.post("/api/export-team-quality/", payload, {
                responseType: 'blob'
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `Team_Quality_Report_${dayjs().format("YYYYMMDD")}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err) {
            setError("Failed to export team quality data");
        } finally {
            setLoading(false);
        }
    };

    if (loading && !rows.length)
        return (
            <Box p={6} textAlign="center">
                <CircularProgress size={40} />
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
                    background: "linear-gradient(135deg, #1e40af, #3b82f6)",
                    color: "#fff",
                    boxShadow: 3
                }}
            >
                <Typography variant="h5" fontWeight="bold">
                    Team Quality Dashboard
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                    Quality and accuracy overview of your team
                </Typography>
            </Box>

            {/* KPI Cards */}
            <Grid container spacing={3} sx={{ mb: 4 }}>
                <Grid item xs={12} sm={6} md={2.4}>
                    <Paper sx={kpiStyle}>
                        <GroupsIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
                        <Typography variant="h5" fontWeight="bold">{summary.members_count}</Typography>
                        <Typography variant="body2" color="text.secondary">No. of Members</Typography>
                    </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={2.4}>
                    <Paper sx={kpiStyle}>
                        <AssessmentIcon color="info" sx={{ fontSize: 40, mb: 1 }} />
                        <Typography variant="h5" fontWeight="bold">{summary.audited_count}</Typography>
                        <Typography variant="body2" color="text.secondary">No. of Audited</Typography>
                    </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={2.4}>
                    <Paper sx={kpiStyle}>
                        <TrendingUpIcon color="success" sx={{ fontSize: 40, mb: 1 }} />
                        <Typography variant="h5" fontWeight="bold">{summary.charts}</Typography>
                        <Typography variant="body2" color="text.secondary">Total ICD</Typography>
                    </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={2.4}>
                    <Paper sx={kpiStyle}>
                        <ErrorIcon color="error" sx={{ fontSize: 40, mb: 1 }} />
                        <Typography variant="h5" fontWeight="bold">{summary.errors}</Typography>
                        <Typography variant="body2" color="text.secondary">Errors</Typography>
                    </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={2.4}>
                    <Paper sx={kpiStyle}>
                        <TrendingUpIcon color="secondary" sx={{ fontSize: 40, mb: 1 }} />
                        <Typography variant="h5" fontWeight="bold">{summary.quality}%</Typography>
                        <Typography variant="body2" color="text.secondary">Quality Score</Typography>
                    </Paper>
                </Grid>
            </Grid>

            {/* Filter Panel */}
            <Card sx={{ mb: 4, p: 3, borderRadius: 3, boxShadow: "0 4px 20px rgba(0,0,0,0.05)" }}>
                <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
                    <FilterListIcon sx={{ color: "#1e40af" }} />
                    <Typography variant="h6" fontWeight="bold">Filters</Typography>
                </Stack>
                <LocalizationProvider dateAdapter={AdapterDayjs}>
                    <Grid container spacing={2} alignItems="flex-end">
                        <Grid item xs={12} md={2}>
                            <TextField
                                select
                                fullWidth
                                size="small"
                                label="Manager"
                                value={filters.manager}
                                onChange={(e) => handleFilterChange("manager", e.target.value)}
                            >
                                <MenuItem value="">All Managers</MenuItem>
                                {filterOptions.managers.map((m) => (
                                    <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>
                                ))}
                            </TextField>
                        </Grid>
                        <Grid item xs={12} md={2}>
                            <TextField
                                select
                                fullWidth
                                size="small"
                                label="Team Lead"
                                value={filters.tl}
                                onChange={(e) => handleFilterChange("tl", e.target.value)}
                            >
                                <MenuItem value="">All TLs</MenuItem>
                                {filterOptions.tls.map((t) => (
                                    <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                                ))}
                            </TextField>
                        </Grid>
                        <Grid item xs={12} md={2}>
                            <TextField
                                select
                                fullWidth
                                size="small"
                                label="Project"
                                value={filters.project}
                                onChange={(e) => handleFilterChange("project", e.target.value)}
                            >
                                <MenuItem value="">All Projects</MenuItem>
                                {filterOptions.projects.map((p) => (
                                    <MenuItem key={p} value={p}>{p}</MenuItem>
                                ))}
                            </TextField>
                        </Grid>
                        <Grid item xs={12} md={2}>
                            <TextField
                                select
                                fullWidth
                                size="small"
                                label="Sub Project"
                                value={filters.subproject}
                                onChange={(e) => handleFilterChange("subproject", e.target.value)}
                            >
                                <MenuItem value="">All SubProjects</MenuItem>
                                {filterOptions.subprojects.map((p) => (
                                    <MenuItem key={p} value={p}>{p}</MenuItem>
                                ))}
                            </TextField>
                        </Grid>
                        <Grid item xs={12} md={2}>
                            <DatePicker
                                label="From Date"
                                value={filters.from_date}
                                onChange={(val) => handleFilterChange("from_date", val)}
                                slotProps={{ textField: { size: "small", fullWidth: true } }}
                            />
                        </Grid>
                        <Grid item xs={12} md={2}>
                            <DatePicker
                                label="To Date"
                                value={filters.to_date}
                                onChange={(val) => handleFilterChange("to_date", val)}
                                slotProps={{ textField: { size: "small", fullWidth: true } }}
                            />
                        </Grid>
                        <Grid item xs={12} md={12}>
                            <Stack direction="row" spacing={1} justifyContent="flex-end">
                                <Button variant="contained" color="success" onClick={handleExport} sx={{ borderRadius: 2, minWidth: 150 }}>Export Excel</Button>
                                <Button variant="contained" onClick={handleApplyFilters} sx={{ borderRadius: 2, minWidth: 150 }}>Apply Filters</Button>
                                <Button variant="outlined" onClick={handleClearFilters} sx={{ borderRadius: 2, minWidth: 100 }}>Reset</Button>
                            </Stack>
                        </Grid>
                    </Grid>
                </LocalizationProvider>
            </Card>

            {/* Data Table */}
            <Card sx={{ height: 600, borderRadius: 3, boxShadow: 3 }}>
                {error ? (
                    <Box p={3}><Alert severity="error">{error}</Alert></Box>
                ) : (
                    <DataGrid
                        rows={rows}
                        columns={columns}
                        getRowId={(row) => `${row.user_employee_id}-${row.project}-${row.subproject}`}
                        slots={{ toolbar: GridToolbar }}
                        pageSizeOptions={[10, 25, 50]}
                        initialState={{
                            pagination: { paginationModel: { pageSize: 10 } }
                        }}
                        loading={loading}
                        sx={{
                            border: "none",
                            "& .MuiDataGrid-columnHeaders": {
                                backgroundColor: "#f8fafc",
                                color: "#1e293b",
                                fontWeight: "bold"
                            }
                        }}
                    />
                )}
            </Card>
        </Box>
    );
}

const kpiStyle = {
    p: 3,
    borderRadius: 3,
    textAlign: "center",
    boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
    transition: "all 0.3s ease",
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 140,
    "&:hover": {
        transform: "translateY(-5px)",
        boxShadow: "0 8px 30px rgba(0,0,0,0.1)"
    }
};
