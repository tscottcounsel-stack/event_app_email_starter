import React from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import BoothMapEditor from "../figma/pages/BoothMapEditor";

class PageErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack?: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(err: any) {
    return {
      hasError: true,
      message: err?.message ? String(err.message) : String(err),
      stack: err?.stack ? String(err.stack) : undefined,
    };
  }

  componentDidCatch(err: any) {
    // Keeps the error visible even if React dev overlay is inconsistent
    // eslint-disable-next-line no-console
    console.error("MapEditorPage crashed:", err);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-white p-6">
          <div className="mx-auto max-w-3xl rounded-3xl border border-red-200 bg-red-50 p-6">
            <div className="text-lg font-black text-red-800">
              BoothMapEditor crashed on this route
            </div>
            <div className="mt-2 text-sm font-semibold text-red-700">
              {this.state.message}
            </div>

            {this.state.stack && (
              <pre className="mt-4 whitespace-pre-wrap rounded-2xl border border-red-200 bg-white p-4 text-xs text-slate-900">
                {this.state.stack}
              </pre>
            )}

            <div className="mt-4 text-sm font-semibold text-slate-700">
              Fix this error and the layout page will render normally.
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function MapEditorPage() {
  const navigate = useNavigate();
  const { eventId } = useParams<{ eventId: string }>();

  if (!eventId) return <Navigate to="/organizer/dashboard" replace />;

  return (
    <div className="fixed inset-0 z-[60] bg-white">
      {/* Small header so you always know the route rendered */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <button
          type="button"
          onClick={() => navigate(`/organizer/events/${eventId}/details`)}
          className="text-sm font-black text-slate-700 hover:text-slate-900"
        >
          ← Back to Event
        </button>
        <div className="text-sm font-black text-slate-900">
          Layout Editor • Event {eventId}
        </div>
        <div className="w-[120px]" />
      </div>

      <div className="h-[calc(100vh-52px)] w-full overflow-hidden">
        <PageErrorBoundary>
          <BoothMapEditor key={eventId} />
        </PageErrorBoundary>
      </div>
    </div>
  );
}
