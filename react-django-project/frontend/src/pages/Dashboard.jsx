import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../services/api";
import { Pie, Bar, Doughnut } from "react-chartjs-2";
import "../chartConfig";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  CircularProgress,
  Container,
  Divider,
  Paper,
  Avatar,
  Chip,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  IconButton,
  Tooltip,
  LinearProgress,
  Skeleton,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from "@mui/material";
import {
  TrendingUp,
  Assignment,
  CheckCircle,
  ErrorOutline,
  Timeline,
  AccessTime,
  Notifications,
  FormatQuote,
  WorkspacePremium,
  BarChart,
  PendingActions,
  ContactSupport
} from "@mui/icons-material";
import { motion, AnimatePresence } from "framer-motion";

const MotionCard = motion.create(Card);

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [qualitySummary, setQualitySummary] = useState([]);
  const [rebuttals, setRebuttals] = useState([]);
  const [allocatedCharts, setAllocatedCharts] = useState([]);
  const [teamStats, setTeamStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeMembersOpen, setActiveMembersOpen] = useState(false);
  const [pendingClarifications, setPendingClarifications] = useState(0);
  const navigate = useNavigate();

  const role = localStorage.getItem("role") || "Coder";
  const user_name = localStorage.getItem("user_name") || "User";

  useEffect(() => {
    const fetchAllData = async () => {
      setLoading(true);
      try {
        const [dashRes, qualityRes, rebuttalRes, tasksRes, teamRes] = await Promise.allSettled([
          api.get("/api/dashboard/"),
          api.get("/api/quality/summary/"),
          api.get("/api/quality/rebuttal-status/"),
          role === "Auditor" || role === "AT Auditor"
            ? api.get("/api/audit/dashboard/")
            : api.get("/api/coder/"),
          (role === "TL" || role === "Manager") ? api.post("/api/team-production/", {}) : Promise.resolve({ data: { rows: [] } })
        ]);

        if (dashRes.status === "fulfilled") setData(dashRes.value.data);
        if (qualityRes.status === "fulfilled") setQualitySummary(qualityRes.value.data.rows || []);
        if (rebuttalRes.status === "fulfilled") setRebuttals(rebuttalRes.value.data.rows || []);
        if (teamRes.status === "fulfilled") setTeamStats(teamRes.value.data.rows || []);

        if (tasksRes.status === "fulfilled") {
          const taskData = tasksRes.value.data;
          setAllocatedCharts(taskData.results || taskData.allocated || []);
        }
      } catch (err) {
        console.error("Error fetching dashboard data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchAllData();

    // Fetch pending clarifications count for responders (non-Coders)
    if (role !== "Coder") {
      api.get("/api/clarification/").then((res) => {
        const allRequests = res.data.requests || [];
        const currentUserId = res.data.current_user_id || "";
        const pendingCount = allRequests.filter(
          (r) => r.status === "pending" && r.raised_by !== currentUserId
        ).length;
        setPendingClarifications(pendingCount);
      }).catch(() => {});
    }
  }, [role]);

  // Derived metrics
  const avgQuality = useMemo(() => {
    if (!qualitySummary.length) return 100;
    const totalIcd = qualitySummary.reduce((acc, curr) => acc + (curr.total_icd || 0), 0);
    const totalError = qualitySummary.reduce((acc, curr) => acc + (curr.total_error || 0), 0);
    if (totalIcd === 0) return 100;
    return (Math.max(0, (1 - (totalError / totalIcd)) * 100)).toFixed(1);
  }, [qualitySummary]);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1 }
  };

  if (loading || !data) {
    return (
      <Container maxWidth="xl" sx={{ mt: 4 }}>
        <Grid container spacing={3} mb={4}>
          <Grid size={{ xs: 12, md: 7 }}>
            <Box display="flex" alignItems="center">
              <Skeleton variant="circular" width={64} height={64} sx={{ mr: 2 }} />
              <Box>
                <Skeleton width={200} height={40} />
                <Skeleton width={120} height={24} />
              </Box>
            </Box>
          </Grid>
          <Grid size={{ xs: 12, md: 5 }}>
            <Skeleton variant="rounded" height={80} sx={{ borderRadius: 4 }} />
          </Grid>
        </Grid>
        <Grid container spacing={3} mb={4}>
          {[1, 2, 3, 4].map((i) => (
            <Grid size={{ xs: 12, sm: 6, md: 3 }} key={i}>
              <Skeleton variant="rounded" height={140} sx={{ borderRadius: 4 }} />
            </Grid>
          ))}
        </Grid>
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 8 }}>
            <Skeleton variant="rounded" height={400} sx={{ borderRadius: 4 }} />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <Skeleton variant="rounded" height={190} sx={{ borderRadius: 4, mb: 3 }} />
            <Skeleton variant="rounded" height={190} sx={{ borderRadius: 4 }} />
          </Grid>
        </Grid>
      </Container>
    );
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top right, rgba(25, 118, 210, 0.05), transparent), radial-gradient(circle at bottom left, rgba(156, 39, 176, 0.05), transparent)",
        pt: 0.1
      }}
    >
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* Header Actions */}
          <Box display="flex" justifyContent="flex-end" mb={2} gap={1} alignItems="center">
            <Button variant="contained" size="small" sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600, px: 2, height: 36, boxShadow: '0 4px 12px rgba(25, 118, 210, 0.2)' }}>
              System Reports
            </Button>
          </Box>

          {/* Welcome Section */}
          <Grid container spacing={3} mb={4} alignItems="center">
            <Grid size={{ xs: 12, md: 7 }}>
              <Box display="flex" alignItems="center" mb={1}>
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <Avatar
                    sx={{
                      width: 72,
                      height: 72,
                      mr: 2.5,
                      background: "linear-gradient(135deg, #1976d2, #64b5f6)",
                      boxShadow: "0 8px 30px rgba(25, 118, 210, 0.4)",
                      fontSize: "1.8rem",
                      fontWeight: 800
                    }}
                  >
                    {user_name.charAt(0)}
                  </Avatar>
                </motion.div>
                <Box>
                  <Typography variant="h3" fontWeight="900" letterSpacing="-1.5px" sx={{ color: '#1a237e', textShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                    {data.greeting.split('!')[0]}!
                  </Typography>
                  <Box display="flex" alignItems="center" gap={1.5} mt={0.5}>
                    <Chip
                      label={role}
                      size="small"
                      sx={{
                        fontWeight: 700,
                        px: 1,
                        bgcolor: 'primary.main',
                        color: 'white',
                        boxShadow: '0 4px 10px rgba(25, 118, 210, 0.3)'
                      }}
                      icon={<WorkspacePremium sx={{ color: 'white !important', fontSize: '1rem' }} />}
                    />
                    <Typography variant="body1" color="text.secondary" fontWeight={500}>
                      {data.greeting.split('!')[1]}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </Grid>
            <Grid size={{ xs: 12, md: 5 }}>
              <Paper
                elevation={0}
                sx={{
                  p: 3,
                  borderRadius: 5,
                  backgroundColor: "rgba(255,255,255,0.8)",
                  backdropFilter: "blur(20px)",
                  border: "1px solid rgba(255,255,255,0.4)",
                  boxShadow: "0 10px 40px rgba(0,0,0,0.04)",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 2,
                  position: 'relative',
                  overflow: 'hidden',
                  "&::before": {
                    content: '""',
                    position: 'absolute',
                    top: 0, left: 0, width: '4px', height: '100%',
                    bgcolor: 'primary.main',
                    opacity: 0.6
                  }
                }}
              >
                <FormatQuote color="primary" sx={{ opacity: 0.3, transform: "rotate(180deg)", fontSize: '2rem' }} />
                <Typography variant="body2" color="text.primary" fontStyle="italic" fontWeight={600} lineHeight={1.6}>
                  {data.quote}
                </Typography>
              </Paper>
            </Grid>
          </Grid>

          <Grid container spacing={3} mb={5}>
            {(role === "TL" || role === "Manager" ? [
              {
                label: "Team Production",
                value: data.team_metrics.total_production,
                icon: <Assignment />,
                color: "#3d5afe",
                bg: "linear-gradient(135deg, rgba(61, 90, 254, 0.1), rgba(61, 90, 254, 0.05))",
                progress: (data.team_metrics.total_production / (data.pdf.uploaded || 1)) * 100,
                trend: "Team Throughput"
              },
              {
                label: "On-Floor Strength",
                value: data.team_metrics.active_members,
                icon: <AccessTime />,
                color: "#d500f9",
                bg: "linear-gradient(135deg, rgba(213, 0, 249, 0.1), rgba(213, 0, 249, 0.05))",
                progress: (data.team_metrics.active_members / (teamStats.length || 1)) * 100,
                trend: "Active Members"
              },
              {
                label: "Team Quality Avg",
                value: `${avgQuality}%`,
                icon: <CheckCircle />,
                color: "#00c853",
                bg: "linear-gradient(135deg, rgba(0, 200, 83, 0.1), rgba(0, 200, 83, 0.05))",
                progress: parseFloat(avgQuality),
                trend: avgQuality > 90 ? "Healthy" : "Needs Review"
              },
              {
                label: "Team Rebuttals",
                value: data.team_metrics.pending_rebuttals,
                icon: <PendingActions />,
                color: "#ff1744",
                bg: "linear-gradient(135deg, rgba(255, 23, 68, 0.1), rgba(255, 23, 68, 0.05))",
                progress: (data.team_metrics.pending_rebuttals / (data.team_metrics.total_production || 1)) * 100,
                trend: "Unresolved"
              },
              {
                label: "Team Hold Charts",
                value: data.team_metrics.total_hold_charts || 0,
                icon: <PendingActions />,
                color: "#ff9100",
                bg: "linear-gradient(135deg, rgba(255, 145, 0, 0.1), rgba(255, 145, 0, 0.05))",
                progress: (data.team_metrics.total_hold_charts / (data.team_metrics.total_allocated || 1)) * 100,
                trend: "Paused Work"
              },
              {
                label: "Pending Clarifications",
                value: pendingClarifications,
                icon: <ContactSupport />,
                color: "#00bcd4",
                bg: "linear-gradient(135deg, rgba(0, 188, 212, 0.1), rgba(0, 188, 212, 0.05))",
                progress: pendingClarifications > 0 ? Math.min((pendingClarifications / 10) * 100, 100) : 0,
                trend: pendingClarifications > 0 ? "Needs Response" : "All Clear",
                onClick: () => navigate("/clarification-portal")
              }
            ] : [
              {
                label: "Total Inventory",
                value: data.pdf.uploaded,
                icon: <Assignment />,
                color: "#3d5afe",
                bg: "linear-gradient(135deg, rgba(61, 90, 254, 0.1), rgba(61, 90, 254, 0.05))",
                progress: (data.pdf.allocated / (data.pdf.uploaded || 1)) * 100,
                trend: "System"
              },
              {
                label: "Active Focus",
                value: data.pdf.allocated,
                icon: <AccessTime />,
                color: "#d500f9",
                bg: "linear-gradient(135deg, rgba(213, 0, 249, 0.1), rgba(213, 0, 249, 0.05))",
                progress: (allocatedCharts.length / (data.pdf.allocated || 1)) * 100,
                trend: "Personal"
              },
              {
                label: "Average Quality",
                value: `${avgQuality}%`,
                icon: <CheckCircle />,
                color: "#00c853",
                bg: "linear-gradient(135deg, rgba(0, 200, 83, 0.1), rgba(0, 200, 83, 0.05))",
                progress: parseFloat(avgQuality),
                trend: avgQuality > 90 ? "Excellent" : "Needs Focus"
              },
              {
                label: "Open Disputes",
                value: rebuttals.length,
                icon: <PendingActions />,
                color: "#ff1744",
                bg: "linear-gradient(135deg, rgba(255, 23, 68, 0.1), rgba(255, 23, 68, 0.05))",
                progress: (rebuttals.length / (data.errors.agree + data.errors.disagree + data.errors.pending || 1)) * 100,
                trend: rebuttals.length > 5 ? "High Priority" : "Stable"
              },
              ...(role !== "Coder" ? [{
                label: "Pending Clarifications",
                value: pendingClarifications,
                icon: <ContactSupport />,
                color: "#00bcd4",
                bg: "linear-gradient(135deg, rgba(0, 188, 212, 0.1), rgba(0, 188, 212, 0.05))",
                progress: pendingClarifications > 0 ? Math.min((pendingClarifications / 10) * 100, 100) : 0,
                trend: pendingClarifications > 0 ? "Needs Response" : "All Clear",
                onClick: () => navigate("/clarification-portal")
              }] : [])
            ]).map((stat, idx) => (
              <Grid size={{ xs: 12, sm: 6, md: 3 }} key={idx}>
                <MotionCard
                  onClick={() => {
                    if (stat.label === "On-Floor Strength") {
                      setActiveMembersOpen(true);
                    } else if (stat.onClick) {
                      stat.onClick();
                    }
                  }}
                  variants={itemVariants}
                  whileHover={{
                    y: -8,
                    boxShadow: "0 20px 40px rgba(0,0,0,0.08)",
                    transition: { duration: 0.3, ease: 'easeOut' }
                  }}
                  sx={{
                    borderRadius: 5,
                    border: stat.label === "Pending Clarifications" && pendingClarifications > 0
                      ? "1px solid rgba(0, 188, 212, 0.4)"
                      : "1px solid rgba(255,255,255,0.6)",
                    bgcolor: 'rgba(255,255,255,0.7)',
                    backdropFilter: 'blur(30px)',
                    position: 'relative',
                    overflow: 'visible',
                    cursor: (stat.label === "On-Floor Strength" || stat.onClick) ? "pointer" : "default"
                  }}
                >
                  <CardContent sx={{ p: 3 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary" fontWeight={800} sx={{ opacity: 0.6, letterSpacing: '0.5px', fontSize: '0.7rem' }}>
                          {stat.label.toUpperCase()}
                        </Typography>
                        <Typography variant="h3" fontWeight={900} sx={{ mt: 0.5, color: "#1a237e", letterSpacing: '-1px' }}>
                          {stat.value}
                        </Typography>
                      </Box>
                      <motion.div
                        animate={{
                          y: [0, -4, 0],
                          transition: { repeat: Infinity, duration: 3, ease: 'easeInOut', delay: idx * 0.5 }
                        }}
                      >
                        <Box
                          sx={{
                            p: 2,
                            borderRadius: 4,
                            background: stat.bg,
                            color: stat.color,
                            display: "flex",
                            boxShadow: `0 8px 20px ${stat.color}20`
                          }}
                        >
                          {stat.icon}
                        </Box>
                      </motion.div>
                    </Box>

                    <Box mt={3} display="flex" alignItems="center" justifyContent="space-between">
                      <Box sx={{ width: '70%' }}>
                        <LinearProgress
                          variant="determinate"
                          value={stat.progress || 0}
                          sx={{
                            height: 6,
                            borderRadius: 3,
                            bgcolor: 'rgba(0,0,0,0.04)',
                            "& .MuiLinearProgress-bar": {
                              borderRadius: 3,
                              background: `linear-gradient(90deg, ${stat.color}, ${stat.color}88)`
                            }
                          }}
                        />
                      </Box>
                      <Typography variant="caption" fontWeight={700} sx={{ color: stat.color, bgcolor: `${stat.color}15`, px: 1, py: 0.5, borderRadius: 1.5 }}>
                        {stat.trend}
                      </Typography>
                    </Box>
                  </CardContent>
                </MotionCard>
              </Grid>
            ))}
          </Grid>

          {/* Charts and Details Section */}
          <Grid container spacing={3}>
            {/* Main Visualizations */}
            <Grid size={{ xs: 12, md: 8 }}>
              <MotionCard
                variants={itemVariants}
                sx={{
                  borderRadius: 5,
                  height: "100%",
                  bgcolor: 'rgba(255,255,255,0.7)',
                  backdropFilter: 'blur(30px)',
                  border: '1px solid rgba(255,255,255,0.5)',
                  boxShadow: '0 15px 50px rgba(0,0,0,0.05)'
                }}
              >
                <CardContent sx={{ p: 4 }}>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={5}>
                    <Box>
                      <Typography variant="h5" fontWeight={900} sx={{ color: '#1a237e' }}>Performance Overview</Typography>
                      <Typography variant="body2" color="text.secondary" fontWeight={500}>Detailed quality and throughput metrics by project</Typography>
                    </Box>
                    <Box display="flex" gap={1}>
                      <Chip label="Last 30 Days" size="small" variant="outlined" sx={{ fontWeight: 600 }} />
                      <IconButton size="small" sx={{ color: 'primary.main', bgcolor: 'rgba(25, 118, 210, 0.05)' }}>
                        <BarChart />
                      </IconButton>
                    </Box>
                  </Box>

                  <Box sx={{ height: 320 }}>
                    <Bar
                      data={{
                        labels: (() => {
                          const projectGroups = {};
                          qualitySummary.forEach(r => {
                            if (!projectGroups[r.project]) projectGroups[r.project] = { icd: 0, err: 0, count: 0 };
                            projectGroups[r.project].icd += r.total_icd || 0;
                            projectGroups[r.project].err += r.total_error || 0;
                            projectGroups[r.project].count += r.total_audited || 0;
                          });
                          return Object.keys(projectGroups).length > 0 ? Object.keys(projectGroups) : (loading ? ["Loading..."] : ["No Data"]);
                        })(),
                        datasets: [
                          {
                            label: "Quality %",
                            data: (() => {
                              const projectGroups = {};
                              qualitySummary.forEach(r => {
                                if (!projectGroups[r.project]) projectGroups[r.project] = { icd: 0, err: 0 };
                                projectGroups[r.project].icd += r.total_icd || 0;
                                projectGroups[r.project].err += r.total_error || 0;
                              });
                              return Object.values(projectGroups).map(g => g.icd > 0 ? ((1 - (g.err / g.icd)) * 100).toFixed(1) : 100);
                            })(),
                            backgroundColor: "#3d5afe",
                            borderRadius: 10,
                            barThickness: 24,
                            hoverBackgroundColor: '#1a237e'
                          },
                          {
                            label: "Volumes",
                            data: (() => {
                              const projectGroups = {};
                              qualitySummary.forEach(r => {
                                if (!projectGroups[r.project]) projectGroups[r.project] = 0;
                                projectGroups[r.project] += r.total_audited || 0;
                              });
                              return Object.values(projectGroups);
                            })(),
                            backgroundColor: "#e8efff",
                            borderRadius: 10,
                            barThickness: 24,
                            hoverBackgroundColor: '#c5d5ff'
                          }
                        ]
                      }}
                      options={{
                        maintainAspectRatio: false,
                        plugins: {
                          legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8, font: { weight: 'bold', size: 12 } } },
                          tooltip: {
                            backgroundColor: 'rgba(26, 35, 126, 0.9)',
                            padding: 12,
                            borderRadius: 10,
                            titleFont: { size: 14, weight: 'bold' },
                            bodyFont: { size: 13 }
                          }
                        },
                        scales: {
                          y: {
                            beginAtZero: true,
                            max: 100,
                            grid: { color: 'rgba(0,0,0,0.03)' },
                            ticks: { font: { weight: 'bold' } }
                          },
                          x: {
                            grid: { display: false },
                            ticks: { font: { weight: 'bold' } }
                          }
                        }
                      }}
                    />
                  </Box>
                </CardContent>
              </MotionCard>
            </Grid>

            {/* Side Charts / Notifications */}
            <Grid size={{ xs: 12, md: 4 }}>
              <Grid container spacing={3}>
                <Grid size={{ xs: 12 }}>
                  <MotionCard variants={itemVariants} sx={{ borderRadius: 4 }}>
                    <CardContent sx={{ p: 4 }}>
                      <Typography variant="subtitle1" fontWeight={700} mb={3} display="flex" alignItems="center" gap={1}>
                        <Timeline color="primary" /> Pending Rebuttals Summary
                      </Typography>
                      <Grid container spacing={2}>
                        {[
                          { label: "Coder Pending", value: data.rebuttal_counts.coder_pending, color: "#ffa726" },
                          { label: "Coder TL Pending", value: data.rebuttal_counts.coder_tl_pending, color: "#f44336" },
                          { label: "Auditor Pending", value: data.rebuttal_counts.auditor_pending, color: "#26a69a" },
                          { label: "Auditor TL Pending", value: data.rebuttal_counts.auditor_tl_pending, color: "#7e57c2" }
                        ].map((item, idx) => (
                          <Grid size={{ xs: 6 }} key={idx}>
                            <Box
                              sx={{
                                p: 2,
                                borderRadius: 3,
                                bgcolor: `${item.color}10`,
                                border: `1px solid ${item.color}30`,
                                textAlign: 'center'
                              }}
                            >
                              <Typography variant="h5" fontWeight={800} sx={{ color: item.color }}>
                                {item.value}
                              </Typography>
                              <Typography variant="caption" fontWeight={700} color="text.secondary">
                                {item.label}
                              </Typography>
                            </Box>
                          </Grid>
                        ))}
                      </Grid>
                    </CardContent>
                  </MotionCard>
                </Grid>

                <Grid size={{ xs: 12 }}>
                  <MotionCard variants={itemVariants} sx={{ borderRadius: 4 }}>
                    <CardContent sx={{ p: 3 }}>
                      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Typography variant="subtitle1" fontWeight={700}>Detailed Rebuttals</Typography>
                        <Chip label={rebuttals.length} size="small" color="error" variant="outlined" />
                      </Box>
                      <List dense sx={{ maxHeight: 180, overflow: 'auto' }}>
                        {rebuttals.length > 0 ? rebuttals.slice(0, 3).map((r, i) => (
                          <ListItem
                            key={i}
                            component={Link}
                            to={r.source === "at_audit" ? `/at-audit/quality/chart/${r.encrypted_chart_id || r.chart_id}` : `/quality/chart/${r.encrypted_chart_id || r.chart_id}`}
                            sx={{
                              px: 0,
                              borderBottom: "1px solid rgba(0,0,0,0.05)",
                              color: "inherit",
                              textDecoration: "none",
                              "&:hover": { bgcolor: "rgba(0,0,0,0.02)" }
                            }}
                          >
                            <ListItemIcon sx={{ minWidth: 36 }}>
                              <ErrorOutline color="warning" fontSize="small" />
                            </ListItemIcon>
                            <ListItemText
                              primary={`Chart ${r.chart_id}`}
                              secondary={`${r.project} - ${r.error_type}`}
                              primaryTypographyProps={{ fontWeight: 600, variant: 'body2' }}
                            />
                          </ListItem>
                        )) : (

                          <Box py={2} textAlign="center">
                            <Typography variant="caption" color="text.secondary">All rebuttals resolved! 🎉</Typography>
                          </Box>
                        )}
                      </List>
                    </CardContent>
                  </MotionCard>
                </Grid>
              </Grid>
            </Grid>

            {/* Team Production (For TLs/Managers) */}
            {(role === "TL" || role === "Manager") && teamStats.length > 0 && (
              <Grid size={{ xs: 12 }}>
                <MotionCard variants={itemVariants} sx={{ borderRadius: 4 }}>
                  <CardContent sx={{ p: 4 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                      <Box>
                        <Typography variant="h6" fontWeight={700}>Team Productivity Stats</Typography>
                        <Typography variant="body2" color="text.secondary">Live throughput overview of your direct reports</Typography>
                      </Box>
                    </Box>
                    <Box sx={{ maxHeight: 280, overflowY: 'auto', overflowX: 'hidden', pr: 1 }}>
                      <Grid container spacing={2}>
                        {teamStats.map((member, idx) => (
                          <Grid size={{ xs: 12, sm: 4, md: 2 }} key={idx}>
                            <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, textAlign: 'center' }}>
                              <Typography variant="body2" fontWeight={700} noWrap>{member.username}</Typography>
                              <Box display="flex" justifyContent="center" gap={1} mt={1}>
                                <Tooltip title="Completed">
                                  <Chip label={member.completed_charts} size="small" sx={{ bgcolor: 'rgba(76, 175, 80, 0.1)', color: '#2e7d32', fontWeight: 700 }} />
                                </Tooltip>
                                <Tooltip title="Rejected">
                                  <Chip label={member.rejected_charts} size="small" sx={{ bgcolor: 'rgba(211, 47, 47, 0.1)', color: '#d32f2f', fontWeight: 700 }} />
                                </Tooltip>
                              </Box>
                            </Paper>
                          </Grid>
                        ))}
                      </Grid>
                    </Box>
                  </CardContent>
                </MotionCard>
              </Grid>
            )}

            {/* Team Hold Charts (For TLs/Managers) */}
            {(role === "TL" || role === "Manager") && data?.team_metrics?.team_hold_charts?.length > 0 && (
              <Grid size={{ xs: 12 }}>
                <MotionCard variants={itemVariants} sx={{ borderRadius: 4 }}>
                  <CardContent sx={{ p: 4 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                      <Box>
                        <Typography variant="h6" fontWeight={700} sx={{ color: '#e65100', display: 'flex', alignItems: 'center', gap: 1 }}>
                          <PendingActions /> Team Hold Charts
                        </Typography>
                        <Typography variant="body2" color="text.secondary">Charts currently paused by team members</Typography>
                      </Box>
                    </Box>
                    <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid rgba(0,0,0,0.05)', borderRadius: 3 }}>
                      <Table size="small">
                        <TableHead sx={{ bgcolor: 'rgba(255, 145, 0, 0.05)' }}>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 700 }}>Chart ID</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>User</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Role</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Project</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Hold Notes</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {data.team_metrics.team_hold_charts.map((chart, idx) => (
                            <TableRow key={idx} hover>
                              <TableCell>
                                <Typography
                                  component={Link}
                                  to={
                                    chart.role === "Coder" ? `/chart/${chart.encrypted_chart_id || chart.chart_id}` :
                                      chart.role === "Auditor" ? `/audit/chart/${chart.encrypted_chart_id || chart.chart_id}` :
                                        `/at-audit/chart/${chart.encrypted_chart_id || chart.chart_id}`
                                  }
                                  sx={{ color: 'primary.main', fontWeight: 600, textDecoration: 'none' }}
                                >
                                  #{chart.chart_id}
                                </Typography>

                              </TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>{chart.user}</TableCell>
                              <TableCell>
                                <Chip
                                  label={chart.role}
                                  size="small"
                                  sx={{
                                    height: 20,
                                    fontSize: '0.65rem',
                                    fontWeight: 700,
                                    bgcolor: chart.role === 'Coder' ? 'info.light' : chart.role === 'Auditor' ? 'secondary.light' : 'success.light',
                                    color: 'white'
                                  }}
                                />
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2" fontWeight={500}>{chart.project}</Typography>
                                <Typography variant="caption" color="text.secondary">{chart.subproject}</Typography>
                              </TableCell>
                              <TableCell sx={{ fontStyle: 'italic', color: 'text.secondary' }}>
                                {chart.hold_command || "No notes"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </CardContent>
                </MotionCard>
              </Grid>
            )}

            {/* Bottom Table: Active Allocations */}
            <Grid size={{ xs: 12 }}>
              <MotionCard variants={itemVariants} sx={{ borderRadius: 4 }}>
                <CardContent sx={{ p: 4 }}>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                    <Box>
                      <Typography variant="h6" fontWeight={700}>Your Active Charts</Typography>
                      <Typography variant="body2" color="text.secondary">Recent allocations waiting for your attention</Typography>
                    </Box>
                  </Box>

                  <Grid container spacing={2}>
                    {allocatedCharts.length > 0 ? allocatedCharts.slice(0, 4).map((chart, idx) => (
                      <Grid size={{ xs: 12, sm: 6, md: 3 }} key={idx}>
                        <Paper
                          variant="outlined"
                          sx={{
                            p: 2,
                            borderRadius: 3,
                            borderColor: "rgba(0,0,0,0.08)",
                            transition: "0.2s",
                            "&:hover": { borderColor: "primary.main", backgroundColor: "rgba(25, 118, 210, 0.02)" }
                          }}
                        >
                          <Box display="flex" justifyContent="space-between" mb={1}>
                            <Typography fontWeight={700} color="primary">#{chart.chart_id}</Typography>
                            <Chip label="Allocated" size="mini" color="info" sx={{ fontSize: '10px', height: 18 }} />
                          </Box>
                          <Typography variant="body2" noWrap>{chart.project}</Typography>
                          <Typography variant="caption" color="text.secondary">{chart.subproject}</Typography>
                          <Box mt={1.5} display="flex" alignItems="center" gap={1}>
                            <Typography variant="caption" fontWeight={700}>{chart.page_count} pgs</Typography>
                            <LinearProgress variant="determinate" value={0} sx={{ flexGrow: 1, height: 4, borderRadius: 2 }} />
                          </Box>
                        </Paper>
                      </Grid>
                    )) : (
                      <Grid size={{ xs: 12 }}>
                        <Box py={4} textAlign="center" sx={{ bgcolor: "rgba(0,0,0,0.02)", borderRadius: 4 }}>
                          <Typography color="text.secondary">No charts currently allocated. Visit the workspace to start coding.</Typography>
                        </Box>
                      </Grid>
                    )}
                  </Grid>
                </CardContent>
              </MotionCard>
            </Grid>
          </Grid>

          <Dialog open={activeMembersOpen} onClose={() => setActiveMembersOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ fontWeight: 700, color: '#1a237e' }}>Active Members On-Floor</DialogTitle>
            <DialogContent dividers>
              {data?.team_metrics?.active_members_list && data.team_metrics.active_members_list.length > 0 ? (
                <List>
                  {data.team_metrics.active_members_list.map((member, i) => (
                    <ListItem key={i}>
                      <ListItemIcon>
                        <CheckCircle color="success" />
                      </ListItemIcon>
                      <ListItemText primary={member} primaryTypographyProps={{ fontWeight: 600 }} />
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography color="text.secondary">No active members found.</Typography>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setActiveMembersOpen(false)} color="primary" sx={{ fontWeight: 600 }}>Close</Button>
            </DialogActions>
          </Dialog>

          {/* Footer info */}
          <Box mt={6} textAlign="center" pb={4} position="relative">
            <Divider sx={{ mb: 3, opacity: 0.1 }} />
            <Box display="flex" justifyContent="center" alignItems="center" gap={3} mb={2}>
              <Typography variant="caption" sx={{ color: 'text.disabled', fontWeight: 600 }}>Privacy Policy</Typography>
              <Typography variant="caption" sx={{ color: 'text.disabled', fontWeight: 600 }}>Term of Service</Typography>
              <Typography variant="caption" sx={{ color: 'text.disabled', fontWeight: 600 }}>Help Center</Typography>
            </Box>
            <Typography variant="caption" sx={{ color: 'text.disabled', fontWeight: 500, letterSpacing: '1px' }}>
              © 2026 MEDLEARN AI CORE • ADVANCED ANALYTICS ENGINE • v2.0.0
            </Typography>
            <Typography variant="caption" display="block" sx={{ color: 'primary.main', fontWeight: 800, mt: 1, opacity: 0.5 }}>
              CONNECTED TO PRODUCTION NODE: {new Date().toLocaleTimeString()}
            </Typography>
          </Box>
        </motion.div>
      </Container>
    </Box>
  );
}
