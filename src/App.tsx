/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  BatteryCharging,
  BrainCircuit,
  Cpu,
  FlaskConical,
  Grid,
  LayoutDashboard,
  Menu,
  Sliders,
  X,
} from 'lucide-react';
import {
  ActiveInjectedFaults,
  BatteryTelemetrySnapshot,
  ChargingSessionRecord,
  FaultEventRecord,
  MLModelMetadata,
  OperationState,
  SafetyThresholds,
  SoHPredictionResult,
} from './types/bms';
import {
  CellAnalysisView,
  DashboardOverviewView,
  LiveMonitoringView,
} from './components/PrimaryViews';
import {
  AdaptiveChargingView,
  AIDiagnosticsView,
  FaultInjectionLabView,
} from './components/SecondaryViews';
import {
  AnalyticsReportsView,
  HardwareIntegrationView,
  SystemSettingsView,
} from './components/TertiaryViews';

type PageId =
  | 'dashboard'
  | 'live-monitoring'
  | 'cell-analysis'
  | 'ai-diagnostics'
  | 'adaptive-charging'
  | 'fault-lab'
  | 'analytics'
  | 'hardware'
  | 'settings';

const NAV_ITEMS: { id: PageId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: '1. Dashboard', icon: LayoutDashboard },
  { id: 'live-monitoring', label: '2. Live Battery Monitoring', icon: Activity },
  { id: 'cell-analysis', label: '3. Cell Analysis', icon: Grid },
  { id: 'ai-diagnostics', label: '4. AI Diagnostics', icon: BrainCircuit },
  { id: 'adaptive-charging', label: '5. Adaptive Charging', icon: BatteryCharging },
  { id: 'fault-lab', label: '6. Fault Injection Lab', icon: FlaskConical },
  { id: 'analytics', label: '7. Analytics & Reports', icon: BarChart3 },
  { id: 'hardware', label: '8. Hardware Integration', icon: Cpu },
  { id: 'settings', label: '9. System Settings', icon: Sliders },
];

