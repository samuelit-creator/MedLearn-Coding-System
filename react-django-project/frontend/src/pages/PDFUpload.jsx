import { useState, useRef, useEffect } from "react";
import { api } from "../services/api";
import {
  Button,
  CircularProgress,
  Box,
  Typography,
  Stack,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert
} from "@mui/material";

export default function PDFUpload() {
  const [project, setProject] = useState("");
  const [subproject, setSubproject] = useState("");
  const [files, setFiles] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [configs, setConfigs] = useState([]);
  const [configLoading, setConfigLoading] = useState(true);

  const fileInputRef = useRef(null);

  useEffect(() => {
    api.get("/api/project-field-config/")
      .then(res => setConfigs(res.data.configs || []))
      .catch(() => setConfigs([]))
      .finally(() => setConfigLoading(false));
  }, []);

  // Unique project names
  const projectOptions = [...new Set(configs.map(c => c.project))];

  // Subprojects for selected project
  const subprojectOptions = configs
    .filter(c => c.project === project)
    .map(c => c.subproject);

  const handleFileChange = (e) => {
    setFiles(Array.from(e.target.files));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (files.length === 0) return;

    const formData = new FormData();
    formData.append("project", project);
    formData.append("subproject", subproject);
    files.forEach((file) => formData.append("files", file));

    setLoading(true);
    setMessage("");

    try {
      const res = await api.post("/api/pdf-upload/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setMessage(`✅ ${res.data.files?.length || files.length} PDFs uploaded`);
      setProject("");
      setSubproject("");
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setMessage("❌ Upload failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 500, margin: "40px auto", padding: 3, borderRadius: 2, boxShadow: 3 }}>
      <Typography variant="h5" align="center" gutterBottom sx={{ fontWeight: "bold" }}>
        Inventory Upload
      </Typography>

      {configLoading ? (
        <Box textAlign="center" py={3}><CircularProgress /></Box>
      ) : projectOptions.length === 0 ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No project configurations found. Please set up projects in <strong>Project Configuration</strong> first.
        </Alert>
      ) : null}

      <form onSubmit={handleSubmit}>
        <Stack spacing={3}>
          <FormControl fullWidth size="small" required disabled={configLoading || projectOptions.length === 0}>
            <InputLabel>Project Name</InputLabel>
            <Select
              value={project}
              label="Project Name"
              onChange={(e) => {
                setProject(e.target.value);
                setSubproject("");
              }}
            >
              {projectOptions.map((p) => (
                <MenuItem key={p} value={p}>{p}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small" required disabled={!project}>
            <InputLabel>Sub Project</InputLabel>
            <Select
              value={subproject}
              label="Sub Project"
              onChange={(e) => setSubproject(e.target.value)}
            >
              {subprojectOptions.map((s) => (
                <MenuItem key={s} value={s}>{s}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box>
            <input
              type="file"
              multiple
              accept="application/pdf"
              onChange={handleFileChange}
              style={{ display: "none" }}
              id="upload-pdfs"
              ref={fileInputRef}
            />
            <label htmlFor="upload-pdfs">
              <Button variant="outlined" component="span" fullWidth>
                {files.length > 0 ? "Change Selection" : "Select PDFs"}
              </Button>
            </label>

            {files.length > 0 && (
              <Box sx={{ mt: 1, display: "flex", flexWrap: "wrap", gap: 1 }}>
                {files.map((file, index) => (
                  <Chip key={index} label={file.name} size="small" variant="outlined" />
                ))}
              </Box>
            )}
          </Box>

          <Button
            variant="contained"
            color="primary"
            type="submit"
            fullWidth
            size="large"
            disabled={loading || files.length === 0 || !project || !subproject}
          >
            {loading ? <CircularProgress size={24} color="inherit" /> : "Upload Files"}
          </Button>
        </Stack>
      </form>

      {message && (
        <Typography
          variant="body2"
          align="center"
          sx={{ marginTop: 2, color: message.startsWith("✅") ? "success.main" : "error.main", fontWeight: "medium" }}
        >
          {message}
        </Typography>
      )}
    </Box>
  );
}