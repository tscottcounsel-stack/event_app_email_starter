// vendor-portal/src/pages/OrganizerEventsPage.tsx
import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";

type OrganizerEvent = {
  id: number;
  name: string;
  location: string;
  startDate: string; // ISO string
  endDate: string;
  applications: number;
  approved: number;
  pending: number;
  revenueCents: number;
};

const mockEvents: OrganizerEvent[] = [
  {
    id: 52,
    name: "Winter Party",
    location: "home",
    startDate: "2025-01-26",
    endDate: "2025-01-27",
    applications: 8,
    approved: 4,
    pending: 3,
    revenueCents: 60000,
  },
  {
    id: 49,
    name: "Atlanta Fall Festival",
    location: "Atlanta, GA",
    startDate: "2025-11-09",
    endDate: "2025-11-10",
    applications: 25,
    approved: 18,
    pending: 5,
    revenueCents: 210000,
  },
];

const OrganizerEventsPage: React.FC = () => {
  const navigate = useNavigate();

  const stats = useMemo(() => {
    const totalEvents = mockEvents.length;

    const now = new Date();
    const upcoming = mockEvents.filter(
      (e) => new Date(e.startDate).getTime() >= now.getTime()
    ).length;
    const past = totalEvents - upcoming;

    const totalApplications = mockEvents.reduce(
      (sum, e) => sum + e.applications,
      0
    );
    const totalApproved = mockEvents.reduce(
      (sum, e) => sum + e.approved,
      0
    );
    const totalRevenueCents = mockEvents.reduce(
      (sum, e) => sum + e.revenueCents,
      0
    );

    return {
      totalEvents,
      upcoming,
      past,
      totalApplications,
      totalApproved,
      totalRevenueCents,
    };
  }, []);

  function formatMoney(cents: number): string {
    return `$${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="w-full border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-sm">
              EP
            </div>
            <span className="font-semibold text-slate-900">Event Portal</span>
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              Organizer view
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Page title */}
        <div>
          <h1 className="text-xl font-semibold mb-1">Your events</h1>
          <p className="text-sm text-slate-600">
            Overview of your events, applications, and revenue. Click an event
            to jump into applications, maps, and payments.
          </p>
        </div>

        {/* Summary cards */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="text-xs text-slate-500 mb-1">Events</div>
            <div className="text-2xl font-semibold text-slate-900">
              {stats.totalEvents}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {stats.upcoming} upcoming • {stats.past} past
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="text-xs text-slate-500 mb-1">Applications</div>
            <div className="text-2xl font-semibold text-slate-900">
              {stats.totalApplications}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {stats.totalApproved} approved so far
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="text-xs text-slate-500 mb-1">Revenue</div>
            <div className="text-2xl font-semibold text-slate-900">
              {formatMoney(stats.totalRevenueCents)}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Across all active events
            </div>
          </div>
        </section>

        {/* Events table / list */}
        <section className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Event list
            </h2>
            <span className="text-xs text-slate-500">
              Click a tool to open applications, dashboard, or map editor.
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {mockEvents.map((event) => (
              <div
                key={event.id}
                className="py-3 flex items-center justify-between gap-4"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {event.name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {event.location} •{" "}
                    {new Date(event.startDate).toLocaleDateString()} –{" "}
                    {new Date(event.endDate).toLocaleDateString()}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {event.applications} applications • {event.approved} approved
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    className="px-3 py-1 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() =>
                      console.log("TODO: organizer applications for", event.id)
                    }
                  >
                    Applications
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() =>
                      console.log("TODO: organizer dashboard for", event.id)
                    }
                  >
                    Dashboard
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1 rounded-full border border-emerald-500 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                    onClick={() =>
                      navigate(`/organizer/events/${event.id}/diagram/edit`)
                    }
                  >
                    Map editor
                  </button>
                </div>
              </div>
            ))}

            {mockEvents.length === 0 && (
              <div className="py-8 text-center text-sm text-slate-500">
                No events yet. Create your first event from the organizer tools.
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

export default OrganizerEventsPage;
