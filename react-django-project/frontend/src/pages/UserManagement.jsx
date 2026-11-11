import { useEffect, useState, useMemo } from "react";
import { api } from "../services/api";
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Checkbox,
  Button,
  TextField,
  InputAdornment,
  CircularProgress,
  Alert,
  Chip,
  Snackbar,
  Stack,
  Tooltip,
  Avatar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Divider,
  Grid,
  RadioGroup,
  FormControlLabel,
  Radio,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import SaveIcon from "@mui/icons-material/Save";
import PeopleIcon from "@mui/icons-material/People";
import GroupIcon from "@mui/icons-material/Group";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import WbSunnyIcon from "@mui/icons-material/WbSunny";
import NightsStayIcon from "@mui/icons-material/NightsStay";
import MoreTimeIcon from "@mui/icons-material/MoreTime";
import HistoryIcon from "@mui/icons-material/History";
import CloseIcon from "@mui/icons-material/Close";
import EditCalendarIcon from "@mui/icons-material/EditCalendar";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import TuneIcon from "@mui/icons-material/Tune";
import dayjs from "dayjs";

const ALL_PROFILES = ["Coder", "Auditor", "SME", "TL", "AM", "Manager", "VP"];

const PROFILE_COLORS = {
  Coder:   { bg: "#e3f2fd", text: "#1565c0" },
  Auditor: { bg: "#f3e5f5", text: "#6a1b9a" },
  SME:     { bg: "#e8f5e9", text: "#2e7d32" },
  TL:      { bg: "#fff3e0", text: "#e65100" },
  AM:      { bg: "#fce4ec", text: "#ad1457" },
  Manager: { bg: "#e0f2f1", text: "#00695c" },
  VP:      { bg: "#ede7f6", text: "#4527a0" },
};

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [search, setSearch] = useState("");
  const [shiftFilter, setShiftFilter] = useState("ALL"); // ALL | DAY | NIGHT | DEFAULT

  // Multi-select for bulk actions
  const [selectedEmpIds, setSelectedEmpIds] = useState(new Set());

  // Pending profile changes: { [emp_id]: Set<profile> }
  const [pendingProfiles, setPendingProfiles] = useState({});
  // Track saving state per row
  const [savingRow, setSavingRow] = useState({});
  // Snackbar
  const [snack, setSnack] = useState({ open: false, msg: "", severity: "success" });

  // Shift Assignment Dialog State
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [shiftForm, setShiftForm] = useState({
    targetUsers: [], // list of user objects or ['all']
    applyToAll: false,
    preset: "DAY", // DAY | NIGHT | CUSTOM
    shift_name: "Day Shift",
    shift_start_time: "09:30",
    shift_end_time: "18:30",
    from_date: dayjs().format("YYYY-MM-DD"),
    to_date: dayjs().add(14, "day").format("YYYY-MM-DD"),
    early_buffer_minutes: 90,
    late_buffer_minutes: 120,
  });
  const [assigningShift, setAssigningShift] = useState(false);

  // Shift History Dialog State
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyUser, setHistoryUser] = useState(null);
  const [historyList, setHistoryList] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    setFetchError("");
    try {
      const res = await api.get("/api/users-list/");
      const fetched = res.data.users || [];
      setUsers(fetched);
      const initial = {};
      fetched.forEach((u) => {
        initial[u.user_employee_id] = new Set(u.profiles || []);
      });
      setPendingProfiles(initial);
    } catch (err) {
      setFetchError(err.response?.data?.error || "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const handleCheckbox = (empId, profile, checked) => {
    setPendingProfiles((prev) => {
      const next = new Set(prev[empId] || []);
      if (checked) next.add(profile);
      else next.delete(profile);
      return { ...prev, [empId]: next };
    });
  };

  const isDirty = (user) => {
    const original = new Set(user.profiles || []);
    const pending = pendingProfiles[user.user_employee_id] || new Set();
    if (original.size !== pending.size) return true;
    for (const p of original) if (!pending.has(p)) return true;
    return false;
  };

  const handleSave = async (empId) => {
    setSavingRow((prev) => ({ ...prev, [empId]: true }));
    const profiles = Array.from(pendingProfiles[empId] || []);
    try {
      await api.post("/api/users-list/update-profile/", {
        user_employee_id: empId,
        profiles,
      });
      setUsers((prev) =>
        prev.map((u) =>
          u.user_employee_id === empId
            ? { ...u, profiles, user_profile: profiles.join(",") }
            : u
        )
      );
      setSnack({ open: true, msg: "Profile updated successfully!", severity: "success" });
    } catch (err) {
      setSnack({
        open: true,
        msg: err.response?.data?.error || "Failed to save profile",
        severity: "error",
      });
    } finally {
      setSavingRow((prev) => ({ ...prev, [empId]: false }));
    }
  };

  // Selection handlers
  const handleSelectUser = (empId) => {
    setSelectedEmpIds((prev) => {
      const next = new Set(prev);
      if (next.has(empId)) next.delete(empId);
      else next.add(empId);
      return next;
    });
  };

  const handleSelectGroup = (groupUsers, allSelected) => {
    setSelectedEmpIds((prev) => {
      const next = new Set(prev);
      groupUsers.forEach((u) => {
        if (allSelected) next.delete(u.user_employee_id);
        else next.add(u.user_employee_id);
      });
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedEmpIds.size === filteredUsers.length) {
      setSelectedEmpIds(new Set());
    } else {
      setSelectedEmpIds(new Set(filteredUsers.map((u) => u.user_employee_id)));
    }
  };

  // Open Shift Dialog for selected users
  const openAssignShiftModal = (targetUsers = null) => {
    let targets = [];
    if (targetUsers) {
      targets = Array.isArray(targetUsers) ? targetUsers : [targetUsers];
    } else {
      targets = users.filter((u) => selectedEmpIds.has(u.user_employee_id));
    }

    setShiftForm({
      targetUsers: targets,
      applyToAll: targets.length === users.length && users.length > 0,
      preset: "DAY",
      shift_name: "Day Shift",
      shift_start_time: "09:30",
      shift_end_time: "18:30",
      from_date: dayjs().format("YYYY-MM-DD"),
      to_date: dayjs().add(14, "day").format("YYYY-MM-DD"),
      early_buffer_minutes: 90,
      late_buffer_minutes: 120,
    });
    setShiftDialogOpen(true);
  };

  const handlePresetChange = (preset) => {
    if (preset === "DAY") {
      setShiftForm((prev) => ({
        ...prev,
        preset: "DAY",
        shift_name: "Day Shift",
        shift_start_time: "09:30",
        shift_end_time: "18:30",
      }));
    } else if (preset === "NIGHT") {
      setShiftForm((prev) => ({
        ...prev,
        preset: "NIGHT",
        shift_name: "Night Shift",
        shift_start_time: "21:00",
        shift_end_time: "06:00",
      }));
    } else {
      setShiftForm((prev) => ({
        ...prev,
        preset: "CUSTOM",
        shift_name: "Custom Shift",
      }));
    }
  };

  const handleSaveShiftSchedule = async () => {
    if (!shiftForm.from_date || !shiftForm.to_date) {
      setSnack({ open: true, msg: "Please select From and To dates.", severity: "warning" });
      return;
    }
    if (shiftForm.from_date > shiftForm.to_date) {
      setSnack({ open: true, msg: "From Date cannot be after To Date.", severity: "warning" });
      return;
    }

    const targetEmpIds = shiftForm.applyToAll
      ? "all"
      : shiftForm.targetUsers.map((u) => u.user_employee_id);

    if (targetEmpIds !== "all" && targetEmpIds.length === 0) {
      setSnack({ open: true, msg: "No employees selected for shift schedule.", severity: "warning" });
      return;
    }

    setAssigningShift(true);
    try {
      const payload = {
        user_employee_ids: targetEmpIds,
        shift_name: shiftForm.shift_name,
        shift_start_time: shiftForm.shift_start_time,
        shift_end_time: shiftForm.shift_end_time,
        from_date: shiftForm.from_date,
        to_date: shiftForm.to_date,
        early_buffer_minutes: Number(shiftForm.early_buffer_minutes) || 90,
        late_buffer_minutes: Number(shiftForm.late_buffer_minutes) || 120,
      };

      const res = await api.post("/api/user-shifts/assign/", payload);
      setSnack({ open: true, msg: res.data.message || "Shift schedule assigned successfully!", severity: "success" });
      setShiftDialogOpen(false);
      setSelectedEmpIds(new Set());
      // Refresh list to update shift badges
      await fetchUsers();
    } catch (err) {
      setSnack({
        open: true,
        msg: err.response?.data?.error || "Failed to assign shift schedule",
        severity: "error",
      });
    } finally {
      setAssigningShift(false);
    }
  };

  // Open Shift History Dialog
  const openHistoryModal = async (user) => {
    setHistoryUser(user);
    setHistoryDialogOpen(true);
    setLoadingHistory(true);
    try {
      const res = await api.get(`/api/user-shifts/history/${user.user_employee_id}/`);
      setHistoryList(res.data.history || []);
    } catch (err) {
      setSnack({ open: true, msg: "Failed to load shift history", severity: "error" });
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleCancelShift = async (scheduleId) => {
    try {
      await api.post(`/api/user-shifts/delete/${scheduleId}/`);
      setSnack({ open: true, msg: "Shift schedule cancelled.", severity: "info" });
      setHistoryList((prev) => prev.filter((h) => h.id !== scheduleId));
      await fetchUsers();
    } catch (err) {
      setSnack({ open: true, msg: "Failed to cancel shift schedule", severity: "error" });
    }
  };

  // Filtered users calculation
  const filteredUsers = useMemo(() => {
    const q = search.toLowerCase().trim();
    return users.filter((u) => {
      const matchesSearch =
        !q ||
        u.username?.toLowerCase().includes(q) ||
        u.tl_name?.toLowerCase().includes(q) ||
        u.user_employee_id?.toLowerCase().includes(q) ||
        u.user_mail_id?.toLowerCase().includes(q) ||
        u.current_shift?.shift_name?.toLowerCase().includes(q);

      if (!matchesSearch) return false;

      if (shiftFilter === "DAY") {
        return (
          u.current_shift?.shift_name?.toLowerCase().includes("day") ||
          u.current_shift?.is_default
        );
      }
      if (shiftFilter === "NIGHT") {
        return u.current_shift?.shift_name?.toLowerCase().includes("night");
      }
      if (shiftFilter === "CUSTOM") {
        return (
          !u.current_shift?.is_default &&
          !u.current_shift?.shift_name?.toLowerCase().includes("day") &&
          !u.current_shift?.shift_name?.toLowerCase().includes("night")
        );
      }
      return true;
    });
  }, [users, search, shiftFilter]);

  // Group by TL
  const grouped = useMemo(() => {
    const map = {};
    filteredUsers.forEach((u) => {
      const tl = u.tl_name || "No TL Assigned";
      if (!map[tl]) map[tl] = [];
      map[tl].push(u);
    });
    return map;
  }, [filteredUsers]);

  // Shift counts for filter pills
  const counts = useMemo(() => {
    let day = 0;
    let night = 0;
    let custom = 0;
    users.forEach((u) => {
      const name = u.current_shift?.shift_name?.toLowerCase() || "";
      if (name.includes("night")) night++;
      else if (name.includes("day") || u.current_shift?.is_default) day++;
      else custom++;
    });
    return { all: users.length, day, night, custom };
  }, [users]);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, minHeight: "100vh", bgcolor: "#f0f7ff" }}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <Paper
        elevation={0}
        sx={{
          p: 3,
          mb: 3,
          borderRadius: 3,
          background: "linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 2,
        }}
      >
        <Box
          sx={{
            width: 52,
            height: 52,
            borderRadius: 2,
            bgcolor: "rgba(255,255,255,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <PeopleIcon sx={{ fontSize: 30 }} />
        </Box>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            User & Shift Management
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.9 }}>
            Assign roles and configure Day/Night shift schedules with date ranges and buffer tolerance
          </Typography>
        </Box>

        <Box sx={{ ml: "auto", display: "flex", gap: 3, textAlign: "right" }}>
          <Box>
            <Typography variant="h4" fontWeight={800}>
              {counts.all}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.85 }}>
              Total Users
            </Typography>
          </Box>
          <Divider orientation="vertical" flexItem sx={{ bgcolor: "rgba(255,255,255,0.3)" }} />
          <Box>
            <Typography variant="h4" fontWeight={800} sx={{ color: "#fef08a" }}>
              {counts.day}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.85 }}>
              Day Shift
            </Typography>
          </Box>
          <Divider orientation="vertical" flexItem sx={{ bgcolor: "rgba(255,255,255,0.3)" }} />
          <Box>
            <Typography variant="h4" fontWeight={800} sx={{ color: "#c4b5fd" }}>
              {counts.night}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.85 }}>
              Night Shift
            </Typography>
          </Box>
        </Box>
      </Paper>

      {/* ── Search & Filter Controls ───────────────────────────────── */}
      <Paper elevation={0} sx={{ p: 2, mb: 3, borderRadius: 3, border: "1px solid #dbeafe" }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="center">
          <TextField
            fullWidth
            size="small"
            placeholder="Search by name, TL, employee ID, email, or shift…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: "#64748b" }} />
                </InputAdornment>
              ),
            }}
            sx={{
              "& .MuiOutlinedInput-root": { borderRadius: 2, bgcolor: "#f8fafc" },
            }}
          />

          <Stack direction="row" spacing={1} flexShrink={0}>
            <Chip
              label={`All (${counts.all})`}
              clickable
              color={shiftFilter === "ALL" ? "primary" : "default"}
              onClick={() => setShiftFilter("ALL")}
              sx={{ fontWeight: 600 }}
            />
            <Chip
              icon={<WbSunnyIcon sx={{ fontSize: 16, color: "#d97706 !important" }} />}
              label={`Day Shift (${counts.day})`}
              clickable
              color={shiftFilter === "DAY" ? "warning" : "default"}
              variant={shiftFilter === "DAY" ? "filled" : "outlined"}
              onClick={() => setShiftFilter("DAY")}
              sx={{ fontWeight: 600 }}
            />
            <Chip
              icon={<NightsStayIcon sx={{ fontSize: 16, color: "#7c3aed !important" }} />}
              label={`Night Shift (${counts.night})`}
              clickable
              color={shiftFilter === "NIGHT" ? "secondary" : "default"}
              variant={shiftFilter === "NIGHT" ? "filled" : "outlined"}
              onClick={() => setShiftFilter("NIGHT")}
              sx={{ fontWeight: 600 }}
            />
          </Stack>
        </Stack>
      </Paper>

      {/* ── Sticky Bulk Action Bar (when rows selected) ────────────── */}
      {selectedEmpIds.size > 0 && (
        <Paper
          elevation={4}
          sx={{
            position: "sticky",
            top: 16,
            zIndex: 100,
            p: 1.8,
            mb: 3,
            borderRadius: 3,
            bgcolor: "#1e293b",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 10px 25px -5px rgba(0,0,0,0.25)",
            border: "1px solid #334155",
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <CheckCircleOutlineIcon sx={{ color: "#38bdf8" }} />
            <Typography fontWeight={700} fontSize={14}>
              {selectedEmpIds.size} employee{selectedEmpIds.size > 1 ? "s" : ""} selected
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1.5}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setSelectedEmpIds(new Set())}
              sx={{ color: "#94a3b8", borderColor: "#475569", textTransform: "none", borderRadius: 2 }}
            >
              Clear Selection
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<EditCalendarIcon />}
              onClick={() => openAssignShiftModal()}
              sx={{
                bgcolor: "#38bdf8",
                color: "#0f172a",
                fontWeight: 700,
                borderRadius: 2,
                textTransform: "none",
                "&:hover": { bgcolor: "#0284c7", color: "#fff" },
              }}
            >
              Assign Shift Schedule to Selected
            </Button>
          </Stack>
        </Paper>
      )}

      {/* ── Error Alert ────────────────────────────────────────────── */}
      {fetchError && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
          {fetchError}
        </Alert>
      )}

      {/* ── Loading Spinner ────────────────────────────────────────── */}
      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : Object.keys(grouped).length === 0 ? (
        <Paper sx={{ p: 5, textAlign: "center", borderRadius: 3 }}>
          <Typography color="text.secondary">No users found matching your filters.</Typography>
        </Paper>
      ) : (
        Object.entries(grouped).map(([tlName, tlUsers]) => {
          const groupEmpIds = tlUsers.map((u) => u.user_employee_id);
          const allGroupSelected = groupEmpIds.every((id) => selectedEmpIds.has(id));
          const someGroupSelected = groupEmpIds.some((id) => selectedEmpIds.has(id)) && !allGroupSelected;

          return (
            <Paper
              key={tlName}
              elevation={0}
              sx={{ mb: 3, borderRadius: 3, border: "1px solid #dbeafe", overflow: "hidden" }}
            >
              {/* TL Group Header */}
              <Box
                sx={{
                  px: 2.5,
                  py: 1.5,
                  bgcolor: "#eff6ff",
                  borderBottom: "1px solid #dbeafe",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1.5}>
                  <Checkbox
                    size="small"
                    checked={allGroupSelected}
                    indeterminate={someGroupSelected}
                    onChange={() => handleSelectGroup(tlUsers, allGroupSelected)}
                    sx={{ p: 0.5, color: "#93c5fd", "&.Mui-checked": { color: "#2563eb" } }}
                  />
                  <GroupIcon sx={{ color: "#3b82f6", fontSize: 20 }} />
                  <Typography fontWeight={700} color="#1e40af" fontSize={15}>
                    TL: {tlName}
                  </Typography>
                  <Chip
                    label={`${tlUsers.length} user${tlUsers.length !== 1 ? "s" : ""}`}
                    size="small"
                    sx={{ bgcolor: "#dbeafe", color: "#1e40af", fontWeight: 600, ml: 0.5 }}
                  />
                </Stack>

                <Button
                  size="small"
                  startIcon={<MoreTimeIcon sx={{ fontSize: 16 }} />}
                  onClick={() => openAssignShiftModal(tlUsers)}
                  sx={{
                    fontSize: 12,
                    fontWeight: 600,
                    textTransform: "none",
                    color: "#2563eb",
                    borderRadius: 2,
                    "&:hover": { bgcolor: "rgba(37,99,235,0.08)" },
                  }}
                >
                  Schedule Shift for this Team
                </Button>
              </Box>

              {/* Users Table */}
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: "#f8fafc" }}>
                      <TableCell sx={{ width: 40, p: "6px 8px" }}>
                        <Checkbox
                          size="small"
                          checked={allGroupSelected}
                          indeterminate={someGroupSelected}
                          onChange={() => handleSelectGroup(tlUsers, allGroupSelected)}
                          sx={{ p: 0 }}
                        />
                      </TableCell>
                      <TableCell sx={{ fontWeight: 700, color: "#64748b", fontSize: 11.5, width: 100 }}>
                        EMP ID
                      </TableCell>
                      <TableCell sx={{ fontWeight: 700, color: "#64748b", fontSize: 11.5, width: 160 }}>
                        NAME
                      </TableCell>
                      <TableCell sx={{ fontWeight: 700, color: "#64748b", fontSize: 11.5, width: 180 }}>
                        CURRENT SHIFT SCHEDULE
                      </TableCell>
                      <TableCell sx={{ fontWeight: 700, color: "#64748b", fontSize: 11.5, minWidth: 440 }}>
                        USER PROFILE — check all that apply
                      </TableCell>
                      <TableCell sx={{ fontWeight: 700, color: "#64748b", fontSize: 11.5, width: 110, textAlign: "center" }}>
                        ACTIONS
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tlUsers.map((user) => {
                      const empId = user.user_employee_id;
                      const pending = pendingProfiles[empId] || new Set();
                      const dirty = isDirty(user);
                      const saving = savingRow[empId];
                      const isSelected = selectedEmpIds.has(empId);
                      const shift = user.current_shift || {};
                      const isNight = shift.shift_name?.toLowerCase().includes("night");
                      const isDefault = shift.is_default;

                      return (
                        <TableRow
                          key={empId}
                          sx={{
                            "&:hover": { bgcolor: "#f0f7ff" },
                            transition: "background 0.15s",
                            bgcolor: isSelected ? "#e0f2fe" : dirty ? "#fffbeb" : "transparent",
                          }}
                        >
                          {/* Row Checkbox */}
                          <TableCell sx={{ p: "6px 8px" }}>
                            <Checkbox
                              size="small"
                              checked={isSelected}
                              onChange={() => handleSelectUser(empId)}
                              sx={{ p: 0, color: "#cbd5e1", "&.Mui-checked": { color: "#0284c7" } }}
                            />
                          </TableCell>

                          {/* EMP ID */}
                          <TableCell>
                            <Typography
                              fontSize={11.5}
                              fontWeight={600}
                              color="#334155"
                              fontFamily="monospace"
                            >
                              {empId}
                            </Typography>
                          </TableCell>

                          {/* Name & Email */}
                          <TableCell>
                            <Stack direction="row" alignItems="center" gap={1}>
                              <Avatar
                                sx={{
                                  width: 28,
                                  height: 28,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  bgcolor: isNight ? "#7c3aed" : "#3b82f6",
                                }}
                              >
                                {(user.username || "?")[0].toUpperCase()}
                              </Avatar>
                              <Box sx={{ minWidth: 0 }}>
                                <Typography fontSize={12.5} fontWeight={600} color="#1e293b" noWrap>
                                  {user.username}
                                </Typography>
                                <Typography fontSize={10.5} color="#64748b" noWrap>
                                  {user.user_mail_id}
                                </Typography>
                              </Box>
                            </Stack>
                          </TableCell>

                          {/* Current Shift Schedule Column */}
                          <TableCell>
                            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.4 }}>
                              <Stack direction="row" alignItems="center" spacing={0.6}>
                                <Chip
                                  size="small"
                                  icon={
                                    isNight ? (
                                      <NightsStayIcon sx={{ fontSize: "14px !important", color: "#6d28d9 !important" }} />
                                    ) : (
                                      <WbSunnyIcon sx={{ fontSize: "14px !important", color: "#b45309 !important" }} />
                                    )
                                  }
                                  label={
                                    <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                      <strong>{shift.shift_name || "Day Shift"}</strong>
                                      <span style={{ opacity: 0.85, fontSize: 10 }}>
                                        ({shift.shift_start_time || "09:30"} - {shift.shift_end_time || "18:30"})
                                      </span>
                                    </Box>
                                  }
                                  sx={{
                                    height: 22,
                                    fontSize: 10.5,
                                    bgcolor: isNight ? "#ede9fe" : "#fef3c7",
                                    color: isNight ? "#5b21b6" : "#92400e",
                                    fontWeight: 600,
                                    border: `1px solid ${isNight ? "#c4b5fd" : "#fde68a"}`,
                                  }}
                                />
                                <Tooltip title="View Shift Schedule History" arrow>
                                  <IconButton
                                    size="small"
                                    onClick={() => openHistoryModal(user)}
                                    sx={{ p: 0.3, color: "#64748b", "&:hover": { color: "#1e40af" } }}
                                  >
                                    <HistoryIcon sx={{ fontSize: 16 }} />
                                  </IconButton>
                                </Tooltip>
                              </Stack>

                              <Typography fontSize={10} color={isDefault ? "#94a3b8" : "#0369a1"} fontWeight={500}>
                                {isDefault ? (
                                  "Default (Standard Timing)"
                                ) : (
                                  `Effective: ${shift.from_date} to ${shift.to_date}`
                                )}
                              </Typography>
                            </Box>
                          </TableCell>

                          {/* Profile Checkboxes */}
                          <TableCell>
                            <Stack direction="row" flexWrap="wrap" gap={0.5}>
                              {ALL_PROFILES.map((profile) => {
                                const checked = pending.has(profile);
                                const colors = PROFILE_COLORS[profile] || { bg: "#f1f5f9", text: "#334155" };
                                return (
                                  <Tooltip
                                    key={profile}
                                    title={checked ? `Remove ${profile}` : `Add ${profile}`}
                                    placement="top"
                                    arrow
                                  >
                                    <Box
                                      onClick={() => handleCheckbox(empId, profile, !checked)}
                                      sx={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 0.3,
                                        px: 0.8,
                                        py: 0.2,
                                        borderRadius: 1.5,
                                        cursor: "pointer",
                                        border: "1.5px solid",
                                        borderColor: checked ? colors.text : "#e2e8f0",
                                        bgcolor: checked ? colors.bg : "#f8fafc",
                                        transition: "all 0.15s",
                                        userSelect: "none",
                                        "&:hover": {
                                          borderColor: colors.text,
                                          bgcolor: colors.bg,
                                        },
                                      }}
                                    >
                                      <Checkbox
                                        size="small"
                                        checked={checked}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          handleCheckbox(empId, profile, e.target.checked);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        sx={{
                                          p: 0,
                                          color: "#cbd5e1",
                                          "&.Mui-checked": { color: colors.text },
                                        }}
                                      />
                                      <Typography
                                        fontSize={11}
                                        fontWeight={checked ? 700 : 500}
                                        color={checked ? colors.text : "#64748b"}
                                      >
                                        {profile}
                                      </Typography>
                                    </Box>
                                  </Tooltip>
                                );
                              })}
                            </Stack>
                          </TableCell>

                          {/* Action Buttons */}
                          <TableCell align="center">
                            <Stack direction="row" spacing={0.5} justifyContent="center">
                              {/* Quick Assign Shift */}
                              <Tooltip title="Assign/Change Shift" arrow>
                                <IconButton
                                  size="small"
                                  onClick={() => openAssignShiftModal(user)}
                                  sx={{
                                    p: 0.6,
                                    borderRadius: 1.5,
                                    bgcolor: "#f0fdf4",
                                    color: "#16a34a",
                                    border: "1px solid #bbf7d0",
                                    "&:hover": { bgcolor: "#dcfce7" },
                                  }}
                                >
                                  <EditCalendarIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                              </Tooltip>

                              {/* Save Profile */}
                              <Button
                                size="small"
                                variant={dirty ? "contained" : "outlined"}
                                disabled={!dirty || saving}
                                onClick={() => handleSave(empId)}
                                startIcon={
                                  saving ? (
                                    <CircularProgress size={10} color="inherit" />
                                  ) : (
                                    <SaveIcon sx={{ fontSize: "13px !important" }} />
                                  )
                                }
                                sx={{
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  borderRadius: 1.5,
                                  minWidth: 58,
                                  px: 1,
                                  py: 0.3,
                                  ...(dirty && {
                                    background: "linear-gradient(135deg, #1e40af, #3b82f6)",
                                    boxShadow: "0 2px 6px rgba(59,130,246,0.4)",
                                  }),
                                }}
                              >
                                {saving ? "..." : dirty ? "Save" : "Saved"}
                              </Button>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          );
        })
      )}

      {/* ── Shift Assignment Dialog Modal ──────────────────────────── */}
      <Dialog
        open={shiftDialogOpen}
        onClose={() => !assigningShift && setShiftDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: { borderRadius: 3, p: 1 },
        }}
      >
        <DialogTitle sx={{ pb: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box
              sx={{
                width: 38,
                height: 38,
                borderRadius: 2,
                bgcolor: "#e0f2fe",
                color: "#0284c7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <EditCalendarIcon />
            </Box>
            <Box>
              <Typography variant="h6" fontWeight={700} fontSize={17}>
                Assign Shift Schedule
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Configure shift timings, effective dates, and grace buffers
              </Typography>
            </Box>
          </Stack>
          <IconButton size="small" onClick={() => setShiftDialogOpen(false)} disabled={assigningShift}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <Divider />

        <DialogContent sx={{ pt: 2.5, pb: 2 }}>
          {/* Recipient summary */}
          <Paper
            variant="outlined"
            sx={{
              p: 1.5,
              mb: 2.5,
              borderRadius: 2,
              bgcolor: "#f8fafc",
              border: "1px dashed #cbd5e1",
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography fontSize={13} fontWeight={600} color="#334155">
                Target:{" "}
                <span style={{ color: "#0284c7" }}>
                  {shiftForm.applyToAll
                    ? `All Employees (${users.length} users)`
                    : `${shiftForm.targetUsers.length} selected employee${shiftForm.targetUsers.length > 1 ? "s" : ""}`}
                </span>
              </Typography>

              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={shiftForm.applyToAll}
                    onChange={(e) => setShiftForm((p) => ({ ...p, applyToAll: e.target.checked }))}
                  />
                }
                label={<Typography fontSize={12} fontWeight={600}>Apply to All Employees</Typography>}
              />
            </Stack>

            {!shiftForm.applyToAll && shiftForm.targetUsers.length > 0 && (
              <Box sx={{ mt: 1, maxHeight: 65, overflowY: "auto", display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {shiftForm.targetUsers.map((u) => (
                  <Chip
                    key={u.user_employee_id}
                    size="small"
                    label={`${u.username} (${u.user_employee_id})`}
                    sx={{ fontSize: 11, height: 20, bgcolor: "#e2e8f0" }}
                  />
                ))}
              </Box>
            )}
          </Paper>

          {/* Preset Shift Selection Cards */}
          <Typography fontSize={13} fontWeight={700} color="#1e293b" sx={{ mb: 1 }}>
            Select Shift Type
          </Typography>

          <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
            {/* Day Shift Preset */}
            <Grid item xs={12} sm={4}>
              <Paper
                onClick={() => handlePresetChange("DAY")}
                sx={{
                  p: 1.5,
                  cursor: "pointer",
                  borderRadius: 2,
                  border: "2px solid",
                  borderColor: shiftForm.preset === "DAY" ? "#f59e0b" : "#e2e8f0",
                  bgcolor: shiftForm.preset === "DAY" ? "#fffbeb" : "#ffffff",
                  transition: "all 0.15s",
                  "&:hover": { borderColor: "#f59e0b" },
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <WbSunnyIcon sx={{ color: "#d97706", fontSize: 20 }} />
                  <Typography fontWeight={700} fontSize={13} color="#92400e">
                    Day Shift
                  </Typography>
                </Stack>
                <Typography fontSize={11} fontWeight={600} color="#78350f">
                  9:30 AM – 6:30 PM
                </Typography>
                <Typography fontSize={10} color="#a16207">
                  Same day schedule
                </Typography>
              </Paper>
            </Grid>

            {/* Night Shift Preset */}
            <Grid item xs={12} sm={4}>
              <Paper
                onClick={() => handlePresetChange("NIGHT")}
                sx={{
                  p: 1.5,
                  cursor: "pointer",
                  borderRadius: 2,
                  border: "2px solid",
                  borderColor: shiftForm.preset === "NIGHT" ? "#7c3aed" : "#e2e8f0",
                  bgcolor: shiftForm.preset === "NIGHT" ? "#f5f3ff" : "#ffffff",
                  transition: "all 0.15s",
                  "&:hover": { borderColor: "#7c3aed" },
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <NightsStayIcon sx={{ color: "#7c3aed", fontSize: 20 }} />
                  <Typography fontWeight={700} fontSize={13} color="#5b21b6">
                    Night Shift
                  </Typography>
                </Stack>
                <Typography fontSize={11} fontWeight={600} color="#4c1d95">
                  9:00 PM – 6:00 AM
                </Typography>
                <Typography fontSize={10} color="#6d28d9">
                  Crosses midnight (+1 day)
                </Typography>
              </Paper>
            </Grid>

            {/* Custom Shift */}
            <Grid item xs={12} sm={4}>
              <Paper
                onClick={() => handlePresetChange("CUSTOM")}
                sx={{
                  p: 1.5,
                  cursor: "pointer",
                  borderRadius: 2,
                  border: "2px solid",
                  borderColor: shiftForm.preset === "CUSTOM" ? "#0284c7" : "#e2e8f0",
                  bgcolor: shiftForm.preset === "CUSTOM" ? "#f0f9ff" : "#ffffff",
                  transition: "all 0.15s",
                  "&:hover": { borderColor: "#0284c7" },
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <TuneIcon sx={{ color: "#0284c7", fontSize: 20 }} />
                  <Typography fontWeight={700} fontSize={13} color="#0369a1">
                    Custom Shift
                  </Typography>
                </Stack>
                <Typography fontSize={11} fontWeight={600} color="#075985">
                  Custom Timings
                </Typography>
                <Typography fontSize={10} color="#0284c7">
                  Flexible hours
                </Typography>
              </Paper>
            </Grid>
          </Grid>

          {/* Timings row (Editable for Custom or fine-tuning) */}
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="Shift Start Time"
                type="time"
                value={shiftForm.shift_start_time}
                onChange={(e) => setShiftForm((p) => ({ ...p, shift_start_time: e.target.value }))}
                InputLabelProps={{ shrink: true }}
                inputProps={{ step: 300 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="Shift End Time"
                type="time"
                value={shiftForm.shift_end_time}
                onChange={(e) => setShiftForm((p) => ({ ...p, shift_end_time: e.target.value }))}
                InputLabelProps={{ shrink: true }}
                inputProps={{ step: 300 }}
              />
            </Grid>
          </Grid>

          {/* Date Range Fields */}
          <Typography fontSize={13} fontWeight={700} color="#1e293b" sx={{ mb: 1 }}>
            Effective Schedule Date Range
          </Typography>

          <Grid container spacing={2} sx={{ mb: 1.5 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="From Date"
                type="date"
                value={shiftForm.from_date}
                onChange={(e) => setShiftForm((p) => ({ ...p, from_date: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="To Date"
                type="date"
                value={shiftForm.to_date}
                onChange={(e) => setShiftForm((p) => ({ ...p, to_date: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
          </Grid>

          {/* Quick Date Presets */}
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <Button
              size="small"
              variant="outlined"
              onClick={() =>
                setShiftForm((p) => ({
                  ...p,
                  from_date: dayjs().format("YYYY-MM-DD"),
                  to_date: dayjs().format("YYYY-MM-DD"),
                }))
              }
              sx={{ fontSize: 11, py: 0.2, textTransform: "none", borderRadius: 1.5 }}
            >
              Today Only
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={() =>
                setShiftForm((p) => ({
                  ...p,
                  from_date: dayjs().format("YYYY-MM-DD"),
                  to_date: dayjs().add(6, "day").format("YYYY-MM-DD"),
                }))
              }
              sx={{ fontSize: 11, py: 0.2, textTransform: "none", borderRadius: 1.5 }}
            >
              Next 7 Days
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={() =>
                setShiftForm((p) => ({
                  ...p,
                  from_date: dayjs().format("YYYY-MM-DD"),
                  to_date: dayjs().add(29, "day").format("YYYY-MM-DD"),
                }))
              }
              sx={{ fontSize: 11, py: 0.2, textTransform: "none", borderRadius: 1.5 }}
            >
              Next 30 Days
            </Button>
          </Stack>

          {/* Accordion for Early/Late Buffers */}
          <Accordion
            elevation={0}
            sx={{
              border: "1px solid #e2e8f0",
              borderRadius: "8px !important",
              "&:before": { display: "none" },
            }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ fontSize: 18 }} />}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <AccessTimeIcon sx={{ fontSize: 16, color: "#64748b" }} />
                <Typography fontSize={12} fontWeight={600} color="#475569">
                  Shift Timing Buffers & Grace Tolerance (Early/Late Arrival)
                </Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <Typography fontSize={11} color="#64748b" sx={{ mb: 1.5 }}>
                Users may clock in early or stay late. These buffers ensure charts completed slightly before or after official shift hours are credited to this shift.
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Early Buffer (minutes)"
                    type="number"
                    value={shiftForm.early_buffer_minutes}
                    onChange={(e) => setShiftForm((p) => ({ ...p, early_buffer_minutes: e.target.value }))}
                    helperText="e.g. 90 mins (clock-in early)"
                    InputProps={{ inputProps: { min: 0, max: 240 } }}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Late Buffer (minutes)"
                    type="number"
                    value={shiftForm.late_buffer_minutes}
                    onChange={(e) => setShiftForm((p) => ({ ...p, late_buffer_minutes: e.target.value }))}
                    helperText="e.g. 120 mins (late completion)"
                    InputProps={{ inputProps: { min: 0, max: 240 } }}
                  />
                </Grid>
              </Grid>
            </AccordionDetails>
          </Accordion>
        </DialogContent>

        <DialogActions sx={{ p: 2, pt: 0 }}>
          <Button
            onClick={() => setShiftDialogOpen(false)}
            disabled={assigningShift}
            sx={{ textTransform: "none", color: "#64748b" }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={assigningShift}
            onClick={handleSaveShiftSchedule}
            startIcon={assigningShift ? <CircularProgress size={16} color="inherit" /> : <EditCalendarIcon />}
            sx={{
              background: "linear-gradient(135deg, #1e40af, #3b82f6)",
              fontWeight: 700,
              textTransform: "none",
              borderRadius: 2,
              px: 2.5,
            }}
          >
            {assigningShift ? "Saving Schedule…" : "Save Shift Schedule"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Shift History Dialog Modal ─────────────────────────────── */}
      <Dialog
        open={historyDialogOpen}
        onClose={() => setHistoryDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3, p: 1 } }}
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Avatar sx={{ bgcolor: "#3b82f6", width: 34, height: 34, fontSize: 13, fontWeight: 700 }}>
              {(historyUser?.username || "?")[0].toUpperCase()}
            </Avatar>
            <Box>
              <Typography variant="h6" fontWeight={700} fontSize={16}>
                Shift Schedule History: {historyUser?.username}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Employee ID: {historyUser?.user_employee_id} | TL: {historyUser?.tl_name}
              </Typography>
            </Box>
          </Stack>
          <IconButton size="small" onClick={() => setHistoryDialogOpen(false)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <Divider />

        <DialogContent sx={{ pt: 2 }}>
          {loadingHistory ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 5 }}>
              <CircularProgress size={30} />
            </Box>
          ) : historyList.length === 0 ? (
            <Box sx={{ py: 4, textAlign: "center" }}>
              <Typography color="text.secondary" fontSize={13}>
                No explicit shift schedules recorded. User operates under standard <strong>Day Shift (09:30 – 18:30)</strong>.
              </Typography>
            </Box>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: "#f8fafc" }}>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11.5 }}>SHIFT</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11.5 }}>TIMINGS</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11.5 }}>FROM DATE</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11.5 }}>TO DATE</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11.5 }}>BUFFERS</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11.5 }}>STATUS</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11.5, textAlign: "center" }}>ACTION</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {historyList.map((item) => {
                    const isNight = item.shift_name?.toLowerCase().includes("night");
                    return (
                      <TableRow key={item.id} sx={{ opacity: item.is_active ? 1 : 0.55 }}>
                        <TableCell>
                          <Chip
                            size="small"
                            icon={
                              isNight ? (
                                <NightsStayIcon sx={{ fontSize: "14px !important" }} />
                              ) : (
                                <WbSunnyIcon sx={{ fontSize: "14px !important" }} />
                              )
                            }
                            label={item.shift_name}
                            sx={{
                              height: 22,
                              fontSize: 11,
                              fontWeight: 600,
                              bgcolor: isNight ? "#ede9fe" : "#fef3c7",
                              color: isNight ? "#6d28d9" : "#b45309",
                            }}
                          />
                        </TableCell>
                        <TableCell sx={{ fontSize: 12, fontWeight: 600 }}>
                          {item.shift_start_time} – {item.shift_end_time}
                        </TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{item.from_date}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{item.to_date}</TableCell>
                        <TableCell sx={{ fontSize: 11, color: "#64748b" }}>
                          Early: {item.early_buffer_minutes}m | Late: {item.late_buffer_minutes}m
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={item.is_active ? "Active" : "Archived"}
                            sx={{
                              height: 18,
                              fontSize: 9.5,
                              fontWeight: 700,
                              bgcolor: item.is_active ? "#dcfce7" : "#f1f5f9",
                              color: item.is_active ? "#15803d" : "#64748b",
                            }}
                          />
                        </TableCell>
                        <TableCell align="center">
                          {item.is_active && (
                            <Tooltip title="Cancel this shift schedule" arrow>
                              <IconButton
                                size="small"
                                onClick={() => handleCancelShift(item.id)}
                                sx={{ color: "#ef4444", p: 0.5 }}
                              >
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Snackbar Notifications ─────────────────────────────────── */}
      <Snackbar
        open={snack.open}
        autoHideDuration={3500}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={snack.severity}
          variant="filled"
          sx={{ borderRadius: 2, fontWeight: 600 }}
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
        >
          {snack.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}