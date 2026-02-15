import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import type { AuthRole } from "../../auth/authStorage";

export default function RequireAuth({ allow }: { allow?: AuthRole[] }) {
  const location = useLocation();
  const { isReady, isAuthed, role } = useAuth();

  if (!isReady) return null; // or a spinner later

  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (allow && allow.length > 0) {
    if (!role || !allow.includes(role)) {
      return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    }
  }

  return <Outlet />;
}
