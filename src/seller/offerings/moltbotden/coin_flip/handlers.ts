import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const POOL_FILE = "/home/will/clawd/skills/openclaw-acp/data/jackpot_pool.json";

interface PoolState {
  pool: number;
  total_flips: number;
  last_jackpot: string | null;
}

function getPool(): PoolState {
  try {
    if (existsSync(POOL_FILE)) {
      return JSON.parse(readFileSync(POOL_FILE, "utf-8"));
    }
  } catch {}
  return { pool: 10.0, total_flips: 0, last_jackpot: null };
}

function savePool(state: PoolState): void {
  const dir = join(POOL_FILE, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(POOL_FILE, JSON.stringify(state, null, 2));
}

export function validateRequirements(request: any): ValidationResult {
  const call = (request?.playerChoice || request?.call || "").toLowerCase().trim();
  if (call && call !== "heads" && call !== "tails") {
    return { valid: false, reason: "Pick 'heads' or 'tails'" };
  }
  return { valid: true };
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const call = (request?.playerChoice || request?.call || "heads").toLowerCase().trim();
  const result = Math.random() < 0.5 ? "heads" : "tails";
  const won = call === result;

  const pool = getPool();
  pool.total_flips++;

  // 30% of each $1 fee goes to jackpot pool
  pool.pool += 0.3;

  // Check jackpot
  const jackpotRoll = Math.random();
  let jackpotWin = "";
  let jackpotAmount = 0;

  if (jackpotRoll < 0.00024) {
    // MEGA JACKPOT — 0.024% chance, 90% of pool
    jackpotAmount = Math.floor(pool.pool * 0.9 * 100) / 100;
    pool.pool -= jackpotAmount;
    pool.last_jackpot = new Date().toISOString();
    jackpotWin = `\n\n🎰🎰🎰 MEGA JACKPOT!!! You won $${jackpotAmount} from the jackpot pool! 🎰🎰🎰`;
  } else if (jackpotRoll < 0.0039) {
    // Mini jackpot — 0.37% chance, 5% of pool
    jackpotAmount = Math.floor(pool.pool * 0.05 * 100) / 100;
    pool.pool -= jackpotAmount;
    pool.last_jackpot = new Date().toISOString();
    jackpotWin = `\n\n🥉 MINI JACKPOT! You won $${jackpotAmount} from the jackpot pool!`;
  }

  savePool(pool);

  const poolInfo = `\n\n💰 Current Jackpot Pool: $${pool.pool.toFixed(2)} | Total Flips: ${pool.total_flips}`;

  if (won) {
    return {
      deliverable: `🎉 WINNER! You called ${call} and it was ${result}! You win $1.70!${jackpotWin}${poolInfo}\n\nPlay again anytime! 🎰 MoltbotDen Casino — moltbotden.com`,
    };
  } else {
    return {
      deliverable: `😢 You called ${call} but it was ${result}. Better luck next time!${jackpotWin}${poolInfo}\n\nTry again — fortune favors the bold! 🎰 MoltbotDen Casino — moltbotden.com`,
    };
  }
}
