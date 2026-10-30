/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Code2,
  Copy,
  Cpu,
  Download,
  FileSpreadsheet,
  FileText,
  Radio,
  Save,
  Send,
  ShieldAlert,
  Sliders,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  BatteryTelemetrySnapshot,
  ChargingSessionRecord,
  FaultEventRecord,
  MLModelMetadata,
  SafetyThresholds,
  SoHPredictionResult,
} from '../types/bms';

// ============================================================================
// PAGE 7: ANALYTICS & REPORTS (CSV & PDF Export)
// ============================================================================

export const AnalyticsReportsView: React.FC<{
  snapshot: BatteryTelemetrySnapshot;
  sohHistory: SoHPredictionResult[];
  faultEvents: FaultEventRecord[];
  chargingSessions: ChargingSessionRecord[];
  faultCounts: Record<string, number>;
}> = ({ snapshot, sohHistory, faultEvents, chargingSessions, faultCounts }) => {
  const cycleMap = new Map<number, { cycle: number; soh: number; confidence: number; rul: number }>();
  for (const item of sohHistory) {
    const c = item.features?.cycleNumber || 100;
    cycleMap.set(c, {
      cycle: c,
      soh: item.predictedSoH,
      confidence: item.confidence,
      rul: item.rulCycles,
    });
  }
  const sohChartData = Array.from(cycleMap.values()).sort((a, b) => a.cycle - b.cycle);

  const faultFreqData = Object.entries(faultCounts).map(([type, count]) => ({
    type,
    count,
  }));

  const handleDownloadCSV = () => {
    const headers = [
      'Event_ID',
      'Timestamp',
      'Fault_Type',
      'Severity',
      'Detected_By',
      'Pack_Voltage_V',
      'Pack_Current_A',
      'Max_Temp_C',
      'Cell_Delta_mV',
      'Safety_Response',
      'Cleared',
    ];
    const rows = faultEvents.map((ev) => [
      ev.id,
      ev.timestamp,
      ev.faultType,
      ev.severity,
      ev.detectedBy,
      ev.packVoltage.toFixed(2),
      ev.packCurrent.toFixed(2),
      ev.maxTemperature.toFixed(1),
      ev.cellDeltaMv.toFixed(1),
      `"${ev.safetyResponse.replace(/"/g, '""')}"`,
      ev.cleared ? 'YES' : 'NO',
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `ZEROTH_BMS_Diagnostic_Report_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(15);
    doc.text('ZEROTH - AI-Powered Smart BMS Diagnostic Report', 14, 18);
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(
      `Generated: ${new Date().toLocaleString()} | Pack: ${snapshot.packName} (${snapshot.chemistry})`,
      14,
      25
    );

    autoTable(doc, {
      startY: 32,
      head: [['Metric', 'Current Reading', 'Safety Status / Mode']],
      body: [
        ['State of Charge (SoC)', `${snapshot.soc.toFixed(1)} %`, snapshot.operationState],
        [
          'Predicted State of Health (SoH)',
          `${snapshot.soh.toFixed(2)} % (Conf: ${snapshot.sohPrediction.confidence.toFixed(1)}%)`,
          `Est. RUL: ${snapshot.sohPrediction.rulCycles} cycles`,
        ],
        [
          'Pack Voltage & Current',
          `${snapshot.packVoltage.toFixed(2)} V / ${snapshot.packCurrent.toFixed(2)} A`,
          `Charging Mode: ${snapshot.chargingState.mode}`,
        ],
        [
          'Max Battery Temperature',
          `${snapshot.maxTemperature.toFixed(1)} °C`,
          `Critical Cutoff: ${snapshot.thresholds.criticalTempThreshold} °C`,
        ],
        [
          'Cell Voltage Spread (Delta V)',
          `${snapshot.cellVoltageDeltaMv.toFixed(1)} mV`,
          `Max: ${snapshot.maxCellVoltage.toFixed(3)}V / Min: ${snapshot.minCellVoltage.toFixed(3)}V`,
        ],
      ],
    });

    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
    doc.setFontSize(11);
    doc.setTextColor(20);
    doc.text('Recorded Fault & Safety Override Events', 14, finalY);

    autoTable(doc, {
      startY: finalY + 4,
      head: [['ID', 'Time', 'Fault Type', 'Severity', 'Temp (°C)', 'Safety Action']],
      body: faultEvents.slice(0, 12).map((ev) => [
        `#${ev.id}`,
        new Date(ev.timestamp).toLocaleTimeString(),
        ev.faultType,
        ev.severity,
        `${ev.maxTemperature.toFixed(1)}`,
        ev.safetyResponse,
      ]),
    });

    doc.save(`ZEROTH_Battery_Health_Report_${Date.now()}.pdf`);
  };

  return (
    <div className="space-y-6">
      {/* Header & Export Buttons */}
      <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">
            Historical Battery Health Trends, Analytics & Diagnostic Reports
          </h2>
          <p className="text-xs text-slate-400">
            Long-term SoH degradation curves, charging efficiency metrics, and persisted fault logs
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleDownloadCSV}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span>Export CSV Report</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadPDF}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Export PDF Health Report</span>
          </button>
        </div>
      </div>

      {/* Charts: SoH Degradation vs Cycle Count + Fault Frequency Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-5">
          <h3 className="text-sm font-semibold text-white mb-1">
            State of Health (SoH %) Degradation History Across Cycles
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            Random Forest regression trajectory from initial commissioning
          </p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sohChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis dataKey="cycle" stroke="#94A3B8" fontSize={11} />
                <YAxis stroke="#06B6D4" fontSize={11} domain={[65, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderColor: '#1E293B',
                    fontSize: '12px',
                    fontFamily: 'JetBrains Mono',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="soh"
                  name="Predicted SoH (%)"
                  stroke="#06B6D4"
                  fill="#06B6D4"
                  fillOpacity={0.18}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-5">
          <h3 className="text-sm font-semibold text-white mb-1">
            Fault Event Frequency Breakdown
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            Distribution of detected electrical, thermal, and cell imbalance incidents
          </p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={faultFreqData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis dataKey="type" stroke="#94A3B8" fontSize={11} />
                <YAxis stroke="#94A3B8" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderColor: '#1E293B',
                    fontSize: '12px',
                    fontFamily: 'JetBrains Mono',
                  }}
                />
                <Bar dataKey="count" name="Incident Count" fill="#F59E0B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Historical Charging Sessions Table */}
      <div className="bg-[#111827] border border-[#1E293B] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-white">
            Historical Adaptive Charging Sessions & Coulombic Efficiency Log
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-3 px-4">SESSION</th>
                <th className="py-3 px-4">START TIME</th>
                <th className="py-3 px-4 text-right">SoC WINDOW</th>
                <th className="py-3 px-4 text-right">DELIVERED (Ah)</th>
                <th className="py-3 px-4 text-right">AVG CURRENT</th>
                <th className="py-3 px-4 text-right">PEAK TEMP</th>
                <th className="py-3 px-4">PREDOMINANT MODE</th>
                <th className="py-3 px-4 text-right">EFFICIENCY</th>
                <th className="py-3 px-4">OUTCOME</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {chargingSessions.map((s) => (
                <tr key={s.id} className="hover:bg-slate-900/50">
                  <td className="py-2.5 px-4 text-slate-300">#{s.id}</td>
                  <td className="py-2.5 px-4 text-slate-400">
                    {new Date(s.startTime).toLocaleDateString()}
                  </td>
                  <td className="py-2.5 px-4 text-right text-white">
                    {s.startSoc.toFixed(1)}% → {s.endSoc.toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-4 text-right text-cyan-400">
                    {s.capacityDeliveredAh.toFixed(2)} Ah
                  </td>
                  <td className="py-2.5 px-4 text-right text-slate-200">
                    {s.averageCurrentA.toFixed(2)} A
                  </td>
                  <td className="py-2.5 px-4 text-right text-slate-200">
                    {s.peakTempC.toFixed(1)} °C
                  </td>
                  <td className="py-2.5 px-4 text-cyan-300">{s.predominantMode}</td>
                  <td className="py-2.5 px-4 text-right text-emerald-400">
                    {s.efficiencyPercent.toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-4">
                    <span
                      className={
                        s.status === 'COMPLETED' ? 'text-emerald-400' : 'text-rose-400 font-semibold'
                      }
                    >
                      {s.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Conventional Fixed-Threshold BMS vs ZEROTH AI-BMS Comparison (Expected Outcomes Page 14) */}
      <div className="bg-[#111827] border border-[#1E293B] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-white">
            Architectural Comparison: Conventional BMS vs ZEROTH AI-Enabled BMS (PDF Page 5, 10, 14)
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-mono">
                <th className="py-3 px-4">CAPABILITY DIMENSION</th>
                <th className="py-3 px-4">CONVENTIONAL BMS</th>
                <th className="py-3 px-4">ZEROTH AI-ENABLED SMART BMS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-slate-300">
              <tr>
                <td className="py-3 px-4 font-semibold text-white">Fault Detection Timing</td>
                <td className="py-3 px-4 text-slate-400">Reactive: Trips only after hard voltage/temp limits are crossed</td>
                <td className="py-3 px-4 text-emerald-400">Predictive ML classification + Independent hardware cutoff backup</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold text-white">Cell-Level Granularity</td>
                <td className="py-3 px-4 text-slate-400">Pack-level monitoring; weak cells masked until severe capacity loss</td>
                <td className="py-3 px-4 text-emerald-400">Individual cell voltage, ΔV spread, and internal resistance tracking</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold text-white">State of Health (SoH)</td>
                <td className="py-3 px-4 text-slate-400">No early degradation prediction</td>
                <td className="py-3 px-4 text-emerald-400">Random Forest Regressor over 9 electrical/thermal/cycle features</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold text-white">Charging Control</td>
                <td className="py-3 px-4 text-slate-400">Fixed CC-CV profile regardless of battery aging or cell imbalance</td>
                <td className="py-3 px-4 text-emerald-400">6-Mode Safe Adaptive Charging (Normal, Balancing, Thermal, Conservative, Fallback)</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold text-white">AI Failure Resilience</td>
                <td className="py-3 px-4 text-slate-400">N/A (No AI layer)</td>
                <td className="py-3 px-4 text-emerald-400">Confidence monitoring (&lt;70%) automatically reverts to hardware safety rules</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// PAGE 8: HARDWARE INTEGRATION (ESP32 Firmware, MQTT Topic Schema & Safety Notice)
// ============================================================================

const ESP32_FIRMWARE_CODE = `/**
 * ZEROTH Smart BMS - ESP32 Telemetry & Independent Hardware Safety Node
 * Target: ESP32-WROOM-32D | Sensors: ADS1115 (4S Cell Voltages), INA219 (Current), NTC 10k (Temp)
 * Actuators: GPIO 26 (Charger MOSFET Relay), GPIO 27 (Load MOSFET Relay), GPIO 14..33 (Bleed Balancing)
 */
#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_ADS1X15.h>

const char* WIFI_SSID = "ZEROTH_LAB_NET";
const char* WIFI_PASS = "bms_prototype_2026";
const char* MQTT_BROKER = "192.168.1.100";

// Independent Hardware Safety Cutoffs (Active even if WiFi/MQTT or AI Server fails)
const float HARD_MAX_CELL_V = 4.22f;
const float HARD_MIN_CELL_V = 2.85f;
const float HARD_MAX_CURRENT_A = 5.00f;
const float HARD_MAX_TEMP_C = 48.0f;

#define PIN_CHARGER_RELAY 26
#define PIN_LOAD_RELAY    27

WiFiClient espClient;
PubSubClient mqtt(espClient);
Adafruit_ADS1115 ads;

void enforceIndependentHardwareProtection(float cellV[4], float currentA, float maxTempC) {
  bool fault = false;
  for (int i = 0; i < 4; i++) {
    if (cellV[i] >= HARD_MAX_CELL_V || cellV[i] <= HARD_MIN_CELL_V || isnan(cellV[i])) {
      fault = true;
    }
  }
  if (fabs(currentA) > HARD_MAX_CURRENT_A || maxTempC >= HARD_MAX_TEMP_C) {
    fault = true;
  }
  if (fault) {
    // Immediate local hardware cutoff without waiting for cloud/AI command
    digitalWrite(PIN_CHARGER_RELAY, LOW);
    digitalWrite(PIN_LOAD_RELAY, LOW);
  }
}

void loop() {
  float cellV[4] = {3.862f, 3.858f, 3.849f, 3.860f}; // Sampled from ADS1115 divider ladder
  float packCurrentA = 3.20f;
  float maxTempC = 29.4f;

  // 1. Always execute local hardware safety check first
  enforceIndependentHardwareProtection(cellV, packCurrentA, maxTempC);

  // 2. Publish JSON telemetry frame to MQTT topic: zeroth/bms/pack01/telemetry
  char payload[256];
  snprintf(payload, sizeof(payload),
    "{\\"cellVoltages\\":[%.3f,%.3f,%.3f,%.3f],\\"packCurrent\\":%.2f,\\"temperatures\\":[%.1f,%.1f,%.1f,%.1f]}",
    cellV[0], cellV[1], cellV[2], cellV[3], packCurrentA, maxTempC, maxTempC, maxTempC, maxTempC);
  mqtt.publish("zeroth/bms/pack01/telemetry", payload);
  delay(1000);
}`;

export const HardwareIntegrationView: React.FC<{
  snapshot: BatteryTelemetrySnapshot;
  onSimulateEsp32Packet: (payload: {
    cellVoltages: number[];
    packCurrent: number;
    temperatures: number[];
  }) => Promise<void>;
}> = ({ snapshot, onSimulateEsp32Packet }) => {
  const [copied, setCopied] = useState(false);
  const [testResp, setTestResp] = useState<string | null>(null);

  const handleCopyFirmware = () => {
    navigator.clipboard.writeText(ESP32_FIRMWARE_CODE);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendTestFrame = async () => {
    await onSimulateEsp32Packet({
      cellVoltages: [3.912, 3.908, 3.895, 3.910],
      packCurrent: 3.15,
      temperatures: [30.2, 30.6, 30.1, 30.4],
    });
    setTestResp(
      `ESP32 frame ingested at ${new Date().toLocaleTimeString()} -> BMS returned MOSFET_CLOSED=${snapshot.chargingState.mosfetRelayClosed}, MODE=${snapshot.chargingState.mode}`
    );
  };

  return (
    <div className="space-y-6">
      {/* Mandatory Safety Requirement Callout (Section 10) */}
      <div className="bg-amber-950/35 border border-amber-500/50 rounded-lg p-4 space-y-1.5">
        <div className="flex items-center gap-2 text-xs font-mono font-bold text-amber-400">
          <AlertTriangle className="w-4 h-4" />
          <span>
            IMPORTANT PROTOTYPE SAFETY REQUIREMENT (LOW-VOLTAGE ACADEMIC PROTOTYPE)
          </span>
        </div>
        <p className="text-xs text-slate-200 leading-relaxed">
          This is an academic low-voltage prototype architecture. Never connect this application
          directly to mains power or a high-voltage EV traction battery pack without appropriately
          rated BMS hardware, certified protection devices, galvanic electrical isolation, and
          qualified engineering validation. Software simulation must not be represented as verified
          physical protection.
        </p>
      </div>

      {/* MQTT Topic Architecture & Live Test Frame Injector */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-white">
              ESP32 MQTT Topic Structure & Hardware Pinout
            </h3>
            <p className="text-xs text-slate-400">
              Bi-directional telemetry ingestion and MOSFET relay command topics
            </p>
          </div>

          <div className="space-y-2.5 text-xs font-mono">
            <div className="p-3 rounded bg-slate-900 border border-slate-800">
              <div className="text-cyan-400 font-semibold">
                PUBLISH: zeroth/bms/pack01/telemetry (1 Hz ESP32 → Server)
              </div>
              <div className="text-slate-400 mt-1">
                Payload: cellVoltages[4], packCurrent, temperatures[4], cycleCount, hwCutoffTripped
              </div>
            </div>
            <div className="p-3 rounded bg-slate-900 border border-slate-800">
              <div className="text-emerald-400 font-semibold">
                SUBSCRIBE: zeroth/bms/pack01/commands (Server → ESP32)
              </div>
              <div className="text-slate-400 mt-1">
                Payload: mosfetRelayClosed, loadRelayClosed, targetChargeCurrentAmps, balancingCells[]
              </div>
            </div>
            <div className="p-3 rounded bg-slate-900 border border-slate-800">
              <div className="text-amber-400 font-semibold">
                HEARTBEAT / LWT: zeroth/bms/pack01/status
              </div>
              <div className="text-slate-400 mt-1">
                Automatic fallback to simulation mode when physical ESP32 node is offline
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-mono text-slate-300">
              Active Stream Mode:{' '}
              <strong className="text-cyan-400">{snapshot.source}</strong>
            </div>
            <button
              type="button"
              onClick={handleSendTestFrame}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Dispatch Test ESP32 Telemetry Frame</span>
            </button>
          </div>

          {testResp && (
            <div className="p-2.5 rounded bg-slate-900 border border-emerald-500/40 text-xs font-mono text-emerald-300">
              {testResp}
            </div>
          )}
        </div>

        {/* ESP32 C++ Firmware Reference Code */}
        <div className="bg-[#111827] border border-[#1E293B] rounded-lg p-5 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">
                ESP32 Reference Firmware (Arduino / ESP-IDF C++)
              </h3>
              <p className="text-xs text-slate-400">
                Includes local independent hardware safety cutoff loop
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopyFirmware}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy Firmware'}</span>
            </button>
          </div>

          <pre className="p-3.5 rounded bg-[#07090E] border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-80 leading-relaxed">
            <code>{ESP32_FIRMWARE_CODE}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// PAGE 9: SYSTEM SETTINGS & SAFETY THRESHOLDS + API EXPLORER
// ============================================================================

export const SystemSettingsView: React.FC<{
  snapshot: BatteryTelemetrySnapshot;
  onSaveThresholds: (thresholds: SafetyThresholds) => Promise<void>;
}> = ({ snapshot, onSaveThresholds }) => {
  const [form, setForm] = useState<SafetyThresholds>({ ...snapshot.thresholds });
  const [savedBanner, setSavedBanner] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveThresholds(form);
    setSavedBanner(true);
    setTimeout(() => setSavedBanner(false), 2500);
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSubmit}
        className="bg-[#111827] border border-[#1E293B] rounded-lg p-5 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-base font-semibold text-white">
              Independent Hardware Safety Thresholds & AI Confidence Policy
            </h2>
            <p className="text-xs text-slate-400">
              Changes are persisted in SQLite and immediately enforced by the safety override controller
            </p>
          </div>

          <button
            type="submit"
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Protection Thresholds</span>
          </button>
        </div>

        {savedBanner && (
          <div className="p-3 rounded bg-emerald-950/40 border border-emerald-500/50 text-xs font-mono text-emerald-300">
            Safety thresholds saved to SQLite and applied to live hardware protection controller.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div>
            <label htmlFor="th-max-cell" className="block text-slate-300 mb-1">
              Max Cell Cutoff Voltage (V)
            </label>
            <input
              id="th-max-cell"
              type="number"
              step="0.01"
              value={form.maxCellVoltage}
              onChange={(e) => setForm({ ...form, maxCellVoltage: Number(e.target.value) })}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 font-mono text-white"
            />
          </div>

          <div>
            <label htmlFor="th-min-cell" className="block text-slate-300 mb-1">
              Min Cell Cutoff Voltage (V)
            </label>
            <input
              id="th-min-cell"
              type="number"
              step="0.01"
              value={form.minCellVoltage}
              onChange={(e) => setForm({ ...form, minCellVoltage: Number(e.target.value) })}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 font-mono text-white"
            />
          </div>

          <div>
            <label htmlFor="th-max-chg" className="block text-slate-300 mb-1">
              Max Charging Current (A)
            </label>
            <input
              id="th-max-chg"
              type="number"
              step="0.1"
              value={form.maxChargingCurrent}
              onChange={(e) => setForm({ ...form, maxChargingCurrent: Number(e.target.value) })}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 font-mono text-white"
            />
          </div>

          <div>
            <label htmlFor="th-crit-temp" className="block text-slate-300 mb-1">
              Critical Temperature Cutoff (°C)
            </label>
            <input
              id="th-crit-temp"
              type="number"
              step="0.5"
              value={form.criticalTempThreshold}
              onChange={(e) => setForm({ ...form, criticalTempThreshold: Number(e.target.value) })}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 font-mono text-white"
            />
          </div>

          <div>
            <label htmlFor="th-high-temp" className="block text-slate-300 mb-1">
              Thermal Derating Warning (°C)
            </label>
            <input
              id="th-high-temp"
              type="number"
              step="0.5"
              value={form.highTempThreshold}
              onChange={(e) => setForm({ ...form, highTempThreshold: Number(e.target.value) })}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 font-mono text-white"
            />
          </div>

          <div>
            <label htmlFor="th-imb" className="block text-slate-300 mb-1">
              Cell Imbalance Threshold (mV)
            </label>
            <input
              id="th-imb"
              type="number"
              step="1"
              value={form.imbalanceThresholdMv}
              onChange={(e) => setForm({ ...form, imbalanceThresholdMv: Number(e.target.value) })}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 font-mono text-white"
            />
          </div>

          <div>
            <label htmlFor="th-soh" className="block text-slate-300 mb-1">
              Conservative SoH Threshold (%)
            </label>
            <input
              id="th-soh"
              type="number"
              step="1"
              value={form.lowSoHThreshold}
              onChange={(e) => setForm({ ...form, lowSoHThreshold: Number(e.target.value) })}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 font-mono text-white"
            />
          </div>

          <div>
            <label htmlFor="th-conf" className="block text-slate-300 mb-1">
              Min AI Confidence Threshold (%)
            </label>
            <input
              id="th-conf"
              type="number"
              step="1"
              value={form.minAiConfidence}
              onChange={(e) => setForm({ ...form, minAiConfidence: Number(e.target.value) })}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 font-mono text-white"
            />
          </div>
        </div>
      </form>

      {/* OpenAPI / Swagger REST & WebSocket Reference Table */}
      <div className="bg-[#111827] border border-[#1E293B] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">
              REST & WebSocket API Reference (OpenAPI 3.1 Specification)
            </h3>
            <p className="text-xs text-slate-400">
              All frontend views communicate with these live backend endpoints
            </p>
          </div>
          <a
            href="/api/openapi.json"
            target="_blank"
            rel="noreferrer"
            className="text-xs font-mono text-cyan-400 hover:underline"
          >
            View /api/openapi.json
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2.5 px-4">METHOD</th>
                <th className="py-2.5 px-4">ENDPOINT</th>
                <th className="py-2.5 px-4">DESCRIPTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-slate-300">
              <tr>
                <td className="py-2.5 px-4 text-emerald-400">WS</td>
                <td className="py-2.5 px-4 text-white">/api/ws</td>
                <td className="py-2.5 px-4 font-sans">1 Hz real-time telemetry broadcast stream</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 text-cyan-400">GET</td>
                <td className="py-2.5 px-4 text-white">/api/status</td>
                <td className="py-2.5 px-4 font-sans">Complete pack, cell, SoH, fault, and adaptive charging snapshot</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 text-cyan-400">GET</td>
                <td className="py-2.5 px-4 text-white">/api/cells</td>
                <td className="py-2.5 px-4 font-sans">Individual cell voltages, internal resistances, ΔV, and balancing states</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 text-cyan-400">GET</td>
                <td className="py-2.5 px-4 text-white">/api/soh</td>
                <td className="py-2.5 px-4 font-sans">Random Forest SoH predictions, RUL, and feature importances</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 text-amber-400">POST</td>
                <td className="py-2.5 px-4 text-white">/api/faults/inject</td>
                <td className="py-2.5 px-4 font-sans">Inject or clear any of the 8 fault conditions</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 text-amber-400">POST</td>
                <td className="py-2.5 px-4 text-white">/api/charging/control</td>
                <td className="py-2.5 px-4 font-sans">Control charger/load state and target charging current</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 text-amber-400">POST</td>
                <td className="py-2.5 px-4 text-white">/api/hardware/ingest</td>
                <td className="py-2.5 px-4 font-sans">Ingest external ESP32 sensor frame and return relay commands</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
