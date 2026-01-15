// src/pages/OrganizerSlotsPage.tsx
import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getOrganizerDiagram,
  saveOrganizerDiagram,
  type OrganizerDiagram,
  type OrganizerDiagramSlot,
} from "../api/diagram";

type SlotForm = OrganizerDiagramSlot & {
  priceDollars: string;
};

export default function OrganizerSlotsPage() {
  const { eventId: eventIdParam } = useParams();
  const eventId = Number(eventIdParam);

  const [diagram, setDiagram] = useState<OrganizerDiagram | null>(null);
  const [slots, setSlots] = useState<SlotForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!Number.isFinite(eventId)) {
      setError("Invalid event id.");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const d = await getOrganizerDiagram(eventId);

      const slotForms: SlotForm[] = d.slots.map((s) => ({
        ...s,
        priceDollars: ((s.price_cents ?? 0) / 100).toString(),
      }));

      setDiagram(d);
      setSlots(slotForms);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Failed to load diagram.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventIdParam]);

  function updateSlot(id: number, patch: Partial<SlotForm>) {
    setSlots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
    );
  }

  async function save() {
    if (!diagram) return;

    try {
      setSaving(true);
      setError(null);

      const payload: OrganizerDiagram = {
        ...diagram,
        slots: slots.map((s) => ({
          ...s,
          price_cents: Math.round(Number(s.priceDollars || 0) * 100),
        })),
      };

      await saveOrganizerDiagram(eventId, payload);
      await load();
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Failed to save layout.");
    } finally {
      setSaving(false);
    }
  }

  if (!Number.isFinite(eventId)) {
    return <div className="p-6 text-red-600">Invalid event id.</div>;
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Booth Slots</h1>
          <p className="mt-1 text-sm text-slate-600">
            Edit booth pricing and dimensions. Layout position is handled in the
            Map Editor.
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            to={`/organizer/events/${eventId}`}
            className="rounded-full border bg-white px-4 py-2 text-sm hover:bg-slate-50"
          >
            Back to Event
          </Link>

          <button
            onClick={save}
            disabled={saving}
            className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : slots.length === 0 ? (
        <div className="rounded-2xl border bg-white p-6 text-sm text-slate-600">
          No booths yet. Add them using the Map Editor.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-white">
          <table className="min-w-full text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Label</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Price ($)</th>
                <th className="px-4 py-3 text-left">W</th>
                <th className="px-4 py-3 text-left">H</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {slots.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-medium">{s.label}</td>

                  <td className="px-4 py-3">
                    {s.category_name || "—"}
                  </td>

                  <td className="px-4 py-3">
                    <input
                      className="w-24 rounded-lg border px-3 py-2"
                      value={s.priceDollars}
                      onChange={(e) =>
                        updateSlot(s.id, { priceDollars: e.target.value })
                      }
                    />
                  </td>

                  <td className="px-4 py-3">
                    <input
                      className="w-16 rounded-lg border px-3 py-2"
                      value={s.w}
                      onChange={(e) =>
                        updateSlot(s.id, { w: Number(e.target.value) })
                      }
                    />
                  </td>

                  <td className="px-4 py-3">
                    <input
                      className="w-16 rounded-lg border px-3 py-2"
                      value={s.h}
                      onChange={(e) =>
                        updateSlot(s.id, { h: Number(e.target.value) })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
