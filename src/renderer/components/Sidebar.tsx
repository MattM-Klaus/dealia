import React from 'react';
import { NavLink } from 'react-router-dom';

const links = [
  { to: '/dashboard',          label: 'Renewals Dashboard',  icon: '📊' },
  { to: '/accounts',           label: 'Accounts',            icon: '🏢' },
  { to: '/forecast-dashboard', label: 'Forecast Dashboard',  icon: '🎯' },
  { to: '/pipeline',           label: 'Pipeline',            icon: '📈' },
  { to: '/closed-won',         label: 'Closed Won',          icon: '✅' },
  { to: '/closed-lost',        label: 'Closed Lost',         icon: '❌' },
  { to: '/analytics',          label: 'Analytics',           icon: '🔍' },
  { to: '/weekly-trends',      label: 'What Changed?',       icon: '📊' },
  { to: '/commission-reconciliation', label: 'Commission Recon', icon: '💰' },
  { to: '/dealia',             label: 'AskDealia',           icon: '✨' },
  { to: '/history',            label: 'History',             icon: '🔔' },
  { to: '/settings',           label: 'Settings',            icon: '⚙️' },
];

const DealiaLogo = () => (
  <svg width="140" height="36" viewBox="0 0 140 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style={{stopColor: '#3B82F6', stopOpacity: 1}} />
        <stop offset="100%" style={{stopColor: '#10B981', stopOpacity: 1}} />
      </linearGradient>
    </defs>
    <g transform="translate(2, 4)">
      <path d="M4 4 L20 4 L16 14 L8 14 Z" fill="url(#logoGradient)" opacity="0.2"/>
      <path d="M8 14 L16 14 L14 22 L10 22 Z" fill="url(#logoGradient)" opacity="0.4"/>
      <path d="M10 22 L14 22 L13 28 L11 28 Z" fill="url(#logoGradient)"/>
      <path d="M18 26 L22 18 L26 22" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <circle cx="22" cy="18" r="2" fill="#10B981"/>
    </g>
    <text x="42" y="24" fontFamily="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif" fontSize="20" fontWeight="700" fill="#1F2937" letterSpacing="-0.5">Dealia</text>
    <circle cx="114" cy="23" r="2.5" fill="url(#logoGradient)"/>
  </svg>
);

export default function Sidebar() {
  return (
    <aside className="w-52 bg-white border-r border-gray-200 flex flex-col pt-10 pb-6 px-3 shrink-0">
      <div className="mb-8 px-2">
        <DealiaLogo />
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
