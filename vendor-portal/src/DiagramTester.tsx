import React, { useState } from "react";

export default function DiagramTester() {
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:8011");
  const [token, setToken] = useState("");
  const [eventId, setEventId] = useState("");
  const [latest, setLatest] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  function authHeader() {
    return { Authorization: `Bearer ${token}` };
  }

  async function loadCurrent() {
    setLoading(true);
    setStatus("Loading current...");
    try {
      const res = await fetch(`${baseUrl}/organizer/events/${eventId}/diagram`, {
        headers: authHeader(),
      });
      const data = await res.json();
      setLatest(data);
      setStatus("Loaded current.");
    } catch (e: any) {
      setStatus("Error loading current: " + e.message);
    }
    setLoading(false);
  }

  async function loadHistory() {
    setLoading(true);
    setStatus("Loading history...");
    try {
      const res = await fetch(
        `${baseUrl}/organizer/events/${eventId}/diagram/_history?limit=25`,
        { headers: authHeader() }
      );
      const data = await res.json();
      setHistory(data);
      setStatus("Loaded history.");
    } catch (e: any) {
      setStatus("Error loading history: " + e.message);
    }
    setLoading(false);
  }

  async function restoreSelected() {
    if (!selectedId) return;
    setLoading(true);
    setStatus("Restoring...");
    try {
      await fetch(
        `${baseUrl}/organizer/events/${eventId}/diagram/_history/${selectedId}/restore`,
        { method: "POST", headers: authHeader() }
      );
      setStatus("Restored. Reloading current...");
      await loadCurrent();
    } catch (e: any) {
      setStatus("Error restoring: " + e.message);
    }
    setLoading(false);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Connection */}
      <div className="p-4 rounded-lg border bg-white space-y-3">
        <h2 className="text-lg font-semibold">Connection</h2>

        <label className="block text-sm font-medium">Backend Base URL</label>
        <input
          className="w-full px-3 py-2 border rounded"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />

        <label className="block text-sm font-medium">Organizer Token</label>
        <input
          className="w-full px-3 py-2 border rounded"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="paste access_token here"
        />

        <label className="block text-sm font-medium">Event ID</label>
        <input
          className="w-full px-3 py-2 border rounded"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
        />

        <div className="flex gap-3 pt-2">
          <button
            onClick={loadCurrent}
            disabled={loading}
            className="px-4 py-2 rounded bg-slate-900 text-white"
          >
            Load Current
          </button>
          <button
            onClick={loadHistory}
            disabled={loading}
            className="px-4 py-2 rounded bg-slate-600 text-white"
          >
            Load History
          </button>
        </div>

        {status && (
          <div className="text-sm text-slate-600 pt-1">{status}</div>
        )}
      </div>

      {/* Current */}
      {latest && (
        <div className="p-4 rounded-lg border bg-white">
          <h2 className="text-lg font-semibold mb-2">Current Diagram</h2>
          <div className="text-sm text-slate-600">
            <div>image_url: {latest.image_url}</div>
            <div>grid_px: {latest.grid_px}</div>
            <div>notes: {latest.notes}</div>
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="p-4 rounded-lg border bg-white space-y-4">
          <h2 className="text-lg font-semibold">History</h2>

          <div className="space-y-2 max-h-64 overflow-auto border rounded p-2">
            {history.map((h) => (
              <div
                key={h.id}
                className={`p-2 border rounded cursor-pointer ${
                  selectedId === h.id ? "bg-slate-200" : "bg-white"
                }`}
                onClick={() => setSelectedId(h.id)}
              >
                <div className="text-sm font-medium">
                  #{h.id} — {h.created_at}
                </div>
                <div className="text-xs text-slate-600">
                  {h.image_url} | grid_px: {h.grid_px} | notes: {h.notes}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={restoreSelected}
            disabled={!selectedId || loading}
            className="px-4 py-2 rounded bg-green-700 text-white"
          >
            Restore Selected Version
          </button>
        </div>
      )}
    </div>
  );
}
