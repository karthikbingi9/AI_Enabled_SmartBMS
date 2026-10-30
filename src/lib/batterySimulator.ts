/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ActiveInjectedFaults,
  BatteryTelemetrySnapshot,
  CellReading,
  MLFeatureVector,
  OperationState,
  SafetyThresholds,
} from '../types/bms';
import {
  evaluateAdaptiveCharging,
  RandomForestBMSPipeline,
} from './bmsRules';
import {
  getSavedThresholds,
  markFaultEventsCleared,
  recordFaultEvent,
  saveSafetyThresholds,
  saveSoHPrediction,
  saveTelemetryReading,
} from './database';

export class BatterySimulatorEngine {
  private mlPipeline: RandomForestBMSPipeline;
  private running = true;
  private source: 'SIMULATION' | 'ESP32_HARDWARE' = 'SIMULATION';
  private operationState: OperationState = 'CHARGING';
  private packId = 'PACK-EV-4S01';
  private packName = 'ZEROTH 4S1P NMC Prototype Pack';
  private chemistry = 'LiNiMnCoO2 (NMC 18650)';
  private seriesCells = 4;
  private nominalCapacityAh = 5.0;
  private soc = 64.5; // %
  private cycleCount = 142;
  private ambientTemperature = 25.0; // °C
  private cellTemperatures: number[] = [28.4, 28.9, 28.6, 28.5];
  private cellSocOffsets: number[] = [0.4, -0.2, 0.1, -0.3];
  private cellBaseResistanceMOhm: number[] = [28.0, 29.5, 28.8, 30.2];
  private chargingTimeSeconds = 840;
  private capacityDeliveredAh = 0.92;
  private requestedChargeCurrentAmps = 4.0;
  private requestedDischargeCurrentAmps = 2.8;
  private tickCounter = 0;

  private activeInjectedFaults: ActiveInjectedFaults = {
    overvoltage: false,
    undervoltage: false,
    overcurrent: false,
    overtemperature: false,
    cellImbalance: false,
    weakCell: false,
    sensorFailure: false,
    lowAiConfidence: false,
  };

  private thresholds: SafetyThresholds;
  private latestSnapshot: BatteryTelemetrySnapshot;

  constructor(mlPipeline: RandomForestBMSPipeline) {
    this.mlPipeline = mlPipeline;
    this.thresholds = getSavedThresholds();
    this.latestSnapshot = this.computeNextStep(0);
  }

  public getLatestSnapshot(): BatteryTelemetrySnapshot {
    return this.latestSnapshot;
  }

  public getMLPipeline(): RandomForestBMSPipeline {
    return this.mlPipeline;
  }

  public step(dtSeconds = 1.0): BatteryTelemetrySnapshot {
    if (!this.running && this.source === 'SIMULATION') {
      return this.latestSnapshot;
    }
    this.tickCounter++;
    this.latestSnapshot = this.computeNextStep(dtSeconds);

    // Persist reading to SQLite every 2 ticks (or immediately on fault)
    if (this.tickCounter % 2 === 0 || this.latestSnapshot.faultDetection.faultType !== 'NONE') {
      saveTelemetryReading(this.latestSnapshot);
    }
    if (this.tickCounter % 10 === 0) {
      saveSoHPrediction(this.latestSnapshot.sohPrediction);
    }
    if (this.latestSnapshot.faultDetection.faultType !== 'NONE') {
      recordFaultEvent(this.latestSnapshot);
    }

    return this.latestSnapshot;
  }

  /**
   * Non-linear NMC Lithium-Ion Open-Circuit Voltage (OCV) curve from 0% to 100% SoC
   */
  private socToOcv(socPercent: number): number {
    const s = Math.max(0.01, Math.min(0.999, socPercent / 100));
    // Realistic NMC 18650 OCV curve (~3.00V at 0% to ~4.19V at 100%)
    const ocv =
      3.02 +
      1.04 * s -
      0.32 * Math.pow(s, 2) +
      0.44 * Math.pow(s, 3) -
      0.04 * Math.log((1 - s) / s);
    return Math.max(2.65, Math.min(4.24, ocv));
  }

