/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  generateSyntheticDataset,
  RandomForestBMSPipeline,
} from './src/lib/bmsRules';
import { BatterySimulatorEngine } from './src/lib/batterySimulator';
import {
  getChargingSessions,
  getFaultHistory,
  getRecentReadings,
  getSoHHistory,
} from './src/lib/database';
import { ActiveInjectedFaults } from './src/types/bms';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  const mlPipeline = new RandomForestBMSPipeline();
  const simulator = new BatterySimulatorEngine(mlPipeline);

  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    // Send initial snapshot immediately upon connection
    ws.send(
      JSON.stringify({
        type: 'TELEMETRY_UPDATE',
        payload: simulator.getLatestSnapshot(),
      })
    );
    ws.on('close', () => clients.delete(ws));
  });

  server.on('upgrade', (request, socket, head) => {
    if (request.url?.startsWith('/api/ws')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  function broadcastSnapshot() {
    const payload = JSON.stringify({
      type: 'TELEMETRY_UPDATE',
      payload: simulator.getLatestSnapshot(),
    });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  // Real-time simulation loop ticking every 1000ms
  setInterval(() => {
    simulator.step(1.0);
    broadcastSnapshot();
  }, 1000);

  // ============================================================================
  // REST API ENDPOINTS (Matching FastAPI & OpenAPI specification)
  // ============================================================================

  // 1. Live Battery Status & Complete Snapshot
  app.get('/api/status', (_req, res) => {
    res.json(simulator.getLatestSnapshot());
  });

  // 2. Historical Sensor Readings
  app.get('/api/readings', (req, res) => {
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 60));
    res.json(getRecentReadings(limit));
  });

  // 3. Individual Cell Information
  app.get('/api/cells', (_req, res) => {
    const snap = simulator.getLatestSnapshot();
    res.json({
      seriesCells: snap.seriesCells,
      maxCellVoltage: snap.maxCellVoltage,
      minCellVoltage: snap.minCellVoltage,
      cellVoltageDeltaMv: snap.cellVoltageDeltaMv,
      weakCellIds: snap.weakCellIds,
      cells: snap.cells,
    });
  });

  // 4. SoH Predictions & ML Model Metadata
  app.get('/api/soh', (req, res) => {
    const limit = Math.min(100, Number(req.query.limit) || 40);
    res.json({
      current: simulator.getLatestSnapshot().sohPrediction,
      history: getSoHHistory(limit),
      modelMetadata: mlPipeline.getMetadata(),
    });
  });

  // 5. Retrain ML Model or Evaluate Custom Feature Vector
  app.post('/api/ml/retrain', (req, res) => {
    const sampleCount = Math.min(1200, Math.max(200, Number(req.body?.sampleCount) || 650));
    const seed = Number(req.body?.seed) || Date.now() % 10000;
    const dataset = generateSyntheticDataset(sampleCount, seed);
    const metadata = mlPipeline.trainOnDataset(dataset, 'SYNTHETIC_EXPERIMENTAL');
    simulator.step(0.1);
    broadcastSnapshot();
    res.json({
      success: true,
      message: `Random Forest Regressor & Classifier retrained on ${sampleCount} synthetic EV battery samples.`,
      metadata,
    });
  });

  app.post('/api/ml/predict', (req, res) => {
    const features = req.body;
    const prediction = mlPipeline.predictSoH(features, false, true);
    res.json(prediction);
  });

  // 6. Fault Detection Status & Incident Log
  app.get('/api/faults', (req, res) => {
    const limit = Math.min(100, Number(req.query.limit) || 50);
    res.json({
      currentFault: simulator.getLatestSnapshot().faultDetection,
      activeInjectedFaults: simulator.getLatestSnapshot().activeInjectedFaults,
      events: getFaultHistory(limit),
    });
  });

  // 7. Fault Injection Lab Control
  app.post('/api/faults/inject', (req, res) => {
    const { faultKey, active } = req.body as {
      faultKey: keyof ActiveInjectedFaults;
      active: boolean;
    };
    const result = simulator.injectFault(faultKey, Boolean(active));
    broadcastSnapshot();
    res.json({
      ...result,
      events: getFaultHistory(50),
    });
  });

  app.post('/api/faults/clear', (req, res) => {
    const force = Boolean(req.body?.force);
    const result = simulator.clearAllFaults(force);
    broadcastSnapshot();
    res.status(result.success ? 200 : 400).json({
      ...result,
      events: getFaultHistory(50),
    });
  });

  // 8. Adaptive Charging Control
  app.post('/api/charging/control', (req, res) => {
    const { operationState, requestedChargeCurrentAmps, requestedDischargeCurrentAmps } = req.body;
    const snap = simulator.controlSimulation({
      operationState,
      requestedChargeCurrentAmps,
      requestedDischargeCurrentAmps,
    });
    broadcastSnapshot();
    res.json(snap);
  });

  // 9. Simulation Parameter Control
  app.post('/api/simulation/control', (req, res) => {
    const snap = simulator.controlSimulation(req.body || {});
    broadcastSnapshot();
    res.json(snap);
  });

  // 10. Historical Analytics & Sessions
  app.get('/api/analytics', (_req, res) => {
    const sohHistory = getSoHHistory(50);
    const faultEvents = getFaultHistory(60);
    const chargingSessions = getChargingSessions(25);
    const recentReadings = getRecentReadings(80);

    // Fault frequency breakdown
    const faultCounts: Record<string, number> = {};
    for (const ev of faultEvents) {
      faultCounts[ev.faultType] = (faultCounts[ev.faultType] || 0) + 1;
    }

    res.json({
      sohHistory,
      faultEvents,
      chargingSessions,
      recentReadings,
      faultCounts,
      modelMetadata: mlPipeline.getMetadata(),
    });
  });

  // 11. System Configuration & Safety Thresholds
  app.get('/api/config', (_req, res) => {
    res.json({
      thresholds: simulator.getLatestSnapshot().thresholds,
      modelMetadata: mlPipeline.getMetadata(),
    });
  });

  app.post('/api/config/thresholds', (req, res) => {
    const snap = simulator.updateThresholds(req.body || {});
    broadcastSnapshot();
    res.json({
      success: true,
      thresholds: snap.thresholds,
      snapshot: snap,
    });
  });

  // 12. ESP32 Hardware MQTT / HTTP Ingestion Endpoint
  app.post('/api/hardware/ingest', (req, res) => {
    const { cellVoltages, packCurrent, temperatures, cycleCount } = req.body;
    if (!Array.isArray(cellVoltages) || cellVoltages.length < 3) {
      res.status(400).json({ error: 'cellVoltages array (min 3 cells) is required' });
      return;
    }
    const snap = simulator.ingestEsp32Telemetry({
      cellVoltages: cellVoltages.map(Number),
      packCurrent: Number(packCurrent ?? 2.5),
      temperatures: Array.isArray(temperatures) ? temperatures.map(Number) : [29.5, 30.1, 29.8, 29.6],
      cycleCount: cycleCount ? Number(cycleCount) : undefined,
    });
    broadcastSnapshot();
    res.json({
      success: true,
      commandResponse: {
        mosfetRelayClosed: snap.chargingState.mosfetRelayClosed,
        loadRelayClosed: snap.chargingState.loadRelayClosed,
        targetChargeCurrentAmps: snap.chargingState.targetCurrentAmps,
        balancingCells: snap.chargingState.balancingCellIds,
        mode: snap.chargingState.mode,
      },
      snapshot: snap,
    });
  });

  // 13. OpenAPI / Swagger Specification JSON for API Explorer
  app.get('/api/openapi.json', (_req, res) => {
    res.json({
      openapi: '3.1.0',
      info: {
        title: 'ZEROTH – AI-Powered Smart BMS API',
        version: '1.0.0',
        description:
          'REST & WebSocket Telemetry API for State-of-Health Prediction, Fault Detection, and Safe Adaptive Charging.',
      },
      paths: {
        '/api/status': { get: { summary: 'Get live battery pack, cell, ML SoH, fault, and adaptive charging snapshot' } },
        '/api/readings': { get: { summary: 'Get time-series historical sensor readings from SQLite' } },
        '/api/cells': { get: { summary: 'Get individual cell voltages, temperatures, ΔV, and balancing status' } },
        '/api/soh': { get: { summary: 'Get Random Forest SoH predictions, confidence, RUL, and feature importances' } },
        '/api/faults': { get: { summary: 'Get active fault classifications and historical incident records' } },
        '/api/faults/inject': { post: { summary: 'Trigger or clear a specific fault in the Fault Injection Lab' } },
        '/api/faults/clear': { post: { summary: 'Clear active faults if underlying physical conditions are safe' } },
        '/api/charging/control': { post: { summary: 'Adjust operation state (CHARGING/DISCHARGING/IDLE) and target current' } },
        '/api/simulation/control': { post: { summary: 'Start, pause, reset, or modify battery simulator parameters' } },
        '/api/analytics': { get: { summary: 'Fetch aggregated battery health trends, charging sessions, and fault logs' } },
        '/api/config/thresholds': { post: { summary: 'Update independent hardware protection safety thresholds' } },
        '/api/hardware/ingest': { post: { summary: 'Ingest real or simulated ESP32 MQTT/HTTP sensor frame and return relay commands' } },
      },
    });
  });

  // Vite middleware in development or static serving in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`ZEROTH Smart BMS Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
