/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SAFETY_THRESHOLDS,
  evaluateAdaptiveCharging,
  generateSyntheticDataset,
  RandomForestBMSPipeline,
} from './bmsRules';
import { MLFeatureVector } from '../types/bms';

const pipeline = new RandomForestBMSPipeline();

const nominalFeatures: MLFeatureVector = {
  meanCellVoltage: 3.85,
  packVoltage: 15.4,
  chargingCurrent: 3.2,
  dischargingCurrent: 0.0,
  batteryTemperature: 28.5,
  chargingTimeSeconds: 950,
  capacityDeliveredAh: 0.85,
  cycleNumber: 65,
  cellVoltageDifference: 0.012,
};

test('1. Synthetic dataset generation produces balanced labeled records', () => {
  const ds = generateSyntheticDataset(200, 101);
  assert.equal(ds.length, 200);
  assert.ok(ds[0].features.length === 9);
  assert.ok(ds.some((d) => d.faultClass === 'OVERTEMPERATURE'));
  assert.ok(ds.some((d) => d.faultClass === 'CELL_IMBALANCE'));
  assert.ok(ds.some((d) => d.faultClass === 'NONE'));
});

test('2. Random Forest Regressor predicts higher SoH for low-cycle healthy battery than aged high-cycle battery', () => {
  const healthyPred = pipeline.predictSoH(nominalFeatures, false, true);
  const agedPred = pipeline.predictSoH(
    {
      ...nominalFeatures,
      cycleNumber: 1200,
      batteryTemperature: 41.0,
      cellVoltageDifference: 0.085,
    },
    false,
    true
  );

  assert.ok(healthyPred.predictedSoH > 88, `Expected healthy SoH > 88, got ${healthyPred.predictedSoH}`);
  assert.ok(agedPred.predictedSoH < healthyPred.predictedSoH, 'Aged battery must have lower predicted SoH');
  assert.equal(healthyPred.isExperimental, true);
  assert.ok(healthyPred.confidence >= 70);
});

test('3. Overtemperature fault detection triggers CRITICAL hardware safety override', () => {
  const fault = pipeline.detectFaults({
    features: { ...nominalFeatures, batteryTemperature: 52.4 },
    maxCellVoltage: 3.92,
    minCellVoltage: 3.90,
    maxTemperature: 52.4,
    packCurrent: 3.2,
    sensorValid: true,
    weakCellDetected: false,
    forceLowConfidence: false,
    thresholds: DEFAULT_SAFETY_THRESHOLDS,
  });

  assert.equal(fault.faultType, 'OVERTEMPERATURE');
  assert.equal(fault.severity, 'CRITICAL');
  assert.equal(fault.isHardwareSafetyOverride, true);
});

test('4. Overcurrent fault detection triggers CRITICAL cutoff on excessive current', () => {
  const fault = pipeline.detectFaults({
    features: { ...nominalFeatures, chargingCurrent: 6.8 },
    maxCellVoltage: 3.95,
    minCellVoltage: 3.93,
    maxTemperature: 33.0,
    packCurrent: 6.8,
    sensorValid: true,
    weakCellDetected: false,
    forceLowConfidence: false,
    thresholds: DEFAULT_SAFETY_THRESHOLDS,
  });

  assert.equal(fault.faultType, 'OVERCURRENT');
  assert.equal(fault.severity, 'CRITICAL');
  assert.equal(fault.isHardwareSafetyOverride, true);
});

test('5. Cell imbalance detection identifies moderate and critical voltage delta', () => {
  const fault = pipeline.detectFaults({
    features: { ...nominalFeatures, cellVoltageDifference: 0.068 },
    maxCellVoltage: 3.968,
    minCellVoltage: 3.900,
    maxTemperature: 30.0,
    packCurrent: 2.8,
    sensorValid: true,
    weakCellDetected: false,
    forceLowConfidence: false,
    thresholds: DEFAULT_SAFETY_THRESHOLDS,
  });

  assert.equal(fault.faultType, 'CELL_IMBALANCE');
  assert.equal(fault.severity, 'WARNING');
});

