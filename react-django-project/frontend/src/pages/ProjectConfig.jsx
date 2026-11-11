import { useEffect, useState } from "react";
import { api } from "../services/api";
import {
    Box, Typography, Paper, Stack, TextField, Button,
    Chip, Divider, FormGroup, FormControlLabel, Checkbox,
    IconButton, CircularProgress, Alert, Tooltip,
    Card, CardContent
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import SettingsIcon from "@mui/icons-material/Settings";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { invalidateProjectConfigCache } from "../config/projectFieldsConfig";

const ALL_FIELDS = [
    { key: "from_date", label: "From DOS" },
    { key: "to_date", label: "To DOS" },
    { key: "pos", label: "POS" },
    { key: "start_page", label: "Start Page" },
    { key: "end_page", label: "End Page" },
    { key: "dxcode", label: "DX Code" },
    { key: "details", label: "Code Description" },
    { key: "eo", label: "DX Flag" },
    { key: "dx_location", label: "DX Location" },
    { key: "provider", label: "Meat Flag" },
    { key: "meat_dec", label: "Meat Details" },
    { key: "DOS_Flag", label: "DOS Flag" },
];

/** Fields that typically have dropdowns */
const DROPDOWN_FIELDS = [
    { key: "pos", label: "POS Options" },
    { key: "eo", label: "DX Flag Options" },
    { key: "dx_location", label: "DX Location Options" },
    { key: "provider", label: "Meat Flag Options" },
    { key: "reject_reason", label: "Reject Reason Options" },
    { key: "DOS_Flag", label: "DOS Flag Options" },
    { key: "complete_command", label: "Complete Command Options" },
];

export default function ProjectConfig() {
    const [configs, setConfigs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);

    // New entry form
    const [newProject, setNewProject] = useState("");
    const [newSubproject, setNewSubproject] = useState("");
    const [newFields, setNewFields] = useState([]);
    const [newDropdowns, setNewDropdowns] = useState({
        pos: "",
        eo: "",
        dx_location: "",
        provider: "",
        reject_reason: "",
        DOS_Flag: "",
        complete_command: ""
    });
    const [manualIcdTable, setManualIcdTable] = useState("");
    const [icdTables, setIcdTables] = useState([]);
    const [icdUploadFile, setIcdUploadFile] = useState(null);
    const [icdUploadTableName, setIcdUploadTableName] = useState("");
    const [uploadingIcd, setUploadingIcd] = useState(false);
    const [enableNpi, setEnableNpi] = useState(false);

    useEffect(() => {
        loadConfigs();
        loadIcdTables();
    }, []);

    const loadIcdTables = async () => {
        try {
            const res = await api.get("/api/list-manual-icd-tables/");
            setIcdTables(res.data.tables || []);
        } catch (err) {
            console.error("Failed to load ICD tables", err);
        }
    };

    const loadConfigs = async () => {
        setLoading(true);
        try {
            const res = await api.get("/api/project-field-config/");
            setConfigs(res.data.configs || []);
        } catch {
            setMessage({ type: "error", text: "Failed to load configurations." });
        } finally {
            setLoading(false);
        }
    };

    const toggleNewField = (key) => {
        setNewFields(prev =>
            prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
        );
    };

    const handleDropdownChange = (key, value) => {
        setNewDropdowns(prev => ({ ...prev, [key]: value }));
    };

    const handleAdd = async () => {
        if (!newProject.trim() || !newSubproject.trim() || newFields.length === 0) {
            setMessage({ type: "error", text: "Please fill in project, subproject, and select at least one field." });
            return;
        }

        // Convert comma-separated strings to arrays
        const processedDropdowns = {};
        Object.keys(newDropdowns).forEach(k => {
            const vals = newDropdowns[k].split(",").map(v => v.trim()).filter(v => v);
            if (vals.length > 0) processedDropdowns[k] = vals;
        });

        setSaving(true);
        try {
            await api.post("/api/project-field-config/", {
                project: newProject.trim(),
                subproject: newSubproject.trim(),
                fields: newFields,
                dropdowns: processedDropdowns,
                manual_icd_table: manualIcdTable,
                enable_npi: enableNpi,
            });
            invalidateProjectConfigCache();
            setMessage({ type: "success", text: `Saved: ${newProject} / ${newSubproject}` });
            setNewProject("");
            setNewSubproject("");
            setNewFields([]);
            setNewDropdowns({ pos: "", eo: "", dx_location: "", provider: "", reject_reason: "", DOS_Flag: "", complete_command: "" });
            setManualIcdTable("");
            setEnableNpi(false);
            loadConfigs();
        } catch (err) {
            setMessage({ type: "error", text: err.response?.data?.error || "Save failed." });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id, project, subproject) => {
        if (!window.confirm(`Delete config for "${project} / ${subproject}"?`)) return;
        try {
            await api.delete("/api/project-field-config/", { data: { id } });
            invalidateProjectConfigCache();
            setMessage({ type: "success", text: "Deleted." });
            loadConfigs();
        } catch {
            setMessage({ type: "error", text: "Delete failed." });
        }
    };

    const fillFormForEdit = (config) => {
        setNewProject(config.project);
        setNewSubproject(config.subproject);
        setNewFields(config.fields);
        setNewDropdowns({
            pos: (config.dropdowns?.pos || []).join(", "),
            eo: (config.dropdowns?.eo || []).join(", "),
            dx_location: (config.dropdowns?.dx_location || []).join(", "),
            provider: (config.dropdowns?.provider || []).join(", "),
            reject_reason: (config.dropdowns?.reject_reason || []).join(", "),
            DOS_Flag: (config.dropdowns?.DOS_Flag || []).join(", "),
            complete_command: (config.dropdowns?.complete_command || []).join(", ")
        });
        setManualIcdTable(config.manual_icd_table || "");
        setEnableNpi(!!config.enable_npi);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        <Box sx={{ maxWidth: 900, mx: "auto", py: 4, px: 2 }}>
            <Typography variant="h5" fontWeight="bold" gutterBottom>
                Project & Dropdown Configuration
            </Typography>
            <Typography variant="body2" color="text.secondary" mb={3}>
                Define field visibility and custom dropdown options for each Project / Subproject.
            </Typography>

            {message && (
                <Alert severity={message.type} onClose={() => setMessage(null)} sx={{ mb: 2 }}>
                    {message.text}
                </Alert>
            )}

            {/* ── Add/Edit Config ── */}
            <Paper variant="outlined" sx={{ p: 3, mb: 4, borderRadius: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom color="primary">
                    <AddCircleOutlineIcon fontSize="small" sx={{ mr: 0.5, verticalAlign: "middle" }} />
                    Configuration Details
                </Typography>

                <Stack direction={{ xs: "column", sm: "row" }} spacing={2} mb={3}>
                    <TextField
                        label="Project Name"
                        size="small"
                        fullWidth
                        value={newProject}
                        onChange={(e) => setNewProject(e.target.value)}
                    />
                    <TextField
                        label="Subproject Name"
                        size="small"
                        fullWidth
                        value={newSubproject}
                        onChange={(e) => setNewSubproject(e.target.value)}
                    />
                </Stack>

                <Divider sx={{ mb: 2 }} />

                <Typography variant="body2" fontWeight="bold" mb={1}>
                    1. Field Visibility
                </Typography>
                <FormGroup row sx={{ mb: 3 }}>
                    {ALL_FIELDS.map(f => (
                        <FormControlLabel
                            key={f.key}
                            control={
                                <Checkbox
                                    checked={newFields.includes(f.key)}
                                    onChange={() => toggleNewField(f.key)}
                                    size="small"
                                />
                            }
                            label={f.label}
                            sx={{ minWidth: 160 }}
                        />
                    ))}
                </FormGroup>

                <Divider sx={{ mb: 2 }} />

                <Typography variant="body2" fontWeight="bold" mb={1}>
                    2. Custom Dropdown Options (Comma separated)
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" mb={2}>
                    Leave empty to use system defaults for that field.
                </Typography>

                <Stack spacing={2}>
                    {DROPDOWN_FIELDS.map(df => (
                        <TextField
                            key={df.key}
                            label={df.label}
                            placeholder="e.g. Option 1, Option 2, Option 3"
                            size="small"
                            fullWidth
                            variant="outlined"
                            value={newDropdowns[df.key]}
                            onChange={(e) => handleDropdownChange(df.key, e.target.value)}
                        />
                    ))}
                </Stack>

                <Divider sx={{ my: 3 }} />

                <Typography variant="body2" fontWeight="bold" mb={1}>
                    3. Manual ICD Database Table
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" mb={2}>
                    Choose which database table to use for ICD search in this project.
                </Typography>

                <Stack direction="row" spacing={2} alignItems="center">
                    <TextField
                        select
                        label="Select ICD Table"
                        size="small"
                        fullWidth
                        value={manualIcdTable}
                        onChange={(e) => setManualIcdTable(e.target.value)}
                        SelectProps={{ native: true }}
                    >
                        <option value="">-- Default (manual_icd) --</option>
                        {icdTables.filter(t => t !== 'manual_icd').map(t => (
                            <option key={t} value={t}>{t}</option>
                        ))}
                    </TextField>
                    <Button variant="outlined" size="small" onClick={loadIcdTables}>Refresh</Button>
                </Stack>

                <Box sx={{ mt: 3, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                    <Typography variant="caption" fontWeight="bold" display="block" mb={1}>
                        UPLOAD NEW ICD DATABASE (Excel)
                    </Typography>
                    <Stack direction="row" spacing={2} alignItems="center">
                        <TextField
                            label="New Table Name"
                            placeholder="e.g. project_a_codes"
                            size="small"
                            value={icdUploadTableName}
                            onChange={(e) => setIcdUploadTableName(e.target.value)}
                        />
                        <input
                            type="file"
                            accept=".xlsx"
                            style={{ display: 'none' }}
                            id="icd-file-upload"
                            onChange={(e) => setIcdUploadFile(e.target.files[0])}
                        />
                        <label htmlFor="icd-file-upload">
                            <Button variant="outlined" component="span" startIcon={<CloudUploadIcon />}>
                                {icdUploadFile ? icdUploadFile.name : "Choose Excel"}
                            </Button>
                        </label>
                        <Button
                            variant="contained"
                            color="secondary"
                            disabled={!icdUploadFile || !icdUploadTableName || uploadingIcd}
                            onClick={async () => {
                                setUploadingIcd(true);
                                const formData = new FormData();
                                formData.append("file", icdUploadFile);
                                formData.append("table_name", icdUploadTableName);
                                try {
                                    const res = await api.post("/api/upload-manual-icd/", formData);
                                    setMessage({ type: "success", text: `Created table: ${res.data.table}` });
                                    setIcdUploadFile(null);
                                    setIcdUploadTableName("");
                                    loadIcdTables();
                                } catch (err) {
                                    setMessage({ type: "error", text: err.response?.data?.error || "Upload failed" });
                                } finally {
                                    setUploadingIcd(false);
                                }
                            }}
                        >
                            {uploadingIcd ? <CircularProgress size={20} /> : "Upload & Create"}
                        </Button>
                    </Stack>
                </Box>

                <Box mt={3} p={2} sx={{ background: "linear-gradient(135deg,#f0f9ff,#e0f2fe)", borderRadius: 2, border: "1px solid #bae6fd" }}>
                    <Box display="flex" alignItems="center" justifyContent="space-between">
                        <Box>
                            <Typography variant="body2" fontWeight="bold" color="#0369a1">
                                🔍 NPI Provider Search
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                Allow coders to look up providers by name and auto-fill NPI number per DX entry.
                            </Typography>
                        </Box>
                        <Box display="flex" alignItems="center" gap={1}>
                            <Typography variant="body2" color={enableNpi ? "#0369a1" : "text.secondary"} fontWeight={600}>
                                {enableNpi ? "Enabled" : "Disabled"}
                            </Typography>
                            <input
                                type="checkbox"
                                id="enable-npi-toggle"
                                checked={enableNpi}
                                onChange={(e) => setEnableNpi(e.target.checked)}
                                style={{ width: 18, height: 18, accentColor: "#0ea5e9", cursor: "pointer" }}
                            />
                        </Box>
                    </Box>
                </Box>

                <Box mt={4} textAlign="right">
                    <Button
                        variant="contained"
                        onClick={handleAdd}
                        disabled={saving}
                        size="large"
                        startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SettingsIcon />}
                    >
                        Save Configuration
                    </Button>
                </Box>
            </Paper>

            {/* ── Existing Configs ── */}
            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Saved Configurations
            </Typography>

            {loading ? (
                <CircularProgress />
            ) : configs.length === 0 ? (
                <Typography color="text.secondary">No configurations saved yet.</Typography>
            ) : (
                <Stack spacing={2}>
                    {configs.map(cfg => (
                        <Card key={cfg.id} variant="outlined" sx={{ borderRadius: 2 }}>
                            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                                <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                                    <Box sx={{ flex: 1 }}>
                                        <Typography variant="subtitle1" fontWeight="bold">
                                            {cfg.project}
                                            <Typography component="span" color="text.secondary" fontWeight="normal">
                                                {" / "}{cfg.subproject}
                                            </Typography>
                                        </Typography>

                                        <Box mt={1}>
                                            <Typography variant="caption" fontWeight="bold" color="text.secondary">FIELDS:</Typography>
                                            <Box mt={0.5} display="flex" flexWrap="wrap" gap={0.5}>
                                                {cfg.fields.map(f => (
                                                    <Chip key={f} label={ALL_FIELDS.find(x => x.key === f)?.label || f} size="small" variant="outlined" />
                                                ))}
                                            </Box>
                                        </Box>

                                        {cfg.dropdowns && Object.keys(cfg.dropdowns).length > 0 && (
                                            <Box mt={1.5}>
                                                <Typography variant="caption" fontWeight="bold" color="text.secondary">CUSTOM DROPDOWNS:</Typography>
                                                <Stack spacing={0.5} mt={0.5}>
                                                    {Object.entries(cfg.dropdowns).map(([key, vals]) => (
                                                        <Typography key={key} variant="caption" display="block">
                                                            <strong>{ALL_FIELDS.find(x => x.key === key)?.label || key}:</strong> {vals.join(", ")}
                                                        </Typography>
                                                    ))}
                                                </Stack>
                                            </Box>
                                        )}

                                        {cfg.manual_icd_table && (
                                            <Box mt={1.5}>
                                                <Typography variant="caption" fontWeight="bold" color="text.secondary">ICD TABLE:</Typography>
                                                <Typography variant="caption" display="block">
                                                    {cfg.manual_icd_table}
                                                </Typography>
                                            </Box>
                                        )}
                                        {cfg.enable_npi && (
                                            <Box mt={1}>
                                                <Chip
                                                    label="NPI Search Enabled"
                                                    size="small"
                                                    style={{ background: "#0ea5e9", color: "#fff", fontWeight: 600, fontSize: "0.72rem" }}
                                                />
                                            </Box>
                                        )}
                                    </Box>

                                    <Stack direction="row" spacing={1}>
                                        <Button size="small" onClick={() => fillFormForEdit(cfg)}>Edit</Button>
                                        <Tooltip title="Delete">
                                            <IconButton color="error" size="small" onClick={() => handleDelete(cfg.id, cfg.project, cfg.subproject)}>
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    </Stack>
                                </Box>
                            </CardContent>
                        </Card>
                    ))}
                </Stack>
            )}
        </Box>
    );
}
