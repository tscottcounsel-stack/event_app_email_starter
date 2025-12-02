// src/pages/VendorEventApply.tsx
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getVendorEvent,
  getVendorEventSlots,
  type VendorEvent,
  type VendorEventSlot,
} from "../api/vendorEvents";
import { applyForEventSlot } from "../api/vendorApplications";

function formatMoney(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

const VendorEventApply: React.FC = () => {
  const navigate = useNavigate();
  const { eventId } = useParams<{ eventId: string }>();

  const [event, setEvent] = useState<VendorEvent | null>(null);
  const [slots, setSlots] = useState<VendorEventSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Load event + slots from vendor endpoints
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!eventId) {
      setError("No event id in URL.");
      return;
    }

    const idNum = Number(eventId);
    if (!Number.isFinite(idNum)) {
      setError(`Invalid event id: ${eventId}`);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const [evt, slotList] = await Promise.all([
          getVendorEvent(idNum),
          getVendorEventSlots(idNum),
        ]);

        if (cancelled) return;
        setEvent(evt);
        setSlots(slotList);
      } catch (err: any) {
        if (cancelled) return;
        console.error(err);
        setError(
          err?.message ?? "Failed to load event or slots for vendor.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // -------------------------------------------------------------------------
  // Submit application for a slot
  // -------------------------------------------------------------------------
  async function handleApply(slot: VendorEventSlot) {
    if (!eventId) return;

    const idNum = Number(eventId);
    if (!Number.isFinite(idNum)) return;

    try {
      setSubmitting(slot.id);
      setError(null);
      setSuccess(null);

      // We already built applyForEventSlot to be flexible:
      // (eventId, slotId) is enough.
      const app = await applyForEventSlot(idNum, slot.id);

      setSuccess("Application submitted successfully!");
      // Optionally, navigate to vendor applications page:
      // navigate("/vendor/applications");
      console.log("Created application:", app);
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Failed to submit application.");
    } finally {
      setSubmitting(null);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const title = event?.title ?? `Event ID: ${eventId}`;

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <button
        type="button"
        onClick={() => navigate("/vendor/events")}
        className="mb-4 inline-flex items-center rounded border px-3 py-1 text-sm hover:bg-gray-100"
      >
        ← Back to events
      </button>

      <h1 className="text-xl font-semibold mb-2">Apply for event</h1>
      <p className="text-sm text-gray-600 mb-4">
        {title} — choose a slot and submit an application.
      </p>

      {error && (
        <div className="mb-4 border border-red-300 bg-red-50 text-red-700 px-3 py-2 rounded text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 border border-green-300 bg-green-50 text-green-700 px-3 py-2 rounded text-sm">
          {success}
        </div>
      )}

      <div className="border rounded p-4 bg-white">
        <h2 className="font-semibold mb-3">Available slots &amp; pricing</h2>

        {loading && <p className="text-sm text-gray-500">Loading…</p>}

        {!loading && slots.length === 0 && !error && (
          <p className="text-sm text-gray-500">
            No slots defined for this event yet.
          </p>
        )}

        {!loading && slots.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Label</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-right">Size</th>
                  <th className="px-3 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {slots.map((slot) => (
                  <tr key={slot.id} className="border-t">
                    <td className="px-3 py-2">{slot.label}</td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(slot.price_cents)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {slot.width && slot.height
                        ? `${slot.width}×${slot.height}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        disabled={submitting === slot.id}
                        onClick={() => handleApply(slot)}
                        className="border rounded px-3 py-1 text-xs bg-blue-600 text-white disabled:opacity-60"
                      >
                        {submitting === slot.id
                          ? "Submitting..."
                          : "Apply for this slot"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default VendorEventApply;