  private computeNextStep(dtSeconds: number): BatteryTelemetrySnapshot {
    // 1. Determine base electrical current before safety/adaptive feedback
    let actualCurrent = 0; // + charging, - discharging
    if (this.operationState === 'CHARGING') {
      actualCurrent = this.requestedChargeCurrentAmps;
    } else if (this.operationState === 'DISCHARGING') {
      actualCurrent = -this.requestedDischargeCurrentAmps;
    }

    // Apply overcurrent fault injection if active
    if (this.activeInjectedFaults.overcurrent) {
      actualCurrent = this.operationState === 'DISCHARGING' ? -9.6 : 6.8;
    }

    // Check previous step's hardware safety cutoff unless overcurrent is actively forced on this tick
    if (this.latestSnapshot && !this.activeInjectedFaults.overcurrent) {
      const prevCharge = this.latestSnapshot.chargingState;
      if (this.operationState === 'CHARGING') {
        if (!prevCharge.mosfetRelayClosed) {
          actualCurrent = 0.0;
        } else {
          actualCurrent = Math.min(actualCurrent, prevCharge.targetCurrentAmps);
        }
      } else if (this.operationState === 'DISCHARGING' && !prevCharge.loadRelayClosed) {
        actualCurrent = 0.0;
      }
    }

    // 2. Coulomb counting SoC integration (accelerated 15x for interactive real-time observation)
    const simSpeedMultiplier = 15;
    const dAh = (actualCurrent * dtSeconds * simSpeedMultiplier) / 3600;
    if (dtSeconds > 0) {
      this.soc = Math.max(2.0, Math.min(99.8, this.soc + (dAh / this.nominalCapacityAh) * 100));
      if (actualCurrent > 0.05) {
        this.chargingTimeSeconds += Math.round(dtSeconds * 5);
        this.capacityDeliveredAh = Number((this.capacityDeliveredAh + Math.abs(dAh)).toFixed(3));
      }
    }

    // 3. Thermal dynamics per cell: dT = (I^2 * R_int - h*A*(T - T_amb)) * dt
    const cells: CellReading[] = [];
    for (let i = 0; i < this.seriesCells; i++) {
      const isWeakCell = i === 2 && this.activeInjectedFaults.weakCell;
      const rIntMOhm =
        this.cellBaseResistanceMOhm[i] *
        (1 + this.cycleCount * 0.0005) *
        (isWeakCell ? 2.45 : 1.0);

      // Joule heating + ambient Newton cooling
      const jouleHeat = Math.pow(actualCurrent, 2) * (rIntMOhm / 1000) * 0.42;
      const cooling = (this.cellTemperatures[i] - this.ambientTemperature) * 0.08;
      const microJitter = Math.sin(this.tickCounter * 0.4 + i) * 0.04;

      if (dtSeconds > 0) {
        this.cellTemperatures[i] = Math.max(
          this.ambientTemperature - 2,
          this.cellTemperatures[i] + (jouleHeat - cooling) * dtSeconds + microJitter
        );
      }

      // If overtemperature fault is injected, drive cell temperatures to critical thermal runaway warning zone
      let effectiveCellTemp = this.cellTemperatures[i];
      if (this.activeInjectedFaults.overtemperature) {
        effectiveCellTemp = Math.max(effectiveCellTemp, 51.8 + i * 0.6 + Math.sin(this.tickCounter * 0.5) * 0.3);
      }

      // Passive balancing bleed pulls high cells slightly toward mean SoC
      if (this.latestSnapshot?.chargingState.balancingCellIds.includes(i + 1) && dtSeconds > 0) {
        this.cellSocOffsets[i] = Math.max(-0.2, this.cellSocOffsets[i] - 0.04);
      }

      let cellSoc = Math.max(1.0, Math.min(99.9, this.soc + this.cellSocOffsets[i]));
      if (isWeakCell) {
        cellSoc = Math.max(1.0, cellSoc - 11.5);
      }

      const ocv = this.socToOcv(cellSoc);
      const irDrop = actualCurrent * (rIntMOhm / 1000);
      const ripple = Math.cos(this.tickCounter * 0.35 + i * 1.3) * 0.0025;
      let cellVoltage = ocv + irDrop + ripple;

      // Apply fault injections to specific cells
      if (this.activeInjectedFaults.overvoltage && i === 0) {
        cellVoltage = 4.285 + Math.sin(this.tickCounter * 0.3) * 0.008;
      }
      if (this.activeInjectedFaults.undervoltage && i === 3) {
        cellVoltage = 2.740 - Math.abs(Math.sin(this.tickCounter * 0.3) * 0.01);
      }
      if (this.activeInjectedFaults.cellImbalance) {
        if (i === 0) cellVoltage += 0.048;
        if (i === 3) cellVoltage -= 0.036;
      }
      if (isWeakCell) {
        cellVoltage -= 0.095;
      }

      cellVoltage = Number(cellVoltage.toFixed(3));
      effectiveCellTemp = Number(effectiveCellTemp.toFixed(1));

      const cellSoh = Number(
        Math.max(
          50,
          Math.min(100, 99.2 - this.cycleCount * 0.042 - (isWeakCell ? 14.5 : i * 0.35))
        ).toFixed(1)
      );

      cells.push({
        cellId: i + 1,
        voltage: this.activeInjectedFaults.sensorFailure && i === 1 ? 0.0 : cellVoltage,
        temperature: effectiveCellTemp,
        internalResistance: Number(rIntMOhm.toFixed(1)),
        soc: Number(cellSoc.toFixed(1)),
        soh: cellSoh,
        isBalancing: false,
        isWeak: isWeakCell || cellSoh < 80,
        status: 'NOMINAL',
      });
    }

    const validVoltages = cells.map((c) => c.voltage);
    const maxCellVoltage = Number(Math.max(...validVoltages).toFixed(3));
    const minCellVoltage = Number(Math.min(...validVoltages).toFixed(3));
    const cellVoltageDeltaMv = Number(((maxCellVoltage - minCellVoltage) * 1000).toFixed(1));
    const packVoltage = Number(validVoltages.reduce((a, b) => a + b, 0).toFixed(2));
    const meanCellVoltage = Number((packVoltage / this.seriesCells).toFixed(3));
    const averageTemperature = Number(
      (cells.reduce((a, c) => a + c.temperature, 0) / this.seriesCells).toFixed(1)
    );
    const maxTemperature = Number(Math.max(...cells.map((c) => c.temperature)).toFixed(1));

    const chargingCurrent = actualCurrent > 0 ? Number(actualCurrent.toFixed(2)) : 0.0;
    const dischargingCurrent = actualCurrent < 0 ? Number(Math.abs(actualCurrent).toFixed(2)) : 0.0;

    // 4. Construct 9-Feature Vector for Random Forest Models (Page 12 of ZEROTH.pdf)
    const mlFeatures: MLFeatureVector = {
      meanCellVoltage,
      packVoltage,
      chargingCurrent,
      dischargingCurrent,
      batteryTemperature: maxTemperature,
      chargingTimeSeconds: this.chargingTimeSeconds,
      capacityDeliveredAh: this.capacityDeliveredAh,
      cycleNumber: this.cycleCount,
      cellVoltageDifference: Number((maxCellVoltage - minCellVoltage).toFixed(4)),
    };

    const sensorValid = !this.activeInjectedFaults.sensorFailure;

    // 5. Run Random Forest SoH Prediction
    const sohPrediction = this.mlPipeline.predictSoH(
      mlFeatures,
      this.activeInjectedFaults.lowAiConfidence,
      sensorValid
    );

    // 6. Run Random Forest + Hardware Protection Fault Classification
    const weakCellIds = cells.filter((c) => c.isWeak).map((c) => c.cellId);
    const faultDetection = this.mlPipeline.detectFaults({
      features: mlFeatures,
      maxCellVoltage,
      minCellVoltage,
      maxTemperature,
      packCurrent: actualCurrent,
      sensorValid,
      weakCellDetected: weakCellIds.length > 0,
      forceLowConfidence: this.activeInjectedFaults.lowAiConfidence,
      thresholds: this.thresholds,
    });

    // 7. Run Adaptive Charging & Independent Safety Override Controller
    const chargingState = evaluateAdaptiveCharging({
      operationState: this.operationState,
      soc: this.soc,
      predictedSoH: sohPrediction.predictedSoH,
      aiConfidence: sohPrediction.confidence,
      sensorValid,
      maxTemperature,
      cellDeltaMv: cellVoltageDeltaMv,
      cellVoltages: validVoltages,
      fault: faultDetection,
      thresholds: this.thresholds,
      nominalChargeCurrentAmps: this.requestedChargeCurrentAmps,
    });

    // If charging state just tripped the MOSFET relay on this tick, immediately clamp packCurrent to 0
    // unless overcurrent fault is actively being injected for live demonstration
    let finalPackCurrent = Number(actualCurrent.toFixed(2));
    if (
      this.operationState === 'CHARGING' &&
      !chargingState.mosfetRelayClosed &&
      !this.activeInjectedFaults.overcurrent
    ) {
      finalPackCurrent = 0.0;
    } else if (
      this.operationState === 'CHARGING' &&
      chargingState.mosfetRelayClosed &&
      !this.activeInjectedFaults.overcurrent
    ) {
      finalPackCurrent = Number(Math.min(actualCurrent, chargingState.targetCurrentAmps).toFixed(2));
    }

    // Update individual cell statuses and balancing flags
    cells.forEach((cell) => {
      cell.isBalancing = chargingState.balancingCellIds.includes(cell.cellId);
      if (
        !sensorValid &&
        cell.voltage <= 0.5
      ) {
        cell.status = 'CRITICAL';
      } else if (
        cell.voltage >= this.thresholds.maxCellVoltage ||
        cell.voltage <= this.thresholds.minCellVoltage ||
        cell.temperature >= this.thresholds.criticalTempThreshold
      ) {
        cell.status = 'CRITICAL';
      } else if (cell.isWeak) {
        cell.status = 'WEAK';
      } else if ((cell.voltage - minCellVoltage) * 1000 >= this.thresholds.imbalanceThresholdMv) {
        cell.status = 'IMBALANCED';
      } else {
        cell.status = 'NOMINAL';
      }
    });

    const remainingCapacityAh = Number(
      ((this.soc / 100) * this.nominalCapacityAh * (sohPrediction.predictedSoH / 100)).toFixed(2)
    );

    return {
      timestamp: new Date().toISOString(),
      source: this.source,
      simulationRunning: this.running,
      operationState: chargingState.hardwareSafetyTripped ? 'FAULT_LOCKOUT' : this.operationState,
      packId: this.packId,
      packName: this.packName,
      chemistry: this.chemistry,
      seriesCells: this.seriesCells,
      nominalCapacityAh: this.nominalCapacityAh,
      remainingCapacityAh,
      capacityDeliveredAh: this.capacityDeliveredAh,
      chargingTimeSeconds: this.chargingTimeSeconds,
      packVoltage,
      packCurrent: finalPackCurrent,
      packPowerWatts: Number((packVoltage * finalPackCurrent).toFixed(2)),
      soc: Number(this.soc.toFixed(1)),
      soh: sohPrediction.predictedSoH,
      averageTemperature,
      maxTemperature,
      ambientTemperature: this.ambientTemperature,
      cycleCount: this.cycleCount,
      maxCellVoltage,
      minCellVoltage,
      cellVoltageDeltaMv,
      weakCellIds,
      sensorValid,
      cells,
      sohPrediction,
      faultDetection,
      chargingState,
      activeInjectedFaults: { ...this.activeInjectedFaults },
      thresholds: { ...this.thresholds },
    };
  }

