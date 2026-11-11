import { useEffect, useState } from "react";
import { api } from "../services/api";
import { Link, useNavigate } from "react-router-dom";
import {
  Container,
  Typography,
  Box,
  Paper,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Alert,
  Breadcrumbs
} from "@mui/material";
import SearchIcon from '@mui/icons-material/Search';

export default function AuditDashboard() {
  const navigate = useNavigate();

  const [projects, setProjects] = useState([]);
  const [projectSubprojects, setProjectSubprojects] = useState({});
  const [allocated, setAllocated] = useState([]);
  const [holdCharts, setHoldCharts] = useState([]);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    project: "",
    subproject: "",
    chart_id: "",
    date_filter: "",
  });

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    try {
      const res = await api.get("/api/audit/dashboard/");
      setProjects(res.data.projects);
      setProjectSubprojects(res.data.project_subprojects || {});
      setAllocated(res.data.allocated);
      setHoldCharts(res.data.hold_charts || []);
    } catch (err) {
      if (err.response?.status === 401) {
        navigate("/login");
      }
    }
  };

  const submit = async () => {
    if (!form.chart_id && (!form.project || !form.subproject)) {
      alert("Select project + subproject OR enter chart ID");
      return;
    }

    try {
      setLoading(true);
      await api.post("/api/audit/dashboard/", form);
      setForm({ project: "", subproject: "", chart_id: "", date_filter: "" });
      load();
    } catch (err) {
      alert("Failed to allocate chart");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom component="h1" sx={{ fontWeight: 'bold', mb: 3 }}>
        Search Charts
      </Typography>

      <Paper sx={{ p: 3, mb: 4 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel
                id="project-label"
                sx={{
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  color: '#1976d2',
                  '&.Mui-focused': { color: '#0d47a1' }
                }}
              >
                Project
              </InputLabel>
              <Select
                labelId="project-label"
                value={form.project}
                label="Project"
                disabled={loading}
                onChange={e => setForm({ ...form, project: e.target.value, subproject: "" })}
              >
                <MenuItem value=""><em>None</em></MenuItem>
                {projects.map(p => (
                  <MenuItem key={p} value={p}>{p}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel
                id="subproject-label"
                sx={{
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  color: '#1976d2',
                  '&.Mui-focused': { color: '#0d47a1' }
                }}
              >
                Subproject
              </InputLabel>
              <Select
                labelId="subproject-label"
                value={form.subproject}
                label="Subproject"
                disabled={loading}
                onChange={e => setForm({ ...form, subproject: e.target.value })}
              >
                <MenuItem value=""><em>None</em></MenuItem>
                {(projectSubprojects[form.project] || []).map(s => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              size="small"
              type="date"
              label="Date Filter"
              InputLabelProps={{
                shrink: true,
                sx: {
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  color: '#1976d2',
                  '&.Mui-focused': { color: '#0d47a1' }
                }
              }}
              value={form.date_filter}
              disabled={loading}
              onChange={e => setForm({ ...form, date_filter: e.target.value })}
            />
          </Grid>

          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search Chart ID"
              label="Chart ID"
              value={form.chart_id}
              disabled={loading}
              onChange={e => setForm({ ...form, chart_id: e.target.value })}
              InputLabelProps={{
                sx: {
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  color: '#1976d2',
                  '&.Mui-focused': { color: '#0d47a1' }
                }
              }}
            />
          </Grid>

          <Grid item xs={12} md={2}>
            <Button
              fullWidth
              variant="contained"
              startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <SearchIcon />}
              onClick={submit}
              disabled={loading}
              sx={{ height: '40px' }}
            >
              {loading ? "Allocating..." : "Get Chart"}
            </Button>
          </Grid>
        </Grid>
      </Paper>

      <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>
        Allocated Charts
      </Typography>

      {allocated.length > 0 ? (
        <TableContainer component={Paper} variant="outlined">
          <Table sx={{ minWidth: 650 }}>
            <TableHead sx={{ backgroundColor: '#f5f5f5' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold' }}>Chart ID</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Project</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Subproject</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {allocated.map(r => (
                <TableRow key={r.chart_id} hover>
                  <TableCell>
                    <Typography
                      component={Link}
                      to={`/audit/chart/${r.encrypted_chart_id || r.chart_id}`}
                      sx={{
                        color: 'primary.main',
                        textDecoration: 'none',
                        '&:hover': { textDecoration: 'underline' }
                      }}
                    >
                      {r.chart_id}
                    </Typography>
                  </TableCell>
                  <TableCell>{r.project}</TableCell>
                  <TableCell>{r.subproject}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Alert severity="info" sx={{ mt: 2 }}>
          No chart allocated
        </Alert>
      )}

      {holdCharts.length > 0 && (
        <Box sx={{ mt: 5 }}>
          <Typography variant="h6" gutterBottom sx={{ color: '#f57c00', display: 'flex', alignItems: 'center', gap: 1 }}>
            ⚠️ Hold Charts
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ borderColor: '#ffe0b2' }}>
            <Table sx={{ minWidth: 650 }}>
              <TableHead sx={{ backgroundColor: '#fff3e0' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>Chart ID</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Project</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Subproject</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Hold Notes</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {holdCharts.map(r => (
                  <TableRow key={r.chart_id} hover>
                    <TableCell>
                      <Typography
                        component={Link}
                        to={`/audit/chart/${r.encrypted_chart_id || r.chart_id}`}
                        sx={{
                          color: 'primary.main',
                          textDecoration: 'none',
                          '&:hover': { textDecoration: 'underline' }
                        }}
                      >
                        {r.chart_id}
                      </Typography>
                    </TableCell>
                    <TableCell>{r.project}</TableCell>
                    <TableCell>{r.subproject}</TableCell>
                    <TableCell sx={{ fontStyle: 'italic', color: '#e65100' }}>
                      {r.hold_command || "No notes provided"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
    </Container>
  );
}