// vendor-portal/src/pages/ComingSoon.tsx
import React from "react";
import { Link } from "react-router-dom";

export default function ComingSoon({ title }: { title: string }) {
  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <p style={{ opacity: 0.85 }}>
        This section is wired in the shell, but the feature is not enabled yet.
      </p>
      <Link to="/organizer/events">← Back to events</Link>
    </div>
  );
}
