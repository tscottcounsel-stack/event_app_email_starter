// src/components/auth/RequireAuth.tsx
import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { readSession, type AuthRole } from "../../auth/authStorage";

type RequireAuthProps = {
  allow?: AuthRole[];
  children?: React.ReactNode;
};

export default function RequireAuth({
  allow,
  children,
}: RequireAuthProps) {
  const location = useLocation();
  const session = readSession();

  // No session at all → do NOT send to the broken /login placeholder.
  // Send users to the app root so they can re-enter through the working flow.
  if (!session?.accessToken || !session?.role) {
    return (
      <Navigate
        to="/"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }

  // Role-restricted route
  if (allow?.length && !allow.includes(session.role)) {
    const fallbackByRole: Record<AuthRole, string> = {
      vendor: "/vendor",
      organizer: "/organizer",
      admin: "/admin",
    };

    return <Navigate to={fallbackByRole[session.role] || "/"} replace />;
  }

  return <>{children ?? <Outlet />}</>;
}
