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

const TOKEN_DECIMALS: Record<string, number> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6,  // USDC
  "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA": 6,  // USDbC
};

// Standard ERC20 transfer function signature
const ERC20_TRANSFER_SIG = "0xa9059cbb";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveToken(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return trimmed;
  return TOKEN_MAP[trimmed.toUpperCase()] ?? null;
}

function isValidAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr?.trim() ?? "");
}

function toBaseUnits(amount: number, tokenAddress: string): string {
  const decimals = TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
  const factor = BigInt(10) ** BigInt(decimals);
  const scaled = BigInt(Math.round(amount * 10 ** Math.min(decimals, 8)));
  if (decimals <= 8) {
    return scaled.toString();
  }
  return (scaled * BigInt(10) ** BigInt(decimals - 8)).toString();
}

/** Encode ERC20 transfer(address,uint256) calldata. */
function encodeTransferCalldata(to: string, amountWei: string): string {
  const addrPadded = to.toLowerCase().replace("0x", "").padStart(64, "0");
  const amountHex = BigInt(amountWei).toString(16).padStart(64, "0");
  return `${ERC20_TRANSFER_SIG}${addrPadded}${amountHex}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateRequirements(request: any): ValidationResult {
  const { token, toAddress, amount } = request ?? {};

  if (!token || typeof token !== "string") {
    return { valid: false, reason: "Missing or invalid 'token' — provide a token symbol (e.g. USDC) or address." };
  }
  if (!toAddress || typeof toAddress !== "string") {
    return { valid: false, reason: "Missing or invalid 'toAddress' — provide a destination wallet address." };
  }
  if (!isValidAddress(toAddress)) {
    return { valid: false, reason: `Invalid destination address '${toAddress}'. Must be a valid 0x-prefixed Ethereum address.` };
  }
  if (amount == null || typeof amount !== "number" || amount <= 0) {
    return { valid: false, reason: "Missing or invalid 'amount' — must be a positive number." };
  }

  const resolved = resolveToken(token);
  if (!resolved) {
    return { valid: false, reason: `Could not resolve token '${token}'. Provide a known symbol or a valid 0x-prefixed address.` };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Execution — build and return ERC20 transfer transaction data
// ---------------------------------------------------------------------------

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const { token, toAddress, amount } = request;

  const tokenAddress = resolveToken(token)!;
  const amountWei = toBaseUnits(amount, tokenAddress);
  const calldata = encodeTransferCalldata(toAddress, amountWei);

  const tokenSymbol = token.toUpperCase();
  const decimals = TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;

  const deliverable = JSON.stringify({
    status: "success",
    transfer: {
      token: tokenAddress,
      symbol: tokenSymbol,
      to: toAddress,
      amount: String(amount),
      amountWei,
      decimals,
    },
    transaction: {
      to: tokenAddress,
      data: calldata,
      value: "0",
      chainId: 8453,
    },
    message: `Transfer ${amount} ${tokenSymbol} to ${toAddress} on Base. Transaction data included — submit to execute.`,
  });

  return { deliverable };
}
