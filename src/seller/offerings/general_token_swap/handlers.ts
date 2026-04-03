import type { ExecuteJobResult, ValidationResult } from "../../runtime/offeringTypes.js";

// =============================================================================
// General Token Swap — returns quote + transaction data (no on-chain execution)
//
// Uses MoltbotDen Swap API which wraps 0x Swap API v2.
// The buyer receives tx calldata to sign and submit themselves.
// =============================================================================

const MOLTBOTDEN_API = "https://api.moltbotden.com/api/v1/swap";

// ---------------------------------------------------------------------------
// Token resolution via MoltbotDen API
// ---------------------------------------------------------------------------

let tokenCache: Record<string, { address: string; decimals: number }> | null = null;

async function loadTokenMap(): Promise<Record<string, { address: string; decimals: number }>> {
  if (tokenCache) return tokenCache;
  try {
    const res = await fetch(`${MOLTBOTDEN_API}/tokens`);
    if (res.ok) {
      const data = (await res.json()) as {
        tokens: Array<{ symbol: string; address: string; decimals: number }>;
      };
      const map: Record<string, { address: string; decimals: number }> = {};
      for (const t of data.tokens) {
        map[t.symbol.toUpperCase()] = { address: t.address.toLowerCase(), decimals: t.decimals };
      }
      if (map["WETH"] && !map["ETH"]) map["ETH"] = map["WETH"];
      tokenCache = map;
      return map;
    }
  } catch {}
  return {
    USDC: { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
    WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    ETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    VIRTUAL: { address: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b", decimals: 18 },
  };
}

async function resolveToken(input: string): Promise<string | null> {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return trimmed;
  const map = await loadTokenMap();
  return map[trimmed.toUpperCase()]?.address ?? null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export async function validateRequirements(request: any): Promise<ValidationResult> {
  const { fromToken, toToken, amount } = request ?? {};

  if (!fromToken || typeof fromToken !== "string") {
    return {
      valid: false,
      reason: "Missing or invalid 'fromToken' — provide a token symbol (e.g. USDC) or address.",
    };
  }
  if (!toToken || typeof toToken !== "string") {
    return {
      valid: false,
      reason: "Missing or invalid 'toToken' — provide a token symbol (e.g. VIRTUAL) or address.",
    };
  }
  if (amount == null || typeof amount !== "number" || amount <= 0) {
    return { valid: false, reason: "Missing or invalid 'amount' — must be a positive number." };
  }
  if (amount > 1_000_000) {
    return { valid: false, reason: "Amount too large — max 1,000,000 per swap." };
  }

  const from = await resolveToken(fromToken);
  if (!from) {
    return {
      valid: false,
      reason: `Could not resolve fromToken '${fromToken}'. Provide a known symbol or a valid 0x-prefixed address.`,
    };
  }
  const to = await resolveToken(toToken);
  if (!to) {
    return {
      valid: false,
      reason: `Could not resolve toToken '${toToken}'. Provide a known symbol or a valid 0x-prefixed address.`,
    };
  }
  if (from.toLowerCase() === to.toLowerCase()) {
    return { valid: false, reason: "fromToken and toToken cannot be the same." };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Execution — get quote from MoltbotDen API, return tx data to buyer
// ---------------------------------------------------------------------------

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const { fromToken, toToken, amount } = request;

  // Get quote with transaction calldata from our API
  const quoteRes = await fetch(`${MOLTBOTDEN_API}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sellToken: fromToken,
      buyToken: toToken,
      sellAmount: String(amount),
    }),
  });

  if (!quoteRes.ok) {
    const errBody = await quoteRes.text();
    return { deliverable: `Swap quote failed (${quoteRes.status}): ${errBody}` };
  }

  const quote = (await quoteRes.json()) as any;

  const fromSymbol = fromToken.toUpperCase();
  const toSymbol = toToken.toUpperCase();
  const buyAmount = quote.buyAmount ?? "unknown";
  const gasEstimate = quote.gasEstimate ?? "unknown";

  const deliverable = JSON.stringify({
    status: "success",
    swap: {
      from: { token: quote.sellToken, symbol: fromSymbol, amount: String(amount) },
      to: { token: quote.buyToken, symbol: toSymbol, estimatedAmount: buyAmount },
      route: quote.route ?? null,
      gasEstimate: String(gasEstimate),
    },
    transaction: quote.transaction ?? null,
    allowance: quote.allowance ?? null,
    message: `Swap ${amount} ${fromSymbol} → ~${buyAmount} ${toSymbol} on Base. Transaction data included — approve allowance if needed, then submit the transaction.`,
  });

  return { deliverable };
}
