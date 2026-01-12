// src/pages/VendorApplicationsPage.tsx
import React from "react";
import { Link } from "react-router-dom";

export default function VendorApplicationsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Vendor Applications</h1>
        <div className="text-sm text-slate-600">
          This page is intentionally read-only right now to avoid calling phantom endpoints.
        </div>
      </div>

      <div className="rounded border bg-slate-50 p-4 text-sm text-slate-700 space-y-2">
        <div className="font-semibold">Why no list here?</div>
        <div>
          Your confirmed OpenAPI routes include:
          <ul className="list-disc pl-5 mt-1">
            <li>GET /public/events</li>
            <li>GET /vendor/events/{`{event_id}`}/diagram</li>
            <li>GET /organizer/events</li>
            <li>GET /organizer/events/{`{event_id}`}/applications</li>
          </ul>
        </div>
        <div>
          There is no confirmed vendor endpoint to list “my applications” yet, so we do not fetch.
        </div>
      </div>

      <div className="flex gap-2">
        <Link to="/vendor/events" className="rounded border px-3 py-2 text-sm hover:bg-slate-50">
          Back to Vendor Events
        </Link>
      </div>
    </div>
  );
}
