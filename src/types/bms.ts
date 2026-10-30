/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ChargingMode =
  | 'NORMAL'
  | 'BALANCING'
  | 'REDUCED_THERMAL'
  | 'PAUSED_THERMAL'
  | 'CONSERVATIVE_SOH'
  | 'DISCONNECTED_FAULT'
  | 'SAFE_FALLBACK'
  | 'IDLE';

export type FaultType =
  | 'NONE'
  | 'OVERVOLTAGE'
  | 'UNDERVOLTAGE'
  | 'OVERCURRENT'
  | 'OVERTEMPERATURE'
  | 'CELL_IMBALANCE'
  | 'WEAK_CELL'
  | 'ABNORMAL_BEHAVIOUR'
  | 'SENSOR_FAILURE'
  | 'LOW_AI_CONFIDENCE';

export type FaultSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export type OperationState = 'CHARGING' | 'DISCHARGING' | 'IDLE' | 'FAULT_LOCKOUT';

export interface CellReading {
  cellId: number;
  voltage: number; // V (e.g., 3.000V - 4.250V)
  temperature: number; // °C
  internalResistance: number; // mΩ
  soc: number; // %
  soh: number; // %
  isBalancing: boolean;
  isWeak: boolean;
  status: 'NOMINAL' | 'IMBALANCED' | 'WEAK' | 'CRITICAL';
}

export interface MLFeatureVector {
  meanCellVoltage: number;
  packVoltage: number;
  chargingCurrent: number;
  dischargingCurrent: number;
  batteryTemperature: number;
  chargingTimeSeconds: number;
  capacityDeliveredAh: number;
  cycleNumber: number;
  cellVoltageDifference: number; // V
}

export interface SoHPredictionResult {
  id?: number;
  timestamp: string;
  predictedSoH: number; // % (0 - 100)
  confidence: number; // % (0 - 100)
  uncertaintyStd: number; // ± % across trees
  rulCycles: number; // Remaining Useful Life in cycles
  isExperimental: boolean;
  features: MLFeatureVector;
  featureImportances: Record<string, number>;
}

export interface FaultDetectionResult {
  faultType: FaultType;
  severity: FaultSeverity;
  confidence: number; // %
  isHardwareSafetyOverride: boolean;
  detectedBy: 'HARDWARE_PROTECTION' | 'RANDOM_FOREST_CLASSIFIER' | 'CONSENSUS';
  timestamp: string;
  relevantReadings: {
    packVoltage: number;
    maxCellVoltage: number;
    minCellVoltage: number;
    cellDeltaMv: number;
    packCurrent: number;
    maxTemperature: number;
  };
  recommendedAction: string;
  description: string;
}

export interface AdaptiveChargingState {
  mode: ChargingMode;
  targetCurrentAmps: number;
  maxAllowedCurrentAmps: number;
  targetVoltageVolts: number;
  mosfetRelayClosed: boolean;
  loadRelayClosed: boolean;
  activeBalancing: boolean;
  balancingCellIds: number[];
  aiOverrideActive: boolean;
  hardwareSafetyTripped: boolean;
  reason: string;
  ruleTriggered: string;
}

export interface SafetyThresholds {
  maxCellVoltage: number; // default 4.22 V
  minCellVoltage: number; // default 2.85 V
  maxPackVoltage: number; // default 16.88 V (for 4S)
  minPackVoltage: number; // default 11.40 V
  maxChargingCurrent: number; // default 5.0 A
  maxDischargingCurrent: number; // default 8.0 A
  highTempThreshold: number; // default 42.0 °C
  criticalTempThreshold: number; // default 48.0 °C
  imbalanceThresholdMv: number; // default 45 mV
  criticalImbalanceMv: number; // default 120 mV
  lowSoHThreshold: number; // default 80.0 %
  minAiConfidence: number; // default 70.0 %
}

export interface ActiveInjectedFaults {
  overvoltage: boolean;
  undervoltage: boolean;
  overcurrent: boolean;
  overtemperature: boolean;
  cellImbalance: boolean;
  weakCell: boolean;
  sensorFailure: boolean;
  lowAiConfidence: boolean;
}

export interface BatteryTelemetrySnapshot {
  id?: number;
  timestamp: string;
  source: 'SIMULATION' | 'ESP32_HARDWARE';
  simulationRunning: boolean;
  operationState: OperationState;
  packId: string;
  packName: string;
  chemistry: string;
  seriesCells: number;
  nominalCapacityAh: number;
  remainingCapacityAh: number;
  capacityDeliveredAh: number;
  chargingTimeSeconds: number;
  packVoltage: number;
  packCurrent: number; // + for charging, - for discharging
  packPowerWatts: number;
  soc: number; // %
  soh: number; // %
  averageTemperature: number;
  maxTemperature: number;
  ambientTemperature: number;
  cycleCount: number;
  maxCellVoltage: number;
  minCellVoltage: number;
  cellVoltageDeltaMv: number;
  weakCellIds: number[];
  sensorValid: boolean;
  cells: CellReading[];
  sohPrediction: SoHPredictionResult;
  faultDetection: FaultDetectionResult;
  chargingState: AdaptiveChargingState;
  activeInjectedFaults: ActiveInjectedFaults;
  thresholds: SafetyThresholds;
}

export interface FaultEventRecord {
  id: number;
  timestamp: string;
  faultType: FaultType;
  severity: FaultSeverity;
  detectedBy: string;
  packVoltage: number;
  packCurrent: number;
  maxTemperature: number;
  cellDeltaMv: number;
  aiConfidence: number;
  safetyResponse: string;
  recommendedAction: string;
  cleared: boolean;
  clearedAt: string | null;
}

export interface ChargingSessionRecord {
  id: number;
  startTime: string;
  endTime: string | null;
  startSoc: number;
  endSoc: number;
  capacityDeliveredAh: number;
  averageCurrentA: number;
  peakTempC: number;
  predominantMode: ChargingMode;
  efficiencyPercent: number;
  status: 'ACTIVE' | 'COMPLETED' | 'ABORTED_FAULT';
}

export interface MLModelMetadata {
  regressorName: string;
  classifierName: string;
  datasetType: 'SYNTHETIC_EXPERIMENTAL' | 'UPLOADED_EMPIRICAL';
  trainingSamples: number;
  treeCount: number;
  sohR2Score: number;
  sohMaeScore: number;
  faultAccuracy: number;
  lastTrainedAt: string;
  featureNames: string[];
  regressorFeatureImportances: Record<string, number>;
  classifierFeatureImportances: Record<string, number>;
}
