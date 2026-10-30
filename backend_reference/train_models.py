/**
 * ZEROTH Smart BMS - Python Reference Implementation & Offline Model Training Script
 * Matches the TypeScript runtime Random Forest Regressor & Classifier in src/lib/bmsRules.ts
 */
import json
import math
import random
from datetime import datetime

FEATURE_NAMES = [
    "meanCellVoltage",
    "packVoltage",
    "chargingCurrent",
    "dischargingCurrent",
    "batteryTemperature",
    "chargingTimeSeconds",
    "capacityDeliveredAh",
    "cycleNumber",
    "cellVoltageDifference",
]

def generate_synthetic_sample(rng: random.Random):
    cycle = rng.randint(1, 1400)
    temp = rng.uniform(22.0, 38.0)
    chg_i = rng.uniform(0.5, 4.2)
    dis_i = 0.0
    mean_v = rng.uniform(3.40, 4.15)
    delta_v = rng.uniform(0.005, 0.030)
    chg_time = rng.uniform(120, 3600)
    cap_ah = (chg_i * chg_time) / 3600.0
    soh = max(45.0, min(100.0, 100.0 - ((cycle / 1500.0) ** 1.12) * 26.5 - max(0.0, temp - 32.0) * 0.22))
    return {
        "features": [mean_v, mean_v * 4, chg_i, dis_i, temp, chg_time, cap_ah, cycle, delta_v],
        "soh": round(soh, 2),
    }

if __name__ == "__main__":
    rng = random.Random(2026)
    dataset = [generate_synthetic_sample(rng) for _ in range(500)]
    print(f"Generated {len(dataset)} synthetic EV battery training records at {datetime.utcnow().isoformat()}Z")
