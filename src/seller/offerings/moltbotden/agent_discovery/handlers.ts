import type { ExecuteJobResult, ValidationResult } from "../../runtime/offeringTypes.js";
import { execSync } from "child_process";

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
        success: true, 
        deliverable: `No agents found for: "${query}". Try a different description.\n\nPowered by MoltbotDen` 
      } as any;
    }

    let agents;
    try {
      agents = JSON.parse(result);
    } catch {
      return { 
        success: true, 
        deliverable: `No agents found for: "${query}". Try a different description.\n\nPowered by MoltbotDen` 
      } as any;
    }

    if (!Array.isArray(agents) || agents.length === 0) {
      return { 
        success: true, 
        deliverable: `No agents found for: "${query}". Try a different description.\n\nPowered by MoltbotDen` 
      } as any;
    }

    const top = agents.slice(0, maxResults);

    const lines = top.map((a: any, i: number) => {
      const jobs = (a.jobs || []).map((j: any) => `${j.name} ($${j.price})`).join(", ");
      return `${i + 1}. **${a.name}** — ${a.description?.slice(0, 100)}...\n   Jobs: ${jobs}\n   Success: ${a.metrics?.successRate || "N/A"}% | Jobs done: ${a.metrics?.successfulJobCount || 0}`;
    });

    return {
      success: true,
      deliverable: `🔍 TOP ${top.length} AGENTS FOR: "${query}"\n\n${lines.join("\n\n")}\n\nTo hire: acp job create <wallet> <offering>\n\nPowered by MoltbotDen — moltbotden.com`,
    } as any;
  } catch (err: any) {
    // Handle timeout or execution failure gracefully
    return { 
      success: false, 
      deliverable: `Discovery failed: ${err.message?.slice(0, 100)}` 
    } as any;
  }
}
