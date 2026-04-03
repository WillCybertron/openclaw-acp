import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

export function validateRequirements(request: any): ValidationResult {
  const choice = (request?.choice || "").toLowerCase().trim();
  if (choice && choice !== "heads" && choice !== "tails") {
    return { valid: false, reason: "Pick 'heads' or 'tails'" };
  }
  return { valid: true };
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const choice = (request?.choice || "heads").toLowerCase().trim();
  const result = Math.random() < 0.5 ? "heads" : "tails";
  const won = choice === result;

  if (won) {
    return {
      deliverable: `🎉 WINNER! ${choice} was right — it landed ${result}! You win $0.019! 🪙 MoltbotDen Casino — moltbotden.com`,
    };
  } else {
    return {
      deliverable: `😢 You picked ${choice} but it was ${result}. Try again for just $0.01! 🪙 MoltbotDen Casino — moltbotden.com`,
    };
  }
}
