import { useEffect, useState, useMemo } from "react";
import { api } from "../services/api";
import {
    Box,
    Typography,
    Card,
    CardContent,
    Grid,
    Container,
    Paper,
    Button,
    IconButton,
    Tooltip,
    TextField,
    InputAdornment,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Chip,
    Stack,
    Alert,
    Snackbar,
    Tabs,
    Tab,
} from "@mui/material";
import {
    Search,
    Delete,
    CloudUpload,
    Refresh,
    Inventory,
    PictureAsPdf,
    Pages,
    WorkOutline,
    Person,
    Groups,
    Assessment
} from "@mui/icons-material";
import { DataGrid, GridToolbar } from "@mui/x-data-grid";
import { motion } from "framer-motion";

const MotionCard = motion(Card);

export default function InventoryManagement() {
    const [tabValue, setTabValue] = useState(0);
    const [rows, setRows] = useState([]);
    const [userSummary, setUserSummary] = useState([]);
    const [teamSummary, setTeamSummary] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchText, setSearchText] = useState("");
    const [deleteId, setDeleteId] = useState(null);
    const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });

    const fetchData = async () => {
        setLoading(true);
        try {
            const [invRes, userRes, teamRes] = await Promise.all([
                api.get("/api/inventory/list/"),
                api.get("/api/inventory/user-summary/"),
                api.get("/api/inventory/team-summary/")
            ]);
            setRows(invRes.data);
            setUserSummary(userRes.data);
            setTeamSummary(teamRes.data);
        } catch (err) {
            console.error("Error fetching data:", err);
            showSnackbar("Failed to load inventory data", "error");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const showSnackbar = (message, severity = "success") => {
        setSnackbar({ open: true, message, severity });
    };

    const handleDelete = async () => {
        if (!deleteId) return;
        try {
            await api.delete(`/api/inventory/delete/${deleteId}/`);
            showSnackbar("Item deleted successfully");
            fetchData();
        } catch (err) {
            console.error("Error deleting item:", err);
            showSnackbar(err.response?.data?.error || "Failed to delete item", "error");
        } finally {
            setDeleteId(null);
        }
    };

    const filteredRows = useMemo(() => {
        if (!searchText) return rows;
        const lowerSearch = searchText.toLowerCase();
        return rows.filter(
            (row) =>
                row.file_name?.toLowerCase().includes(lowerSearch) ||
                row.project?.toLowerCase().includes(lowerSearch) ||
                row.subproject?.toLowerCase().includes(lowerSearch)
        );
    }, [rows, searchText]);

    const filteredUserSummary = useMemo(() => {
        if (!searchText) return userSummary;
        const lowerSearch = searchText.toLowerCase();
        return userSummary.filter(
            (row) =>
                row.username?.toLowerCase().includes(lowerSearch) ||
                row.project?.toLowerCase().includes(lowerSearch)
        );
    }, [userSummary, searchText]);

    const inventoryColumns = [
        { field: "id", headerName: "ID", width: 80 },
        {
            field: "file_name",
            headerName: "File Name",
            flex: 1,
            renderCell: (params) => (
                <Box display="flex" alignItems="center" height="100%" gap={1}>
                    <PictureAsPdf sx={{ color: "#ef4444", fontSize: 20 }} />
                    <Typography variant="body2" fontWeight={600} color="#1e3a8a">
                        {params.value}
                    </Typography>
                </Box>
            ),
        },
        { field: "project", headerName: "Project", width: 150 },
        { field: "subproject", headerName: "Sub-Project", width: 150 },
        {
            field: "page_count",
            headerName: "Pages",
            width: 100,
            renderCell: (params) => (
                <Box display="flex" alignItems="center" height="100%">
                    <Chip
                        label={`${params.value} Pgs`}
                        size="small"
                        sx={{ fontWeight: 700, bgcolor: "#f1f5f9", color: "#475569" }}
                    />
                </Box>
            ),
        },
        { field: "uploaded_at", headerName: "Uploaded At", width: 160 },
        {
            field: "actions",
            headerName: "Actions",
            width: 100,
            sortable: false,
            renderCell: (params) => (
                <Box display="flex" alignItems="center" height="100%">
                    <Tooltip title="Delete">
                        <IconButton
                            size="small"
                            color="error"
                            onClick={() => setDeleteId(params.row.id)}
                            sx={{ "&:hover": { bgcolor: "#fee2e2" } }}
                        >
                            <Delete fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
            ),
        },
    ];

    const userColumns = [
        {
            field: "username", headerName: "User Name", flex: 1, renderCell: (params) => (
                <Box display="flex" alignItems="center" height="100%" gap={1}>
                    <Person sx={{ color: "#3b82f6", fontSize: 18 }} />
                    <Typography variant="body2" fontWeight={700}>{params.value}</Typography>
                </Box>
            )
        },
        { field: "user_employee_id", headerName: "Emp ID", width: 120 },
        { field: "project", headerName: "Project", width: 200 },
        {
            field: "allocated_count", headerName: "Allocated", width: 120, renderCell: (params) => (
                <Box display="flex" alignItems="center" height="100%">
                    <Chip label={params.value} color="primary" size="small" sx={{ fontWeight: 800 }} />
                </Box>
            )
        },
    ];

    const teamColumns = [
        {
            field: "tl_name", headerName: "Team Lead", flex: 1, renderCell: (params) => (
                <Box display="flex" alignItems="center" height="100%" gap={1}>
                    <Groups sx={{ color: "#8b5cf6", fontSize: 18 }} />
                    <Typography variant="body2" fontWeight={700}>{params.value || "No TL"}</Typography>
                </Box>
            )
        },
        { field: "tl_employee_id", headerName: "TL Emp ID", width: 150 },
        { field: "active_members", headerName: "Active Members", width: 150 },
        {
            field: "total_allocated", headerName: "Total Allocations", width: 150, renderCell: (params) => (
                <Box display="flex" alignItems="center" height="100%">
                    <Chip label={params.value} color="secondary" size="small" sx={{ fontWeight: 800 }} />
                </Box>
            )
        },
    ];

    const stats = useMemo(() => {
        const totalPdfs = rows.length;
        const totalPages = rows.reduce((acc, row) => acc + (row.page_count || 0), 0);
        const totalAllocated = userSummary.reduce((acc, row) => acc + (row.allocated_count || 0), 0);
        return { totalPdfs, totalPages, totalAllocated };
    }, [rows, userSummary]);

    return (
        <Box sx={{ minHeight: "80vh" }}>
            <Container maxWidth="xl">
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={4} sx={{ flexWrap: 'wrap', gap: 2 }}>
                    <Box>
                        <Typography variant="h4" fontWeight={900} color="#1e3a8a" sx={{ letterSpacing: "-1.5px" }}>
                            Inventory Intelligence
                        </Typography>
                        <Typography variant="body2" color="text.secondary" fontWeight={500}>
                            Advanced tracking for artifacts, user allocations, and team throughput
                        </Typography>
                    </Box>
                    <Stack direction="row" spacing={2}>
                        <Button
                            variant="outlined"
                            startIcon={<Refresh />}
                            onClick={fetchData}
                            sx={{ borderRadius: 2, textTransform: "none", fontWeight: 700 }}
                        >
                            Synchronize
                        </Button>
                        <Button
                            variant="contained"
                            startIcon={<CloudUpload />}
                            href="/pdf-upload"
                            sx={{
                                borderRadius: 2,
                                textTransform: "none",
                                fontWeight: 700,
                                boxShadow: "0 4px 12px rgba(30, 64, 175, 0.2)",
                            }}
                        >
                            Import Data
                        </Button>
                    </Stack>
                </Box>

                {/* Stats Cards */}
                <Grid container spacing={3} mb={4}>
                    {[
                        { label: "Storage Inventory", value: stats.totalPdfs, icon: <Inventory />, color: "#3b82f6" },
                        { label: "Workload Unit", value: stats.totalAllocated, icon: <Assessment />, color: "#ef4444" },
                        { label: "Data Volume", value: stats.totalPages, icon: <Pages />, color: "#10b981" },
                    ].map((stat, idx) => (
                        <Grid item xs={12} md={4} key={idx}>
                            <MotionCard
                                whileHover={{ y: -5 }}
                                sx={{
                                    borderRadius: 4,
                                    bgcolor: "rgba(255, 255, 255, 0.7)",
                                    backdropFilter: "blur(10px)",
                                    border: "1px solid #dbeafe",
                                }}
                            >
                                <CardContent sx={{ p: 3 }}>
                                    <Box display="flex" justifyContent="space-between" alignItems="center">
                                        <Box>
                                            <Typography variant="caption" fontWeight={800} color="text.secondary" sx={{ opacity: 0.6, letterSpacing: 1 }}>
                                                {stat.label.toUpperCase()}
                                            </Typography>
                                            <Typography variant="h4" fontWeight={900} color="#1e3a8a" sx={{ mt: 0.5 }}>
                                                {stat.value}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ p: 1.5, borderRadius: 3, bgcolor: `${stat.color}15`, color: stat.color }}>
                                            {stat.icon}
                                        </Box>
                                    </Box>
                                </CardContent>
                            </MotionCard>
                        </Grid>
                    ))}
                </Grid>

                {/* Main Content Card with Tabs */}
                <MotionCard
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    sx={{
                        borderRadius: 5,
                        bgcolor: "rgba(255, 255, 255, 0.8)",
                        backdropFilter: "blur(20px)",
                        border: "1px solid #dbeafe",
                        boxShadow: "0 10px 40px rgba(30, 64, 175, 0.03)",
                        overflow: "hidden",
                    }}
                >
                    <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2, pt: 1, bgcolor: '#f8fafc' }}>
                        <Tabs
                            value={tabValue}
                            onChange={(e, v) => setTabValue(v)}
                            sx={{
                                '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', minHeight: 56 },
                                '& .Mui-selected': { color: '#1e40af !important' },
                                '& .MuiTabs-indicator': { height: 3, borderRadius: '3px 3px 0 0', bgcolor: '#1e40af' }
                            }}
                        >
                            <Tab icon={<Inventory sx={{ fontSize: 20 }} />} iconPosition="start" label="PDF Repository" />
                            <Tab icon={<Person sx={{ fontSize: 20 }} />} iconPosition="start" label="User Allocation" />
                            <Tab icon={<Groups sx={{ fontSize: 20 }} />} iconPosition="start" label="Team Summary" />
                        </Tabs>
                    </Box>

                    <Box p={3} display="flex" justifyContent="space-between" alignItems="center" sx={{ flexWrap: 'wrap', gap: 2 }}>
                        <Typography variant="h6" fontWeight={800} color="#1e3a8a">
                            {tabValue === 0 ? "Global Repository" : tabValue === 1 ? "Individual Workload" : "Organizational Layout"}
                        </Typography>
                        <TextField
                            size="small"
                            placeholder="Search details..."
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            sx={{
                                width: 320,
                                "& .MuiOutlinedInput-root": { borderRadius: 2, bgcolor: "#fff", fontSize: 13 },
                            }}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <Search sx={{ fontSize: 18, color: "#94a3b8" }} />
                                    </InputAdornment>
                                ),
                            }}
                        />
                    </Box>

                    <Box sx={{ height: 550, width: "100%", p: 2 }}>
                        {tabValue === 0 && (
                            <DataGrid
                                rows={filteredRows}
                                columns={inventoryColumns}
                                loading={loading}
                                pageSizeOptions={[10, 25, 50]}
                                initialState={{ pagination: { paginationModel: { pageSize: 15 } } }}
                                disableRowSelectionOnClick
                                slots={{ toolbar: GridToolbar }}
                                sx={gridStyles}
                            />
                        )}
                        {tabValue === 1 && (
                            <DataGrid
                                rows={filteredUserSummary}
                                getRowId={(row) => `${row.user_employee_id}-${row.project}`}
                                columns={userColumns}
                                loading={loading}
                                pageSizeOptions={[10, 25, 50]}
                                initialState={{ pagination: { paginationModel: { pageSize: 15 } } }}
                                disableRowSelectionOnClick
                                sx={gridStyles}
                            />
                        )}
                        {tabValue === 2 && (
                            <DataGrid
                                rows={teamSummary}
                                getRowId={(row) => row.tl_employee_id || "no-tl"}
                                columns={teamColumns}
                                loading={loading}
                                pageSizeOptions={[10, 25, 50]}
                                initialState={{ pagination: { paginationModel: { pageSize: 15 } } }}
                                disableRowSelectionOnClick
                                sx={gridStyles}
                            />
                        )}
                    </Box>
                </MotionCard>
            </Container>

            {/* Delete Confirmation Dialog */}
            <Dialog open={Boolean(deleteId)} onClose={() => setDeleteId(null)} PaperProps={{ sx: { borderRadius: 4, maxWidth: 400 } }}>
                <DialogTitle sx={{ fontWeight: 900 }}>Revoke Artifact</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ color: "#475569", fontWeight: 500 }}>
                        This action will permanently purge the record from our systems.
                        <Alert severity="warning" sx={{ mt: 2, borderRadius: 2, fontWeight: 700 }}>
                            Caution: Allocated artifacts cannot be revoked.
                        </Alert>
                    </DialogContentText>
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={() => setDeleteId(null)} sx={{ fontWeight: 700 }}>Cancel</Button>
                    <Button onClick={handleDelete} variant="contained" color="error" sx={{ borderRadius: 2, fontWeight: 700 }}>Confirm Purge</Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })}>
                <Alert severity={snackbar.severity} sx={{ borderRadius: 2, fontWeight: 600 }}>{snackbar.message}</Alert>
            </Snackbar>
        </Box>
    );
}

const gridStyles = {
    border: "none",
    "& .MuiDataGrid-columnHeaders": { bgcolor: "#f8fafc", color: "#475569", fontWeight: 800, fontSize: 13 },
    "& .MuiDataGrid-cell": { borderColor: "#f1f5f9", fontSize: 13, fontWeight: 500 },
    "& .MuiDataGrid-footerContainer": { borderTop: "1px solid #f1f5f9" },
};
