/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Database from 'better-sqlite3';
import path from 'path';
import {
  BatteryTelemetrySnapshot,
  ChargingSessionRecord,
  FaultEventRecord,
  SafetyThresholds,
  SoHPredictionResult,
} from '../types/bms';
import { DEFAULT_SAFETY_THRESHOLDS } from './bmsRules';

const dbPath = path.resolve(process.cwd(), 'zeroth_bms.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Initialize SQLite tables for all 8 required domain models
db.exec(`
  CREATE TABLE IF NOT EXISTS battery_packs (
    pack_id TEXT PRIMARY KEY,
    pack_name TEXT NOT NULL,
    chemistry TEXT NOT NULL,
    series_cells INTEGER NOT NULL,
    nominal_capacity_ah REAL NOT NULL,
    cycle_count INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS battery_cells (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pack_id TEXT NOT NULL,
    cell_id INTEGER NOT NULL,
    voltage REAL NOT NULL,
    temperature REAL NOT NULL,
    internal_resistance REAL NOT NULL,
    soc REAL NOT NULL,
    soh REAL NOT NULL,
    is_balancing INTEGER NOT NULL,
    is_weak INTEGER NOT NULL,
    status TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sensor_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    source TEXT NOT NULL,
    pack_voltage REAL NOT NULL,
    pack_current REAL NOT NULL,
    soc REAL NOT NULL,
    soh REAL NOT NULL,
    avg_temp REAL NOT NULL,
    max_temp REAL NOT NULL,
    min_cell_v REAL NOT NULL,
    max_cell_v REAL NOT NULL,
    cell_delta_mv REAL NOT NULL,
    charging_mode TEXT NOT NULL,
    fault_type TEXT NOT NULL,
    cells_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS soh_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    cycle_number INTEGER NOT NULL,
    predicted_soh REAL NOT NULL,
    confidence REAL NOT NULL,
    uncertainty_std REAL NOT NULL,
    rul_cycles INTEGER NOT NULL,
    features_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fault_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    fault_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    detected_by TEXT NOT NULL,
    pack_voltage REAL NOT NULL,
    pack_current REAL NOT NULL,
    max_temperature REAL NOT NULL,
    cell_delta_mv REAL NOT NULL,
    ai_confidence REAL NOT NULL,
    safety_response TEXT NOT NULL,
    recommended_action TEXT NOT NULL,
    cleared INTEGER NOT NULL DEFAULT 0,
    cleared_at TEXT
  );

  CREATE TABLE IF NOT EXISTS charging_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time TEXT NOT NULL,
    end_time TEXT,
    start_soc REAL NOT NULL,
    end_soc REAL NOT NULL,
    capacity_delivered_ah REAL NOT NULL,
    average_current_a REAL NOT NULL,
    peak_temp_c REAL NOT NULL,
    predominant_mode TEXT NOT NULL,
    efficiency_percent REAL NOT NULL,
    status TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_model_info (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    regressor_name TEXT NOT NULL,
    classifier_name TEXT NOT NULL,
    dataset_type TEXT NOT NULL,
    training_samples INTEGER NOT NULL,
    soh_r2_score REAL NOT NULL,
    soh_mae_score REAL NOT NULL,
    fault_accuracy REAL NOT NULL,
    last_trained_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    thresholds_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// Seed initial historical data if database is empty so Analytics & Reports are immediately rich on startup
const readingCount = (db.prepare('SELECT COUNT(*) as cnt FROM sensor_readings').get() as { cnt: number }).cnt;
if (readingCount === 0) {
  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO battery_packs (pack_id, pack_name, chemistry, series_cells, nominal_capacity_ah, cycle_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('PACK-EV-4S01', 'ZEROTH 4S1P NMC Prototype Pack', 'LiNiMnCoO2 (NMC 18650)', 4, 5.0, 142, new Date(now - 86400000 * 30).toISOString());

  db.prepare(`
    INSERT OR IGNORE INTO system_config (id, thresholds_json, updated_at)
    VALUES (1, ?, ?)
  `).run(JSON.stringify(DEFAULT_SAFETY_THRESHOLDS), new Date().toISOString());

  // Seed historical SoH degradation across cycles (Cycles 10 to 140)
  const insertSoh = db.prepare(`
    INSERT INTO soh_predictions (timestamp, cycle_number, predicted_soh, confidence, uncertainty_std, rul_cycles, features_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (let c = 10; c <= 140; c += 10) {
    const ts = new Date(now - (150 - c) * 3600 * 1000).toISOString();
    const soh = Number((99.4 - c * 0.042 + Math.sin(c) * 0.15).toFixed(2));
    const rul = Math.round(((soh - 70) / 30) * 1100);
    insertSoh.run(
      ts,
      c,
      soh,
      Number((94.2 - (c % 3) * 0.6).toFixed(1)),
      0.62,
      rul,
      JSON.stringify({
        meanCellVoltage: 3.85,
        packVoltage: 15.4,
        chargingCurrent: 3.2,
        dischargingCurrent: 0,
        batteryTemperature: 29.5,
        chargingTimeSeconds: 1800,
        capacityDeliveredAh: 2.1,
        cycleNumber: c,
        cellVoltageDifference: 0.014 + c * 0.0001,
      })
    );
  }

  // Seed historical charging sessions
  const insertSession = db.prepare(`
    INSERT INTO charging_sessions (start_time, end_time, start_soc, end_soc, capacity_delivered_ah, average_current_a, peak_temp_c, predominant_mode, efficiency_percent, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertSession.run(new Date(now - 86400000 * 4).toISOString(), new Date(now - 86400000 * 4 + 3900000).toISOString(), 22.0, 95.0, 3.65, 3.38, 33.4, 'NORMAL', 96.4, 'COMPLETED');
  insertSession.run(new Date(now - 86400000 * 3).toISOString(), new Date(now - 86400000 * 3 + 4500000).toISOString(), 18.5, 92.0, 3.68, 2.95, 36.8, 'BALANCING', 94.8, 'COMPLETED');
  insertSession.run(new Date(now - 86400000 * 2).toISOString(), new Date(now - 86400000 * 2 + 2100000).toISOString(), 31.0, 64.0, 1.65, 2.10, 44.2, 'REDUCED_THERMAL', 92.1, 'COMPLETED');
  insertSession.run(new Date(now - 86400000 * 1).toISOString(), new Date(now - 86400000 * 1 + 1400000).toISOString(), 40.0, 58.5, 0.92, 3.10, 49.1, 'DISCONNECTED_FAULT', 89.5, 'ABORTED_FAULT');

  // Seed historical fault events
  const insertFault = db.prepare(`
    INSERT INTO fault_events (timestamp, fault_type, severity, detected_by, pack_voltage, pack_current, max_temperature, cell_delta_mv, ai_confidence, safety_response, recommended_action, cleared, cleared_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertFault.run(
    new Date(now - 86400000 * 3 + 1200000).toISOString(),
    'CELL_IMBALANCE',
    'WARNING',
    'RANDOM_FOREST_CLASSIFIER',
    15.52,
    2.1,
    35.2,
    58.4,
    92.5,
    'Reduced charging current to 2.0A and enabled passive cell balancing.',
    'Allow passive bleed equalization to bring ΔV below 25 mV.',
    1,
    new Date(now - 86400000 * 3 + 3600000).toISOString()
  );
  insertFault.run(
    new Date(now - 86400000 * 1 + 1400000).toISOString(),
    'OVERTEMPERATURE',
    'CRITICAL',
    'CONSENSUS',
    15.68,
    0.0,
    49.1,
    22.0,
    98.0,
    'Hardware protection tripped: Charger MOSFET opened immediately.',
    'Pause charging and inspect pack thermal dissipation.',
    1,
    new Date(now - 86400000 * 1 + 2900000).toISOString()
  );
}

export function saveTelemetryReading(snapshot: BatteryTelemetrySnapshot): void {
  db.prepare(`
    INSERT INTO sensor_readings (timestamp, source, pack_voltage, pack_current, soc, soh, avg_temp, max_temp, min_cell_v, max_cell_v, cell_delta_mv, charging_mode, fault_type, cells_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshot.timestamp,
    snapshot.source,
    snapshot.packVoltage,
    snapshot.packCurrent,
    snapshot.soc,
    snapshot.soh,
    snapshot.averageTemperature,
    snapshot.maxTemperature,
    snapshot.minCellVoltage,
    snapshot.maxCellVoltage,
    snapshot.cellVoltageDeltaMv,
    snapshot.chargingState.mode,
    snapshot.faultDetection.faultType,
    JSON.stringify(snapshot.cells)
  );

  // Keep sensor_readings table bounded to latest 600 rows
  db.prepare(`
    DELETE FROM sensor_readings WHERE id NOT IN (
      SELECT id FROM sensor_readings ORDER BY id DESC LIMIT 600
    )
  `).run();
}

export function saveSoHPrediction(pred: SoHPredictionResult): void {
  db.prepare(`
    INSERT INTO soh_predictions (timestamp, cycle_number, predicted_soh, confidence, uncertainty_std, rul_cycles, features_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    pred.timestamp,
    pred.features.cycleNumber,
    pred.predictedSoH,
    pred.confidence,
    pred.uncertaintyStd,
    pred.rulCycles,
    JSON.stringify(pred.features)
  );
}

export function recordFaultEvent(snapshot: BatteryTelemetrySnapshot): FaultEventRecord | null {
  const fault = snapshot.faultDetection;
  if (fault.faultType === 'NONE') return null;

  // Check if an identical uncleared fault is already open to avoid duplicate spam every tick
  const existing = db
    .prepare(`SELECT id FROM fault_events WHERE fault_type = ? AND cleared = 0 LIMIT 1`)
    .get(fault.faultType) as { id: number } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE fault_events
      SET pack_voltage = ?, pack_current = ?, max_temperature = ?, cell_delta_mv = ?, ai_confidence = ?, safety_response = ?
      WHERE id = ?
    `).run(
      snapshot.packVoltage,
      snapshot.packCurrent,
      snapshot.maxTemperature,
      snapshot.cellVoltageDeltaMv,
      fault.confidence,
      snapshot.chargingState.reason,
      existing.id
    );
    return null;
  }

  const info = db.prepare(`
    INSERT INTO fault_events (timestamp, fault_type, severity, detected_by, pack_voltage, pack_current, max_temperature, cell_delta_mv, ai_confidence, safety_response, recommended_action, cleared, cleared_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
  `).run(
    fault.timestamp,
    fault.faultType,
    fault.severity,
    fault.detectedBy,
    snapshot.packVoltage,
    snapshot.packCurrent,
    snapshot.maxTemperature,
    snapshot.cellVoltageDeltaMv,
    fault.confidence,
    snapshot.chargingState.reason,
    fault.recommendedAction
  );

  return {
    id: Number(info.lastInsertRowid),
    timestamp: fault.timestamp,
    faultType: fault.faultType,
    severity: fault.severity,
    detectedBy: fault.detectedBy,
    packVoltage: snapshot.packVoltage,
    packCurrent: snapshot.packCurrent,
    maxTemperature: snapshot.maxTemperature,
    cellDeltaMv: snapshot.cellVoltageDeltaMv,
    aiConfidence: fault.confidence,
    safetyResponse: snapshot.chargingState.reason,
    recommendedAction: fault.recommendedAction,
    cleared: false,
    clearedAt: null,
  };
}

export function markFaultEventsCleared(faultType?: string): number {
  const now = new Date().toISOString();
  if (faultType) {
    const res = db
      .prepare(`UPDATE fault_events SET cleared = 1, cleared_at = ? WHERE fault_type = ? AND cleared = 0`)
      .run(now, faultType);
    return res.changes;
  }
  const res = db.prepare(`UPDATE fault_events SET cleared = 1, cleared_at = ? WHERE cleared = 0`).run(now);
  return res.changes;
}

export function getRecentReadings(limit = 60) {
  const rows = db
    .prepare(`SELECT * FROM sensor_readings ORDER BY id DESC LIMIT ?`)
    .all(limit) as Record<string, unknown>[];
  return rows.reverse().map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    source: r.source,
    packVoltage: r.pack_voltage,
    packCurrent: r.pack_current,
    soc: r.soc,
    soh: r.soh,
    averageTemperature: r.avg_temp,
    maxTemperature: r.max_temp,
    minCellVoltage: r.min_cell_v,
    maxCellVoltage: r.max_cell_v,
    cellVoltageDeltaMv: r.cell_delta_mv,
    chargingMode: r.charging_mode,
    faultType: r.fault_type,
    cells: JSON.parse(String(r.cells_json || '[]')),
  }));
}

export function getSoHHistory(limit = 50): SoHPredictionResult[] {
  const rows = db
    .prepare(`SELECT * FROM soh_predictions ORDER BY id DESC LIMIT ?`)
    .all(limit) as Record<string, unknown>[];
  return rows.reverse().map((r) => ({
    id: Number(r.id),
    timestamp: String(r.timestamp),
    predictedSoH: Number(r.predicted_soh),
    confidence: Number(r.confidence),
    uncertaintyStd: Number(r.uncertainty_std),
    rulCycles: Number(r.rul_cycles),
    isExperimental: true,
    features: JSON.parse(String(r.features_json || '{}')),
    featureImportances: {},
  }));
}

export function getFaultHistory(limit = 50): FaultEventRecord[] {
  const rows = db
    .prepare(`SELECT * FROM fault_events ORDER BY id DESC LIMIT ?`)
    .all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    timestamp: String(r.timestamp),
    faultType: r.fault_type as FaultEventRecord['faultType'],
    severity: r.severity as FaultEventRecord['severity'],
    detectedBy: String(r.detectedBy || r.detected_by),
    packVoltage: Number(r.pack_voltage),
    packCurrent: Number(r.pack_current),
    maxTemperature: Number(r.max_temperature),
    cellDeltaMv: Number(r.cell_delta_mv),
    aiConfidence: Number(r.ai_confidence),
    safetyResponse: String(r.safety_response),
    recommendedAction: String(r.recommended_action),
    cleared: Boolean(r.cleared),
    clearedAt: r.cleared_at ? String(r.cleared_at) : null,
  }));
}

export function getChargingSessions(limit = 25): ChargingSessionRecord[] {
  const rows = db
    .prepare(`SELECT * FROM charging_sessions ORDER BY id DESC LIMIT ?`)
    .all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    startTime: String(r.start_time),
    endTime: r.end_time ? String(r.end_time) : null,
    startSoc: Number(r.start_soc),
    endSoc: Number(r.end_soc),
    capacityDeliveredAh: Number(r.capacity_delivered_ah),
    averageCurrentA: Number(r.average_current_a),
    peakTempC: Number(r.peak_temp_c),
    predominantMode: r.predominant_mode as ChargingSessionRecord['predominantMode'],
    efficiencyPercent: Number(r.efficiency_percent),
    status: r.status as ChargingSessionRecord['status'],
  }));
}

export function getSavedThresholds(): SafetyThresholds {
  const row = db.prepare(`SELECT thresholds_json FROM system_config WHERE id = 1`).get() as
    | { thresholds_json: string }
    | undefined;
  if (!row) return { ...DEFAULT_SAFETY_THRESHOLDS };
  try {
    return { ...DEFAULT_SAFETY_THRESHOLDS, ...JSON.parse(row.thresholds_json) };
  } catch {
    return { ...DEFAULT_SAFETY_THRESHOLDS };
  }
}

export function saveSafetyThresholds(thresholds: SafetyThresholds): SafetyThresholds {
  db.prepare(`
    INSERT INTO system_config (id, thresholds_json, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET thresholds_json = excluded.thresholds_json, updated_at = excluded.updated_at
  `).run(JSON.stringify(thresholds), new Date().toISOString());
  return thresholds;
}
