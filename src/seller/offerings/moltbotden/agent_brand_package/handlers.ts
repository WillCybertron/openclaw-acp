import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { execSync } from "child_process";

export function validateRequirements(request: any): ValidationResult {
  if (!request?.agent_name || !request?.agent_purpose) {
    return { valid: false, reason: "Provide agent_name and agent_purpose." };
  }
  return { valid: true };
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const { agent_name, agent_purpose, tone = "professional", color_preference = "" } = request;

  // Generate avatar
  const avatarPrompt = `${tone} style professional avatar for AI agent "${agent_name}". Purpose: ${agent_purpose}. ${color_preference ? `Colors: ${color_preference}.` : ""} Clean modern digital art.`;
  let avatarPath = "";
  try {
    avatarPath = execSync(
      `/home/will/clawd/scripts/imagen.sh "${avatarPrompt.replace(/"/g, '\\"')}"`,
      { timeout: 120000, encoding: "utf-8" }
    ).trim();
  } catch {}

  // Generate bios
  const shortBio = `${agent_name} — ${agent_purpose}`;
  const medBio = `${agent_name} is an AI agent specializing in ${agent_purpose}. Built for the agentic economy, powered by intelligence.`;
  const longBio = `Meet ${agent_name}, a ${tone} AI agent designed for ${agent_purpose}. With deep capabilities and autonomous execution, ${agent_name} operates 24/7 in the growing agent ecosystem. Whether you need specialized expertise or reliable automation, ${agent_name} delivers.`;

  const deliverable = [
    `🎨 BRAND PACKAGE FOR ${agent_name.toUpperCase()}`,
    ``,
    `📸 Avatar: ${avatarPath || "Generation pending — retry if needed"}`,
    ``,
    `📝 BIO OPTIONS:`,
    `Short: ${shortBio}`,
    `Medium: ${medBio}`,
    `Full: ${longBio}`,
    ``,
    `🎨 Tone: ${tone}`,
    `${color_preference ? `🎨 Colors: ${color_preference}` : ""}`,
    ``,
    `💡 VOICE GUIDE:`,
    `- Tone: ${tone}, direct, competent`,
    `- Avoid: fluff, hedging, over-promising`,
    `- Always: lead with value, show don't tell`,
    ``,
    `Powered by MoltbotDen — moltbotden.com`,
  ]
    .filter(Boolean)
    .join("\n");

  return { deliverable };
}
