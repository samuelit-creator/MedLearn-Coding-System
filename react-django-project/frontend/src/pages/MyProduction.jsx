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
    Button
} from "@mui/material";
import { DataGrid, GridToolbar } from "@mui/x-data-grid";
import AssessmentIcon from "@mui/icons-material/Assessment";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import FilterListIcon from "@mui/icons-material/FilterList";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs from "dayjs";
import { api } from "../services/api";

export default function MyProduction() {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // Filter values
    const [filters, setFilters] = useState({
        from_date: null,
        to_date: null
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async (appliedFilters = filters) => {
        try {
            setLoading(true);
            const params = {
                from_date: appliedFilters.from_date ? dayjs(appliedFilters.from_date).format("YYYY-MM-DD") : null,
                to_date: appliedFilters.to_date ? dayjs(appliedFilters.to_date).format("YYYY-MM-DD") : null
            };
            const res = await api.get("/api/my-production/", { params });
            setRows(res.data.rows || []);
        } catch (err) {
            setError("Failed to load production data");
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
            from_date: null,
            to_date: null
        };
        setFilters(clearedFilters);
        loadData(clearedFilters);
    };

    // 🔹 KPI Calculations
    const totalCharts = rows.length;
    const totalPages = rows.reduce((a, b) => a + (Number(b.total_pages) || 0), 0);
    const totalICD = rows.reduce((a, b) => a + (Number(b.total_icd) || 0), 0);
    const totalDOS = rows.reduce((a, b) => a + (Number(b.total_dos) || 0), 0);

    const columns = [
        {
            field: "sno",
            headerName: "S.No",
            width: 70,
            renderCell: (params) =>
                params.api.getRowIndexRelativeToVisibleRows(params.id) + 1
        },
        {
            field: "created_at",
            headerName: "Date",
            width: 180,
            renderCell: (params) => params.value ? dayjs(params.value).format("MM/DD/YYYY HH:mm") : "N/A"
        },
        { field: "chart_id", headerName: "Chart ID", width: 120 },
        { field: "project", headerName: "Project", width: 150 },
        { field: "subproject", headerName: "Sub Project", width: 150 },
        { field: "total_pages", headerName: "Pages", width: 100 },
        { field: "total_dos", headerName: "DOS", width: 100 },
        { field: "total_icd", headerName: "ICD", width: 100 },
        {
            field: "chart_status",
            headerName: "Status",
            width: 130,
            renderCell: (params) => (
                <Chip
                    label={params.value?.toUpperCase()}
                    color={params.value === "complete" ? "success" : "error"}
                    size="small"
                />
            )
        }
    ];

    if (loading && rows.length === 0)
        return (
            <Box p={6} textAlign="center">
                <CircularProgress size={40} />
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
                    My Production Dashboard
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                    Your personal performance metrics
                </Typography>
            </Box>

            {/* 🔷 Filter Layout */}
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
                        <FilterListIcon sx={{ color: "#2563eb" }} />
                        <Typography variant="h6" fontWeight="bold">
                            Filters
                        </Typography>
                    </Stack>
                </Box>

                <LocalizationProvider dateAdapter={AdapterDayjs}>
                    <Box sx={{ p: 2 }}>
                        <Grid container spacing={2} alignItems="center">
                            {/* From Date */}
                            <Grid size={{ xs: 12, md: 3 }}>
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
                            <Grid size={{ xs: 12, md: 3 }}>
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

                            {/* Buttons */}
                            <Grid size={{ xs: 6, md: 2 }}>
                                <Button
                                    fullWidth
                                    variant="contained"
                                    onClick={handleApplyFilters}
                                    sx={buttonStyle}
                                >
                                    Apply
                                </Button>
                            </Grid>
                            <Grid size={{ xs: 6, md: 2 }}>
                                <Button
                                    fullWidth
                                    variant="outlined"
                                    onClick={handleClearFilters}
                                    sx={{ ...buttonStyle, background: 'transparent', color: '#64748b' }}
                                >
                                    Reset
                                </Button>
                            </Grid>
                        </Grid>

                        {/* 🔹 KPI Summary Cards */}
                        <Grid container spacing={2} sx={{ mt: 2 }}>
                            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                                <Paper sx={kpiStyle}>
                                    <TrendingUpIcon color="primary" />
                                    <Typography variant="h6">{totalCharts}</Typography>
                                    <Typography variant="body2">Total Charts</Typography>
                                </Paper>
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                                <Paper sx={kpiStyle}>
                                    <AssessmentIcon color="success" />
                                    <Typography variant="h6">{totalPages}</Typography>
                                    <Typography variant="body2">Total Pages</Typography>
                                </Paper>
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                                <Paper sx={kpiStyle}>
                                    <AssessmentIcon color="warning" />
                                    <Typography variant="h6">{totalDOS}</Typography>
                                    <Typography variant="body2">Total DOS</Typography>
                                </Paper>
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                                <Paper sx={kpiStyle}>
                                    <AssessmentIcon color="info" />
                                    <Typography variant="h6">{totalICD}</Typography>
                                    <Typography variant="body2">Total ICD</Typography>
                                </Paper>
                            </Grid>
                        </Grid>
                    </Box>
                </LocalizationProvider>
            </Card>

            {/* 🔷 Data Table */}
            <Card
                sx={{
                    height: 500,
                    borderRadius: 3,
                    boxShadow: 3,
                    overflow: "hidden"
                }}
            >
                <DataGrid
                    rows={rows}
                    columns={columns}
                    getRowId={(row) => row.chart_id}
                    slots={{ toolbar: GridToolbar }}
                    loading={loading}
                    sx={{
                        border: "none",
                        "& .MuiDataGrid-columnHeaders": {
                            backgroundColor: "#f1f5f9",
                            fontWeight: "bold"
                        }
                    }}
                />
            </Card>
        </Box>
    );
}

const kpiStyle = {
    p: 2,
    borderRadius: 3,
    textAlign: "center",
    boxShadow: 1,
    transition: "0.2s",
    "&:hover": { transform: "translateY(-4px)", boxShadow: 4 }
};

const buttonStyle = {
    height: 40,
    borderRadius: 2,
    textTransform: "none",
    fontWeight: 600,
    background: "#2563eb"
};

const modernField = {
    "& .MuiOutlinedInput-root": {
        borderRadius: 2.5,
        backgroundColor: "#ffffff",
        "& fieldset": { borderColor: "#e2e8f0" },
        "&:hover fieldset": { borderColor: "#2563eb" },
        "&.Mui-focused fieldset": { borderColor: "#2563eb", borderWidth: "2px" }
    }
};
