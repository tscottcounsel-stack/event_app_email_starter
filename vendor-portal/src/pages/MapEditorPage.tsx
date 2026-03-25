// src/pages/MapEditorPage.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { useLocation, useParams } from "react-router-dom";
import BoothMapEditor from "../figma/pages/BoothMapEditor";

/**
 * Error boundary so map crashes don't white-screen the whole organizer shell.
 * This replaces the broken/partial boundary code currently in MapEditorPage.tsx.
 */
class PageErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack?: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "", stack: undefined };
  }

  static getDerivedStateFromError(err: any) {
    return {
      hasError: true,
      message: err?.message ? String(err.message) : String(err),
      stack: err?.stack ? String(err.stack) : undefined,
    };
  }

  componentDidCatch(err: any) {
    // eslint-disable-next-line no-console
    console.error("MapEditorPage crashed:", err);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-white p-6">
          <div className="mx-auto max-w-5xl rounded-2xl border border-slate-200 p-6">
            <div className="text-xl font-black text-slate-900">
              Booth Map Editor crashed
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-700">
              {this.state.message}
            </div>
            {this.state.stack ? (
              <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-xs text-slate-700">
                {this.state.stack}
              </pre>
            ) : null}
          </div>
        </div>
      );
    }

    return this.props.children as any;
  }
}

/**
 * MapEditorPage
 * Wrapper for /organizer/events/:eventId/layout
 *
 * IMPORTANT:
 * - No fixed heights here
 * - No scroll container here
 * - The editor owns scrolling (canvas + right panel)
 */
export default function MapEditorPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const location = useLocation();

  // Remount editor when query changes (e.g. ?assignAppId=77) so it re-inits cleanly
  const key = `${eventId || "no-event"}::${location.search || ""}`;

  return (
    <div
      style={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <PageErrorBoundary>
          <BoothMapEditor key={key} />
        </PageErrorBoundary>
      </div>
    </div>
  );
}





