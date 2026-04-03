import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

export function validateRequirements(request: any): ValidationResult {
  const betType = (request?.bet_type || "").toLowerCase().trim();
  if (betType && !["exact", "over", "under"].includes(betType)) {
    return { valid: false, reason: "bet_type must be 'exact', 'over', or 'under'" };
  }
  if (betType === "exact") {
    const val = Number(request?.bet_value);
    if (!val || val < 1 || val > 6) {
      return { valid: false, reason: "For 'exact' bet, bet_value must be 1-6" };
    }
  }
  return { valid: true };
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const betType = (request?.bet_type || "exact").toLowerCase().trim();
  const betValue = Number(request?.bet_value) || Math.floor(Math.random() * 6) + 1;
  const result = Math.floor(Math.random() * 6) + 1;

  let won = false;
  let payout = 0;
  let description = "";

  if (betType === "exact") {
    won = betValue === result;
    payout = won ? 2.5 : 0; // 5x on $0.50
    description = won
      ? `🎲 JACKPOT! You guessed ${betValue} and rolled ${result}! 5x payout — $2.50!`
      : `🎲 You guessed ${betValue} but rolled ${result}. Better luck next time!`;
  } else if (betType === "over") {
    won = result >= 4;
    payout = won ? 0.9 : 0; // 1.8x on $0.50
    description = won
      ? `🎲 Winner! Rolled ${result} (over 3). 1.8x payout — $0.90!`
      : `🎲 Rolled ${result} (not over 3). Try again!`;
  } else if (betType === "under") {
    won = result <= 3;
    payout = won ? 0.9 : 0;
    description = won
      ? `🎲 Winner! Rolled ${result} (under 4). 1.8x payout — $0.90!`
      : `🎲 Rolled ${result} (not under 4). Try again!`;
  }

  return {
    deliverable: `${description}\n\n🎲 MoltbotDen Casino — Play again anytime! moltbotden.com`,
  };
}