  public controlSimulation(params: {
    running?: boolean;
    operationState?: OperationState;
    soc?: number;
    cycleCount?: number;
    ambientTemperature?: number;
    requestedChargeCurrentAmps?: number;
    requestedDischargeCurrentAmps?: number;
    seriesCells?: number;
    nominalCapacityAh?: number;
    reset?: boolean;
  }): BatteryTelemetrySnapshot {
    if (params.reset) {
      this.running = true;
      this.source = 'SIMULATION';
      this.operationState = 'CHARGING';
      this.soc = 64.5;
      this.cycleCount = 142;
      this.ambientTemperature = 25.0;
      this.cellTemperatures = Array(this.seriesCells).fill(28.5);
      this.cellSocOffsets = Array(this.seriesCells)
        .fill(0)
        .map((_, idx) => (idx % 2 === 0 ? 0.3 : -0.25));
      this.chargingTimeSeconds = 840;
      this.capacityDeliveredAh = 0.92;
      this.requestedChargeCurrentAmps = 4.0;
      this.clearAllFaults(true);
    }

    if (typeof params.running === 'boolean') this.running = params.running;
    if (params.operationState) this.operationState = params.operationState;
    if (typeof params.soc === 'number') this.soc = Math.max(2, Math.min(99.5, params.soc));
    if (typeof params.cycleCount === 'number') {
      this.cycleCount = Math.max(1, Math.min(2000, Math.round(params.cycleCount)));
    }
    if (typeof params.ambientTemperature === 'number') {
      this.ambientTemperature = Math.max(0, Math.min(65, params.ambientTemperature));
      this.cellTemperatures = this.cellTemperatures.map((t) =>
        Math.max(this.ambientTemperature, (t + this.ambientTemperature) / 2)
      );
    }
    if (typeof params.requestedChargeCurrentAmps === 'number') {
      this.requestedChargeCurrentAmps = Math.max(0.5, Math.min(6.0, params.requestedChargeCurrentAmps));
    }
    if (typeof params.requestedDischargeCurrentAmps === 'number') {
      this.requestedDischargeCurrentAmps = Math.max(0.5, Math.min(10.0, params.requestedDischargeCurrentAmps));
    }
    if (typeof params.nominalCapacityAh === 'number') {
      this.nominalCapacityAh = Math.max(1.5, Math.min(100, params.nominalCapacityAh));
    }
    if (typeof params.seriesCells === 'number' && [3, 4, 6, 8].includes(params.seriesCells)) {
      this.seriesCells = params.seriesCells;
      this.cellTemperatures = Array(this.seriesCells).fill(28.5);
      this.cellSocOffsets = Array(this.seriesCells)
        .fill(0)
        .map((_, i) => (i % 2 === 0 ? 0.3 : -0.2));
      this.cellBaseResistanceMOhm = Array(this.seriesCells)
        .fill(28.5)
        .map((r, i) => r + i * 0.6);
      this.thresholds.maxPackVoltage = Number((this.thresholds.maxCellVoltage * this.seriesCells).toFixed(2));
      this.thresholds.minPackVoltage = Number((this.thresholds.minCellVoltage * this.seriesCells).toFixed(2));
    }

    this.latestSnapshot = this.computeNextStep(0.2);
    saveTelemetryReading(this.latestSnapshot);
    saveSoHPrediction(this.latestSnapshot.sohPrediction);
    if (this.latestSnapshot.faultDetection.faultType !== 'NONE') {
      recordFaultEvent(this.latestSnapshot);
    }
    return this.latestSnapshot;
  }

