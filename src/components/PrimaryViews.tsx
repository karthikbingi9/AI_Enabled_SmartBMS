/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  CheckCircle2,
  Cpu,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Thermometer,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BatteryTelemetrySnapshot, OperationState } from '../types/bms';

interface Props {
  snapshot: BatteryTelemetrySnapshot;
  history: Record<string, unknown>[];
  onControlSimulation: (params: Record<string, unknown>) => Promise<void>;
  onNavigate: (page: string) => void;
}

export const DashboardOverviewView: React.FC<Props> = ({
  snapshot,
  history,
  onControlSimulation,
  onNavigate,
}) => {
  const isCritical = snapshot.faultDetection.severity === 'CRITICAL';
  const isWarning = snapshot.faultDetection.severity === 'WARNING';

  const chartData = history.slice(-35).map((r) => ({
    time: new Date(String(r.timestamp)).toLocaleTimeString([], {
      minute: '2-digit',
      second: '2-digit',
    }),
    packVoltage: Number(r.packVoltage),
    packCurrent: Number(r.packCurrent),
    maxTemp: Number(r.maxTemperature),
    soc: Number(r.soc),
    soh: Number(r.soh),
  }));

  return (
    <div className="space-y-6">
      {/* Top Action & Simulation Telemetry Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#111827] border border-[#1E293B] rounded-lg p-4">
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-white">{snapshot.packName}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-slate-400">{snapshot.chemistry}</span>
          </div>
          <span aria-hidden="true" className="text-slate-600">/</span>
          <div className="font-mono">
            <span className="text-slate-400">SOURCE: </span>
            <span className="text-cyan-400 font-semibold">
              {snapshot.source === 'SIMULATION' ? 'REAL-TIME SIMULATION' : 'ESP32 HARDWARE STREAM'}
            </span>
          </div>
          <span aria-hidden="true" className="text-slate-600">/</span>
          <div className="font-mono">
            <span className="text-slate-400">CYCLES: </span>
            <span className="text-white font-semibold tabular-nums">{snapshot.cycleCount}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onControlSimulation({ running: !snapshot.simulationRunning })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {snapshot.simulationRunning ? (
              <>
                <Pause className="w-3.5 h-3.5 text-amber-400" />
                <span>Pause Simulator</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 text-emerald-400" />
                <span>Resume Simulator</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => onControlSimulation({ reset: true })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
            <span>Reset Pack</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('fault-lab')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            <span>Fault Injection Lab</span>
          </button>
        </div>
      </div>

      {/* Active Fault / Hardware Protection Banner */}
      {snapshot.faultDetection.faultType !== 'NONE' && (
        <div
          role="alert"
          className={`flex flex-wrap items-center justify-between gap-4 p-4 rounded-lg border ${
            isCritical
              ? 'bg-rose-950/40 border-rose-500/50 text-rose-100'
              : 'bg-amber-950/40 border-amber-500/50 text-amber-100'
          }`}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className={`w-4 h-4 ${isCritical ? 'text-rose-400' : 'text-amber-400'}`} />
              <span>
                {isCritical ? '✖ CRITICAL HARDWARE SAFETY OVERRIDE' : '▲ ACTIVE BMS WARNING'}:{' '}
                {snapshot.faultDetection.faultType}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-xs opacity-80">
                Detected by {snapshot.faultDetection.detectedBy}
              </span>
            </div>
            <p className="text-xs text-slate-300">{snapshot.faultDetection.description}</p>
            <p className="text-xs font-mono text-cyan-300">
              Action: {snapshot.faultDetection.recommendedAction}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('fault-lab')}
            className="px-3 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white border border-slate-700 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
          >
            Inspect & Clear Fault
          </button>
        </div>
      )}

      {/* 8-Metric Primary Telemetry Grid (Section 4.A) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. State of Charge (SoC) */}
        <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-4">
          <div className="text-xs tracking-wider text-slate-400 font-medium">STATE OF CHARGE (SoC)</div>
          <div className="mt-2 flex items-baseline">
            <span className="text-3xl font-mono font-bold text-white tabular-nums">
              {snapshot.soc.toFixed(1)}
            </span>
            <span className="text-xs font-mono text-slate-400 ml-1.5">%</span>
          </div>
          <div className="mt-2 w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-emerald-500 h-full transition-all duration-300"
              style={{ width: `${Math.min(100, snapshot.soc)}%` }}
            />
          </div>
          <div className="mt-2 text-xs font-mono text-slate-400 tabular-nums">
            Rem. Capacity: {snapshot.remainingCapacityAh.toFixed(2)} / {snapshot.nominalCapacityAh.toFixed(1)} Ah
          </div>
        </div>

        {/* 2. State of Health (SoH - Random Forest Prediction) */}
        <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-4">
          <div className="text-xs tracking-wider text-slate-400 font-medium">
            PREDICTED SoH (RANDOM FOREST)
          </div>
          <div className="mt-2 flex items-baseline">
            <span
              className={`text-3xl font-mono font-bold tabular-nums ${
                snapshot.soh >= 85
                  ? 'text-cyan-400'
                  : snapshot.soh >= 75
                  ? 'text-amber-400'
                  : 'text-rose-400'
              }`}
            >
              {snapshot.soh.toFixed(2)}
            </span>
            <span className="text-xs font-mono text-slate-400 ml-1.5">
              % ±{snapshot.sohPrediction.uncertaintyStd.toFixed(2)}%
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs font-mono text-slate-400 tabular-nums">
            <span>Conf: {snapshot.sohPrediction.confidence.toFixed(1)}%</span>
            <span aria-hidden="true">·</span>
            <span>Est. RUL: {snapshot.sohPrediction.rulCycles} cyc</span>
          </div>
        </div>

        {/* 3. Pack Voltage & Current */}
        <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-4">
          <div className="text-xs tracking-wider text-slate-400 font-medium">
            PACK VOLTAGE & CURRENT
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <div>
              <span className="text-3xl font-mono font-bold text-white tabular-nums">
                {snapshot.packVoltage.toFixed(2)}
              </span>
              <span className="text-xs font-mono text-slate-400 ml-1">V</span>
            </div>
            <div>
              <span
                className={`text-2xl font-mono font-semibold tabular-nums ${
                  snapshot.packCurrent > 0
                    ? 'text-emerald-400'
                    : snapshot.packCurrent < 0
                    ? 'text-amber-400'
                    : 'text-slate-400'
                }`}
              >
                {snapshot.packCurrent > 0 ? '+' : ''}
                {snapshot.packCurrent.toFixed(2)}
              </span>
              <span className="text-xs font-mono text-slate-400 ml-1">A</span>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs font-mono text-slate-400 tabular-nums">
            <span>Power: {snapshot.packPowerWatts.toFixed(1)} W</span>
            <span aria-hidden="true">·</span>
            <span>State: {snapshot.operationState}</span>
          </div>
        </div>

        {/* 4. Pack Temperature & Health Status */}
        <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-4">
          <div className="text-xs tracking-wider text-slate-400 font-medium">
            BATTERY TEMPERATURE & SAFETY
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <div>
              <span
                className={`text-3xl font-mono font-bold tabular-nums ${
                  snapshot.maxTemperature >= snapshot.thresholds.criticalTempThreshold
                    ? 'text-rose-400'
                    : snapshot.maxTemperature >= snapshot.thresholds.highTempThreshold
                    ? 'text-amber-400'
                    : 'text-white'
                }`}
              >
                {snapshot.maxTemperature.toFixed(1)}
              </span>
              <span className="text-xs font-mono text-slate-400 ml-1">°C MAX</span>
            </div>
            <div className="text-xs font-mono">
              {isCritical ? (
                <span className="text-rose-400 font-semibold">✖ CRITICAL</span>
              ) : isWarning ? (
                <span className="text-amber-400 font-semibold">▲ WARNING</span>
              ) : (
                <span className="text-emerald-400 font-semibold">● NOMINAL</span>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs font-mono text-slate-400 tabular-nums">
            <span>Avg: {snapshot.averageTemperature.toFixed(1)}°C</span>
            <span aria-hidden="true">·</span>
            <span>Mode: {snapshot.chargingState.mode}</span>
          </div>
        </div>
      </div>

      {/* Individual Cell Monitoring + Adaptive Charging Status Split (Section 4.B) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Individual Cell Bank Array (2/3 width) */}
        <div className="lg:col-span-2 bg-[#111827] border border-[#1E293B] rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-base font-semibold text-white">
                Individual Cell Voltage & Thermal Array ({snapshot.seriesCells}S Topology)
              </h2>
              <p className="text-xs text-slate-400">
                Real-time per-cell sensing with weak-cell identification and passive bleed equalization
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
              <span className="text-slate-400">
                MAX: <strong className="text-white">{snapshot.maxCellVoltage.toFixed(3)} V</strong>
              </span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-slate-400">
                MIN: <strong className="text-white">{snapshot.minCellVoltage.toFixed(3)} V</strong>
              </span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span
                className={
                  snapshot.cellVoltageDeltaMv >= snapshot.thresholds.imbalanceThresholdMv
                    ? 'text-amber-400 font-semibold'
                    : 'text-emerald-400 font-semibold'
                }
              >
                ΔV: {snapshot.cellVoltageDeltaMv.toFixed(1)} mV
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {snapshot.cells.map((cell) => {
              const vPercent = Math.max(
                0,
                Math.min(100, ((cell.voltage - 2.8) / (4.25 - 2.8)) * 100)
              );
              const isMax = cell.voltage === snapshot.maxCellVoltage;
              const isMin = cell.voltage === snapshot.minCellVoltage;

              return (
                <div
                  key={cell.cellId}
                  className={`p-3.5 rounded-lg border transition-colors ${
                    cell.status === 'CRITICAL'
                      ? 'bg-rose-950/30 border-rose-500/50'
                      : cell.status === 'WEAK'
                      ? 'bg-amber-950/30 border-amber-500/50'
                      : cell.status === 'IMBALANCED'
                      ? 'bg-cyan-950/25 border-cyan-500/40'
                      : 'bg-slate-900/70 border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="font-semibold text-slate-200">CELL 0{cell.cellId}</span>
                    <span
                      className={
                        cell.status === 'CRITICAL'
                          ? 'text-rose-400'
                          : cell.status === 'WEAK'
                          ? 'text-amber-400'
                          : cell.status === 'IMBALANCED'
                          ? 'text-cyan-400'
                          : 'text-emerald-400'
                      }
                    >
                      {cell.status === 'NOMINAL'
                        ? '● NOMINAL'
                        : cell.status === 'IMBALANCED'
                        ? '▲ IMBALANCED'
                        : cell.status === 'WEAK'
                        ? '▲ WEAK CELL'
                        : '✖ CRITICAL'}
                    </span>
                  </div>

                  <div className="mt-2 flex items-baseline">
                    <span className="text-2xl font-mono font-bold text-white tabular-nums">
                      {cell.voltage.toFixed(3)}
                    </span>
                    <span className="text-xs font-mono text-slate-400 ml-1">V</span>
                  </div>

                  <div className="mt-2 w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        cell.status === 'CRITICAL'
                          ? 'bg-rose-500'
                          : cell.status === 'WEAK'
                          ? 'bg-amber-500'
                          : 'bg-cyan-400'
                      }`}
                      style={{ width: `${vPercent}%` }}
                    />
                  </div>

                  <div className="mt-2.5 space-y-1 text-xs font-mono text-slate-400 tabular-nums">
                    <div className="flex justify-between">
                      <span>Temp:</span>
                      <span className="text-slate-200">{cell.temperature.toFixed(1)} °C</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Int. R:</span>
                      <span className="text-slate-200">{cell.internalResistance.toFixed(1)} mΩ</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cell SoH:</span>
                      <span className="text-slate-200">{cell.soh.toFixed(1)} %</span>
                    </div>
                    <div className="pt-1 flex items-center justify-between text-[11px] border-t border-slate-800/80">
                      <span className="text-slate-500">
                        {isMax ? 'HIGHEST V' : isMin ? 'LOWEST V' : 'NOMINAL V'}
                      </span>
                      <span className={cell.isBalancing ? 'text-cyan-400 font-semibold' : 'text-slate-500'}>
                        {cell.isBalancing ? 'BLEED ACTIVE' : 'BALANCED'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Adaptive Charging & Independent Hardware Protection Status Card (1/3 width) */}
        <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="border-b border-slate-800 pb-3">
              <h2 className="text-base font-semibold text-white">
                Safe Adaptive Charging Controller
              </h2>
              <p className="text-xs text-slate-400">
                AI charging profile bounded by independent hardware protection
              </p>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">ACTIVE CHARGING MODE</span>
                <span className="text-cyan-400 font-semibold">{snapshot.chargingState.mode}</span>
              </div>
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">TARGET CURRENT</span>
                <span className="text-white font-bold tabular-nums">
                  {snapshot.chargingState.targetCurrentAmps.toFixed(2)} A (Max {snapshot.chargingState.maxAllowedCurrentAmps.toFixed(1)} A)
                </span>
              </div>
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">CHARGER MOSFET RELAY</span>
                <span
                  className={
                    snapshot.chargingState.mosfetRelayClosed
                      ? 'text-emerald-400 font-semibold'
                      : 'text-rose-400 font-semibold'
                  }
                >
                  {snapshot.chargingState.mosfetRelayClosed ? '● CLOSED (ACTIVE)' : '✖ OPEN (ISOLATED)'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">HARDWARE SAFETY OVERRIDE</span>
                <span
                  className={
                    snapshot.chargingState.hardwareSafetyTripped
                      ? 'text-rose-400 font-semibold'
                      : 'text-emerald-400 font-semibold'
                  }
                >
                  {snapshot.chargingState.hardwareSafetyTripped ? '✖ TRIPPED' : '● ARMED & CLEAR'}
                </span>
              </div>
            </div>

            <div className="text-xs text-slate-300 bg-slate-900/50 border border-slate-800/80 rounded-md p-3">
              <div className="font-mono text-[11px] text-slate-400 mb-1">
                CONTROL RULE: {snapshot.chargingState.ruleTriggered}
              </div>
              <p className="leading-relaxed">{snapshot.chargingState.reason}</p>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() =>
                onControlSimulation({
                  operationState: snapshot.operationState === 'CHARGING' ? 'DISCHARGING' : 'CHARGING',
                })
              }
              className="flex-1 py-2 px-3 text-xs font-medium rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 transition-colors whitespace-nowrap cursor-pointer"
            >
              Switch to {snapshot.operationState === 'CHARGING' ? 'Discharging' : 'Charging'}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('adaptive-charging')}
              className="py-2 px-3 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors whitespace-nowrap cursor-pointer"
            >
              Configure
            </button>
          </div>
        </div>
      </div>

      {/* Live Telemetry Charts (Section 4.C: Voltage, Current, Temp, SoC/SoH) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Pack Voltage & Current vs Time */}
        <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Live Pack Voltage (V) & Current (A) Telemetry
              </h3>
              <p className="text-xs text-slate-400">
                Real-time streaming waveform across 4S1P terminals
              </p>
            </div>
            <span className="text-xs font-mono text-cyan-400 tabular-nums">
              {snapshot.packVoltage.toFixed(2)}V / {snapshot.packCurrent.toFixed(2)}A
            </span>
          </div>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis dataKey="time" stroke="#64748B" fontSize={11} tickMargin={6} />
                <YAxis yAxisId="left" stroke="#06B6D4" fontSize={11} domain={['auto', 'auto']} />
                <YAxis yAxisId="right" orientation="right" stroke="#10B981" fontSize={11} domain={[-10, 10]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderColor: '#1E293B',
                    fontSize: '12px',
                    fontFamily: 'JetBrains Mono',
                  }}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="packVoltage"
                  name="Pack Voltage (V)"
                  stroke="#06B6D4"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="packCurrent"
                  name="Pack Current (A)"
                  stroke="#10B981"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Temperature & State of Charge vs Time */}
        <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Battery Temperature (°C) & State of Charge (%)
              </h3>
              <p className="text-xs text-slate-400">
                Thermal safety envelope with critical cutoff threshold at {snapshot.thresholds.criticalTempThreshold}°C
              </p>
            </div>
            <span className="text-xs font-mono text-amber-400 tabular-nums">
              {snapshot.maxTemperature.toFixed(1)}°C / SoC {snapshot.soc.toFixed(1)}%
            </span>
          </div>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis dataKey="time" stroke="#64748B" fontSize={11} tickMargin={6} />
                <YAxis yAxisId="temp" stroke="#F59E0B" fontSize={11} domain={[15, 65]} />
                <YAxis yAxisId="soc" orientation="right" stroke="#38BDF8" fontSize={11} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderColor: '#1E293B',
                    fontSize: '12px',
                    fontFamily: 'JetBrains Mono',
                  }}
                />
                <ReferenceLine
                  yAxisId="temp"
                  y={snapshot.thresholds.criticalTempThreshold}
                  stroke="#EF4444"
                  strokeDasharray="4 4"
                  label={{ value: 'CRITICAL TEMP', fill: '#EF4444', fontSize: 10 }}
                />
                <Area
                  yAxisId="temp"
                  type="monotone"
                  dataKey="maxTemp"
                  name="Max Temp (°C)"
                  stroke="#F59E0B"
                  fill="#F59E0B"
                  fillOpacity={0.15}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="soc"
                  type="monotone"
                  dataKey="soc"
                  name="SoC (%)"
                  stroke="#38BDF8"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// PAGE 2: LIVE BATTERY MONITORING & REAL-TIME SIMULATOR CONSOLE
// ============================================================================

export const LiveMonitoringView: React.FC<{
  snapshot: BatteryTelemetrySnapshot;
  history: Record<string, unknown>[];
  onControlSimulation: (params: Record<string, unknown>) => Promise<void>;
}> = ({ snapshot, history, onControlSimulation }) => {
  const [socInput, setSocInput] = useState(snapshot.soc);
  const [cycleInput, setCycleInput] = useState(snapshot.cycleCount);
  const [tempInput, setTempInput] = useState(snapshot.ambientTemperature);
  const [chargeCurrentInput, setChargeCurrentInput] = useState(4.0);

  const chartData = history.slice(-50).map((r) => ({
    time: new Date(String(r.timestamp)).toLocaleTimeString([], {
      minute: '2-digit',
      second: '2-digit',
    }),
    packVoltage: Number(r.packVoltage),
    packCurrent: Number(r.packCurrent),
    maxTemp: Number(r.maxTemperature),
    avgTemp: Number(r.averageTemperature),
    soc: Number(r.soc),
    soh: Number(r.soh),
    deltaMv: Number(r.cellVoltageDeltaMv),
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Interactive Real-Time Battery Simulator Control Column */}
        <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-5 space-y-5">
          <div className="border-b border-slate-800 pb-3">
            <h2 className="text-base font-semibold text-white">
              Real-Time Electro-Thermal Simulator
            </h2>
            <p className="text-xs text-slate-400">
              Adjust pack operating state, cycle aging, and ambient conditions
            </p>
          </div>

          {/* Start / Pause / Reset Controls */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => onControlSimulation({ running: true })}
              className={`py-2 px-3 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                snapshot.simulationRunning
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Start Sim
            </button>
            <button
              type="button"
              onClick={() => onControlSimulation({ running: false })}
              className={`py-2 px-3 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                !snapshot.simulationRunning
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Pause Sim
            </button>
            <button
              type="button"
              onClick={() => onControlSimulation({ reset: true })}
              className="py-2 px-3 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            >
              Reset Default
            </button>
          </div>

          {/* Operation State Mode Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">
              Pack Load / Charger State
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['CHARGING', 'DISCHARGING', 'IDLE'] as OperationState[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onControlSimulation({ operationState: mode })}
                  className={`py-2 px-2 text-xs font-mono rounded-md border transition-colors cursor-pointer ${
                    snapshot.operationState === mode
                      ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-semibold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* Pack Topology Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">
              Series Cell Count Topology
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[3, 4, 6, 8].map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => onControlSimulation({ seriesCells: cnt })}
                  className={`py-1.5 text-xs font-mono rounded-md border transition-colors cursor-pointer ${
                    snapshot.seriesCells === cnt
                      ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-semibold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cnt}S Pack
                </button>
              ))}
            </div>
          </div>

          {/* Sliders for SoC, Cycle Count, Ambient Temp, Charge Current */}
          <div className="space-y-4 pt-2 border-t border-slate-800">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <label htmlFor="sim-soc-slider" className="text-slate-300">
                  State of Charge (SoC)
                </label>
                <span className="font-mono text-cyan-400 tabular-nums">{socInput.toFixed(1)}%</span>
              </div>
              <input
                id="sim-soc-slider"
                type="range"
                min={5}
                max={99}
                step={0.5}
                value={socInput}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setSocInput(val);
                  onControlSimulation({ soc: val });
                }}
                className="w-full accent-cyan-400 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <label htmlFor="sim-cycle-slider" className="text-slate-300">
                  Battery Cycle Count (Aging)
                </label>
                <span className="font-mono text-cyan-400 tabular-nums">{cycleInput} cycles</span>
              </div>
              <input
                id="sim-cycle-slider"
                type="range"
                min={1}
                max={1500}
                step={5}
                value={cycleInput}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setCycleInput(val);
                  onControlSimulation({ cycleCount: val });
                }}
                className="w-full accent-cyan-400 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <label htmlFor="sim-temp-slider" className="text-slate-300">
                  Ambient Chamber Temperature
                </label>
                <span className="font-mono text-amber-400 tabular-nums">{tempInput.toFixed(1)} °C</span>
              </div>
              <input
                id="sim-temp-slider"
                type="range"
                min={10}
                max={60}
                step={0.5}
                value={tempInput}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setTempInput(val);
                  onControlSimulation({ ambientTemperature: val });
                }}
                className="w-full accent-amber-400 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <label htmlFor="sim-current-slider" className="text-slate-300">
                  Requested Charging Current
                </label>
                <span className="font-mono text-emerald-400 tabular-nums">{chargeCurrentInput.toFixed(1)} A</span>
              </div>
              <input
                id="sim-current-slider"
                type="range"
                min={0.5}
                max={6.0}
                step={0.2}
                value={chargeCurrentInput}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setChargeCurrentInput(val);
                  onControlSimulation({ requestedChargeCurrentAmps: val });
                }}
                className="w-full accent-emerald-400 cursor-pointer"
              />
            </div>
          </div>

          <div className="p-3 rounded-md bg-slate-900/90 border border-slate-800 text-xs text-slate-400 space-y-1">
            <div className="font-semibold text-slate-200">Electro-Thermal Model Assumptions</div>
            <p>
              OCV(SoC) follows a 4th-order NMC lithium-ion curve with I·R internal impedance drop,
              I²R Joule heating, and Newton ambient cooling.
            </p>
          </div>
        </div>

        {/* Right Multi-Channel Oscilloscope Waveforms (2/3 width) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-5">
            <h3 className="text-sm font-semibold text-white mb-1">
              Channel 1: Pack Voltage (V) & Current (A) Time-Series
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              High-resolution terminal telemetry sampled at 1 Hz
            </p>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis dataKey="time" stroke="#64748B" fontSize={11} />
                  <YAxis yAxisId="v" stroke="#06B6D4" fontSize={11} domain={['auto', 'auto']} />
                  <YAxis yAxisId="i" orientation="right" stroke="#10B981" fontSize={11} domain={[-10, 10]} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0F172A',
                      borderColor: '#1E293B',
                      fontSize: '12px',
                      fontFamily: 'JetBrains Mono',
                    }}
                  />
                  <Line yAxisId="v" type="monotone" dataKey="packVoltage" name="Voltage (V)" stroke="#06B6D4" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line yAxisId="i" type="monotone" dataKey="packCurrent" name="Current (A)" stroke="#10B981" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-5">
            <h3 className="text-sm font-semibold text-white mb-1">
              Channel 2: Max vs Average Cell Temperature (°C) & Cell Spread (ΔmV)
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Thermal dissipation tracking and inter-cell voltage divergence
            </p>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis dataKey="time" stroke="#64748B" fontSize={11} />
                  <YAxis yAxisId="t" stroke="#F59E0B" fontSize={11} domain={[15, 65]} />
                  <YAxis yAxisId="d" orientation="right" stroke="#A855F7" fontSize={11} domain={[0, 'auto']} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0F172A',
                      borderColor: '#1E293B',
                      fontSize: '12px',
                      fontFamily: 'JetBrains Mono',
                    }}
                  />
                  <Line yAxisId="t" type="monotone" dataKey="maxTemp" name="Max Temp (°C)" stroke="#F59E0B" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line yAxisId="t" type="monotone" dataKey="avgTemp" name="Avg Temp (°C)" stroke="#38BDF8" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                  <Line yAxisId="d" type="monotone" dataKey="deltaMv" name="Cell ΔV (mV)" stroke="#A855F7" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// PAGE 3: CELL ANALYSIS & BALANCING MATRIX
// ============================================================================

export const CellAnalysisView: React.FC<{
  snapshot: BatteryTelemetrySnapshot;
  onInjectFault: (faultKey: string, active: boolean) => Promise<void>;
}> = ({ snapshot, onInjectFault }) => {
  const cellBarData = snapshot.cells.map((c) => ({
    name: `Cell 0${c.cellId}`,
    voltage: c.voltage,
    resistance: c.internalResistance,
    temperature: c.temperature,
    status: c.status,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#111827] border border-[#1E293B] rounded-lg p-4">
        <div>
          <h2 className="text-base font-semibold text-white">
            Cell-Level Differential Voltage & Internal Resistance Analyzer
          </h2>
          <p className="text-xs text-slate-400">
            Monitors individual series cells for early weak-cell degradation and voltage divergence
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              onInjectFault('cellImbalance', !snapshot.activeInjectedFaults.cellImbalance)
            }
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
              snapshot.activeInjectedFaults.cellImbalance
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
            }`}
          >
            {snapshot.activeInjectedFaults.cellImbalance
              ? 'Clear Simulated Imbalance'
              : 'Simulate Cell Imbalance'}
          </button>
          <button
            type="button"
            onClick={() => onInjectFault('weakCell', !snapshot.activeInjectedFaults.weakCell)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
              snapshot.activeInjectedFaults.weakCell
                ? 'bg-rose-500/20 border-rose-500/50 text-rose-300'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
            }`}
          >
            {snapshot.activeInjectedFaults.weakCell ? 'Restore Weak Cell #3' : 'Simulate Weak Cell #3'}
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-4">
          <div className="text-xs text-slate-400">MAX CELL VOLTAGE</div>
          <div className="mt-1 text-2xl font-mono font-bold text-white tabular-nums">
            {snapshot.maxCellVoltage.toFixed(3)} V
          </div>
        </div>
        <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-4">
          <div className="text-xs text-slate-400">MIN CELL VOLTAGE</div>
          <div className="mt-1 text-2xl font-mono font-bold text-white tabular-nums">
            {snapshot.minCellVoltage.toFixed(3)} V
          </div>
        </div>
        <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-4">
          <div className="text-xs text-slate-400">CELL VOLTAGE DIFFERENCE (ΔV)</div>
          <div
            className={`mt-1 text-2xl font-mono font-bold tabular-nums ${
              snapshot.cellVoltageDeltaMv >= snapshot.thresholds.imbalanceThresholdMv
                ? 'text-amber-400'
                : 'text-emerald-400'
            }`}
          >
            {snapshot.cellVoltageDeltaMv.toFixed(1)} mV
          </div>
        </div>
        <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-4">
          <div className="text-xs text-slate-400">PASSIVE BALANCING CIRCUIT</div>
          <div className="mt-1 text-2xl font-mono font-bold text-cyan-400">
            {snapshot.chargingState.activeBalancing
              ? `ACTIVE (${snapshot.chargingState.balancingCellIds.length} CELLS)`
              : 'STANDBY'}
          </div>
        </div>
      </div>

      {/* Charts: Cell Voltage Comparison & Internal Resistance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-5">
          <h3 className="text-sm font-semibold text-white mb-1">
            Cell Voltage Comparison (V)
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            Direct comparison across series cells with min/max safety limits
          </p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cellBarData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis dataKey="name" stroke="#94A3B8" fontSize={12} />
                <YAxis stroke="#94A3B8" fontSize={11} domain={[2.5, 4.4]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderColor: '#1E293B',
                    fontSize: '12px',
                    fontFamily: 'JetBrains Mono',
                  }}
                />
                <ReferenceLine y={snapshot.thresholds.maxCellVoltage} stroke="#EF4444" strokeDasharray="3 3" />
                <ReferenceLine y={snapshot.thresholds.minCellVoltage} stroke="#F59E0B" strokeDasharray="3 3" />
                <Bar dataKey="voltage" name="Cell Voltage (V)" radius={[4, 4, 0, 0]}>
                  {cellBarData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={
                        entry.status === 'CRITICAL'
                          ? '#EF4444'
                          : entry.status === 'WEAK'
                          ? '#F59E0B'
                          : entry.status === 'IMBALANCED'
                          ? '#06B6D4'
                          : '#10B981'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-5">
          <h3 className="text-sm font-semibold text-white mb-1">
            Cell Internal Resistance (mΩ) & Thermal Profile (°C)
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            Elevated DC internal resistance indicates SEI layer growth or weak cell degradation
          </p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cellBarData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis dataKey="name" stroke="#94A3B8" fontSize={12} />
                <YAxis stroke="#94A3B8" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderColor: '#1E293B',
                    fontSize: '12px',
                    fontFamily: 'JetBrains Mono',
                  }}
                />
                <Bar dataKey="resistance" name="Internal Resistance (mΩ)" fill="#38BDF8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="temperature" name="Temperature (°C)" fill="#F59E0B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Detailed Cell Table */}
      <div className="bg-[#111827] border border-[#1E293B] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-white">
            Per-Cell Diagnostic Telemetry Matrix
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-mono">
                <th className="py-3 px-4">CELL ID</th>
                <th className="py-3 px-4 text-right">VOLTAGE (V)</th>
                <th className="py-3 px-4 text-right">DELTA FROM MIN (mV)</th>
                <th className="py-3 px-4 text-right">TEMP (°C)</th>
                <th className="py-3 px-4 text-right">DC RESISTANCE (mΩ)</th>
                <th className="py-3 px-4 text-right">EST. SoC (%)</th>
                <th className="py-3 px-4 text-right">CELL SoH (%)</th>
                <th className="py-3 px-4">BALANCING</th>
                <th className="py-3 px-4">DIAGNOSTIC STATUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
              {snapshot.cells.map((cell) => {
                const deltaMin = (cell.voltage - snapshot.minCellVoltage) * 1000;
                return (
                  <tr key={cell.cellId} className="hover:bg-slate-900/50">
                    <td className="py-3 px-4 font-semibold text-white">CELL 0{cell.cellId}</td>
                    <td className="py-3 px-4 text-right text-slate-100">{cell.voltage.toFixed(3)} V</td>
                    <td className="py-3 px-4 text-right text-cyan-400">+{deltaMin.toFixed(1)} mV</td>
                    <td className="py-3 px-4 text-right text-slate-200">{cell.temperature.toFixed(1)} °C</td>
                    <td className="py-3 px-4 text-right text-slate-200">{cell.internalResistance.toFixed(1)} mΩ</td>
                    <td className="py-3 px-4 text-right text-slate-200">{cell.soc.toFixed(1)}%</td>
                    <td className="py-3 px-4 text-right text-slate-200">{cell.soh.toFixed(1)}%</td>
                    <td className="py-3 px-4">
                      {cell.isBalancing ? (
                        <span className="text-cyan-400 font-semibold">BLEED ON</span>
                      ) : (
                        <span className="text-slate-500">OFF</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={
                          cell.status === 'CRITICAL'
                            ? 'text-rose-400 font-semibold'
                            : cell.status === 'WEAK'
                            ? 'text-amber-400 font-semibold'
                            : cell.status === 'IMBALANCED'
                            ? 'text-cyan-400 font-semibold'
                            : 'text-emerald-400'
                        }
                      >
                        {cell.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
