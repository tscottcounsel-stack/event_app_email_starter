// src/pages/VendorDiagramPage.tsx
import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { getVendorDiagram } from "../api/vendorDiagram";
import type { DiagramEnvelope } from "../api/diagramTypes";
import EventDiagramCanvas from "../components/EventDiagramCanvas";

const VendorDiagramPage: React.FC = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const [envelope, setEnvelope] = useState<DiagramEnvelope | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) {
      setError("Missing event id.");
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const id = Number(eventId);
        console.log("[VendorDiagramPage] loading diagram for event", id);

        const resp = await getVendorDiagram(id);

        if (cancelled) return;

        console.log("[VendorDiagramPage] got diagram", resp);
        setEnvelope(resp);
      } catch (err) {
        if (!cancelled) {
          console.error("[VendorDiagramPage] failed to load diagram", err);
          setError("Could not load event map.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const diagram = envelope?.diagram ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Event layout <span className="text-sm font-normal">(read-only)</span>
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            This is a read-only view of the event map.
          </p>
        </div>

        <Link
          to="/vendor/events"
          className="inline-flex items-center rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
        >
          Back
        </Link>
      </div>

      {/* Legend */}
      <div className="rounded-lg bg-slate-800 px-4 py-2 text-xs text-slate-100">
        <span className="mr-4 font-semibold">Legend:</span>
        <span className="mr-4 inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded-sm bg-emerald-500" /> Available
        </span>
        <span className="mr-4 inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded-sm bg-sky-500" /> Assigned / mine
        </span>
        <span className="mr-4 inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded-sm bg-amber-500" /> Pending
        </span>
        <span className="mr-4 inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded-sm bg-rose-500" /> Reserved / blocked
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded-sm bg-slate-500" /> Hidden
        </span>
      </div>

      {loading && !diagram && (
        <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
          Loading event map…
        </div>
      )}

      {error && !diagram && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Shared renderer */}
      <EventDiagramCanvas diagram={diagram} viewMode="vendor" />
    </div>
  );
};

export default VendorDiagramPage;
