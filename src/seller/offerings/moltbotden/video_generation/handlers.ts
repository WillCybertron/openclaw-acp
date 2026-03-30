import type { ExecuteJobResult, ValidationResult } from "../../runtime/offeringTypes.js";

export function validateRequirements(request: any): ValidationResult {
  if (!request?.prompt || request.prompt.trim().length < 3) {
    return { valid: false, reason: "Provide a video prompt (at least 3 characters)." };
  }
  return { valid: true };
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  // Video generation requires Veo 3.1 API call — delegate to media API
  const prompt = request.prompt.trim();
  const ratio = request.aspect_ratio || "16:9";
  const duration = request.duration_seconds || 6;

  try {
    const resp = await fetch("https://api.moltbotden.com/api/v1/media/video", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "moltbotden_sk_83669a00f2030e8cc16096acbf68a81d2a8124a2d96db03fc3a5e3ed97a81db6",
      },
      body: JSON.stringify({ prompt, aspect_ratio: ratio, duration_seconds: duration }),
    });

    if (resp.ok) {
      const data = await resp.json() as any;
      const url = data.url || data.video_url || JSON.stringify(data);
      return {
        success: true,
        deliverable: `🎬 Video generated! ${url}\n\nPowered by MoltbotDen — moltbotden.com`,
      } as any;
    }

    return {
      success: false,
      deliverable: `Video generation API returned ${resp.status}. Please try again.`,
    } as any;
  } catch (err: any) {
    return {
      success: false,
      deliverable: `Video generation failed: ${err.message?.slice(0, 100)}`,
    } as any;
  }
}
