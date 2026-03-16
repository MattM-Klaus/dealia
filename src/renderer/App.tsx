import React from 'react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Analytics from './pages/Analytics';
import Dealia from './pages/Dealia';
import Pipeline from './pages/Pipeline';
import ClosedWon from './pages/ClosedWon';
import ForecastDashboard from './pages/ForecastDashboard';
import Settings from './pages/Settings';
import History from './pages/History';
import { FilterProvider } from './contexts/FilterContext';

export default function App() {
  return (
    <FilterProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <div className="flex h-screen bg-gray-50 text-gray-900 overflow-hidden">
          <Sidebar />
          <main className="flex-1 flex flex-col overflow-hidden">
            <Routes>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/pipeline" element={<Pipeline />} />
              <Route path="/closed-won" element={<ClosedWon />} />
              <Route path="/forecast-dashboard" element={<ForecastDashboard />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/dealia" element={<Dealia />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/history" element={<History />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </main>
        </div>
      </MemoryRouter>
    </FilterProvider>
  );
}
