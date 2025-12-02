// src/pages/VendorEvents.tsx
import React from "react";
import { Link } from "react-router-dom";

const VendorEvents: React.FC = () => {
  // For now this is a simple placeholder page.
  // Later we can replace this with a real fetch from /vendor/events.
  const demoEvents = [
    { id: 1, name: "Event 1" },
    { id: 10, name: "Event 10" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <h1 className="text-2xl font-semibold mb-4">Events You Can Apply To</h1>
      <p className="text-slate-600 mb-6">
        This is a stub Vendor Events page. You already have the full UI version
        in another component, but this keeps the router happy while we wire
        things up.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {demoEvents.map((ev) => (
          <div
            key={ev.id}
            className="bg-white rounded-2xl shadow p-4 flex flex-col justify-between"
          >
            <div>
              <div className="text-xs uppercase text-slate-400 mb-1">
                Event #{ev.id}
              </div>
              <div className="text-lg font-medium mb-2">{ev.name}</div>
            </div>
            <div className="mt-4 flex justify-end">
              <Link
                to={`/vendor/events/${ev.id}/apply`}
                className="px-4 py-2 rounded-full bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
              >
                Apply to this event
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VendorEvents;
