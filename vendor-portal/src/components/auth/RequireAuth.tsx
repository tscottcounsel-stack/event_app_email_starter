import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

type Role = "vendor" | "organizer" | "admin";

function getToken() {
  return localStorage.getItem("accessToken");
}

function getRole(): Role | null {
  const r = localStorage.getItem("userRole");
  if (!r) return null;
  const role = r.toLowerCase();
  if (role === "vendor" || role === "organizer" || role === "admin") return role;
  return null;
}

export default function RequireAuth({
  allow,
}: {
  allow?: Role[];
}) {
  const location = useLocation();
  const token = getToken();
  const role = getRole();

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (allow && allow.length > 0) {
    if (!role || !allow.includes(role)) {
      return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    }
  }

  return <Outlet />;
}
