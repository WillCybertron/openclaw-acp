import type { ExecuteJobResult, ValidationResult } from "../../runtime/offeringTypes.js";

// ---------------------------------------------------------------------------
// Common Base chain token address map
// ---------------------------------------------------------------------------
const TOKEN_MAP: Record<string, string> = {
  USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  WETH: "0x4200000000000000000000000000000000000006",
  ETH: "0x4200000000000000000000000000000000000006",
  VIRTUAL: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
  CBBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  AERO: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
  BRETT: "0x532f27101965dd16442E59d40670FaF5eBB142E4",
  DEGEN: "0x4ed4E862860bed51a9570b96d89aF5E1B0Efefed",
  DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
  USDBC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
  MOLTBOT: "0x0D4aBeB368eb6276Ed8241EA25eaaCAd390D9287",
};

// Decimals for tokens we know about (default 18)
const TOKEN_DECIMALS: Record<string, number> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6,  // USDC
  "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA": 6,  // USDbC
};

const CHAIN_ID = 8453; // Base
const ZERO_X_BASE = "https://api.0x.org";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a symbol or address to a checksummed address. */
function resolveToken(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();

  // Already an address
  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return trimmed;

  // Lookup by symbol
  const upper = trimmed.toUpperCase();
  return TOKEN_MAP[upper] ?? null;
}

/** Convert human-readable amount to smallest unit (bigint string). */
function toBaseUnits(amount: number, tokenAddress: string): string {
  const decimals = TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
  // Use string math to avoid floating point issues for large values
  const factor = BigInt(10) ** BigInt(decimals);
  // Round to avoid floating-point dust
  const scaled = BigInt(Math.round(amount * 10 ** Math.min(decimals, 8)));
  if (decimals <= 8) {
    return scaled.toString();
  }
  return (scaled * BigInt(10) ** BigInt(decimals - 8)).toString();
}

function getApiKey(): string {
  const key = process.env.ZERO_X_API_KEY;
  if (!key) throw new Error("ZERO_X_API_KEY environment variable is not set");
  return key;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateRequirements(request: any): ValidationResult {
  const { fromToken, toToken, amount } = request ?? {};

  if (!fromToken || typeof fromToken !== "string") {
    return { valid: false, reason: "Missing or invalid 'fromToken' — provide a token symbol (e.g. USDC) or address." };
  }
  if (!toToken || typeof toToken !== "string") {
    return { valid: false, reason: "Missing or invalid 'toToken' — provide a token symbol (e.g. VIRTUAL) or address." };
  }
  if (amount == null || typeof amount !== "number" || amount <= 0) {
    return { valid: false, reason: "Missing or invalid 'amount' — must be a positive number." };
  }

  const from = resolveToken(fromToken);
  if (!from) {
    return { valid: false, reason: `Could not resolve fromToken '${fromToken}'. Provide a known symbol or a valid 0x-prefixed address.` };
  }
  const to = resolveToken(toToken);
  if (!to) {
    return { valid: false, reason: `Could not resolve toToken '${toToken}'. Provide a known symbol or a valid 0x-prefixed address.` };
  }
  if (from.toLowerCase() === to.toLowerCase()) {
    return { valid: false, reason: "fromToken and toToken cannot be the same." };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Execution — call 0x Swap API and return quote data
// ---------------------------------------------------------------------------

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const { fromToken, toToken, amount } = request;

  const sellToken = resolveToken(fromToken)!;
  const buyToken = resolveToken(toToken)!;
  const sellAmount = toBaseUnits(amount, sellToken);

  const apiKey = getApiKey();

  // --- Step 1: Get indicative price first (cheaper, no commitment) ---
  const priceParams = new URLSearchParams({
    chainId: String(CHAIN_ID),
    sellToken,
    buyToken,
    sellAmount,
  });

  const priceRes = await fetch(`${ZERO_X_BASE}/swap/allowance-holder/price?${priceParams}`, {
    headers: { "0x-api-key": apiKey, "0x-version": "2" },
  });

  if (!priceRes.ok) {
    const errBody = await priceRes.text();
    return {
      deliverable: `Swap quote failed (price check). Status ${priceRes.status}: ${errBody}`,
    };
  }

  const priceData = await priceRes.json();

  // --- Step 2: Get firm quote with transaction data ---
  const quoteParams = new URLSearchParams({
    chainId: String(CHAIN_ID),
    sellToken,
    buyToken,
    sellAmount,
  });

  const quoteRes = await fetch(`${ZERO_X_BASE}/swap/allowance-holder/quote?${quoteParams}`, {
    headers: { "0x-api-key": apiKey, "0x-version": "2" },
  });

  if (!quoteRes.ok) {
    const errBody = await quoteRes.text();
    return {
      deliverable: `Swap quote failed. Status ${quoteRes.status}: ${errBody}`,
    };
  }

  const quoteData = await quoteRes.json();

  // --- Build deliverable ---
  const fromSymbol = fromToken.toUpperCase();
  const toSymbol = toToken.toUpperCase();

  const buyAmountHuman = formatBuyAmount(quoteData.buyAmount, buyToken);
  const gasEstimate = quoteData.transaction?.gas ?? quoteData.gas ?? "unknown";

  const deliverable = JSON.stringify({
    status: "success",
    swap: {
      from: { token: sellToken, symbol: fromSymbol, amount: String(amount) },
      to: { token: buyToken, symbol: toSymbol, estimatedAmount: buyAmountHuman },
      route: quoteData.route ?? priceData.route ?? null,
      gasEstimate: String(gasEstimate),
    },
    transaction: quoteData.transaction ?? null,
    allowanceTarget: quoteData.issues?.allowance?.spender ?? null,
    message: `Swap ${amount} ${fromSymbol} -> ~${buyAmountHuman} ${toSymbol} on Base. Transaction data included — approve allowance if needed, then submit the transaction.`,
  });

  return { deliverable };
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatBuyAmount(raw: string | undefined, tokenAddress: string): string {
  if (!raw) return "unknown";
  const decimals = TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
  try {
    const value = Number(BigInt(raw)) / 10 ** decimals;
    return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
  } catch {
    return raw;
  }
}