  public injectFault(
    faultKey: keyof ActiveInjectedFaults,
    active: boolean
  ): { success: boolean; message: string; snapshot: BatteryTelemetrySnapshot } {
    this.activeInjectedFaults[faultKey] = active;
    if (!active && faultKey === 'overtemperature') {
      // Cool pack back toward safe operating temperature when user resolves fault injection
      this.cellTemperatures = this.cellTemperatures.map(() => this.ambientTemperature + 3.5);
      if (this.ambientTemperature >= this.thresholds.highTempThreshold) {
        this.ambientTemperature = 26.0;
      }
    }

    this.latestSnapshot = this.computeNextStep(0.1);
    saveTelemetryReading(this.latestSnapshot);

    if (active && this.latestSnapshot.faultDetection.faultType !== 'NONE') {
      recordFaultEvent(this.latestSnapshot);
    } else if (!active && this.latestSnapshot.faultDetection.faultType === 'NONE') {
      markFaultEventsCleared();
    }

    return {
      success: true,
      message: active
        ? `Fault '${faultKey}' injected into live BMS telemetry stream.`
        : `Fault '${faultKey}' cleared and normal operating conditions restored.`,
      snapshot: this.latestSnapshot,
    };
  }

  public clearAllFaults(forceSafeReset = false): {
    success: boolean;
    message: string;
    snapshot: BatteryTelemetrySnapshot;
  } {
    // Safety requirement: Only allow clearing faults when underlying physical condition is safe (or when resetting)
    if (!forceSafeReset && this.ambientTemperature >= this.thresholds.criticalTempThreshold) {
      return {
        success: false,
        message: `Cannot clear thermal lockout while ambient temperature (${this.ambientTemperature}°C) exceeds critical threshold (${this.thresholds.criticalTempThreshold}°C). Lower ambient temperature first.`,
        snapshot: this.latestSnapshot,
      };
    }

    this.activeInjectedFaults = {
      overvoltage: false,
      undervoltage: false,
      overcurrent: false,
      overtemperature: false,
      cellImbalance: false,
      weakCell: false,
      sensorFailure: false,
      lowAiConfidence: false,
    };
    this.cellTemperatures = this.cellTemperatures.map(() => Math.min(31.0, this.ambientTemperature + 3.0));
    if (this.operationState === 'FAULT_LOCKOUT') {
      this.operationState = 'CHARGING';
    }

    markFaultEventsCleared();
    this.latestSnapshot = this.computeNextStep(0.1);
    saveTelemetryReading(this.latestSnapshot);

    return {
      success: true,
      message: 'All injected faults cleared. Safety relays re-armed after verifying nominal telemetry.',
      snapshot: this.latestSnapshot,
    };
  }

