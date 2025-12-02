import { Navigate, useLocation } from "react-router-dom";
import { PropsWithChildren } from "react";
import { isAuthed } from "@/lib/auth";

export default function Protected({ children }: PropsWithChildren) {
  const authed = isAuthed();
  const loc = useLocation();
  return authed ? <>{children}</> : <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
}
