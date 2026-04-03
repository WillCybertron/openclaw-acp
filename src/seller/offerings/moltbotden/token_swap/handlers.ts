import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { readFileSync } from "fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Hex,
  type Address,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// =============================================================================
// MoltbotDen Token Swap Handler — ACP Seller
//
// Flow:
// 1. Buyer sends a swap request (sellToken, buyToken, sellAmount)
// 2. We validate and get a quote from the MoltbotDen Swap API
// 3. Buyer sends sell tokens to our wallet via ACP requiredFunds
// 4. We execute the swap on-chain via the 0x tx data from our API
// 5. We return the bought tokens to the buyer via ACP payableDetail
//
// The MoltbotDen API (api.moltbotden.com/api/v1/swap) wraps 0x Swap API v2
// and handles token resolution, decimal conversion, and routing. We only need
// the private key locally for signing the actual transaction.
// =============================================================================

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MOLTBOTDEN_API = "https://api.moltbotden.com/api/v1/swap";
const BASE_RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";

// Swap execution wallet — Chief's wallet
const AGENT_WALLET: Address = "0x7798E574e1e3ee752a5322C8c976D9CADD5F1673";

// PROTECTED TOKENS — NEVER swap these from our wallet
const PROTECTED_TOKENS: Set<string> = new Set([
  "0x0d4abeb368eb6276ed8241ea25eaacad390d9287", // $MOLTBOT
  "0xa7d95896d88448c42bf28566dfb8091bb1efddc2", // $INTL / $MDEN
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);

// ---------------------------------------------------------------------------
// Token resolution — use the MoltbotDen API token list
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
      // ETH alias
      if (map["WETH"] && !map["ETH"]) {
        map["ETH"] = map["WETH"];
      }
      tokenCache = map;
      return map;
    }
  } catch {}
  // Fallback if API unreachable — hardcode essentials
  return {
    USDC: { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
    WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    ETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    VIRTUAL: { address: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b", decimals: 18 },
    CBBTC: { address: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", decimals: 8 },
  };
}

async function resolveToken(input: string): Promise<{ address: Address; decimals: number } | null> {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    // Contract address — look up decimals from map, default to 18
    const map = await loadTokenMap();
    const entry = Object.values(map).find((t) => t.address.toLowerCase() === trimmed.toLowerCase());
    return { address: trimmed as Address, decimals: entry?.decimals ?? 18 };
  }
  const map = await loadTokenMap();
  const entry = map[trimmed.toUpperCase()];
  if (!entry) return null;
  return { address: entry.address as Address, decimals: entry.decimals };
}

// ---------------------------------------------------------------------------
// Decimal helpers
// ---------------------------------------------------------------------------

function toBaseUnits(amount: number, decimals: number): bigint {
  const factor = 10 ** Math.min(decimals, 8);
  const scaled = BigInt(Math.round(amount * factor));
  if (decimals <= 8) return scaled;
  return scaled * BigInt(10) ** BigInt(decimals - 8);
}

function fromBaseUnits(raw: bigint | string, decimals: number): number {
  return Number(BigInt(raw)) / 10 ** decimals;
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

function getPrivateKey(): Hex {
  let key = process.env.AGENT_WALLET_PRIVATE_KEY;
  if (!key) {
    try {
      const envContent = readFileSync("/home/will/.secrets/swap-wallet.env", "utf-8");
      const match = envContent.match(/AGENT_WALLET_PRIVATE_KEY=(.+)/);
      if (match) key = match[1].trim();
    } catch {}
  }
  if (!key) throw new Error("AGENT_WALLET_PRIVATE_KEY not set");
  return (key.startsWith("0x") ? key : `0x${key}`) as Hex;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export async function validateRequirements(request: any): Promise<ValidationResult> {
  const { sellToken, buyToken, sellAmount } = request ?? {};

  if (!sellToken || typeof sellToken !== "string") {
    return {
      valid: false,
      reason: "Missing 'sellToken' — provide a symbol (USDC, WETH, VIRTUAL) or 0x address.",
    };
  }
  if (!buyToken || typeof buyToken !== "string") {
    return {
      valid: false,
      reason: "Missing 'buyToken' — provide a symbol (USDC, WETH, VIRTUAL) or 0x address.",
    };
  }
  if (sellAmount == null || typeof sellAmount !== "number" || sellAmount <= 0) {
    return { valid: false, reason: "Missing or invalid 'sellAmount' — must be a positive number." };
  }
  if (sellAmount > 1_000_000) {
    return { valid: false, reason: "sellAmount too large — max 1,000,000 per swap." };
  }

  const from = await resolveToken(sellToken);
  if (!from) {
    return {
      valid: false,
      reason: `Cannot resolve sellToken '${sellToken}'. Use a known symbol or 0x address.`,
    };
  }
  const to = await resolveToken(buyToken);
  if (!to) {
    return {
      valid: false,
      reason: `Cannot resolve buyToken '${buyToken}'. Use a known symbol or 0x address.`,
    };
  }
  if (from.address.toLowerCase() === to.address.toLowerCase()) {
    return { valid: false, reason: "sellToken and buyToken cannot be the same." };
  }

  // SECURITY: Never allow swapping protected tokens FROM our wallet
  if (PROTECTED_TOKENS.has(from.address.toLowerCase())) {
    return { valid: false, reason: `${sellToken} is not available for swaps.` };
  }

  // Verify private key is available (fail fast)
  try {
    getPrivateKey();
  } catch (err: any) {
    return { valid: false, reason: `Swap service temporarily unavailable.` };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Request additional funds — buyer sends sell tokens to our wallet
// ---------------------------------------------------------------------------

export async function requestAdditionalFunds(request: any): Promise<{
  content: string;
  amount: number;
  tokenAddress: string;
  recipient: string;
}> {
  const from = await resolveToken(request.sellToken);
  if (!from) throw new Error(`Cannot resolve sellToken: ${request.sellToken}`);
  const symbol = request.sellToken.toUpperCase();

  return {
    content: `Send ${request.sellAmount} ${symbol} to execute the swap. Best price across 150+ DEXs on Base.`,
    amount: request.sellAmount,
    tokenAddress: from.address,
    recipient: AGENT_WALLET,
  };
}

// ---------------------------------------------------------------------------
// Execute swap
// ---------------------------------------------------------------------------

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const { sellToken, buyToken, sellAmount, slippageBps } = request;

  const sellInfo = await resolveToken(sellToken);
  const buyInfo = await resolveToken(buyToken);
  if (!sellInfo || !buyInfo) {
    return { deliverable: "Error: Could not resolve token addresses." };
  }

  const sellAmountWei = toBaseUnits(sellAmount, sellInfo.decimals);
  const privateKey = getPrivateKey();

  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({
    chain: base,
    transport: http(BASE_RPC),
  });
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(BASE_RPC),
  });

  try {
    // --- Step 1: Verify we received the buyer's tokens ---
    const balance = await publicClient.readContract({
      address: sellInfo.address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [AGENT_WALLET],
    });

    if (balance < sellAmountWei) {
      return {
        deliverable: `Error: Insufficient ${sellToken} balance. Expected ${sellAmount}, have ${fromBaseUnits(balance, sellInfo.decimals).toFixed(6)}. Buyer tokens may not have arrived yet.`,
      };
    }

    // --- Step 2: Get quote from MoltbotDen Swap API ---
    const quoteRes = await fetch(`${MOLTBOTDEN_API}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sellToken: sellToken,
        buyToken: buyToken,
        sellAmount: String(sellAmount),
        takerAddress: AGENT_WALLET,
        ...(slippageBps ? { slippageBps: Number(slippageBps) } : {}),
      }),
    });

    if (!quoteRes.ok) {
      const errBody = await quoteRes.text();
      return { deliverable: `Swap quote failed (${quoteRes.status}): ${errBody}` };
    }

    const quote = (await quoteRes.json()) as any;

    if (!quote.transaction?.to || !quote.transaction?.data) {
      return {
        deliverable: `Quote returned no executable transaction. Response: ${JSON.stringify(quote).slice(0, 300)}`,
      };
    }

    // --- Step 3: Approve 0x allowance holder if needed ---
    const allowanceTarget = quote.allowance?.allowanceTarget as Address | undefined;

    if (allowanceTarget && quote.allowance?.isNeeded) {
      const currentAllowance = await publicClient.readContract({
        address: sellInfo.address,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [AGENT_WALLET, allowanceTarget],
      });

      if (currentAllowance < sellAmountWei) {
        console.log(
          `[swap] Approving ${allowanceTarget} to spend ${sellAmountWei} of ${sellToken}`
        );
        const approveHash = await walletClient.writeContract({
          address: sellInfo.address,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [allowanceTarget, sellAmountWei * 2n], // 2x buffer
        });
        await publicClient.waitForTransactionReceipt({
          hash: approveHash,
          confirmations: 1,
        });
        console.log(`[swap] Approval confirmed: ${approveHash}`);
      }
    }

    // --- Step 4: Execute the swap ---
    const txData = quote.transaction;
    console.log(`[swap] Submitting swap: ${sellAmount} ${sellToken} → ${buyToken}`);

    const swapHash = await walletClient.sendTransaction({
      to: txData.to as Address,
      data: txData.data as Hex,
      value: BigInt(txData.value || "0"),
      gas: txData.gas ? BigInt(txData.gas) : undefined,
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: swapHash,
      confirmations: 1,
    });

    if (receipt.status !== "success") {
      return { deliverable: `Swap transaction reverted. TX: https://basescan.org/tx/${swapHash}` };
    }

    console.log(`[swap] Swap confirmed: ${swapHash}`);

    // --- Step 5: Return output to buyer ---
    const buyAmountRaw = quote.buyAmountRaw ? BigInt(quote.buyAmountRaw) : BigInt(0);
    const buyAmountHuman = quote.buyAmount
      ? Number(quote.buyAmount)
      : fromBaseUnits(buyAmountRaw, buyInfo.decimals);

    const sellSymbol = sellToken.toUpperCase();
    const buySymbol = buyToken.toUpperCase();

    return {
      deliverable: JSON.stringify({
        status: "success",
        swap: {
          sold: { token: sellInfo.address, symbol: sellSymbol, amount: String(sellAmount) },
          bought: { token: buyInfo.address, symbol: buySymbol, amount: buyAmountHuman.toFixed(6) },
          route: quote.route ?? null,
        },
        txHash: swapHash,
        explorerUrl: `https://basescan.org/tx/${swapHash}`,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
        message: `Swapped ${sellAmount} ${sellSymbol} → ${buyAmountHuman.toFixed(6)} ${buySymbol} on Base. TX: https://basescan.org/tx/${swapHash}`,
      }),
      payableDetail: {
        tokenAddress: buyInfo.address,
        amount: buyAmountHuman,
      },
    };
  } catch (err: any) {
    console.error("[swap] Execution error:", err);
    return {
      deliverable: `Swap execution failed: ${err.message || String(err)}`,
    };
  }
}
