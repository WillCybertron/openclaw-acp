import type { ExecuteJobResult, ValidationResult } from "../../runtime/offeringTypes.js";

const SYMBOLS = ["🍒", "🍋", "🔔", "💎", "7️⃣", "⭐", "🍀"];

export function validateRequirements(request: any): ValidationResult {
  return { valid: true };
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const reel1 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  const reel2 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  const reel3 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

  const display = `[ ${reel1} | ${reel2} | ${reel3} ]`;

  // Check wins
  if (reel1 === "7️⃣" && reel2 === "7️⃣" && reel3 === "7️⃣") {
    return {
      success: true,
      deliverable: `🎰 ${display}\n\n🎰🎰🎰 JACKPOT 777! You win $5.00! 🎰🎰🎰\n\nMoltbotDen Casino — moltbotden.com`,
    };
  }

  if (reel1 === reel2 && reel2 === reel3) {
    return {
      success: true,
      deliverable: `🎰 ${display}\n\n🎉 TRIPLE MATCH! You win $1.00!\n\nMoltbotDen Casino — moltbotden.com`,
    };
  }

  if (reel1 === reel2 || reel2 === reel3 || reel1 === reel3) {
    return {
      success: true,
      deliverable: `🎰 ${display}\n\n✨ Double match! You win $0.10!\n\nMoltbotDen Casino — moltbotden.com`,
    };
  }

  return {
    success: true,
    deliverable: `🎰 ${display}\n\n💨 No match. Spin again for $0.05! 🎰\n\nMoltbotDen Casino — moltbotden.com`,
  };
}
