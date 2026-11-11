import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import {
  Box,
  Button,
  Card,
  CardContent,
  TextField,
  Typography,
  IconButton,
  InputAdornment,
  Alert,
  Link,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stepper,
  Step,
  StepLabel,
  CircularProgress,
  Chip,
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import { api, setAuthToken } from "../services/api";

import gsap from "gsap";
import { useGSAP } from "@gsap/react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [fpStep, setFpStep] = useState(0); 
  const [fpEmail, setFpEmail] = useState("");
  const [fpOtp, setFpOtp] = useState("");
  const [fpNewPassword, setFpNewPassword] = useState("");
  const [fpLoading, setFpLoading] = useState(false);
  const [fpError, setFpError] = useState("");
  const [fpSuccess, setFpSuccess] = useState("");

  // Profile selector (shown when user has multiple profiles)
  const [profileSelectorOpen, setProfileSelectorOpen] = useState(false);
  const [availableProfiles, setAvailableProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [pendingToken, setPendingToken] = useState("");
  const [pendingUserName, setPendingUserName] = useState("");

  const PROFILE_COLORS = {
    Coder:   { bg: "#e3f2fd", text: "#1565c0" },
    Auditor: { bg: "#f3e5f5", text: "#6a1b9a" },
    SME:     { bg: "#e8f5e9", text: "#2e7d32" },
    TL:      { bg: "#fff3e0", text: "#e65100" },
    AM:      { bg: "#fce4ec", text: "#ad1457" },
    Manager: { bg: "#e0f2f1", text: "#00695c" },
    VP:      { bg: "#ede7f6", text: "#4527a0" },
  };
  const cardRef = useRef(null);
  const logoRef = useRef(null);
  const fieldsRef = useRef([]);
  const buttonRef = useRef(null);
  const errorRef = useRef(null);

  // M C S refs
  const mRef = useRef(null);
  const cRef = useRef(null);
  const sRef = useRef(null);
  const navigate = useNavigate();

  // Page entrance animation
  useGSAP(() => {
    const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

    tl.from(cardRef.current, {
      opacity: 0,
      scale: 0.9,
      duration: 0.8,
    })

      // Logo animation
      .from(
        logoRef.current,
        {
          y: -20,
          opacity: 0,
          duration: 0.6,
        },
        "-=0.4"
      )

      // M C S zoom + rotate highlight
      .from(
        [mRef.current, cRef.current, sRef.current],
        {
          scale: 0,
          rotate: 180,
          opacity: 0,
          stagger: 0.15,
          duration: 0.6,
        },
        "-=0.3"
      )

      // Form fields animation
      .from(
        fieldsRef.current,
        {
          y: 20,
          opacity: 0,
          stagger: 0.15,
          duration: 0.6,
        },
        "-=0.2"
      );
  }, []);

  // Floating logo loop
  useEffect(() => {
    gsap.to(logoRef.current, {
      y: 6,
      repeat: -1,
      yoyo: true,
      duration: 2,
      ease: "sine.inOut",
    });
  }, []);

  // Error shake animation
  useEffect(() => {
    if (error && errorRef.current) {
      gsap.fromTo(
        errorRef.current,
        { x: -10 },
        { x: 10, duration: 0.08, repeat: 5, yoyo: true }
      );
    }
  }, [error]);

  const handleFpRequestOtp = async () => {
    setFpError("");
    setFpLoading(true);
    try {
      await api.post("/api/forgot-password/request-otp/", { email: fpEmail });
      setFpStep(1);
    } catch (err) {
      setFpError(err.response?.data?.error || "Failed to send OTP");
    } finally {
      setFpLoading(false);
    }
  };

  const handleFpVerifyOtp = async () => {
    setFpError("");
    setFpLoading(true);
    try {
      await api.post("/api/forgot-password/verify-otp/", { email: fpEmail, otp: fpOtp });
      setFpStep(2);
    } catch (err) {
      setFpError(err.response?.data?.error || "Invalid OTP");
    } finally {
      setFpLoading(false);
    }
  };

  const handleFpReset = async () => {
    setFpError("");
    setFpLoading(true);
    try {
      await api.post("/api/forgot-password/reset/", { email: fpEmail, otp: fpOtp, new_password: fpNewPassword });
      setFpSuccess("Password changed successfully! You can now login.");
      setTimeout(() => {
        setForgotPasswordOpen(false);
        setFpStep(0);
        setFpEmail("");
        setFpOtp("");
        setFpNewPassword("");
        setFpSuccess("");
      }, 3000);
    } catch (err) {
      setFpError(err.response?.data?.error || "Failed to reset password");
    } finally {
      setFpLoading(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");

    gsap.to(buttonRef.current, {
      scale: 0.96,
      duration: 0.1,
      yoyo: true,
      repeat: 1,
    });

    try {
      const res = await api.post("/api/login/", { email, password });

      const rawProfile = res.data.user_profile || "";
      const profiles = rawProfile.split(",").map((p) => p.trim()).filter(Boolean);

      if (profiles.length > 1) {
        // Multiple profiles — show the selector dialog first
        setPendingToken(res.data.token);
        setPendingUserName(res.data.user_name);
        setAvailableProfiles(profiles);
        setSelectedProfile(profiles[0]);
        setProfileSelectorOpen(true);
      } else {
        // Single profile — proceed as before
        const chosenProfile = profiles[0] || rawProfile;
        localStorage.setItem("token", res.data.token);
        localStorage.setItem("role", chosenProfile);
        localStorage.setItem("user_name", res.data.user_name);
        setAuthToken(res.data.token);
        navigate("/", { replace: true });
      }

    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    }
  };

  const handleProfileConfirm = async () => {
    try {
      // Temporarily set the token so the api client uses it for this request
      setAuthToken(pendingToken);
      
      // Tell the backend which role the user chose
      await api.post("/api/set-active-role/", { role: selectedProfile });
      
      // Now set the rest of the localStorage
      localStorage.setItem("token", pendingToken);
      localStorage.setItem("role", selectedProfile);
      localStorage.setItem("user_name", pendingUserName);
      
      setProfileSelectorOpen(false);
      navigate("/", { replace: true });
    } catch (err) {
      setError("Failed to set active role");
    }
  };


  return (
    <Box
      sx={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #e3f2fd, #f9fbff)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: 2,
      }}
    >
      <Card
        ref={cardRef}
        sx={{
          width: "100%",
          maxWidth: 420,
          borderRadius: "20px",
          boxShadow: "0 10px 40px rgba(0, 0, 0, 0.15)",
          backdropFilter: "blur(12px)",
        }}
      >
        <CardContent sx={{ p: 4 }}>
          {/* Logo */}
          <Box textAlign="center" mb={2}>
            <Box
              ref={logoRef}
              component="img"
              src="https://github.com/samuelit-creator/HRMS/blob/main/med.png?raw=true"
              alt="MedLearn Vision"
              sx={{ width: 120 }}
            />
          </Box>

          {/* Title */}
          <Typography variant="h5" fontWeight={700} textAlign="center">
            <span
              ref={mRef}
              style={{ color: "#318BE6", display: "inline-block" }}
            >
              M
            </span>
            edLearn{" "}
            <span
              ref={cRef}
              style={{ color: "#318BE6", display: "inline-block" }}
            >
              C
            </span>
            oding{" "}
            <span
              ref={sRef}
              style={{ color: "#318BE6", display: "inline-block" }}
            >
              S
            </span>
            ystem
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            textAlign="center"
            mb={3}
          >
            Accuracy • Integrity • Impact
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} ref={errorRef}>
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={submit}>
            <Box ref={(el) => (fieldsRef.current[0] = el)}>
              <Typography fontWeight={600} mb={0.5}>
                Email ID
              </Typography>
              <TextField
                fullWidth
                type="email"
                placeholder="Enter email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                sx={{
                  mb: 2,
                  borderRadius: 2,
                  "& .MuiOutlinedInput-root": {
                    borderRadius: "10px",
                  },
                }}
              />
            </Box>

            <Box ref={(el) => (fieldsRef.current[1] = el)}>
              <Typography fontWeight={600} mb={0.5}>
                Password
              </Typography>
              <TextField
                fullWidth
                type={showPassword ? "text" : "password"}
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                sx={{
                  mb: 2,
                  borderRadius: 2,
                  "& .MuiOutlinedInput-root": {
                    borderRadius: "10px",
                  },
                }}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowPassword(!showPassword)}
                        edge="end"
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Box>

            <Box textAlign="right" mt={1} mb={2}>
              <Link href="#" underline="none" fontSize={13} onClick={(e) => { e.preventDefault(); setForgotPasswordOpen(true); }}>
                Forgot password?
              </Link>
            </Box>

            <Button
              ref={buttonRef}
              type="submit"
              variant="contained"
              fullWidth
              size="large"
              sx={{
                fontWeight: 700,
                transition: "all .2s",
                borderRadius: "10px",
                "&:hover": {
                  boxShadow: "0 10px 25px rgba(49,149,237,.4)",
                },
              }}
            >
              Login
            </Button>
          </Box>

          <Typography
            variant="caption"
            display="block"
            textAlign="center"
            color="text.secondary"
            mt={3}
          >
            © 2026 MedLearn Coding System
          </Typography>
        </CardContent>
      </Card>
      <Dialog open={forgotPasswordOpen} onClose={() => !fpLoading && setForgotPasswordOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>Forgot Password</DialogTitle>
        <DialogContent>
          <Stepper activeStep={fpStep} sx={{ mb: 4, mt: 2 }}>
            <Step><StepLabel>Email</StepLabel></Step>
            <Step><StepLabel>Verify OTP</StepLabel></Step>
            <Step><StepLabel>New Password</StepLabel></Step>
          </Stepper>

          {fpError && <Alert severity="error" sx={{ mb: 2 }}>{fpError}</Alert>}
          {fpSuccess && <Alert severity="success" sx={{ mb: 2 }}>{fpSuccess}</Alert>}

          {fpStep === 0 && (
            <TextField
              fullWidth
              label="Enter your registered .co.in email"
              type="email"
              value={fpEmail}
              onChange={(e) => setFpEmail(e.target.value)}
              disabled={fpLoading}
              autoFocus
            />
          )}

          {fpStep === 1 && (
            <TextField
              fullWidth
              label="Enter 6-digit OTP"
              type="text"
              value={fpOtp}
              onChange={(e) => setFpOtp(e.target.value)}
              disabled={fpLoading}
              autoFocus
            />
          )}

          {fpStep === 2 && (
            <TextField
              fullWidth
              label="Enter New Password"
              type={showPassword ? "text" : "password"}
              value={fpNewPassword}
              onChange={(e) => setFpNewPassword(e.target.value)}
              disabled={fpLoading}
              autoFocus
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowPassword(!showPassword)} edge="end">
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setForgotPasswordOpen(false)} disabled={fpLoading}>Cancel</Button>
          {fpStep === 0 && (
            <Button variant="contained" onClick={handleFpRequestOtp} disabled={fpLoading || !fpEmail}>
              {fpLoading ? <CircularProgress size={24} /> : "Send OTP"}
            </Button>
          )}
          {fpStep === 1 && (
            <Button variant="contained" onClick={handleFpVerifyOtp} disabled={fpLoading || fpOtp.length !== 6}>
              {fpLoading ? <CircularProgress size={24} /> : "Verify"}
            </Button>
          )}
          {fpStep === 2 && (
            <Button variant="contained" onClick={handleFpReset} disabled={fpLoading || !fpNewPassword}>
              {fpLoading ? <CircularProgress size={24} /> : "Change Password"}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* ── Profile Selector Dialog ─────────────────────────────── */}
      <Dialog
        open={profileSelectorOpen}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3, overflow: "visible" } }}
      >
        <DialogTitle sx={{ fontWeight: 700, pb: 1, textAlign: "center" }}>
          Choose Your Profile
        </DialogTitle>
        <DialogContent sx={{ pt: "8px !important", pb: 1 }}>
          <Typography variant="body2" color="text.secondary" textAlign="center" mb={2.5}>
            You have multiple roles assigned. Select how you want to log in today.
          </Typography>

          {/* Profile pill buttons */}
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.2, justifyContent: "center", mb: 1 }}>
            {availableProfiles.map((profile) => {
              const colors = PROFILE_COLORS[profile] || { bg: "#f1f5f9", text: "#334155" };
              const active = selectedProfile === profile;
              return (
                <Chip
                  key={profile}
                  label={profile}
                  onClick={() => setSelectedProfile(profile)}
                  sx={{
                    px: 1,
                    py: 2.5,
                    fontSize: 14,
                    fontWeight: active ? 800 : 500,
                    borderRadius: 2,
                    cursor: "pointer",
                    border: "2px solid",
                    borderColor: active ? colors.text : "#e2e8f0",
                    bgcolor: active ? colors.bg : "#f8fafc",
                    color: active ? colors.text : "#64748b",
                    transition: "all 0.15s",
                    boxShadow: active ? `0 0 0 3px ${colors.text}33` : "none",
                    "&:hover": { borderColor: colors.text, bgcolor: colors.bg, color: colors.text },
                  }}
                />
              );
            })}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, justifyContent: "center" }}>
          <Button
            variant="contained"
            fullWidth
            disabled={!selectedProfile}
            onClick={handleProfileConfirm}
            sx={{
              fontWeight: 700,
              borderRadius: 2,
              py: 1.2,
              background: "linear-gradient(135deg, #1e40af, #3b82f6)",
              boxShadow: "0 4px 14px rgba(59,130,246,0.4)",
              "&:hover": { boxShadow: "0 6px 20px rgba(59,130,246,0.5)" },
            }}
          >
            Continue as {selectedProfile}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
