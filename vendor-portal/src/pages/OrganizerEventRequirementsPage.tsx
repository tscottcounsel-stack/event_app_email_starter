// src/pages/OrganizerEventRequirementsPage.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE =
  import.meta.env.VITE_API_BASE || "https://event-app-api-production-ccce.up.railway.app";

type RequirementItem = {
  id: string;
  text: string;
  required?: boolean;
};

type DocumentItem = {
  id: string;
  name: string;
  required?: boolean;
  dueBy?: string;
};

type RequirementTemplate = {
  id: string;
  name: string;
  description?: string;
  compliance: RequirementItem[];
  documents: DocumentItem[];
};

type RequirementsPayload = {
  requirements: {
    compliance: RequirementItem[];
    documents: DocumentItem[];
  };
  version: number;
};

type OrganizerEventSummary = {
  id?: number | string;
  event_id?: number | string;
  title?: string;
  name?: string;
  event_name?: string;
  organizer_email?: string;
  owner_email?: string;
  organizer_id?: number | string;
  owner_id?: number | string;
};

const BUILT_IN_TEMPLATES: RequirementTemplate[] = [
  {
    id: "tech-expo-exhibitions",
    name: "Tech / Startup Expo — Exhibitions",
    description: "Demo-heavy, power-friendly exhibitor setup.",
    compliance: [
      { id: "business_license", text: "Business license or registration", required: true },
      { id: "insurance", text: "Certificate of insurance", required: true },
      { id: "electrical_safety", text: "Electrical equipment safety compliance", required: true },
    ],
    documents: [
      { id: "insurance_doc", name: "Insurance certificate", required: true },
      { id: "setup_plan", name: "Booth setup plan", required: false },
    ],
  },
  {
    id: "food-market",
    name: "Food Market / Festival",
    description: "Food service compliance and health coverage.",
    compliance: [
      { id: "business_license", text: "Business license", required: true },
      { id: "food_permit", text: "Temporary food permit", required: true },
      { id: "liability", text: "General liability insurance", required: true },
    ],
    documents: [
      { id: "menu", name: "Menu / product list", required: false },
      { id: "permit_doc", name: "Food permit upload", required: true },
    ],
  },
  {
    id: "art-market",
    name: "Art / Maker Market",
    description: "Simple handmade goods / maker event default.",
    compliance: [
      { id: "business_license", text: "Business registration (if applicable)", required: false },
      { id: "original_work", text: "All work must be original or properly licensed", required: true },
    ],
    documents: [{ id: "product_photos", name: "Sample product photos", required: false }],
  },
];

function normalizeId(v: unknown) {
  return String(v ?? "").trim();
}

function safeJsonParse<T = any>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function cloneTemplate(template: RequirementTemplate) {
  return {
    compliance: template.compliance.map((c) => ({ ...c })),
    documents: template.documents.map((d) => ({ ...d })),
  };
}

function normalizeRequirementItems(list: any): RequirementItem[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      const text = String(item?.text || item?.label || "").trim();
      const id = normalizeId(item?.id || text);
      if (!text || !id) return null;
      return { id, text, required: !!item?.required } as RequirementItem;
    })
    .filter(Boolean) as RequirementItem[];
}

function normalizeDocumentItems(list: any): DocumentItem[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      const name = String(item?.name || "").trim();
      const id = normalizeId(item?.id || name);
      if (!name || !id) return null;
      return {
        id,
        name,
        required: !!item?.required,
        dueBy: item?.dueBy ? String(item.dueBy) : item?.due_by ? String(item.due_by) : undefined,
      } as DocumentItem;
    })
    .filter(Boolean) as DocumentItem[];
}

function normalizeRequirementsPayload(raw: any): RequirementsPayload {
  const req =
    raw?.requirements && typeof raw.requirements === "object" ? raw.requirements : raw || {};

  return {
    requirements: {
      compliance: normalizeRequirementItems(req?.compliance || []),
      documents: normalizeDocumentItems(req?.documents || []),
    },
    version: Number(raw?.version || req?.version || 1) || 1,
  };
}

function makeLocalStorageKey(eventId: string) {
  return `organizer:event:${eventId}:requirements`;
}

function getEventIdFromSummary(event: OrganizerEventSummary | null | undefined): string {
  return normalizeId(event?.id || event?.event_id);
}

function getEventDisplayName(event: OrganizerEventSummary | null | undefined): string {
  return String(event?.title || event?.name || event?.event_name || "").trim();
}

