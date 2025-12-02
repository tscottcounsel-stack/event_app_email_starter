export default function TestUI() {
  return (
    <div className="min-h-[60vh] p-6">
      {/* Responsive grid: 1 → 2 → 3 cols */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {/* Card 1 */}
        <div className="rounded-2xl border bg-white p-6 shadow transition
                        hover:shadow-lg focus-within:ring-2 focus-within:ring-blue-500">
          <h2 className="mb-2 text-xl font-semibold">Responsive Card</h2>
          <p className="mb-4 text-sm text-gray-600">
            Resize the window: this grid becomes 1/2/3 columns at <code>sm</code>/<code>lg</code>.
          </p>

          <button
            className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium
                       transition active:scale-95
                       hover:bg-blue-50 hover:text-blue-700
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <span>Hover & Focus</span>
          </button>
        </div>

        {/* Card 2 with group/hover */}
        <a
          href="#"
          className="group rounded-2xl border bg-white p-6 shadow transition hover:shadow-lg"
        >
          <h2 className="mb-2 text-xl font-semibold">Group Hover</h2>
          <p className="text-sm text-gray-600">
            The arrow changes on <span className="font-medium">.group-hover</span>.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 text-blue-600">
            Learn more
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </div>
        </a>

        {/* Card 3 with badges & disabled state */}
        <div className="rounded-2xl border bg-white p-6 shadow transition hover:shadow-lg">
          <h2 className="mb-3 text-xl font-semibold">States & Badges</h2>
          <div className="mb-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs">neutral</span>
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs text-green-800">success</span>
            <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs text-yellow-800">warning</span>
            <span className="rounded-full bg-red-100 px-3 py-1 text-xs text-red-800">error</span>
          </div>

          <button
            disabled
            className="inline-flex items-center rounded-lg bg-gray-200 px-4 py-2 text-sm text-gray-500
                       disabled:cursor-not-allowed disabled:opacity-70"
          >
            Disabled Button
          </button>
        </div>
      </div>
    </div>
  );
}
