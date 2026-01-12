import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import EventDiagramCanvas from "../components/EventDiagramCanvas";
import { getPublicEventDiagram, vendorGetEventDiagram, type EventDiagramResponse } from "../api";
import type { DiagramJson, Booth } from "../api/diagramTypes";

function getVendorToken(): string | null {
  return (
    localStorage.getItem("VENDOR_TOKEN") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("token")
  );
}

export default function VendorDiagramPage() {
  const nav = useNavigate();
  const { eventId } = useParams();

  const eid = Number(eventId);
  const token = getVendorToken();

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resp, setResp] = useState<EventDiagramResponse | null>(null);

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [selectedBooth, setSelectedBooth] = useState<Booth | null>(null);

  const diagram = useMemo(() => {
    return (resp as unknown as DiagramJson) || null;
  }, [resp]);

  const load = async () => {
    if (!Number.isFinite(eid) || eid <= 0) {
      setError("Invalid event id.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const data = token ? await vendorGetEventDiagram(eid, token) : await getPublicEventDiagram(eid);
      setResp(data);

      if (!token) {
        setInfo("Public preview mode. Log in as a vendor for vendor-only access.");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load diagram.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eid]);

  const onBoothClick = (code: string, booth: Booth) => {
    setSelectedCode(code);
    setSelectedBooth(booth);
    setInfo(null);

    if (!token) {
      setInfo("Log in as a vendor to use vendor-only features.");
      return;
    }

    const status = String((booth as any)?.status || "").toLowerCase();
    if (status && status !== "available") {
      setInfo("This booth is not currently available.");
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Vendor Map</h1>
          <div className="text-sm text-slate-600">
            Event {Number.isFinite(eid) ? eid : "—"} · Diagram v{resp?.version ?? "—"}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
            onClick={load}
          >
            Refresh
          </button>
          <button
            type="button"
            className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
            onClick={() => nav("/vendor/events")}
          >
            Back
          </button>
        </div>
      </div>

      {info ? <div className="rounded border bg-sky-50 p-2 text-sm">{info}</div> : null}
      {error ? <div className="rounded border bg-red-50 p-2 text-sm text-red-700">{error}</div> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-9 rounded-xl border bg-white p-3">
          {loading ? (
            <div className="p-6 text-sm text-slate-500">Loading…</div>
          ) : diagram ? (
            <EventDiagramCanvas diagram={diagram} viewMode="vendor" mineBoothCodes={[]} onBoothClick={onBoothClick} />
          ) : (
            <div className="p-6 text-sm text-slate-500">No diagram found.</div>
          )}
        </div>

        <div className="lg:col-span-3 rounded-xl border bg-white p-3">
          <div className="font-semibold">Booth details</div>

          {!selectedCode ? (
            <div className="mt-2 text-sm text-slate-600">Click a booth to see details.</div>
          ) : (
            <div className="mt-2 space-y-2 text-sm">
              <div className="font-mono font-semibold">{selectedCode}</div>
              <div>Status: {(selectedBooth as any)?.status ?? "—"}</div>
              <div>
                Size: {(selectedBooth as any)?.width ?? "—"}×{(selectedBooth as any)?.height ?? "—"}
              </div>

              <div className="rounded border bg-slate-50 p-2 text-slate-700">
                Apply flow is disabled for now because there is no vendor applications endpoint in OpenAPI.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
