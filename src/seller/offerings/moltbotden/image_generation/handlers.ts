import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { unlinkSync, existsSync } from "fs";

const IMAGE_BLOCKED_PATTERNS = [
  /\b(nude|naked|nsfw|porn|hentai|explicit|sexual|adult)\b/i,
  /\bchild\b.*\b(sexual|nude|naked|exploit)/i,
  /\b(violence|violent)\b/i,
  /\b(gore|gory|dismember|mutilat)/i,
  /\b(offensive|harmful|graphic\s*harm|extreme\s*harm|extreme\s*graphic)\b/i,
  /\b(terror|bomb|weapon).*\b(make|build|create|instruct)/i,
  /\b(hateful|hate\s*speech|hate\s*group)\b/i,
  /\b(extremist|extremism|radical|supremacist|racist|bigot)\b/i,
  /\b(promot\w*\s+(hate|violence|harm|terror))/i,
  /\b(swastika|nazi)\b/i,
  /\billegal\b/i,
  /\bdrug\s*(manufactur|synthe|cook)/i,
  /\b(blood|murder|kill|death|torture|abuse|assault)\b/i,
  /\b(self.?harm|suicide)\b/i,
];

function isInappropriateImagePrompt(text: string): boolean {
  return IMAGE_BLOCKED_PATTERNS.some((p) => p.test(text));
}

export function validateRequirements(request: any): ValidationResult {
  if (!request?.prompt || typeof request.prompt !== "string") {
    return { valid: false, reason: "Provide a prompt describing the image as a string." };
  }
  if (request.prompt.trim().length === 0) {
    return { valid: false, reason: "Prompt cannot be empty or whitespace." };
  }
  if (request.prompt.trim().length < 3) {
    return {
      valid: false,
      reason: "Provide a prompt describing the image (at least 3 characters).",
    };
  }
  if (isInappropriateImagePrompt(request.prompt)) {
    return {
      valid: false,
      reason: "Request contains inappropriate content. We cannot generate this type of image.",
    };
  }
  if (request.style !== undefined && typeof request.style !== "string") {
    return { valid: false, reason: "style must be a string." };
  }
  return { valid: true };
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const prompt = request.prompt.trim();
  const style = request.style || "";
  const fullPrompt = style ? `${style} style: ${prompt}` : prompt;
  const safePrompt = fullPrompt.replace(/["'`]/g, "");

  const uuid = randomUUID();
  const tmpPath = `/tmp/acp-image-${uuid}.png`;
  const gcsPath = `gs://moltbotden-media/acp-images/${uuid}.png`;
  const publicUrl = `https://storage.googleapis.com/moltbotden-media/acp-images/${uuid}.png`;

  // Retry up to 3 times for transient failures
  let lastErr: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execSync(
        `/home/will/clawd/scripts/imagen.sh "${safePrompt.replace(/\$/g, "\\$")}" "${tmpPath}"`,
        { timeout: 120000, encoding: "utf-8" }
      );
      if (existsSync(tmpPath)) break;
    } catch (err: any) {
      lastErr = err;
      console.error(
        `[image_generation] Imagen attempt ${attempt}/3 failed: ${err.message?.slice(0, 100)}`
      );
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
    }
  }

  if (!existsSync(tmpPath)) {
    return {
      deliverable: `Image generation failed after 3 attempts. Please try again. Error: ${lastErr?.message?.slice(0, 150) || "unknown"}`,
    };
  }

  try {
    execSync(
      `export PATH=$PATH:/snap/bin && /snap/bin/gcloud storage cp "${tmpPath}" "${gcsPath}" --project=moltbot-den`,
      { timeout: 60000, encoding: "utf-8" }
    );
    try {
      unlinkSync(tmpPath);
    } catch {}
    return {
      deliverable: `🎨 Image generated!\n\n${publicUrl}\n\nPowered by MoltbotDen — moltbotden.com`,
    };
  } catch (err: any) {
    try {
      unlinkSync(tmpPath);
    } catch {}
    return {
      deliverable: `Image upload failed. Please try again. Error: ${err.message?.slice(0, 200)}`,
    };
  }
}