export default function OrganizerEventRequirementsPage() {
  const navigate = useNavigate();
  const params = useParams();
  const eventId = normalizeId(params.eventId);

  const [compliance, setCompliance] = useState<RequirementItem[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [version, setVersion] = useState<number>(1);

  const [builtInTemplateId, setBuiltInTemplateId] = useState<string>(BUILT_IN_TEMPLATES[0]?.id || "");
  const [savedTemplates, setSavedTemplates] = useState<RequirementTemplate[]>([]);
  const [savedTemplateId, setSavedTemplateId] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [backendMode, setBackendMode] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [resolvedEventId, setResolvedEventId] = useState<string>(eventId);
  const [eventTitle, setEventTitle] = useState<string>("");

  const redirectAttemptedRef = useRef(false);

  const authHeaders = useMemo(() => buildAuthHeaders(), []);
  const hasAuth =
    !!(authHeaders as any)?.Authorization ||
    !!(authHeaders as any)?.["x-user-email"] ||
    !!(authHeaders as any)?.["x-user-id"];

  const templatePreview = useMemo(() => {
    return BUILT_IN_TEMPLATES.find((t) => t.id === builtInTemplateId) || BUILT_IN_TEMPLATES[0] || null;
  }, [builtInTemplateId]);

  useEffect(() => {
    setResolvedEventId(eventId);
    setEventTitle("");
    redirectAttemptedRef.current = false;
  }, [eventId]);

  const findValidEvent = useCallback(async () => {
    const res = await fetch(`${API_BASE}/organizer/events`, {
      method: "GET",
      headers: {
        ...buildAuthHeaders(),
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Could not load organizer events (${res.status})`);
    }

    const data = await res.json().catch(() => null);
    const events = Array.isArray(data?.events) ? (data.events as OrganizerEventSummary[]) : [];

    return {
      events,
      matched: events.find((ev) => getEventIdFromSummary(ev) === eventId) || null,
      fallback: events.find((ev) => Number(getEventIdFromSummary(ev)) > 0) || null,
    };
  }, [eventId]);

  const recoverToValidEvent = useCallback(async () => {
    if (redirecting || redirectAttemptedRef.current) return false;
    redirectAttemptedRef.current = true;
    setRedirecting(true);

    try {
      const { fallback } = await findValidEvent();
      const nextId = getEventIdFromSummary(fallback);
      if (!nextId || nextId === eventId) return false;

      const nextName = getEventDisplayName(fallback);
      setMessage(
        nextName
          ? `Event ${eventId} no longer exists after redeploy. Redirecting to ${nextName} (Event ${nextId})…`
          : `Event ${eventId} no longer exists after redeploy. Redirecting to Event ${nextId}…`
      );
      navigate(`/organizer/events/${nextId}/requirements`, { replace: true });
      return true;
    } catch {
      return false;
    } finally {
      setRedirecting(false);
    }
  }, [eventId, findValidEvent, navigate, redirecting]);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/organizer/requirement-templates`, {
        method: "GET",
        headers: {
          ...buildAuthHeaders(),
          Accept: "application/json",
        },
      });

      if (!res.ok) return;

      const data = await res.json().catch(() => null);
      const rawItems = Array.isArray(data?.templates) ? data.templates : Array.isArray(data) ? data : [];

      const normalized = rawItems
        .map((item: any) => {
          const id = normalizeId(item?.id || item?.template_id || item?.name);
          const name = String(item?.name || "Untitled template").trim();
          if (!id) return null;
          return {
            id,
            name,
            description: String(item?.description || "").trim(),
            compliance: normalizeRequirementItems(item?.requirements?.compliance || item?.compliance || []),
            documents: normalizeDocumentItems(item?.requirements?.documents || item?.documents || []),
          } as RequirementTemplate;
        })
        .filter(Boolean) as RequirementTemplate[];

      setSavedTemplates(normalized);
      if (normalized.length && !savedTemplateId) {
        setSavedTemplateId(normalized[0].id);
      }
    } catch {
      // ignore template load failures
    }
  }, [savedTemplateId]);

  const loadRequirements = useCallback(async () => {
    if (!eventId) {
      setLoading(false);
      setError("Missing event ID.");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);
    setSavedOk(false);

    const localKey = makeLocalStorageKey(eventId);

    try {
      if (backendMode) {
        const { matched } = await findValidEvent();
        if (!matched) {
          const redirected = await recoverToValidEvent();
          if (!redirected) {
            throw new Error(
              `Event ${eventId} was not found on the backend. It was likely wiped during redeploy. Open Organizer Events and choose a current event.`
            );
          }
          return;
        }

        const currentEventId = getEventIdFromSummary(matched) || eventId;
        const currentEventName = getEventDisplayName(matched);
        setResolvedEventId(currentEventId);
        setEventTitle(currentEventName);

        const res = await fetch(`${API_BASE}/organizer/events/${currentEventId}/requirements`, {
          method: "GET",
          headers: {
            ...buildAuthHeaders(),
            Accept: "application/json",
          },
        });

        if (res.status === 404) {
          setCompliance([]);
          setDocuments([]);
          setVersion(1);
          localStorage.removeItem(localKey);
          setMessage(
            currentEventName
              ? `No saved requirements found yet for ${currentEventName}. You can configure them now.`
              : `No saved requirements found yet for Event ${currentEventId}. You can configure them now.`
          );
          return;
        }

        const data = await res.json().catch(() => null);

        if (!res.ok) {
          const detail =
            (typeof data?.detail === "string" && data.detail) ||
            `Failed to load requirements (${res.status})`;
          throw new Error(detail);
        }

        const normalized = normalizeRequirementsPayload(data);
        setCompliance(normalized.requirements.compliance);
        setDocuments(normalized.requirements.documents);
        setVersion(Number(normalized.version || 1));
        localStorage.setItem(localKey, JSON.stringify(normalized));
      } else {
        const local = safeJsonParse<RequirementsPayload>(localStorage.getItem(localKey));
        if (local) {
          const normalized = normalizeRequirementsPayload(local);
          setCompliance(normalized.requirements.compliance);
          setDocuments(normalized.requirements.documents);
          setVersion(Number(normalized.version || 1));
        } else {
          setCompliance([]);
          setDocuments([]);
          setVersion(1);
        }
      }
    } catch (err: any) {
      setError(err?.message || "Could not load requirements.");
    } finally {
      setLoading(false);
    }
  }, [backendMode, eventId, findValidEvent, recoverToValidEvent]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    void loadRequirements();
  }, [loadRequirements]);

  function applyBuiltInTemplate() {
    const template = BUILT_IN_TEMPLATES.find((t) => t.id === builtInTemplateId);
    if (!template) return;
    const cloned = cloneTemplate(template);
    setCompliance(cloned.compliance);
    setDocuments(cloned.documents);
    setMessage(`Loaded built-in template: ${template.name}`);
    setError(null);
    setSavedOk(false);
  }

  function applySavedTemplate() {
    const template = savedTemplates.find((t) => t.id === savedTemplateId);
    if (!template) return;
    const cloned = cloneTemplate(template);
    setCompliance(cloned.compliance);
    setDocuments(cloned.documents);
    setMessage(`Loaded saved template: ${template.name}`);
    setError(null);
    setSavedOk(false);
  }

  async function saveTemplate(mode: "create" | "update") {
    const name =
      mode === "create"
        ? window.prompt("Template name")
        : savedTemplates.find((t) => t.id === savedTemplateId)?.name || "";

    if (!name) return;

    try {
      const url =
        mode === "create"
          ? `${API_BASE}/organizer/requirement-templates`
          : `${API_BASE}/organizer/requirement-templates/${encodeURIComponent(savedTemplateId)}`;

      const method = mode === "create" ? "POST" : "PUT";

      const res = await fetch(url, {
        method,
        headers: {
          ...buildAuthHeaders(),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name,
          requirements: {
            compliance,
            documents,
          },
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const detail =
          (typeof data?.detail === "string" && data.detail) ||
          `Template save failed (${res.status})`;
        throw new Error(detail);
      }

      setMessage(mode === "create" ? "Template saved." : "Template updated.");
      setError(null);
      await loadTemplates();
    } catch (err: any) {
      setError(err?.message || "Could not save template.");
    }
  }

  async function deleteTemplate() {
    if (!savedTemplateId) return;
    if (!window.confirm("Delete selected template?")) return;

    try {
      const res = await fetch(
        `${API_BASE}/organizer/requirement-templates/${encodeURIComponent(savedTemplateId)}`,
        {
          method: "DELETE",
          headers: {
            ...buildAuthHeaders(),
            Accept: "application/json",
          },
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const detail =
          (typeof data?.detail === "string" && data.detail) ||
          `Template delete failed (${res.status})`;
        throw new Error(detail);
      }

      setMessage("Template deleted.");
      setError(null);
      setSavedTemplateId("");
      await loadTemplates();
    } catch (err: any) {
      setError(err?.message || "Could not delete template.");
    }
  }

  function addCompliance() {
    const text = window.prompt("Compliance requirement text");
    if (!text) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    setCompliance((prev) => [
      ...prev,
      {
        id: normalizeId(`${trimmed}-${Date.now()}`),
        text: trimmed,
        required: true,
      },
    ]);
    setSavedOk(false);
  }

  function addDocument() {
    const name = window.prompt("Document requirement name");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    setDocuments((prev) => [
      ...prev,
      {
        id: normalizeId(`${trimmed}-${Date.now()}`),
        name: trimmed,
        required: true,
      },
    ]);
    setSavedOk(false);
  }

  function updateCompliance(idx: number, patch: Partial<RequirementItem>) {
    setCompliance((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
    setSavedOk(false);
  }

  function updateDocument(idx: number, patch: Partial<DocumentItem>) {
    setDocuments((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
    setSavedOk(false);
  }

  function removeCompliance(idx: number) {
    setCompliance((prev) => prev.filter((_, i) => i !== idx));
    setSavedOk(false);
  }

  function removeDocument(idx: number) {
    setDocuments((prev) => prev.filter((_, i) => i !== idx));
    setSavedOk(false);
  }

  async function onSave() {
    const activeEventId = resolvedEventId || eventId;

    if (!activeEventId) {
      setError("Missing event ID.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    setSavedOk(false);

    const payload: RequirementsPayload = {
      requirements: {
        compliance,
        documents,
      },
      version: Number(version || 1),
    };

    try {
      localStorage.setItem(makeLocalStorageKey(activeEventId), JSON.stringify(payload));

      if (!backendMode) {
        setMessage("Saved locally. Redirecting to layout…");
        setSavedOk(true);
        navigate(`/organizer/events/${activeEventId}/layout`);
        return;
      }

      const headers = {
        ...buildAuthHeaders(),
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      let res = await fetch(`${API_BASE}/organizer/events/${activeEventId}/requirements`, {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
      });

      let data = await res.json().catch(() => null);

      if (res.status === 404) {
        const redirected = await recoverToValidEvent();
        if (redirected) return;
      }

      if (!res.ok) {
        res = await fetch(`${API_BASE}/organizer/events/${activeEventId}/requirements`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        data = await res.json().catch(() => null);
      }

      if (!res.ok) {
        const detail =
          (typeof data?.detail === "string" && data.detail) ||
          (typeof data?.message === "string" && data.message) ||
          `Could not save requirements (${res.status})`;
        throw new Error(detail);
      }

      setVersion((v) => Number(v || 1) + 1);
      setSavedOk(true);
      setMessage("Requirements saved. Redirecting to booth layout…");
      navigate(`/organizer/events/${activeEventId}/layout`);
    } catch (err: any) {
      setError(err?.message || "Could not save requirements.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-gray-600">Loading requirements…</div>;
  }

  const activeEventId = resolvedEventId || eventId;

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between border-b pb-5">
        <button
          className="text-sm font-medium text-gray-700"
          onClick={() => navigate("/organizer/events")}
        >
          ← Back
        </button>

        <div className="text-center">
          <div className="text-3xl font-semibold">Event Setup & Vendor Requirements</div>
          <div className="mt-1 text-sm text-gray-500">
            Event ID: {activeEventId || "—"}
            {eventTitle ? ` • ${eventTitle}` : ""}
          </div>
        </div>

        <button
          className="rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => void onSave()}
          disabled={saving || redirecting}
        >
          {saving ? "Saving..." : "Save Configuration"}
        </button>
      </div>

      {!hasAuth ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
          Organizer auth token is missing on this page. Save may fail until you sign in again.
        </div>
      ) : null}

      {message ? (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          {error}
        </div>
      ) : null}

      <div className="rounded-[28px] border bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="text-xl font-semibold">Requirement Templates</div>
            <div className="mt-1 max-w-3xl text-sm text-gray-600">
              Save this event’s requirements to your backend, reuse them in future events, and
              choose from expanded built-in presets.
            </div>
          </div>

          <button
            className="rounded-full border px-4 py-2 text-sm text-gray-700"
            onClick={() => setBackendMode((v) => !v)}
          >
            {backendMode ? "Backend mode" : "Local mode"}
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border p-4">
            <div className="text-xl font-semibold">Built-in Templates</div>
            <div className="mt-1 text-sm text-gray-600">Expanded defaults beyond Tech / Food / Art.</div>

            <div className="mt-4 flex gap-3">
              <select
                className="flex-1 rounded-2xl border px-4 py-3"
                value={builtInTemplateId}
                onChange={(e) => setBuiltInTemplateId(e.target.value)}
              >
                {BUILT_IN_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              <button
                className="rounded-2xl border px-5 py-3 font-semibold"
                onClick={applyBuiltInTemplate}
              >
                Load built-in
              </button>
            </div>

            <div className="mt-4 rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700">
              {templatePreview?.name ? (
                <>
                  <div className="font-semibold">{templatePreview.name}</div>
                  <div className="mt-1">{templatePreview.description}</div>
                </>
              ) : (
                "No preview available."
              )}
            </div>
          </div>

          <div className="rounded-3xl border p-4">
            <div className="text-xl font-semibold">Saved Organizer Templates</div>
            <div className="mt-1 text-sm text-gray-600">
              Persist these in your backend so they work across devices.
            </div>

            <div className="mt-4 flex gap-3">
              <select
                className="flex-1 rounded-2xl border px-4 py-3"
                value={savedTemplateId}
                onChange={(e) => setSavedTemplateId(e.target.value)}
              >
                {!savedTemplates.length ? (
                  <option value="">No saved templates yet</option>
                ) : null}
                {savedTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              <button
                className="rounded-2xl border px-5 py-3 font-semibold"
                onClick={applySavedTemplate}
                disabled={!savedTemplateId}
              >
                Load saved
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                className="rounded-2xl bg-emerald-600 px-5 py-3 font-semibold text-white"
                onClick={() => void saveTemplate("create")}
              >
                Save As Template
              </button>

              <button
                className="rounded-2xl border px-5 py-3 font-semibold"
                onClick={() => void saveTemplate("update")}
                disabled={!savedTemplateId}
              >
                Update Selected
              </button>

              <button
                className="rounded-2xl border px-5 py-3 font-semibold"
                onClick={() => void deleteTemplate()}
                disabled={!savedTemplateId}
              >
                Delete Selected
              </button>
            </div>

            <div className="mt-4 rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700">
              Saved templates load from GET /organizer/requirement-templates
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-xl font-semibold">Compliance Items</div>
              <button
                className="rounded-xl border px-4 py-2 text-sm font-medium"
                onClick={addCompliance}
              >
                + Add
              </button>
            </div>

            <div className="space-y-3">
              {compliance.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-4 text-sm text-gray-500">
                  No compliance items yet.
                </div>
              ) : null}

              {compliance.map((item, idx) => (
                <div key={item.id || idx} className="rounded-2xl border p-4">
                  <div className="flex gap-3">
                    <input
                      className="flex-1 rounded-xl border px-3 py-2"
                      value={item.text}
                      onChange={(e) => updateCompliance(idx, { text: e.target.value })}
                      placeholder="Requirement text"
                    />
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!item.required}
                        onChange={(e) => updateCompliance(idx, { required: e.target.checked })}
                      />
                      Required
                    </label>
                    <button
                      className="rounded-xl border px-3 py-2 text-sm"
                      onClick={() => removeCompliance(idx)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-xl font-semibold">Document Requirements</div>
              <button
                className="rounded-xl border px-4 py-2 text-sm font-medium"
                onClick={addDocument}
              >
                + Add
              </button>
            </div>

            <div className="space-y-3">
              {documents.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-4 text-sm text-gray-500">
                  No document requirements yet.
                </div>
              ) : null}

              {documents.map((item, idx) => (
                <div key={item.id || idx} className="rounded-2xl border p-4">
                  <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
                    <input
                      className="rounded-xl border px-3 py-2"
                      value={item.name}
                      onChange={(e) => updateDocument(idx, { name: e.target.value })}
                      placeholder="Document name"
                    />
                    <input
                      className="rounded-xl border px-3 py-2"
                      value={item.dueBy || ""}
                      onChange={(e) => updateDocument(idx, { dueBy: e.target.value })}
                      placeholder="Due by (optional)"
                    />
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!item.required}
                        onChange={(e) => updateDocument(idx, { required: e.target.checked })}
                      />
                      Required
                    </label>
                    <button
                      className="rounded-xl border px-3 py-2 text-sm"
                      onClick={() => removeDocument(idx)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t pt-6">
          <div className="text-sm text-gray-500">
            After saving, this page will take you directly to booth layout.
          </div>

          <div className="flex gap-3">
            <button
              className="rounded-2xl border px-5 py-3 font-semibold"
              onClick={() => navigate(`/organizer/events/${activeEventId}/layout`)}
              disabled={!activeEventId}
            >
              Go to Booth Layout
            </button>

            <button
              className="rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void onSave()}
              disabled={saving || redirecting}
            >
              {saving ? "Saving..." : "Save Configuration"}
            </button>
          </div>
        </div>

        {savedOk ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
            Requirements saved successfully.
          </div>
        ) : null}
      </div>
    </div>
  );
}
