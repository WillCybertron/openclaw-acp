import type { ExecuteJobResult, ValidationResult } from "../../runtime/offeringTypes.js";

// =============================================================================
// Agent Transfer — returns encoded ERC-20 transfer calldata
//
// Uses MoltbotDen Swap API's /transfer/encode endpoint.
// Pure ABI encoding — no external calls, always available.
// =============================================================================

const MOLTBOTDEN_API = "https://api.moltbotden.com/api/v1/swap";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isValidAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr?.trim() ?? "");
}

export function validateRequirements(request: any): ValidationResult {
  const { token, toAddress, amount } = request ?? {};

  if (!token || typeof token !== "string") {
    return {
      valid: false,
      reason: "Missing or invalid 'token' — provide a token symbol (e.g. USDC) or address.",
    };
  }
  if (!toAddress || typeof toAddress !== "string") {
    return {
      valid: false,
      reason: "Missing or invalid 'toAddress' — provide a destination wallet address.",
    };
  }
  if (!isValidAddress(toAddress)) {
    return {
      valid: false,
      reason: `Invalid destination address '${toAddress}'. Must be a valid 0x-prefixed Ethereum address.`,
    };
  }
  if (amount == null || typeof amount !== "number" || amount <= 0) {
    return { valid: false, reason: "Missing or invalid 'amount' — must be a positive number." };
  }
  if (amount > 1_000_000_000) {
    return { valid: false, reason: "Amount too large." };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Execution — call MoltbotDen API to encode transfer
// ---------------------------------------------------------------------------

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const { token, toAddress, amount } = request;

  const res = await fetch(`${MOLTBOTDEN_API}/transfer/encode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: token,
      toAddress: toAddress,
      amount: String(amount),
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    return { deliverable: `Transfer encoding failed (${res.status}): ${errBody}` };
  }

  const data = (await res.json()) as any;
  const tokenSymbol = token.toUpperCase();

  const deliverable = JSON.stringify({
    status: "success",
    transfer: {
      token: data.token ?? token,
      symbol: tokenSymbol,
      to: data.toAddress ?? toAddress,
      amount: data.amount ?? String(amount),
      amountRaw: data.amountRaw,
    },
    transaction: data.transaction ?? null,
    message: `Transfer ${amount} ${tokenSymbol} to ${toAddress} on Base. Transaction data included — submit to execute.`,
  });

  return { deliverable };
}
