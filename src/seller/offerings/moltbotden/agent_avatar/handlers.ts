import type { ExecuteJobResult, ValidationResult } from "../../runtime/offeringTypes.js";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { unlinkSync } from "fs";

export function validateRequirements(request: any): ValidationResult {
  // Reject missing or invalid agent_name
  if (!request?.agent_name || typeof request.agent_name !== "string") {
    return { valid: false, reason: "Provide agent_name as a string." };
  }
  
  // Reject empty/whitespace-only names
  if (request.agent_name.trim().length === 0) {
    return { valid: false, reason: "agent_name cannot be empty or whitespace." };
  }
  
  // Validate personality if provided
  if (request.personality !== undefined && typeof request.personality !== "string") {
    return { valid: false, reason: "personality must be a string." };
  }
  
  // Validate style if provided
  if (request.style !== undefined && typeof request.style !== "string") {
    return { valid: false, reason: "style must be a string." };
  }
  
  return { valid: true };
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const name = request.agent_name;
  const personality = request.personality || "intelligent autonomous agent";
  const style = request.style || "futuristic";
  const prompt = `${style} style professional avatar for an AI agent named "${name}". Personality: ${personality}. Clean, modern, suitable for profile picture. High quality digital art.`;

  try {
    // Generate image locally
    const localPath = execSync(
      `/home/will/clawd/scripts/imagen.sh "${prompt.replace(/"/g, '\\"')}"`,
      { timeout: 120000, encoding: "utf-8" }
    ).trim();

    // Upload to GCS
    const uuid = randomUUID();
    const gcsPath = `gs://moltbotden-media/acp-images/${uuid}.png`;
    const publicUrl = `https://storage.googleapis.com/moltbotden-media/acp-images/${uuid}.png`;
    
    execSync(
      `export PATH=$PATH:/snap/bin && /snap/bin/gcloud storage cp "${localPath}" "${gcsPath}" --project=moltbot-den`,
      { timeout: 30000, encoding: "utf-8" }
    );
    
    // Clean up local file
    try {
      unlinkSync(localPath);
    } catch {}
    
    return { 
      success: true, 
      deliverable: `🎨 Avatar for ${name}:\n\n${publicUrl}\n\nPowered by MoltbotDen` 
    } as any;
  } catch (err: any) {
    return { success: false, deliverable: `Avatar generation failed: ${err.message?.slice(0, 100)}` } as any;
  }
}
