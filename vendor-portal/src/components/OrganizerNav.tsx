// src/components/OrganizerNav.tsx
import React from "react";
import { NavLink } from "react-router-dom";

type Props = {
  eventId: number;
};

const linkClass =
  "px-3 py-1 rounded-md text-sm font-medium border border-transparent hover:bg-slate-100";

export const OrganizerNav: React.FC<Props> = ({ eventId }) => {
  return (
    <div className="mb-4 flex gap-2">
      <NavLink
        to="/organizer/applications"
        className={({ isActive }) =>
          isActive
            ? `${linkClass} bg-white border-slate-300`
            : `${linkClass} text-slate-600`
        }
      >
        Applications
      </NavLink>

      <NavLink
        to="/organizer/diagram"
        className={({ isActive }) =>
          isActive
            ? `${linkClass} bg-white border-slate-300`
            : `${linkClass} text-slate-600`
        }
      >
        Diagram
      </NavLink>
    </div>
  );
};
