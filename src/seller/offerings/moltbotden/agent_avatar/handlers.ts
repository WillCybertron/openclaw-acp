import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { unlinkSync, existsSync } from "fs";

const AVATAR_BLOCKED_PATTERNS = [
  /\b(nude|naked|nsfw|porn|hentai|explicit|sexual|adult)\b/i,
  /\bchild\b.*\b(sexual|nude|naked|exploit)/i,
  /\b(gore|gory|dismember|mutilat)/i,
  /\b(violence|violent)\b/i,
  /\b(offensive|harmful|graphic\s*harm|extreme\s*harm)\b/i,
  /\b(terror|bomb|weapon).*\b(make|build|create|instruct)/i,
  /\b(swastika|nazi)\b/i,
  /\billegal\b/i,
  /\b(hateful|hate\s*speech|hate\s*group)\b/i,
  /\b(blood|murder|kill|death|torture|abuse|assault)\b/i,
  /\b(self.?harm|suicide)\b/i,
  /\b(extremist|extremism|radical|supremacist|racist|bigot)\b/i,
  /\b(promot\w*\s+(hate|violence|harm|terror))/i,
  /\b(drug\s*dealer|drug\s*lord|cartel)\b/i,
];

function isInappropriateAvatarRequest(request: any): boolean {
  const fields = [request.agent_name, request.personality, request.style].filter(Boolean).join(" ");
  return AVATAR_BLOCKED_PATTERNS.some((p) => p.test(fields));
}

export function validateRequirements(request: any): ValidationResult {
  if (!request?.agent_name || typeof request.agent_name !== "string") {
    return { valid: false, reason: "Provide agent_name as a string." };
  }
  if (request.agent_name.trim().length === 0) {
    return { valid: false, reason: "agent_name cannot be empty or whitespace." };
  }
  if (request.personality !== undefined && typeof request.personality !== "string") {
    return { valid: false, reason: "personality must be a string." };
  }
  if (request.style !== undefined && typeof request.style !== "string") {
    return { valid: false, reason: "style must be a string." };
  }
  if (isInappropriateAvatarRequest(request)) {
    return {
      valid: false,
      reason: "Request contains inappropriate content. We cannot generate this type of avatar.",
    };
  }
  return { valid: true };
}

function runImagen(prompt: string, outputPath: string, timeoutMs: number): void {
  execSync(`/home/will/clawd/scripts/imagen.sh "${prompt.replace(/\$/g, "\\$")}" "${outputPath}"`, {
    timeout: timeoutMs,
    encoding: "utf-8",
  });
}

function uploadToGcs(localPath: string, gcsPath: string): void {
  execSync(
    `export PATH=$PATH:/snap/bin && /snap/bin/gcloud storage cp "${localPath}" "${gcsPath}" --project=moltbot-den`,
    { timeout: 60000, encoding: "utf-8" }
  );
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const name = request.agent_name;
  const personality = request.personality || "intelligent autonomous agent";
  const style = request.style || "futuristic";
  const safeName = name.replace(/["'`]/g, "");
  const safePersonality = personality.replace(/["'`]/g, "");
  const safeStyle = style.replace(/["'`]/g, "");
  const prompt = `${safeStyle} style professional avatar for an AI agent named ${safeName}. Personality: ${safePersonality}. Clean, modern, suitable for profile picture. High quality digital art.`;

  const uuid = randomUUID();
  const tmpPath = `/tmp/acp-avatar-${uuid}.png`;
  const gcsPath = `gs://moltbotden-media/acp-images/${uuid}.png`;
  const publicUrl = `https://storage.googleapis.com/moltbotden-media/acp-images/${uuid}.png`;

  // Retry up to 3 times for transient failures
  let lastErr: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      runImagen(prompt, tmpPath, 120000);
      if (existsSync(tmpPath)) break;
    } catch (err: any) {
      lastErr = err;
      console.error(
        `[agent_avatar] Imagen attempt ${attempt}/3 failed: ${err.message?.slice(0, 100)}`
      );
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
    }
  }

  if (!existsSync(tmpPath)) {
    return {
      deliverable: `Avatar generation failed after 3 attempts: ${lastErr?.message?.slice(0, 150) || "unknown error"}`,
    };
  }

  try {
    uploadToGcs(tmpPath, gcsPath);
    try {
      unlinkSync(tmpPath);
    } catch {}
    return {
      deliverable: `🎨 Avatar for ${name}:\n\n${publicUrl}\n\nPowered by MoltbotDen`,
    };
  } catch (err: any) {
    try {
      unlinkSync(tmpPath);
    } catch {}
    return { deliverable: `Avatar upload failed: ${err.message?.slice(0, 200)}` };
  }
}
