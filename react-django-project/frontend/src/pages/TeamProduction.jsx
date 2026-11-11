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
import PersonIcon from "@mui/icons-material/Person";
import GroupsIcon from "@mui/icons-material/Groups";
import AssessmentIcon from "@mui/icons-material/Assessment";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import FilterListIcon from "@mui/icons-material/FilterList";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs from "dayjs";
import { api } from "../services/api";

export default function TeamProduction() {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // Filter options from backend
    const [filterOptions, setFilterOptions] = useState({
        managers: [],
        tls: [],
        projects: [],
        subprojects: []
    });

    // Filter values
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

            // If filters are provided, use POST; otherwise use GET
            const hasFilters = Object.values(appliedFilters).some(v => v);

            let res;
            if (hasFilters) {
                // Format dates for backend
                const payload = {
                    ...appliedFilters,
                    from_date: appliedFilters.from_date ? dayjs(appliedFilters.from_date).format("YYYY-MM-DD") : null,
                    to_date: appliedFilters.to_date ? dayjs(appliedFilters.to_date).format("YYYY-MM-DD") : null
                };
                res = await api.post("/api/team-production/", payload);
            } else {
                res = await api.get("/api/team-production/");
            }

            const rawRows = res.data.rows || [];
            const consolidateProduction = (data) => {
                const map = {};
                data.forEach(row => {
                    const key = row.user_employee_id;
                    if (!map[key]) {
                        map[key] = { ...row, _count: 1 };
                    } else {
                        map[key].total_page = (Number(map[key].total_page) || 0) + (Number(row.total_page) || 0);
                        map[key].total_dos = (Number(map[key].total_dos) || 0) + (Number(row.total_dos) || 0);
                        map[key].total_icd = (Number(map[key].total_icd) || 0) + (Number(row.total_icd) || 0);
                        map[key].completed_charts = (Number(map[key].completed_charts) || 0) + (Number(row.completed_charts) || 0);
                        map[key].rejected_charts = (Number(map[key].rejected_charts) || 0) + (Number(row.rejected_charts) || 0);
                        map[key].target = (Number(map[key].target) || 0) + (Number(row.target) || 0);
                        
                        map[key].cph = (Number(map[key].cph) || 0) + (Number(row.cph) || 0);
                        map[key].archived_percentage = (Number(map[key].archived_percentage) || 0) + (Number(row.archived_percentage) || 0);
                        
                        map[key]._count += 1;
                    }
                });

                return Object.values(map).map(row => {
                    if (row._count > 1) {
                        row.cph = Number((row.cph / row._count).toFixed(2));
                        row.archived_percentage = Number((row.archived_percentage / row._count).toFixed(2));
                    }
                    return row;
                });
            };
            
            if (hasFilters) {
                setRows(consolidateProduction(rawRows));
            } else {
                setRows([]);
            }

            // Set filter options from backend
            if (res.data.filters) {
                setFilterOptions(res.data.filters);
            }
        } catch (err) {
            setError("Failed to load team production data");
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

    const handleExportExcel = async () => {
        try {
            setLoading(true);
            const payload = {
                ...filters,
                from_date: filters.from_date ? dayjs(filters.from_date).format("YYYY-MM-DD") : null,
                to_date: filters.to_date ? dayjs(filters.to_date).format("YYYY-MM-DD") : null
            };

            const response = await api.post("/api/export-team-production/", payload, {
                responseType: 'blob'
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `Team_Production_Report_${dayjs().format('YYYYMMDD')}.xlsx`);
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

    // 🔹 KPI Calculations
    const totalMembers = rows.length;

    // Total Sums
    const totalCompleted = rows.reduce((a, b) => a + (Number(b.completed_charts) || 0), 0);
    const totalRejected = rows.reduce((a, b) => a + (Number(b.rejected_charts) || 0), 0);
    const totalCharts = totalCompleted + totalRejected;

    const totalPages = rows.reduce((a, b) => a + (Number(b.total_page) || 0), 0);
    const totalICD = rows.reduce((a, b) => a + (Number(b.total_icd) || 0), 0);
    const totalDOS = rows.reduce((a, b) => a + (Number(b.total_dos) || 0), 0);

    // Averages (Avoid division by zero)
    const avgCharts = totalMembers > 0 ? (totalCharts / totalMembers).toFixed(2) : 0;
    const avgPages = totalMembers > 0 ? (totalPages / totalMembers).toFixed(2) : 0;
    const avgICDs = totalMembers > 0 ? (totalICD / totalMembers).toFixed(2) : 0;

    const columns = [
        {
            field: "sno",
            headerName: "S.No",
            width: 50,
            renderCell: (params) =>
                params.api.getRowIndexRelativeToVisibleRows(params.id) + 1
        },
        { field: "user_employee_id", headerName: "Emp ID", width: 80 },
        {
            field: "username",
            headerName: "Employee",
            width: 120
        },
        {
            field: "user_mail_id",
            headerName: "Email ID",
            width: 250
        },

        { field: "tl_name", headerName: "TL", width: 120 },

        { field: "total_page", headerName: "Pages", width: 100 },
        { field: "total_dos", headerName: "DOS", width: 100 },
        { field: "total_icd", headerName: "ICD", width: 100 },
        {
            field: "cph",
            headerName: "CPH",
            width: 100,
            renderCell: (params) => (
                <Chip
                    size="small"
                    label={params.value}
                    color={params.value >= 3 ? "success" : "warning"}
                />
            )
        },
        { field: "completed_charts", headerName: "Completed", width: 130 },
        { field: "rejected_charts", headerName: "Rejected", width: 120 },
        { field: "target", headerName: "Target", width: 100 },
        {
            field: "archived_percentage",
            headerName: "Archive %",
            width: 130,
            renderCell: (params) => {
                const val = params.value ?? 0;
                const color =
                    val >= 95 ? "success" : val >= 90 ? "warning" : "error";
                return <Chip label={`${val}%`} color={color} size="small" />;
            }
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
            {/* 🔷 Page Header */}
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
                    Team Production Dashboard
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                    Performance overview of your team members
                </Typography>
            </Box>

            {/* 🔷 Redesigned Filter Layout */}
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
                {/* Header */}
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
                        <FilterListIcon sx={{ color: "#2563eb" }} />
                        <Typography variant="h6" fontWeight="bold">
                            Filter Panel
                        </Typography>
                    </Stack>

                    <Chip
                        label={`${Object.values(filters).filter(v => v).length} Active`}
                        size="small"
                        sx={{
                            backgroundColor: "#eef2ff",
                            color: "#3730a3",
                            fontWeight: 600
                        }}
                    />
                </Box>

                <LocalizationProvider dateAdapter={AdapterDayjs}>
                    <Box sx={{ p: 2 }}>
                        <Grid container spacing={2} alignItems="center">

                            {/* Manager */}
                            <Grid size={{ xs: 12, md: 2 }}>
                                <TextField
                                    select
                                    fullWidth
                                    size="small"
                                    label="Manager"
                                    value={filters.manager}
                                    onChange={(e) =>
                                        handleFilterChange("manager", e.target.value)
                                    }
                                    sx={modernField}
                                >
                                    <MenuItem value="">All Managers</MenuItem>
                                    {filterOptions.managers.map((mgr) => (
                                        <MenuItem key={mgr.id} value={mgr.id}>
                                            {mgr.name}
                                        </MenuItem>
                                    ))}
                                </TextField>
                            </Grid>

                            {/* TL */}
                            <Grid size={{ xs: 12, md: 2 }}>
                                <TextField
                                    select
                                    fullWidth
                                    size="small"
                                    label="Team Lead"
                                    value={filters.tl}
                                    onChange={(e) =>
                                        handleFilterChange("tl", e.target.value)
                                    }
                                    sx={modernField}
                                >
                                    <MenuItem value="">All TLs</MenuItem>
                                    {filterOptions.tls.map((tl) => (
                                        <MenuItem key={tl.id} value={tl.id}>
                                            {tl.name}
                                        </MenuItem>
                                    ))}
                                </TextField>
                            </Grid>

                            {/* Project */}
                            <Grid size={{ xs: 12, md: 2 }}>
                                <TextField
                                    select
                                    fullWidth
                                    size="small"
                                    label="Project"
                                    value={filters.project}
                                    onChange={(e) =>
                                        handleFilterChange("project", e.target.value)
                                    }
                                    sx={modernField}
                                >
                                    <MenuItem value="">All Projects</MenuItem>
                                    {filterOptions.projects.map((proj) => (
                                        <MenuItem key={proj} value={proj}>
                                            {proj}
                                        </MenuItem>
                                    ))}
                                </TextField>
                            </Grid>

                            {/* SubProject */}
                            <Grid size={{ xs: 12, md: 2 }}>
                                <TextField
                                    select
                                    fullWidth
                                    size="small"
                                    label="Sub Project"
                                    value={filters.subproject}
                                    onChange={(e) =>
                                        handleFilterChange("subproject", e.target.value)
                                    }
                                    sx={modernField}
                                >
                                    <MenuItem value="">All SubProjects</MenuItem>
                                    {filterOptions.subprojects.map((subproj) => (
                                        <MenuItem key={subproj} value={subproj}>
                                            {subproj}
                                        </MenuItem>
                                    ))}
                                </TextField>
                            </Grid>

                            {/* From Date */}
                            <Grid size={{ xs: 12, md: 1.5 }}>
                                <DatePicker
                                    label="From"
                                    value={filters.from_date}
                                    onChange={(newValue) =>
                                        handleFilterChange("from_date", newValue)
                                    }
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

                            {/* To Date */}
                            <Grid size={{ xs: 12, md: 1.5 }}>
                                <DatePicker
                                    label="To"
                                    value={filters.to_date}
                                    onChange={(newValue) =>
                                        handleFilterChange("to_date", newValue)
                                    }
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

                            {/* Apply Button */}
                            <Grid size={{ xs: 6, md: 1 }}>
                                <Button
                                    fullWidth
                                    variant="contained"
                                    onClick={handleApplyFilters}
                                    sx={{
                                        height: 40,
                                        borderRadius: 2,
                                        textTransform: "none",
                                        fontWeight: 600,
                                        background: "#2563eb"
                                    }}
                                >
                                    Apply
                                </Button>
                            </Grid>

                            {/* Reset Button */}
                            <Grid size={{ xs: 6, md: 1 }}>
                                <Button
                                    fullWidth
                                    variant="outlined"
                                    onClick={handleClearFilters}
                                    sx={{
                                        height: 40,
                                        borderRadius: 2,
                                        textTransform: "none",
                                        fontWeight: 600
                                    }}
                                >
                                    Reset
                                </Button>
                            </Grid>

                            {/* Export Button */}
                            <Grid size={{ xs: 12, md: 2 }}>
                                <Button
                                    fullWidth
                                    variant="contained"
                                    color="success"
                                    onClick={handleExportExcel}
                                    startIcon={<AssessmentIcon />}
                                    sx={{
                                        height: 40,
                                        borderRadius: 2,
                                        textTransform: "none",
                                        fontWeight: 600,
                                        background: "#10b981"
                                    }}
                                >
                                    Export Excel
                                </Button>
                            </Grid>

                            {/* 🔹 KPI Summary Cards */}
                            <Grid container spacing={2} sx={{ mt: 1, px: 1 }}>
                                {/* Row 1: Totals */}
                                <Grid size={{ xs: 12, md: 2 }}>
                                    <Paper sx={kpiStyle}>
                                        <GroupsIcon color="primary" />
                                        <Typography variant="h6">{totalMembers}</Typography>
                                        <Typography variant="body2">Team Members</Typography>
                                    </Paper>
                                </Grid>
                                <Grid size={{ xs: 12, md: 2 }}>
                                    <Paper sx={kpiStyle}>
                                        <TrendingUpIcon color="secondary" />
                                        <Typography variant="h6">{totalCharts}</Typography>
                                        <Typography variant="body2">Total Charts</Typography>
                                    </Paper>
                                </Grid>
                                <Grid size={{ xs: 12, md: 2 }}>
                                    <Paper sx={kpiStyle}>
                                        <AssessmentIcon color="success" />
                                        <Typography variant="h6">{totalPages}</Typography>
                                        <Typography variant="body2">Total Pages</Typography>
                                    </Paper>
                                </Grid>
                                <Grid size={{ xs: 12, md: 2 }}>
                                    <Paper sx={kpiStyle}>
                                        <AssessmentIcon color="warning" />
                                        <Typography variant="h6">{totalDOS}</Typography>
                                        <Typography variant="body2">Total DOS</Typography>
                                    </Paper>
                                </Grid>

                                {/* Row 2: Averages & More Totals */}
                                <Grid size={{ xs: 12, md: 2 }}>
                                    <Paper sx={kpiStyle}>
                                        <AssessmentIcon color="info" />
                                        <Typography variant="h6">{totalICD}</Typography>
                                        <Typography variant="body2">Total ICD</Typography>
                                    </Paper>
                                </Grid>
                                <Grid size={{ xs: 12, md: 2 }}>
                                    <Paper sx={kpiStyle}>
                                        <TrendingUpIcon color="primary" />
                                        <Typography variant="h6">{avgCharts}</Typography>
                                        <Typography variant="body2">Avg Charts</Typography>
                                    </Paper>
                                </Grid>
                                <Grid size={{ xs: 12, md: 2 }}>
                                    <Paper sx={kpiStyle}>
                                        <TrendingUpIcon color="success" />
                                        <Typography variant="h6">{avgPages}</Typography>
                                        <Typography variant="body2">Avg Pages</Typography>
                                    </Paper>
                                </Grid>
                                <Grid size={{ xs: 12, md: 2 }}>
                                    <Paper sx={kpiStyle}>
                                        <TrendingUpIcon color="warning" />
                                        <Typography variant="h6">{avgICDs}</Typography>
                                        <Typography variant="body2">Avg ICDs</Typography>
                                    </Paper>
                                </Grid>
                            </Grid>

                        </Grid>
                    </Box>

                </LocalizationProvider>
            </Card>

            {/* 🔷 Data Table */}
            <Card
                sx={{
                    height: 650,
                    borderRadius: 3,
                    boxShadow: 3,
                    overflow: "hidden"
                }}
            >
                <DataGrid
                    rows={rows}
                    columns={columns}
                    getRowId={(row) => row.user_employee_id}
                    slots={{ toolbar: GridToolbar }}
                    pageSizeOptions={[10, 25, 50]}
                    initialState={{
                        pagination: { paginationModel: { pageSize: 10 } }
                    }}
                    sx={{
                        border: "none",
                        "& .MuiDataGrid-columnHeaders": {
                            backgroundColor: "#f1f5f9",
                            fontWeight: "bold"
                        },
                        "& .MuiDataGrid-row:hover": {
                            backgroundColor: "#f9fafb"
                        }
                    }}
                />
            </Card>
        </Box>
    );
}

// 🔹 KPI Card Styling
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
const filterFieldStyle = {
    "& .MuiOutlinedInput-root": {
        borderRadius: 2,
        backgroundColor: "#ffffff",
        "&:hover fieldset": {
            borderColor: "#2563eb"
        },
        "&.Mui-focused fieldset": {
            borderColor: "#2563eb"
        }
    }
};
const modernField = {
    "& .MuiOutlinedInput-root": {
        borderRadius: 2.5,
        backgroundColor: "#ffffff",
        "& fieldset": {
            borderColor: "#e2e8f0"
        },
        "&:hover fieldset": {
            borderColor: "#2563eb"
        },
        "&.Mui-focused fieldset": {
            borderColor: "#2563eb",
            borderWidth: "2px"
        }
    }
};
