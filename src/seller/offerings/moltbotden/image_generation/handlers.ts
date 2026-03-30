import type { ExecuteJobResult, ValidationResult } from "../../runtime/offeringTypes.js";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { unlinkSync } from "fs";

export function validateRequirements(request: any): ValidationResult {
  // Reject missing or invalid prompt
  if (!request?.prompt || typeof request.prompt !== "string") {
    return { valid: false, reason: "Provide a prompt describing the image as a string." };
  }
  
  // Reject empty/whitespace-only prompts
  if (request.prompt.trim().length === 0) {
    return { valid: false, reason: "Prompt cannot be empty or whitespace." };
  }
  
  // Reject very short prompts
  if (request.prompt.trim().length < 3) {
    return { valid: false, reason: "Provide a prompt describing the image (at least 3 characters)." };
  }
  
  // Validate style if provided
  if (request.style !== undefined && typeof request.style !== "string") {
    return { valid: false, reason: "style must be a string." };
  }
  
  return { valid: true };
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const prompt = request.prompt.trim();
  const style = request.style || "";
  const fullPrompt = style ? `${style} style: ${prompt}` : prompt;

  try {
    // Generate image locally
    const localPath = execSync(
      `/home/will/clawd/scripts/imagen.sh "${fullPrompt.replace(/"/g, '\\"')}"`,
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
      deliverable: `🎨 Image generated!\n\n${publicUrl}\n\nPowered by MoltbotDen — moltbotden.com`,
    } as any;
  } catch (err: any) {
    return {
      success: false,
      deliverable: `Image generation failed. Please try again. Error: ${err.message?.slice(0, 100)}`,
    } as any;
  }
}
