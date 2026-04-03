import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { execSync } from "child_process";

// Content filter: reject queries requesting illegal, harmful, or unethical activities
const BLOCKED_PATTERNS = [
  /\b(nsfw|explicit|adult|sexual|porn|nude|naked)\b/i,
  /\billegal\b/i,
  /\bblack\s*market\b/i,
  /\bfraud\b/i,
  /\bmoney\s*launder/i,
  /\bhack(ing|er)?\b/i,
  /\bexploit(ation|ing)?\b/i,
  /\bscam(ming)?\b/i,
  /\bphish(ing)?\b/i,
  /\brug\s*pull\b/i,
  /\bpump\s*and\s*dump\b/i,
  /\binsider\s*trad/i,
  /\bmanipulat(e|ion|ing)\b.*\b(market|price|token)\b/i,
  /\b(drug|weapon|arms)\s*(deal|trad|sell|traffic)/i,
  /\bterroris[mt]/i,
  /\bransomware\b/i,
  /\bmalware\b/i,
  /\bddos\b/i,
  /\bdox(x?ing)?\b/i,
  /\bidentity\s*theft\b/i,
  /\bstolen\s*(funds|tokens|crypto|data|credentials)/i,
  /\blaunder/i,
  /\bcounterfeit/i,
  /\bextort/i,
  /\bbrib(e|ery|ing)\b/i,
  /\bembezzle/i,
  /\bponzi\b/i,
  /\bpyramid\s*scheme\b/i,
];

function isHarmfulQuery(text: string): boolean {
  return BLOCKED_PATTERNS.some((p) => p.test(text));
}

export function validateRequirements(request: any): ValidationResult {
  // Reject missing task_description field
  if (!request?.task_description) {
    return { valid: false, reason: "task_description is required." };
  }

  // Reject non-string task_description
  if (typeof request.task_description !== "string") {
    return { valid: false, reason: "task_description must be a string." };
  }

  // Reject empty/whitespace-only queries
  if (request.task_description.trim().length === 0) {
    return { valid: false, reason: "task_description cannot be empty or whitespace." };
  }

  // Reject very short queries
  if (request.task_description.trim().length < 3) {
    return { valid: false, reason: "Describe what you need (at least 3 characters)." };
  }

  // Reject illegal/harmful/unethical requests
  if (isHarmfulQuery(request.task_description)) {
    return {
      valid: false,
      reason:
        "Request contains prohibited content. We cannot assist with illegal, harmful, or unethical activities.",
    };
  }

  // Validate max_results if provided
  if (request.max_results !== undefined) {
    if (typeof request.max_results !== "number" || !Number.isInteger(request.max_results)) {
      return { valid: false, reason: "max_results must be an integer." };
    }
    if (request.max_results < 1 || request.max_results > 10) {
      return { valid: false, reason: "max_results must be between 1 and 10." };
    }
  }

  return { valid: true };
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const query = request.task_description.trim();
  const maxResults = Math.min(request.max_results || 5, 10);

  try {
    const result = execSync(
      `cd /home/will/clawd/skills/openclaw-acp && npx tsx bin/acp.ts browse "${query.replace(/"/g, '\\"')}" --json 2>/dev/null`,
      { timeout: 30000, encoding: "utf-8" }
    ).trim();

    // Handle empty or malformed JSON
    if (!result) {
      return {
        deliverable: `No agents found for: "${query}". Try a different description.\n\nPowered by MoltbotDen`,
      };
    }

    let agents;
    try {
      agents = JSON.parse(result);
    } catch {
      return {
        deliverable: `No agents found for: "${query}". Try a different description.\n\nPowered by MoltbotDen`,
      };
    }

    if (!Array.isArray(agents) || agents.length === 0) {
      return {
        deliverable: `No agents found for: "${query}". Try a different description.\n\nPowered by MoltbotDen`,
      };
    }

    const top = agents.slice(0, maxResults);

    const lines = top.map((a: any, i: number) => {
      const jobs = (a.jobs || []).map((j: any) => `${j.name} ($${j.price})`).join(", ");
      return `${i + 1}. **${a.name}** — ${a.description?.slice(0, 100)}...\n   Jobs: ${jobs}\n   Success: ${a.metrics?.successRate || "N/A"}% | Jobs done: ${a.metrics?.successfulJobCount || 0}`;
    });

    return {
      deliverable: `🔍 TOP ${top.length} AGENTS FOR: "${query}"\n\n${lines.join("\n\n")}\n\nTo hire: acp job create <wallet> <offering>\n\nPowered by MoltbotDen — moltbotden.com`,
    };
  } catch (err: any) {
    // Handle timeout or execution failure gracefully
    return {
      deliverable: `Discovery failed: ${err.message?.slice(0, 100)}`,
    };
  }
}
