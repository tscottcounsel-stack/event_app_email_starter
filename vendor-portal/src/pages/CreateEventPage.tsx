// src/pages/CreateEventPage.tsx
import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";

export function CreateEventPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [venue, setVenue] = useState("");
  const [city, setCity] = useState("");
  const [ticketUrl, setTicketUrl] = useState("");
  const [description, setDescription] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // TODO: later – call your FastAPI /organizer/events endpoint here
    console.log({
      title,
      date,
      venue,
      city,
      ticketUrl,
      description,
    });

    // For now, after "saving", go back to organizer events list
    navigate("/organizer/events");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <nav className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link
            to="/organizer/events"
            className="text-sm text-gray-500 hover:text-gray-900"
          >
            ← Back to Events
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">
            Create New Event
          </h1>
          <div />
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Event basics */}
          <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-6 space-y-4">
            <h2 className="text-xl font-semibold text-gray-900">
              Event Details
            </h2>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Event Title
              </label>
              <input
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Spring Food & Music Festival"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Date / Time
              </label>
              <input
                type="text"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                placeholder="e.g. April 12–14, 10am–8pm"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Description
              </label>
              <textarea
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the vibe, audience, and highlights..."
              />
            </div>
          </div>

          {/* Location + map placeholder */}
          <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-6 space-y-4">
            <h2 className="text-xl font-semibold text-gray-900">Location</h2>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Venue / Location Name
                </label>
                <input
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={venue}
                  onChange={(e) => setVenue(e.target.value)}
                  placeholder="e.g. Marietta Square"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  City
                </label>
                <input
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Atlanta, GA"
                />
              </div>
            </div>

            {/* This is where Google Maps locator will go */}
            <div className="mt-4">
              <div className="h-56 w-full rounded-xl border border-dashed border-gray-300 bg-white flex items-center justify-center text-sm text-gray-400">
                Google Maps locator goes here (LocationPicker component)
              </div>
            </div>
          </div>

          {/* Ticket purchase link */}
          <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-6 space-y-4">
            <h2 className="text-xl font-semibold text-gray-900">
              Ticket Sales
            </h2>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Ticket Purchase Link
              </label>
              <input
                type="url"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={ticketUrl}
                onChange={(e) => setTicketUrl(e.target.value)}
                placeholder="https://..."
              />
              <p className="text-xs text-gray-500">
                Paste your Eventbrite, Ticketmaster, or custom checkout link.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => navigate("/organizer/events")}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              Save Event
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
