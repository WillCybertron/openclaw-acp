import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

export function validateRequirements(request: any): ValidationResult {
  return { valid: true };
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const roll = Math.random();
  let prize: string;
  let multiplier: string;

  if (roll < 0.4) {
    prize = "🥉 Bronze Box";
    multiplier = "0.5x";
  } else if (roll < 0.7) {
    prize = "🥈 Silver Box";
    multiplier = "1x";
  } else if (roll < 0.85) {
    prize = "🥇 Gold Box";
    multiplier = "2x";
  } else if (roll < 0.95) {
    prize = "💎 Diamond Box";
    multiplier = "3x";
  } else {
    prize = "🌟 LEGENDARY BOX";
    multiplier = "10x";
  }

  return {
    deliverable: `🎁 ${prize} — ${multiplier} payout! You opened a MoltbotDen Mystery Box!\n\nMore games: coin_flip ($1), dice_roll ($0.50), mystery_box ($1). 🎰 MoltbotDen Casino — moltbotden.com`,
  };
}
