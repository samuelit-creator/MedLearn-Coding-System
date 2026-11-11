import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../services/api";

export default function ProtectedRoute({ children }) {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    api.get("/api/me/")
        .then(res => {
        const rawProfile = res.data.user_profile || "";
        const storedRole = localStorage.getItem("role") || "";

        // Only overwrite the stored role if:
        //  1. No role is stored yet, OR
        //  2. The stored role is itself a comma-separated multi-value string
        //     (meaning the user never went through the profile selector, e.g.
        //      after a page refresh before choosing a profile).
        // In all other cases keep the role the user consciously picked in
        // the profile selector dialog.
        const storedIsMulti = storedRole.includes(",");
        if (!storedRole || storedIsMulti) {
          // If the DB profile is also multi-value, use the first one as fallback
          const firstProfile = rawProfile.split(",")[0]?.trim() || rawProfile;
          localStorage.setItem("role", firstProfile);
        }

        setAllowed(true);
        setLoading(false);
        })
        .catch(() => {
        setAllowed(false);
        setLoading(false);
        });
    }, []);


  if (loading) return <p>Checking session...</p>;
  if (!allowed) return <Navigate to="/login" replace />;

  return children;
}