  public updateThresholds(newThresholds: Partial<SafetyThresholds>): BatteryTelemetrySnapshot {
    this.thresholds = saveSafetyThresholds({
      ...this.thresholds,
      ...newThresholds,
    });
    this.latestSnapshot = this.computeNextStep(0.1);
    return this.latestSnapshot;
  }

  /**
   * Ingests external ESP32 hardware telemetry over REST or MQTT bridge
   */
  public ingestEsp32Telemetry(payload: {
    cellVoltages: number[];
    packCurrent: number;
    temperatures: number[];
    cycleCount?: number;
  }): BatteryTelemetrySnapshot {
    this.source = 'ESP32_HARDWARE';
    if (Array.isArray(payload.cellVoltages) && payload.cellVoltages.length >= 3) {
      this.seriesCells = payload.cellVoltages.length;
    }
    if (typeof payload.cycleCount === 'number') {
      this.cycleCount = payload.cycleCount;
    }
    this.cellTemperatures = payload.temperatures.length
      ? payload.temperatures
      : Array(this.seriesCells).fill(29.0);
    if (payload.packCurrent > 0.1) {
      this.operationState = 'CHARGING';
      this.requestedChargeCurrentAmps = payload.packCurrent;
    } else if (payload.packCurrent < -0.1) {
      this.operationState = 'DISCHARGING';
      this.requestedDischargeCurrentAmps = Math.abs(payload.packCurrent);
    } else {
      this.operationState = 'IDLE';
    }

    this.latestSnapshot = this.computeNextStep(0.1);
    // Override cell voltages with exact ESP32 ADC values
    payload.cellVoltages.forEach((v, idx) => {
      if (this.latestSnapshot.cells[idx]) {
        this.latestSnapshot.cells[idx].voltage = Number(v.toFixed(3));
      }
    });
    saveTelemetryReading(this.latestSnapshot);
    return this.latestSnapshot;
  }
}