test('6. Adaptive charging selects BALANCING mode with reduced current on moderate cell imbalance', () => {
  const fault = pipeline.detectFaults({
    features: { ...nominalFeatures, cellVoltageDifference: 0.062 },
    maxCellVoltage: 3.962,
    minCellVoltage: 3.900,
    maxTemperature: 29.0,
    packCurrent: 3.0,
    sensorValid: true,
    weakCellDetected: false,
    forceLowConfidence: false,
    thresholds: DEFAULT_SAFETY_THRESHOLDS,
  });

  const decision = evaluateAdaptiveCharging({
    operationState: 'CHARGING',
    soc: 60,
    predictedSoH: 94.0,
    aiConfidence: 91.0,
    sensorValid: true,
    maxTemperature: 29.0,
    cellDeltaMv: 62,
    cellVoltages: [3.962, 3.940, 3.915, 3.900],
    fault,
    thresholds: DEFAULT_SAFETY_THRESHOLDS,
    nominalChargeCurrentAmps: 4.0,
  });

  assert.equal(decision.mode, 'BALANCING');
  assert.equal(decision.activeBalancing, true);
  assert.equal(decision.targetCurrentAmps, 2.0);
  assert.ok(decision.balancingCellIds.includes(1));
});

test('7. Hardware safety override disconnects MOSFET relay on critical fault regardless of AI', () => {
  const fault = pipeline.detectFaults({
    features: { ...nominalFeatures, batteryTemperature: 51.0 },
    maxCellVoltage: 4.0,
    minCellVoltage: 3.98,
    maxTemperature: 51.0,
    packCurrent: 3.5,
    sensorValid: true,
    weakCellDetected: false,
    forceLowConfidence: false,
    thresholds: DEFAULT_SAFETY_THRESHOLDS,
  });

  const decision = evaluateAdaptiveCharging({
    operationState: 'CHARGING',
    soc: 55,
    predictedSoH: 95.0,
    aiConfidence: 96.0,
    sensorValid: true,
    maxTemperature: 51.0,
    cellDeltaMv: 20,
    cellVoltages: [4.0, 3.99, 3.99, 3.98],
    fault,
    thresholds: DEFAULT_SAFETY_THRESHOLDS,
    nominalChargeCurrentAmps: 4.0,
  });

  assert.equal(decision.mode, 'DISCONNECTED_FAULT');
  assert.equal(decision.mosfetRelayClosed, false);
  assert.equal(decision.targetCurrentAmps, 0.0);
  assert.equal(decision.hardwareSafetyTripped, true);
});

test('8. Low AI confidence or sensor failure triggers SAFE_FALLBACK mode and disables AI optimization', () => {
  const faultLowConf = pipeline.detectFaults({
    features: nominalFeatures,
    maxCellVoltage: 3.86,
    minCellVoltage: 3.85,
    maxTemperature: 28.0,
    packCurrent: 3.0,
    sensorValid: true,
    weakCellDetected: false,
    forceLowConfidence: true,
    thresholds: DEFAULT_SAFETY_THRESHOLDS,
  });

  assert.equal(faultLowConf.faultType, 'LOW_AI_CONFIDENCE');

  const decision = evaluateAdaptiveCharging({
    operationState: 'CHARGING',
    soc: 50,
    predictedSoH: 92.0,
    aiConfidence: 46.0,
    sensorValid: true,
    maxTemperature: 28.0,
    cellDeltaMv: 10,
    cellVoltages: [3.86, 3.85, 3.85, 3.85],
    fault: faultLowConf,
    thresholds: DEFAULT_SAFETY_THRESHOLDS,
    nominalChargeCurrentAmps: 4.0,
  });

  assert.equal(decision.mode, 'SAFE_FALLBACK');
  assert.equal(decision.aiOverrideActive, true);
  assert.ok(decision.targetCurrentAmps < 4.0);
});

test('9. Low predicted SoH (<80%) triggers CONSERVATIVE_SOH charging mode', () => {
  const nominalFault = pipeline.detectFaults({
    features: nominalFeatures,
    maxCellVoltage: 3.86,
    minCellVoltage: 3.85,
    maxTemperature: 28.0,
    packCurrent: 3.0,
    sensorValid: true,
    weakCellDetected: false,
    forceLowConfidence: false,
    thresholds: DEFAULT_SAFETY_THRESHOLDS,
  });

  const decision = evaluateAdaptiveCharging({
    operationState: 'CHARGING',
    soc: 50,
    predictedSoH: 74.5,
    aiConfidence: 89.0,
    sensorValid: true,
    maxTemperature: 28.0,
    cellDeltaMv: 10,
    cellVoltages: [3.86, 3.85, 3.85, 3.85],
    fault: nominalFault,
    thresholds: DEFAULT_SAFETY_THRESHOLDS,
    nominalChargeCurrentAmps: 4.0,
  });

  assert.equal(decision.mode, 'CONSERVATIVE_SOH');
  assert.equal(decision.targetCurrentAmps, 2.6);
});
