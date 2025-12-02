// src/pages/OrganizerSlotsPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { apiGet, apiPost, apiDelete, apiFetch } from "../api";

type Slot = {
  id: number;
  label: string;
  price_cents: number;
  width: number;
  height: number;
  x: number | null;
  y: number | null;
};

type SlotFormState = {
  label: string;
  priceDollars: string;
  width: string;
  height: string;
  x: string;
  y: string;
};

function slotToForm(slot: Slot): SlotFormState {
  return {
    label: slot.label ?? "",
    priceDollars: ((slot.price_cents ?? 0) / 100).toString(),
    width: (slot.width ?? 1).toString(),
    height: (slot.height ?? 1).toString(),
    x: slot.x == null ? "" : slot.x.toString(),
    y: slot.y == null ? "" : slot.y.toString(),
  };
}

function emptyForm(): SlotFormState {
  return {
    label: "",
    priceDollars: "",
    width: "1",
    height: "1",
    x: "",
    y: "",
  };
}

function parseIntOrNull(v: string): number | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parsePriceCents(v: string): number | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

const OrganizerSlotsPage: React.FC = () => {
  const params = useParams<{ eventId: string }>();
  const eventId = useMemo(
    () => (params.eventId ? Number(params.eventId) : NaN),
    [params.eventId]
  );

  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<SlotFormState>(emptyForm);

  const [editRows, setEditRows] = useState<Record<number, SlotFormState>>({});
  const [rowSaving, setRowSaving] = useState<Set<number>>(new Set());
  const [rowError, setRowError] = useState<Record<number, string | null>>({});

  // ---------------------------------------------------------------------------
  // Load slots
  // ---------------------------------------------------------------------------

  async function loadSlots() {
    if (!Number.isFinite(eventId)) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiGet<Slot[]>(`/organizer/events/${eventId}/slots`);
      setSlots(data);
    } catch (err: any) {
      console.error("Failed to load slots", err);
      setLoadError(err?.message ?? "Failed to load slots");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // ---------------------------------------------------------------------------
  // Create slot
  // ---------------------------------------------------------------------------

  function updateCreateField<K extends keyof SlotFormState>(
    key: K,
    value: SlotFormState[K]
  ) {
    setCreateForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreateSlot(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(eventId)) return;

    const priceCents = parsePriceCents(createForm.priceDollars);
    if (priceCents == null) {
      setCreateError("Price must be a valid number in dollars.");
      return;
    }

    const width = parseIntOrNull(createForm.width) ?? 1;
    const height = parseIntOrNull(createForm.height) ?? 1;
    const x = parseIntOrNull(createForm.x);
    const y = parseIntOrNull(createForm.y);

    const body = {
      label: createForm.label.trim() || "Booth",
      price_cents: priceCents,
      width,
      height,
      x,
      y,
    };

    setCreating(true);
    setCreateError(null);
    try {
      await apiPost<Slot>(`/organizer/events/${eventId}/slots`, body);
      setCreateForm(emptyForm());
      await loadSlots();
    } catch (err: any) {
      console.error("Failed to create slot", err);
      setCreateError(err?.message ?? "Failed to create slot");
    } finally {
      setCreating(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Edit helpers
  // ---------------------------------------------------------------------------

  function beginEdit(slot: Slot) {
    setEditRows((prev) => ({
      ...prev,
      [slot.id]: prev[slot.id] ?? slotToForm(slot),
    }));
    setRowError((prev) => ({ ...prev, [slot.id]: null }));
  }

  function cancelEdit(id: number) {
    setEditRows((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    setRowError((prev) => ({ ...prev, [id]: null }));
  }

  function updateEditField<K extends keyof SlotFormState>(
    id: number,
    key: K,
    value: SlotFormState[K]
  ) {
    setEditRows((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? emptyForm()),
        [key]: value,
      },
    }));
  }

  async function saveEdit(id: number) {
    const form = editRows[id];
    if (!form) return;

    const priceCents = parsePriceCents(form.priceDollars);
    if (priceCents == null) {
      setRowError((prev) => ({ ...prev, [id]: "Price must be a valid number." }));
      return;
    }

    const width = parseIntOrNull(form.width) ?? 1;
    const height = parseIntOrNull(form.height) ?? 1;
    const x = parseIntOrNull(form.x);
    const y = parseIntOrNull(form.y);

    const body = {
      label: form.label.trim() || "Booth",
      price_cents: priceCents,
      width,
      height,
      x,
      y,
    };

    setRowSaving((prev) => new Set(prev).add(id));
    setRowError((prev) => ({ ...prev, [id]: null }));
    try {
      await apiFetch<Slot>(`/organizer/slots/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await loadSlots();
      cancelEdit(id);
    } catch (err: any) {
      console.error("Failed to save slot", err);
      setRowError((prev) => ({
        ...prev,
        [id]: err?.message ?? "Failed to save slot",
      }));
    } finally {
      setRowSaving((prev) => {
        const copy = new Set(prev);
        copy.delete(id);
        return copy;
      });
    }
  }

  async function deleteSlot(id: number) {
    if (!window.confirm("Delete this slot? This cannot be undone.")) return;
    setRowSaving((prev) => new Set(prev).add(id));
    setRowError((prev) => ({ ...prev, [id]: null }));
    try {
      await apiDelete<unknown>(`/organizer/slots/${id}`);
      await loadSlots();
    } catch (err: any) {
      console.error("Failed to delete slot", err);
      setRowError((prev) => ({
        ...prev,
        [id]: err?.message ?? "Failed to delete slot",
      }));
    } finally {
      setRowSaving((prev) => {
        const copy = new Set(prev);
        copy.delete(id);
        return copy;
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!Number.isFinite(eventId)) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Event Slots</h1>
        <p className="text-red-600">Invalid event ID in URL.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Event Slots</h1>
          <p className="text-sm text-gray-600">
            Manage booth / slot layout and pricing for this event.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/organizer/events"
            className="px-3 py-1.5 rounded border text-sm hover:bg-gray-50"
          >
            Back to Events
          </Link>
          <button
            type="button"
            onClick={loadSlots}
            disabled={loading}
            className="px-3 py-1.5 rounded border text-sm bg-white hover:bg-gray-50 disabled:opacity-60"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Failed to load slots: {loadError}
        </div>
      )}

      {/* Create form */}
      <form
        onSubmit={handleCreateSlot}
        className="border rounded-xl p-4 bg-white shadow-sm space-y-3"
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold">Add Slot</h2>
          {createError && (
            <span className="text-xs text-red-600">{createError}</span>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
          <div className="flex flex-col">
            <label className="mb-1 text-xs font-medium">Label</label>
            <input
              className="border rounded px-2 py-1"
              value={createForm.label}
              onChange={(e) => updateCreateField("label", e.target.value)}
              placeholder="A1, B2, etc."
            />
          </div>

          <div className="flex flex-col">
            <label className="mb-1 text-xs font-medium">Price ($)</label>
            <input
              className="border rounded px-2 py-1"
              value={createForm.priceDollars}
              onChange={(e) =>
                updateCreateField("priceDollars", e.target.value)
              }
              placeholder="100"
            />
          </div>

          <div className="flex flex-col">
            <label className="mb-1 text-xs font-medium">Width</label>
            <input
              className="border rounded px-2 py-1"
              value={createForm.width}
              onChange={(e) => updateCreateField("width", e.target.value)}
            />
          </div>

          <div className="flex flex-col">
            <label className="mb-1 text-xs font-medium">Height</label>
            <input
              className="border rounded px-2 py-1"
              value={createForm.height}
              onChange={(e) => updateCreateField("height", e.target.value)}
            />
          </div>

          <div className="flex flex-col">
            <label className="mb-1 text-xs font-medium">X</label>
            <input
              className="border rounded px-2 py-1"
              value={createForm.x}
              onChange={(e) => updateCreateField("x", e.target.value)}
              placeholder="optional"
            />
          </div>

          <div className="flex flex-col">
            <label className="mb-1 text-xs font-medium">Y</label>
            <input
              className="border rounded px-2 py-1"
              value={createForm.y}
              onChange={(e) => updateCreateField("y", e.target.value)}
              placeholder="optional"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={creating}
            className="mt-2 px-4 py-1.5 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
          >
            {creating ? "Adding…" : "Add Slot"}
          </button>
        </div>
      </form>

      {/* Slots table */}
      <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                ID
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                Label
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                Price ($)
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                W
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                H
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                X
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                Y
              </th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {slots.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-4 text-center text-sm text-gray-500"
                >
                  No slots yet. Use “Add Slot” above to create one.
                </td>
              </tr>
            )}

            {slots.map((slot) => {
              const editing = !!editRows[slot.id];
              const form = editRows[slot.id] ?? slotToForm(slot);
              const saving = rowSaving.has(slot.id);
              const error = rowError[slot.id] ?? null;

              return (
                <tr key={slot.id} className="border-t">
                  <td className="px-3 py-2 text-xs text-gray-500">
                    #{slot.id}
                  </td>

                  <td className="px-3 py-2">
                    {editing ? (
                      <input
                        className="border rounded px-2 py-1 w-full"
                        value={form.label}
                        onChange={(e) =>
                          updateEditField(slot.id, "label", e.target.value)
                        }
                      />
                    ) : (
                      slot.label
                    )}
                  </td>

                  <td className="px-3 py-2">
                    {editing ? (
                      <input
                        className="border rounded px-2 py-1 w-full"
                        value={form.priceDollars}
                        onChange={(e) =>
                          updateEditField(
                            slot.id,
                            "priceDollars",
                            e.target.value
                          )
                        }
                      />
                    ) : (
                      (slot.price_cents ?? 0) / 100
                    )}
                  </td>

                  <td className="px-3 py-2">
                    {editing ? (
                      <input
                        className="border rounded px-2 py-1 w-16"
                        value={form.width}
                        onChange={(e) =>
                          updateEditField(slot.id, "width", e.target.value)
                        }
                      />
                    ) : (
                      slot.width
                    )}
                  </td>

                  <td className="px-3 py-2">
                    {editing ? (
                      <input
                        className="border rounded px-2 py-1 w-16"
                        value={form.height}
                        onChange={(e) =>
                          updateEditField(slot.id, "height", e.target.value)
                        }
                      />
                    ) : (
                      slot.height
                    )}
                  </td>

                  <td className="px-3 py-2">
                    {editing ? (
                      <input
                        className="border rounded px-2 py-1 w-16"
                        value={form.x}
                        onChange={(e) =>
                          updateEditField(slot.id, "x", e.target.value)
                        }
                      />
                    ) : slot.x == null ? (
                      "—"
                    ) : (
                      slot.x
                    )}
                  </td>

                  <td className="px-3 py-2">
                    {editing ? (
                      <input
                        className="border rounded px-2 py-1 w-16"
                        value={form.y}
                        onChange={(e) =>
                          updateEditField(slot.id, "y", e.target.value)
                        }
                      />
                    ) : slot.y == null ? (
                      "—"
                    ) : (
                      slot.y
                    )}
                  </td>

                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => saveEdit(slot.id)}
                            disabled={saving}
                            className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={() => cancelEdit(slot.id)}
                            disabled={saving}
                            className="px-2 py-1 text-xs rounded border hover:bg-gray-50 disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => beginEdit(slot)}
                            className="px-2 py-1 text-xs rounded border hover:bg-gray-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSlot(slot.id)}
                            disabled={saving}
                            className="px-2 py-1 text-xs rounded border border-red-400 text-red-600 hover:bg-red-50 disabled:opacity-60"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                    {error && (
                      <div className="mt-1 text-xs text-red-600 text-right">
                        {error}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OrganizerSlotsPage;
