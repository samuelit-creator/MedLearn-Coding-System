import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import {
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Select,
  Typography,
  Alert,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
  Paper,
} from "@mui/material";

export default function CoderIndex() {
  const [projects, setProjects] = useState([]);
  const [projectSubprojects, setProjectSubprojects] = useState({});
  const [results, setResults] = useState([]);
  const [holdCharts, setHoldCharts] = useState([]);
  const [project, setProject] = useState("");
  const [subproject, setSubproject] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get("/api/coder/").then((res) => {
      setProjects(res.data.projects);
      setProjectSubprojects(res.data.project_subprojects || {});
      setResults(res.data.results);
      setHoldCharts(res.data.hold_charts || []);
    });
  }, []);

  const allocate = async (e) => {
    e.preventDefault();
    setMsg("");
    setLoading(true);

    try {
      const res = await api.post("/api/coder/", { project, subproject });

      if (res.data.allocated) {
        setMsg("✅ Chart allocated");
        const refreshed = await api.get("/api/coder/");
        setResults(refreshed.data.results);
        setHoldCharts(refreshed.data.hold_charts || []);
      } else {
        setMsg(res.data.message || res.data.error || "Allocation failed");
      }
    } catch (err) {
      console.error(err);
      setMsg(err.response?.data?.error || err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      {/* Allocation Form */}
      <Card
        sx={{
          mb: 4,
          bgcolor: "rgba(15,23,42,0.8)",
          border: "1px solid #1e293b",
          borderRadius: 3,
        }}
      >
        <CardContent>
          <Typography variant="h6" color="white" mb={2}>
            Allocate Chart
          </Typography>

          <Stack
            component="form"
            onSubmit={allocate}
            direction={{ xs: "column", md: "row" }}
            spacing={2}
          >
            <Select
              value={project}
              onChange={(e) => {
                setProject(e.target.value);
                setSubproject("");
              }}
              displayEmpty
              required
              fullWidth
              sx={{ color: "white" }}
            >
              <MenuItem value="" disabled>
                Select Project
              </MenuItem>
              {projects.map((p) => (
                <MenuItem key={p} value={p}>
                  {p}
                </MenuItem>
              ))}
            </Select>

            <Select
              value={subproject}
              onChange={(e) => setSubproject(e.target.value)}
              displayEmpty
              required
              fullWidth
              sx={{ color: "white" }}
            >
              <MenuItem value="" disabled>
                Select Subproject
              </MenuItem>
              {(projectSubprojects[project] || []).map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </Select>

            <Button
              type="submit"
              variant="contained"
              disabled={loading}
              sx={{
                px: 4,
                fontWeight: 600,
                background:
                  "linear-gradient(135deg, #6366f1, #38bdf8)",
                "&:hover": {
                  background:
                    "linear-gradient(135deg, #4f46e5, #0ea5e9)",
                },
              }}
            >
              {loading ? "Allocating..." : "Allocate"}
            </Button>
          </Stack>

          {msg && (
            <Alert severity="info" sx={{ mt: 3 }}>
              {msg}
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Results Table */}
      <TableContainer
        component={Paper}
        sx={{
          bgcolor: "rgba(15,23,42,0.8)",
          border: "1px solid #1e293b",
          borderRadius: 3,
        }}
      >
        <Table>
          <TableHead>
            <TableRow>
              <TableCell sx={{ color: "#e5e7eb", fontWeight: 600 }}>
                Chart ID
              </TableCell>
              <TableCell sx={{ color: "#e5e7eb", fontWeight: 600 }}>
                Project
              </TableCell>
              <TableCell sx={{ color: "#e5e7eb", fontWeight: 600 }}>
                Subproject
              </TableCell>
              <TableCell sx={{ color: "#e5e7eb", fontWeight: 600 }}>
                Pages
              </TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {results.map((r) => (
              <TableRow key={r.chart_id} hover>
                <TableCell>
                  <Link
                    to={`/chart/${r.encrypted_chart_id || r.chart_id}`}
                    style={{
                      color: "#60a5fa",
                      fontWeight: 500,
                      textDecoration: "none",
                    }}
                  >
                    {r.chart_id}
                  </Link>
                </TableCell>
                <TableCell sx={{ color: "#cbd5f5" }}>
                  {r.project}
                </TableCell>
                <TableCell sx={{ color: "#cbd5f5" }}>
                  {r.subproject}
                </TableCell>
                <TableCell sx={{ color: "#94a3b8" }}>
                  {r.page_count}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Hold Charts Table */}
      {holdCharts.length > 0 && (
        <Box sx={{ mt: 5 }}>
          <Typography variant="h6" color="#fbbf24" mb={2} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            ⚠️ Hold Charts
          </Typography>
          <TableContainer
            component={Paper}
            sx={{
              bgcolor: "rgba(15,23,42,0.8)",
              border: "1px solid #b45309",
              borderRadius: 3,
            }}
          >
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ color: "#e5e7eb", fontWeight: 600 }}>Chart ID</TableCell>
                  <TableCell sx={{ color: "#e5e7eb", fontWeight: 600 }}>Project</TableCell>
                  <TableCell sx={{ color: "#e5e7eb", fontWeight: 600 }}>Subproject</TableCell>
                  <TableCell sx={{ color: "#e5e7eb", fontWeight: 600 }}>Hold Notes</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {holdCharts.map((r) => (
                  <TableRow key={r.chart_id} hover>
                    <TableCell>
                      <Link
                        to={`/chart/${r.encrypted_chart_id || r.chart_id}`}
                        style={{
                          color: "#60a5fa",
                          fontWeight: 500,
                          textDecoration: "none",
                        }}
                      >
                        {r.chart_id}
                      </Link>
                    </TableCell>
                    <TableCell sx={{ color: "#cbd5f5" }}>{r.project}</TableCell>
                    <TableCell sx={{ color: "#cbd5f5" }}>{r.subproject}</TableCell>
                    <TableCell sx={{ color: "#fcd34d", fontStyle: "italic" }}>
                      {r.hold_command || "No notes provided"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
    </Box>
  );
}
