# ZEROTH – AI-Powered Smart Battery Management System

**Project Title:** AI-Enabled Smart Battery Management System for Electric Vehicles with State-of-Health Prediction, Fault Detection, and Safe Adaptive Charging.

**Authors:** Lokesh Kumar (247Y5A0207), Karthik (237Y1A0203), Devis Sri Prasad (237Y1A0212)  
**Guidance:** B. LaxmiNarayana & Dr. R. Chander (EEE Dept, MLR Institute of Technology and Management)

---

## 1. System Architecture & Methodology

ZEROTH implements the complete hardware-software-AI architecture proposed in `ZEROTH.pdf`:

1. **Protected Low-Voltage EV Battery Pack (`4S1P` / Configurable `3S–8S`)**:
   - Individual cell voltage sensing (`Cell 1..N`), pack terminal voltage, bidirectional charging/discharging current, and multi-point cell temperatures.
2. **Machine Learning Layer (`src/lib/bmsRules.ts`)**:
   - **Random Forest Regressor (18-Tree CART Ensemble)**: Predicts Battery State of Health (`SoH %`), inter-tree uncertainty (`±%`), confidence score, and Remaining Useful Life (`RUL` cycles) using the 9 features defined on Page 12 of `ZEROTH.pdf`:
     1. Mean Cell Voltage
     2. Pack Voltage
     3. Charging Current
     4. Discharging Current
     5. Battery Temperature
     6. Charging Time
     7. Capacity Delivered
     8. Cycle Number
     9. Cell Voltage Difference ($\Delta V$)
   - **Random Forest Classifier (18-Tree Gini Ensemble)**: Classifies electrical and thermal anomalies (`OVERVOLTAGE`, `UNDERVOLTAGE`, `OVERCURRENT`, `OVERTEMPERATURE`, `CELL_IMBALANCE`, `WEAK_CELL`, `SENSOR_FAILURE`, `LOW_AI_CONFIDENCE`).
3. **Adaptive Charging Controller (`evaluateAdaptiveCharging`)**:
   - Implements the exact 6-row policy matrix from Page 13 of `ZEROTH.pdf`:
     - *Healthy battery & normal temperature* $\rightarrow$ `NORMAL` CC-CV charging mode
     - *Moderate cell imbalance* $\rightarrow$ `BALANCING` mode (50% reduced current + passive bleed resistors)
     - *High temperature* $\rightarrow$ `REDUCED_THERMAL` (40% current) or `PAUSED_THERMAL`
     - *Low predicted SoH (<80%)* $\rightarrow$ `CONSERVATIVE_SOH` mode
     - *Detected critical fault* $\rightarrow$ `DISCONNECTED_FAULT` (MOSFET relay opened + warning generated)
     - *Low AI confidence (<70%) or sensor failure* $\rightarrow$ `SAFE_FALLBACK` (AI disabled; deterministic hardware safety rules govern the pack)
4. **Independent Hardware Safety Protection**:
   - Deterministic voltage, current, and temperature cutoffs always take priority over AI recommendations.
5. **SQLite Persistence (`zeroth_bms.sqlite` via `src/lib/database.ts`)**:
   - Persists `battery_packs`, `battery_cells`, `sensor_readings`, `soh_predictions`, `fault_events`, `charging_sessions`, `ai_model_info`, and `system_config`.

---

## 2. Local Startup & Automated Tests

```bash
# Install dependencies
npm install

# Run automated unit tests for ML SoH, Fault Detection, Adaptive Charging, and Safety Overrides
npx --yes tsx --test src/lib/bmsRules.test.ts

# Start full-stack server + real-time WebSocket simulator on port 3000
npm run dev
```

---

## 3. Prototype Safety Notice

This is an academic low-voltage prototype. Never connect this software directly to mains power or a high-voltage EV battery pack without certified BMS hardware, galvanic isolation, and qualified engineering validation.