export default function App() {
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [snapshot, setSnapshot] = useState<BatteryTelemetrySnapshot | null>(null);
  const [history, setHistory] = useState<Record<string, unknown>[]>([]);
  const [sohHistory, setSohHistory] = useState<SoHPredictionResult[]>([]);
  const [faultEvents, setFaultEvents] = useState<FaultEventRecord[]>([]);
  const [chargingSessions, setChargingSessions] = useState<ChargingSessionRecord[]>([]);
  const [faultCounts, setFaultCounts] = useState<Record<string, number>>({});
  const [modelMetadata, setModelMetadata] = useState<MLModelMetadata | null>(null);
  const [faultStatusMessage, setFaultStatusMessage] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const fetchAnalyticsBundle = useCallback(async () => {
    try {
      const res = await fetch('/api/analytics');
      if (!res.ok) return;
      const data = await res.json();
      setSohHistory(data.sohHistory || []);
      setFaultEvents(data.faultEvents || []);
      setChargingSessions(data.chargingSessions || []);
      setFaultCounts(data.faultCounts || {});
      if (data.modelMetadata) setModelMetadata(data.modelMetadata);
      if (Array.isArray(data.recentReadings) && data.recentReadings.length > 0) {
        setHistory(data.recentReadings);
      }
    } catch (err) {
      console.error('Failed to fetch analytics bundle:', err);
    }
  }, []);

  const fetchInitialStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const snap = (await res.json()) as BatteryTelemetrySnapshot;
        setSnapshot(snap);
      }
    } catch (err) {
      console.error('Failed to fetch initial status:', err);
    }
  }, []);

  useEffect(() => {
    fetchInitialStatus();
    fetchAnalyticsBundle();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws`;
    let ws: WebSocket | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => setWsConnected(true);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'TELEMETRY_UPDATE' && msg.payload) {
            const snap = msg.payload as BatteryTelemetrySnapshot;
            setSnapshot(snap);
            setHistory((prev) => [
              ...prev.slice(-79),
              {
                timestamp: snap.timestamp,
                packVoltage: snap.packVoltage,
                packCurrent: snap.packCurrent,
                soc: snap.soc,
                soh: snap.soh,
                averageTemperature: snap.averageTemperature,
                maxTemperature: snap.maxTemperature,
                cellVoltageDeltaMv: snap.cellVoltageDeltaMv,
              },
            ]);
          }
        } catch {
          // ignore malformed frame
        }
      };
      ws.onclose = () => setWsConnected(false);
    } catch {
      setWsConnected(false);
    }

    // Fallback HTTP poll every 1500ms so UI stays live even if iframe proxy blocks WebSockets
    pollTimer = setInterval(async () => {
      try {
        const res = await fetch('/api/status');
        if (res.ok) {
          const snap = (await res.json()) as BatteryTelemetrySnapshot;
          setSnapshot(snap);
          setHistory((prev) => {
            const lastTs = prev.length > 0 ? prev[prev.length - 1].timestamp : '';
            if (lastTs === snap.timestamp) return prev;
            return [
              ...prev.slice(-79),
              {
                timestamp: snap.timestamp,
                packVoltage: snap.packVoltage,
                packCurrent: snap.packCurrent,
                soc: snap.soc,
                soh: snap.soh,
                averageTemperature: snap.averageTemperature,
                maxTemperature: snap.maxTemperature,
                cellVoltageDeltaMv: snap.cellVoltageDeltaMv,
              },
            ];
          });
        }
      } catch {
        // ignore transient fetch error
      }
    }, 1500);

    return () => {
      if (ws) ws.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [fetchInitialStatus, fetchAnalyticsBundle]);

  const handleControlSimulation = async (params: Record<string, unknown>) => {
    const res = await fetch('/api/simulation/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.ok) {
      const snap = (await res.json()) as BatteryTelemetrySnapshot;
      setSnapshot(snap);
      await fetchAnalyticsBundle();
    }
  };

  const handleInjectFault = async (faultKey: string, active: boolean) => {
    const res = await fetch('/api/faults/inject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faultKey, active }),
    });
    if (res.ok) {
      const data = await res.json();
      setSnapshot(data.snapshot);
      if (data.events) setFaultEvents(data.events);
      setFaultStatusMessage(data.message);
      await fetchAnalyticsBundle();
    }
  };

  const handleClearAllFaults = async () => {
    const res = await fetch('/api/faults/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: false }),
    });
    const data = await res.json();
    if (data.snapshot) setSnapshot(data.snapshot);
    if (data.events) setFaultEvents(data.events);
    setFaultStatusMessage(data.message);
    await fetchAnalyticsBundle();
  };

  const handleRetrainModel = async (sampleCount: number) => {
    const res = await fetch('/api/ml/retrain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sampleCount }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.metadata) setModelMetadata(data.metadata);
      await fetchInitialStatus();
      await fetchAnalyticsBundle();
    }
  };

  const handleControlCharging = async (params: {
    operationState?: OperationState;
    requestedChargeCurrentAmps?: number;
  }) => {
    const res = await fetch('/api/charging/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.ok) {
      const snap = (await res.json()) as BatteryTelemetrySnapshot;
      setSnapshot(snap);
    }
  };

  const handleEmergencyShutdown = async () => {
    await handleControlSimulation({ operationState: 'IDLE', running: false });
  };

  const handleSaveThresholds = async (thresholds: SafetyThresholds) => {
    const res = await fetch('/api/config/thresholds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(thresholds),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.snapshot) setSnapshot(data.snapshot);
    }
  };

  const handleSimulateEsp32Packet = async (payload: {
    cellVoltages: number[];
    packCurrent: number;
    temperatures: number[];
  }) => {
    const res = await fetch('/api/hardware/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.snapshot) setSnapshot(data.snapshot);
    }
  };

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col">
      {/* Top Bar Contract: 3 Zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-[#0B0E17] border-b border-[#1E293B] sticky top-0 z-30">
        {/* Zone 1: Single text element wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            aria-label="Toggle Navigation Menu"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-1.5 rounded text-slate-300 hover:bg-slate-800 cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <a
            href="#dashboard"
            onClick={(e) => {
              e.preventDefault();
              setActivePage('dashboard');
            }}
            className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            ZEROTH BMS
          </a>
        </div>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            type="button"
            onClick={() => setActivePage('dashboard')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activePage === 'dashboard' ? 'text-cyan-400 font-semibold' : ''
            }`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => setActivePage('cell-analysis')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activePage === 'cell-analysis' ? 'text-cyan-400 font-semibold' : ''
            }`}
          >
            Cell Analysis
          </button>
          <button
            type="button"
            onClick={() => setActivePage('ai-diagnostics')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activePage === 'ai-diagnostics' ? 'text-cyan-400 font-semibold' : ''
            }`}
          >
            AI Diagnostics
          </button>
          <button
            type="button"
            onClick={() => setActivePage('fault-lab')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activePage === 'fault-lab' ? 'text-cyan-400 font-semibold' : ''
            }`}
          >
            Fault Lab
          </button>
          <button
            type="button"
            onClick={() => setActivePage('analytics')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activePage === 'analytics' ? 'text-cyan-400 font-semibold' : ''
            }`}
          >
            Analytics
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setActivePage('fault-lab')}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Run Safety Test
          </button>
        </div>
      </header>

      {/* Main Workspace Container: Left Sidebar + Active Page Viewport */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Navigation (9 Application Pages) */}
        <aside
          className={`${
            mobileMenuOpen ? 'fixed inset-y-0 left-0 z-40 w-64 bg-[#0B0E17]' : 'hidden lg:flex lg:w-64'
          } flex-col justify-between border-r border-[#1E293B] bg-[#0B0E17] p-4 shrink-0`}
        >
          <div className="space-y-1">
            <div className="px-3 py-2 text-xs font-mono text-slate-400">
              BMS MODULES (9 VIEWS)
            </div>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActivePage(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-semibold'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-500'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {snapshot && (
            <div className="p-3.5 rounded-lg bg-[#111827] border border-[#1E293B] space-y-2 text-xs font-mono tabular-nums">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">STREAM</span>
                <span className={wsConnected ? 'text-emerald-400 font-semibold' : 'text-cyan-400'}>
                  {wsConnected ? '● LIVE WS' : '● POLLING'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">PACK SoC</span>
                <span className="text-white font-bold">{snapshot.soc.toFixed(1)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">RF SoH</span>
                <span className="text-cyan-400 font-bold">{snapshot.soh.toFixed(2)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">CHG MODE</span>
                <span className="text-emerald-400">{snapshot.chargingState.mode}</span>
              </div>
            </div>
          )}
        </aside>

        {/* Main Content Stage */}
        <main className="flex-1 overflow-y-auto p-6">
          {!snapshot ? (
            <div className="h-96 flex items-center justify-center text-sm font-mono text-slate-400">
              Initializing ZEROTH Random Forest BMS Engine & SQLite Telemetry Store...
            </div>
          ) : (
            <div className="max-w-7xl mx-auto">
              {activePage === 'dashboard' && (
                <DashboardOverviewView
                  snapshot={snapshot}
                  history={history}
                  onControlSimulation={handleControlSimulation}
                  onNavigate={(p) => setActivePage(p as PageId)}
                />
              )}
              {activePage === 'live-monitoring' && (
                <LiveMonitoringView
                  snapshot={snapshot}
                  history={history}
                  onControlSimulation={handleControlSimulation}
                />
              )}
              {activePage === 'cell-analysis' && (
                <CellAnalysisView snapshot={snapshot} onInjectFault={handleInjectFault} />
              )}
              {activePage === 'ai-diagnostics' && (
                <AIDiagnosticsView
                  snapshot={snapshot}
                  modelMetadata={modelMetadata}
                  onRetrainModel={handleRetrainModel}
                />
              )}
              {activePage === 'adaptive-charging' && (
                <AdaptiveChargingView
                  snapshot={snapshot}
                  onControlCharging={handleControlCharging}
                  onEmergencyShutdown={handleEmergencyShutdown}
                />
              )}
              {activePage === 'fault-lab' && (
                <FaultInjectionLabView
                  snapshot={snapshot}
                  faultEvents={faultEvents}
                  statusMessage={faultStatusMessage}
                  onInjectFault={(k, a) => handleInjectFault(k, a)}
                  onClearAllFaults={handleClearAllFaults}
                />
              )}
              {activePage === 'analytics' && (
                <AnalyticsReportsView
                  snapshot={snapshot}
                  sohHistory={sohHistory}
                  faultEvents={faultEvents}
                  chargingSessions={chargingSessions}
                  faultCounts={faultCounts}
                />
              )}
              {activePage === 'hardware' && (
                <HardwareIntegrationView
                  snapshot={snapshot}
                  onSimulateEsp32Packet={handleSimulateEsp32Packet}
                />
              )}
              {activePage === 'settings' && (
                <SystemSettingsView
                  snapshot={snapshot}
                  onSaveThresholds={handleSaveThresholds}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
