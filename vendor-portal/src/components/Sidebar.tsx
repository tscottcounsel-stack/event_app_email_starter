import { NavLink } from "react-router-dom";

export default function Sidebar() {
  const base = "block rounded-lg px-3 py-2 text-sm";
  const active = "bg-blue-600 text-white";
  const idle = "hover:bg-gray-100 dark:hover:bg-gray-800";

  return (
    <aside className="hidden w-60 shrink-0 border-r px-3 py-4
                      border-gray-200 dark:border-gray-800 lg:block">
      <div className="space-y-1">
        <NavLink to="/vendor" className={({isActive}) => `${base} ${isActive ? active : idle}`}>
          Vendor Dashboard
        </NavLink>
        <NavLink to="/organizer" className={({isActive}) => `${base} ${isActive ? active : idle}`}>
          Organizer Dashboard
        </NavLink>
        <NavLink to="/" className={({isActive}) => `${base} ${isActive ? active : idle}`}>
          Home
        </NavLink>
      </div>
    </aside>
  );
}
