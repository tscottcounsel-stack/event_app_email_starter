// src/pages/OrganizerDiagramEditorPage.tsx
// Organizer Diagram Editor
// - Loads diagram + applications
// - Shows unassigned applications panel
// - Click app → click booth to assign
// - Sidebar scrolls independently of grid

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import DiagramEditor from "../components/DiagramEditor";
import { apiGet, apiPatch } from "../api";

// ---- Types ----

type DiagramSlot = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  status?: string;
  db_slot_id?: number | null;
};

type DiagramData = {
  slots: DiagramSlot[];
  width: number;
  height: number;
};

type DiagramResponse = {
  event_id: number;
  version: number;
  diagram: DiagramData;
};

type Application = {
  id: number;
  event_id: number;
  vendor_profile_id: number;
  status: string;
  assigned_slot_id: number | null;
  submitted_at: string;
};

// ---- Page ----

export default function OrganizerDiagramEditorPage() {
  const { eventId } = useParams();
  const numericEventId = Number(eventId);

  const [diagram, setDiagram] = useState<DiagramData | null>(null);
  const [diagramVersion, setDiagramVersion] = useState<number>(0);
  const [applications, setApplications] = useState<Application[]>([]);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);

  // ---- Load diagram ----
  async function loadDiagram() {
    const res = await apiGet<DiagramResponse>(`/organizer/events/${numericEventId}/diagram`);
    setDiagram(res.diagram);
    setDiagramVersion(res.version);
  }

  // ---- Load applications ----
  async function loadApplications() {
    const res = await apiGet<{ event_id: number; items: Application[] }>(
      `/organizer/events/${numericEventId}/applications?limit=200`
    );
    setApplications(res.items);
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        await Promise.all([loadDiagram(), loadApplications()]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [numericEventId]);

  // ---- Derived ----
  const unassignedApps = useMemo(
    () => applications.filter(a => a.assigned_slot_id == null),
    [applications]
  );

  const assignedBySlot = useMemo(() => {
    const map = new Map<number, Application>();
    applications.forEach(app => {
      if (app.assigned_slot_id != null) {
        map.set(app.assigned_slot_id, app);
      }
    });
    return map;
  }, [applications]);

  // ---- Assign app to booth ----
  async function assignSelectedAppToSlot(slot: DiagramSlot) {
    if (!selectedApp || !slot.db_slot_id) return;

    await apiPatch(
      `/organizer/events/${numericEventId}/applications/${selectedApp.id}`,
      { assigned_slot_id: slot.db_slot_id }
    );

    setSelectedApp(null);
    await loadApplications();
  }

  if (loading) {
    return <div className="p-6">Loading diagram…</div>;
  }

  if (!diagram) {
    return <div className="p-6 text-red-600">Failed to load diagram.</div>;
  }

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      {/* LEFT: Diagram */}
      <div className="flex-1 overflow-hidden bg-gray-50">
        <DiagramEditor
          diagram={diagram}
          version={diagramVersion}
          onChange={setDiagram}
          onBoothClick={slot => {
            if (selectedApp) {
              assignSelectedAppToSlot(slot);
            }
          }}
          boothMeta={slot => {
            const app = slot.db_slot_id ? assignedBySlot.get(slot.db_slot_id) : null;
            return app
              ? { badge: `App #${app.id}`, status: app.status }
              : undefined;
          }}
        />
      </div>

      {/* RIGHT: Sidebar */}
      <aside className="w-96 border-l bg-white flex flex-col">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">Unassigned Applications</h2>
          <p className="text-sm text-gray-500">
            Select an application, then click a booth to assign it.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {unassignedApps.length === 0 && (
            <div className="p-4 text-gray-500">No unassigned applications.</div>
          )}

          {unassignedApps.map(app => (
            <button
              key={app.id}
              onClick={() => setSelectedApp(app)}
              className={`w-full text-left p-3 border-b hover:bg-gray-50 transition ${
                selectedApp?.id === app.id ? "bg-blue-50" : ""
              }`}
            >
              <div className="font-medium">Application #{app.id}</div>
              <div className="text-xs text-gray-500">Status: {app.status}</div>
            </button>
          ))}
        </div>

        {selectedApp && (
          <div className="p-4 border-t bg-blue-50 text-sm">
            Assigning <strong>Application #{selectedApp.id}</strong> — click a booth
            on the map.
          </div>
        )}
      </aside>
    </div>
  );
}
