import React from 'react';
import { NavLink } from 'react-router-dom';
import logo from '../../assets/logo.svg';

const links = [
  { to: '/dashboard',          label: 'Renewals Dashboard',  icon: '📊' },
  { to: '/accounts',           label: 'Accounts',            icon: '🏢' },
  { to: '/forecast-dashboard', label: 'Forecast Dashboard',  icon: '🎯' },
  { to: '/pipeline',           label: 'Pipeline',            icon: '📈' },
  { to: '/closed-won',         label: 'Closed Won',          icon: '✅' },
  { to: '/analytics',          label: 'Analytics',           icon: '🔍' },
  { to: '/dealia',             label: 'AskDealia',           icon: '✨' },
  { to: '/history',            label: 'History',             icon: '🔔' },
  { to: '/settings',           label: 'Settings',            icon: '⚙️' },
];

export default function Sidebar() {
  return (
    <aside className="w-52 bg-white border-r border-gray-200 flex flex-col pt-10 pb-6 px-3 shrink-0">
      <div className="mb-8 px-2">
        <img src={logo} alt="Dealia Logo" className="h-8 mb-1" />
        <p className="text-xs text-gray-400 mt-0.5">ZD AIS Forecasting</p>
      </div>
      <nav className="flex flex-col gap-1">
        {links.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-green-50 text-green-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`
            }
          >
            <span>{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
