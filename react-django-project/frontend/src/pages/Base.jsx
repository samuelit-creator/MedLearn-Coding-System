import { useState, useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { api } from "../services/api";
import {
  AppBar,
  Toolbar,
  Box,
  Typography,
  Button,
  IconButton,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Stack,
  InputAdornment,
  Avatar,
  Collapse,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import SearchIcon from "@mui/icons-material/Search";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import DashboardIcon from "@mui/icons-material/Dashboard";
import InboxIcon from "@mui/icons-material/Inbox";
import BarChartIcon from "@mui/icons-material/BarChart";
import StarIcon from "@mui/icons-material/Star";
import SettingsIcon from "@mui/icons-material/Settings";
import ChatIcon from "@mui/icons-material/Chat";

export default function Base() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [clarifCount, setClarifCount] = useState(0);
  const [openDropdown, setOpenDropdown] = useState(null);
  const [mobileExpanded, setMobileExpanded] = useState(null);
  const dropdownRef = useRef(null);
  const role = localStorage.getItem("role")?.trim();
  const userName = localStorage.getItem("user_name") || "User";
  const timeoutRef = useRef(null);

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    navigate("/login");
  };

  const resetTimer = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(logout, 30 * 60 * 1000);
  };

  useEffect(() => {
    resetTimer();
    const events = ["mousemove", "keydown", "mousedown", "touchstart"];
    const handleActivity = () => resetTimer();
    events.forEach((e) => window.addEventListener(e, handleActivity));
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      events.forEach((e) => window.removeEventListener(e, handleActivity));
    };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close dropdown on route change
  useEffect(() => {
    setOpenDropdown(null);
  }, [location.pathname]);

  // Clarification Portal badge — poll count every 60 seconds
  useEffect(() => {
    const fetchCount = () => {
      api
        .get("/api/clarification/count/")
        .then((res) => setClarifCount(res.data.count || 0))
        .catch(() => { });
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (location.pathname === "/clarification-portal") setClarifCount(0);
  }, [location.pathname]);

  // ─── Nav Groups (grouped by domain) ─────────────────────────────────────────
  const navGroups = [
    {
      label: "Dashboard",
      icon: <DashboardIcon sx={{ fontSize: 16 }} />,
      single: true,
      to: "/",
      roles: ["Coder", "Auditor", "SME", "TL", "AM", "Manager", "VP"],
    },
    {
      label: "Inbox",
      icon: <InboxIcon sx={{ fontSize: 16 }} />,
      roles: ["Coder", "Auditor", "SME", "TL"],
      children: [
        { label: "Coder Inbox", to: "/coder", roles: ["Coder", "SME", "Auditor"] },
        { label: "Auditor Inbox", to: "/audit/dashboard", roles: ["Auditor", "SME", "TL"] },
        { label: "AT Audit Dashboard", to: "/at-audit/dashboard", roles: ["SME", "TL"] },
      ],
    },
    {
      label: "Production",
      icon: <BarChartIcon sx={{ fontSize: 16 }} />,
      roles: ["Coder", "Auditor", "SME", "TL", "AM", "Manager"],
      children: [
        { label: "My Production", to: "/my-production", roles: ["Coder"] },
        { label: "My Audit Production", to: "/audit/my-production", roles: ["Auditor"] },
        { label: "My AT Audit Production", to: "/at-audit/my-production", roles: ["SME", "TL"] },
        { label: "Team Production", to: "/team/production", roles: ["TL", "AM", "Manager"] },
        { label: "Audit Team Production", to: "/audit/team-production", roles: ["Auditor", "SME", "TL", "AM", "Manager", "VP"] },
        { label: "Hourly Production", to: "/hourly-production", roles: ["Coder", "SME", "TL", "AM", "Manager"] },
      ],
    },
    {
      label: "Quality",
      icon: <StarIcon sx={{ fontSize: 16 }} />,
      roles: ["Coder", "Auditor", "SME", "TL", "AM", "Manager", "VP"],
      children: [
        { label: "My Quality", to: "/quality/dashboard", roles: ["Coder"] },
        { label: "Audit Quality", to: "/audit/quality/dashboard", roles: ["Auditor"] },
        { label: "Team Quality", to: "/team/quality", roles: ["SME", "TL", "AM", "Manager", "VP"] },
        { label: "Rebuttal Status", to: "/quality/rebuttal-status", roles: ["Auditor", "SME", "TL", "AM", "Manager", "VP"] },
        { label: "View Chart", to: "/search-chart", roles: ["TL", "Manager", "VP", "AM"] },
      ],
    },
    {
      label: "Management",
      icon: <SettingsIcon sx={{ fontSize: 16 }} />,
      roles: ["Manager", "VP", "AM"],
      children: [
        { label: "User Upload", to: "/upload", roles: ["Manager", "VP", "AM"] },
        { label: "Inventory Upload", to: "/pdf-upload", roles: ["Manager", "VP", "AM"] },
        { label: "Inventory Management", to: "/inventory-management", roles: ["Manager", "VP", "AM"] },
        { label: "Project Config", to: "/project-config", roles: ["Manager", "VP", "AM"] },
        { label: "User Management", to: "/user-management", roles: ["Manager", "VP", "AM"] },
      ],
    },
    {
      label: "Clarification",
      icon: <ChatIcon sx={{ fontSize: 16 }} />,
      single: true,
      to: "/clarification-portal",
      roles: ["Coder", "Auditor", "SME", "TL", "AM", "Manager", "VP"],
      badge: clarifCount,
    },
  ];

  // Filter groups and their children by role
  const visibleGroups = navGroups
    .map((group) => {
      if (group.single) {
        return group.roles?.includes(role) ? group : null;
      }
      const visibleChildren = group.children?.filter((c) => c.roles?.includes(role)) ?? [];
      if (visibleChildren.length === 0) return null;
      return { ...group, children: visibleChildren };
    })
    .filter(Boolean);

  // Check if any child in a group matches current path
  const isGroupActive = (group) => {
    if (group.single) return location.pathname === group.to || (group.to === "/" && location.pathname === "/");
    return group.children?.some((c) => location.pathname.startsWith(c.to));
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#f0f7ff", color: "#1e293b" }}>
      {/* ───── App Bar ───── */}
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          bgcolor: "rgba(255,255,255,0.95)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid #dbeafe",
        }}
      >
        <Toolbar sx={{ justifyContent: "space-between", minHeight: "56px !important", px: { xs: 1.5, md: 3 } }}>

          {/* ── Brand Logo ── */}
          <Box component={Link} to="/" sx={{ display: "flex", gap: 1.2, textDecoration: "none", alignItems: "center", flexShrink: 0 }}>
            <Box
              sx={{
                width: 34, height: 34, borderRadius: 1.5,
                background: "linear-gradient(135deg, #1e40af, #3b82f6)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 800, color: "#fff", fontSize: 12,
              }}
            >
              MCS
            </Box>
            <Box sx={{ display: { xs: "none", sm: "block" } }}>
              <Typography fontSize={13} fontWeight={700} color="#1e3a8a" lineHeight={1.2}>
                MedLearn Coding System
              </Typography>
              <Typography fontSize={9} color="#60a5fa" fontWeight={700} sx={{ letterSpacing: 0.8 }}>
                CODER &amp; AUDIT CONSOLE
              </Typography>
            </Box>
          </Box>

          {/* ── Desktop Nav Groups ── */}
          <Stack
            direction="row"
            spacing={0.5}
            alignItems="center"
            ref={dropdownRef}
            sx={{ display: { xs: "none", md: "flex" }, flex: 1, justifyContent: "center", mx: 2 }}
          >
            {visibleGroups.map((group) => {
              const active = isGroupActive(group);

              if (group.single) {
                return (
                  <NavLink
                    key={group.to}
                    to={group.to}
                    end={group.to === "/"}
                    style={{ textDecoration: "none" }}
                  >
                    {({ isActive }) => (
                      <Box
                        sx={{
                          display: "flex", alignItems: "center", gap: 0.6,
                          px: 1.4, py: 0.8,
                          borderRadius: "8px",
                          fontSize: 13, fontWeight: 600,
                          color: isActive ? "#1e40af" : "#475569",
                          bgcolor: isActive ? "#eff6ff" : "transparent",
                          border: isActive ? "1px solid #bfdbfe" : "1px solid transparent",
                          transition: "all 0.18s ease",
                          cursor: "pointer",
                          position: "relative",
                          "&:hover": {
                            bgcolor: "#f0f9ff",
                            color: "#1e40af",
                            border: "1px solid #bfdbfe",
                          },
                        }}
                      >
                        {group.icon}
                        {group.label}
                        {group.badge > 0 && (
                          <Box
                            component="span"
                            sx={{
                              ml: 0.3,
                              bgcolor: "#ef4444", color: "#fff",
                              fontSize: 9, fontWeight: 800,
                              borderRadius: "50%",
                              width: 16, height: 16,
                              display: "inline-flex",
                              alignItems: "center", justifyContent: "center",
                              boxShadow: "0 1px 4px rgba(239,68,68,0.5)",
                              animation: "pulse 1.5s ease-in-out infinite",
                            }}
                          >
                            {group.badge > 99 ? "99+" : group.badge}
                          </Box>
                        )}
                      </Box>
                    )}
                  </NavLink>
                );
              }

              // Dropdown group
              return (
                <Box key={group.label} sx={{ position: "relative" }}>
                  <Box
                    onClick={() => setOpenDropdown(openDropdown === group.label ? null : group.label)}
                    sx={{
                      display: "flex", alignItems: "center", gap: 0.5,
                      px: 1.4, py: 0.8,
                      borderRadius: "8px",
                      fontSize: 13, fontWeight: 600,
                      color: active ? "#1e40af" : "#475569",
                      bgcolor: active ? "#eff6ff" : "transparent",
                      border: active ? "1px solid #bfdbfe" : "1px solid transparent",
                      transition: "all 0.18s ease",
                      cursor: "pointer",
                      userSelect: "none",
                      "&:hover": {
                        bgcolor: "#f0f9ff",
                        color: "#1e40af",
                        border: "1px solid #bfdbfe",
                      },
                    }}
                  >
                    {group.icon}
                    {group.label}
                    {openDropdown === group.label
                      ? <ExpandLessIcon sx={{ fontSize: 14, ml: 0.2, opacity: 0.7 }} />
                      : <ExpandMoreIcon sx={{ fontSize: 14, ml: 0.2, opacity: 0.7 }} />}
                  </Box>

                  {/* Dropdown Panel */}
                  {openDropdown === group.label && (
                    <Box
                      sx={{
                        position: "absolute",
                        top: "calc(100% + 8px)",
                        left: "50%",
                        transform: "translateX(-50%)",
                        minWidth: 210,
                        bgcolor: "#ffffff",
                        border: "1px solid #e0f0ff",
                        borderRadius: "12px",
                        boxShadow: "0 12px 40px rgba(30,64,175,0.12)",
                        zIndex: 9999,
                        overflow: "hidden",
                        animation: "dropIn 0.18s ease",
                      }}
                    >
                      {/* Dropdown header accent */}
                      <Box sx={{ height: 3, background: "linear-gradient(90deg, #1e40af, #3b82f6, #60a5fa)" }} />
                      <Box sx={{ py: 0.8 }}>
                        {group.children.map((child, idx) => {
                          const childActive = location.pathname === child.to || location.pathname.startsWith(child.to + "/");
                          return (
                            <NavLink
                              key={child.to}
                              to={child.to}
                              style={{ textDecoration: "none" }}
                            >
                              <Box
                                sx={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 1,
                                  mx: 1,
                                  px: 1.4,
                                  py: 0.9,
                                  borderRadius: "8px",
                                  fontSize: 13,
                                  fontWeight: childActive ? 700 : 500,
                                  color: childActive ? "#1e40af" : "#374151",
                                  bgcolor: childActive ? "#eff6ff" : "transparent",
                                  transition: "all 0.15s ease",
                                  mb: idx < group.children.length - 1 ? 0.3 : 0,
                                  "&:hover": {
                                    bgcolor: "#f0f9ff",
                                    color: "#1e40af",
                                    pl: 2,
                                  },
                                }}
                              >
                                {childActive && (
                                  <Box sx={{ width: 4, height: 4, borderRadius: "50%", bgcolor: "#1e40af", flexShrink: 0 }} />
                                )}
                                {child.label}
                              </Box>
                            </NavLink>
                          );
                        })}
                      </Box>
                    </Box>
                  )}
                </Box>
              );
            })}
          </Stack>

          {/* ── Right: User + Logout ── */}
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexShrink: 0 }}>
            <TextField
              size="small"
              placeholder="Search..."
              sx={{
                display: { xs: "none", lg: "block" },
                width: 170,
                "& .MuiOutlinedInput-root": {
                  color: "#1e3a8a", bgcolor: "#fff", fontSize: 12,
                  "& fieldset": { borderColor: "#dbeafe" },
                  "&:hover fieldset": { borderColor: "#3b82f6" },
                  "&.Mui-focused fieldset": { borderColor: "#1e40af" },
                },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 16, color: "#3b82f6" }} />
                  </InputAdornment>
                ),
              }}
            />

            <Box sx={{ display: { xs: "none", sm: "flex" }, alignItems: "center", gap: 0.8 }}>
              <Avatar
                sx={{
                  width: 30, height: 30, fontSize: 13, fontWeight: 800,
                  bgcolor: "#1e40af", boxShadow: "0 2px 8px rgba(30,64,175,0.25)",
                }}
              >
                {userName.charAt(0)}
              </Avatar>
              <Typography fontSize={12} fontWeight={700} color="#1e3a8a">
                {userName}
              </Typography>
            </Box>

            <Button
              variant="contained"
              disableElevation
              size="small"
              sx={{
                bgcolor: "#eff6ff", color: "#1e40af",
                textTransform: "none", fontWeight: 700, fontSize: 12,
                border: "1px solid #bfdbfe",
                "&:hover": { bgcolor: "#dbeafe" },
                display: { xs: "none", sm: "inline-flex" },
              }}
              onClick={logout}
            >
              Logout
            </Button>

            <IconButton
              sx={{ display: { md: "none" }, color: "#1e40af" }}
              onClick={() => setMobileOpen(true)}
            >
              <MenuIcon />
            </IconButton>
          </Stack>
        </Toolbar>
      </AppBar>

      {/* ───── Mobile Drawer ───── */}
      <Drawer
        anchor="left"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        PaperProps={{
          sx: {
            width: 280,
            bgcolor: "#fff",
            borderRight: "none",
            boxShadow: "4px 0 30px rgba(30,64,175,0.10)",
          },
        }}
      >
        {/* Drawer Header */}
        <Box
          sx={{
            background: "linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)",
            px: 2.5, py: 2.5,
            display: "flex", alignItems: "center", gap: 1.5,
          }}
        >
          <Box
            sx={{
              width: 36, height: 36, borderRadius: 1.5,
              bgcolor: "rgba(255,255,255,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, color: "#fff", fontSize: 13,
            }}
          >
            MCS
          </Box>
          <Box>
            <Typography fontSize={13} fontWeight={700} color="#fff">MedLearn Coding System</Typography>
            <Typography fontSize={10} color="#93c5fd" fontWeight={600} sx={{ letterSpacing: 0.6 }}>
              {role?.toUpperCase()} · {userName}
            </Typography>
          </Box>
        </Box>

        {/* Drawer Nav */}
        <Box sx={{ py: 1.5, flex: 1, overflow: "auto" }}>
          {visibleGroups.map((group) => {
            if (group.single) {
              const isActive = location.pathname === group.to || (group.to === "/" && location.pathname === "/");
              return (
                <Box
                  key={group.to}
                  component={Link}
                  to={group.to}
                  onClick={() => setMobileOpen(false)}
                  sx={{
                    display: "flex", alignItems: "center", gap: 1.2,
                    mx: 1.5, px: 1.5, py: 1.1,
                    borderRadius: "8px",
                    textDecoration: "none",
                    fontSize: 13, fontWeight: isActive ? 700 : 500,
                    color: isActive ? "#1e40af" : "#374151",
                    bgcolor: isActive ? "#eff6ff" : "transparent",
                    mb: 0.3,
                    transition: "all 0.15s",
                    "&:hover": { bgcolor: "#f0f9ff", color: "#1e40af" },
                  }}
                >
                  {group.icon}
                  {group.label}
                  {group.badge > 0 && (
                    <Box
                      component="span"
                      sx={{
                        ml: "auto", bgcolor: "#ef4444", color: "#fff",
                        fontSize: 9, fontWeight: 800, borderRadius: "50%",
                        width: 16, height: 16,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      {group.badge > 99 ? "99+" : group.badge}
                    </Box>
                  )}
                </Box>
              );
            }

            const anyChildActive = group.children?.some((c) => location.pathname.startsWith(c.to));
            const isExpanded = mobileExpanded === group.label || anyChildActive;

            return (
              <Box key={group.label}>
                <Box
                  onClick={() => setMobileExpanded(isExpanded ? null : group.label)}
                  sx={{
                    display: "flex", alignItems: "center", gap: 1.2,
                    mx: 1.5, px: 1.5, py: 1.1,
                    borderRadius: "8px",
                    fontSize: 13, fontWeight: anyChildActive ? 700 : 500,
                    color: anyChildActive ? "#1e40af" : "#374151",
                    bgcolor: anyChildActive ? "#eff6ff" : "transparent",
                    mb: 0.3,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    "&:hover": { bgcolor: "#f0f9ff", color: "#1e40af" },
                  }}
                >
                  {group.icon}
                  <span style={{ flex: 1 }}>{group.label}</span>
                  {isExpanded
                    ? <ExpandLessIcon sx={{ fontSize: 14 }} />
                    : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
                </Box>

                <Collapse in={isExpanded}>
                  <Box sx={{ pl: 2, pb: 0.5 }}>
                    {group.children.map((child) => {
                      const childActive = location.pathname === child.to || location.pathname.startsWith(child.to + "/");
                      return (
                        <Box
                          key={child.to}
                          component={Link}
                          to={child.to}
                          onClick={() => setMobileOpen(false)}
                          sx={{
                            display: "flex", alignItems: "center", gap: 1,
                            mx: 1, px: 1.5, py: 0.9,
                            borderRadius: "8px",
                            textDecoration: "none",
                            fontSize: 12.5, fontWeight: childActive ? 700 : 400,
                            color: childActive ? "#1e40af" : "#6b7280",
                            bgcolor: childActive ? "#eff6ff" : "transparent",
                            mb: 0.3,
                            transition: "all 0.15s",
                            "&:hover": { bgcolor: "#f0f9ff", color: "#1e40af" },
                          }}
                        >
                          {childActive && <Box sx={{ width: 4, height: 4, borderRadius: "50%", bgcolor: "#1e40af" }} />}
                          {child.label}
                        </Box>
                      );
                    })}
                  </Box>
                </Collapse>
              </Box>
            );
          })}
        </Box>

        {/* Drawer Footer */}
        <Box sx={{ p: 2, borderTop: "1px solid #e0f0ff" }}>
          <Button
            fullWidth
            variant="outlined"
            onClick={() => { setMobileOpen(false); logout(); }}
            sx={{
              color: "#1e40af", borderColor: "#bfdbfe",
              textTransform: "none", fontWeight: 700, fontSize: 13,
              borderRadius: "8px",
              "&:hover": { bgcolor: "#eff6ff", borderColor: "#1e40af" },
            }}
          >
            Logout
          </Button>
        </Box>
      </Drawer>

      {/* ───── Main Content ───── */}
      <Box component="main" sx={{ p: { xs: 2, md: 4 } }}>
        <Box
          sx={{
            maxWidth: "auto",
            mx: "auto",
            minHeight: "85vh",
            borderRadius: 4,
            border: "1px solid #dbeafe",
            bgcolor: "#ffffff",
            p: { xs: 2, sm: 4 },
            boxShadow: "0 10px 25px -5px rgba(30, 64, 175, 0.05)",
          }}
        >
          <Outlet />
        </Box>
      </Box>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.18); opacity: 0.85; }
        }
        @keyframes dropIn {
          from { opacity: 0; transform: translateX(-50%) translateY(-6px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </Box>
  );
}