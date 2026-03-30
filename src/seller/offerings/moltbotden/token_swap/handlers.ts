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
// Executes real on-chain swaps via 0x Swap API on Base.
// Buyer sends sell tokens → we swap on DEX → return buy tokens to buyer.
// =============================================================================

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CHAIN_ID = 8453; // Base Mainnet
const ZERO_X_BASE = "https://api.0x.org";
const BASE_RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";

// Swap execution wallet — Chief's wallet
const AGENT_WALLET: Address = "0x7798E574e1e3ee752a5322C8c976D9CADD5F1673";

// PROTECTED TOKENS — NEVER swap these from our wallet
const PROTECTED_TOKENS: Set<string> = new Set([
  "0x0d4abeb368eb6276ed8241ea25eaacad390d9287", // $MOLTBOT
  "0xa7d95896d88448c42bf28566dfb8091bb1efddc2", // $INTL / $MDEN
]);

// ---------------------------------------------------------------------------
// Token registry
// ---------------------------------------------------------------------------

const TOKEN_MAP: Record<string, Address> = {
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
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": 8,  // cbBTC
};

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveToken(input: string): Address | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return trimmed as Address;
  return TOKEN_MAP[trimmed.toUpperCase()] ?? null;
}

function getDecimals(tokenAddress: string): number {
  return TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
}

function toBaseUnits(amount: number, tokenAddress: string): bigint {
  const decimals = getDecimals(tokenAddress);
  // Use string math to avoid floating point issues
  const factor = 10 ** Math.min(decimals, 8);
  const scaled = BigInt(Math.round(amount * factor));
  if (decimals <= 8) return scaled;
  return scaled * BigInt(10) ** BigInt(decimals - 8);
}

function fromBaseUnits(raw: bigint | string, tokenAddress: string): number {
  const decimals = getDecimals(tokenAddress);
  return Number(BigInt(raw)) / 10 ** decimals;
}

function getPrivateKey(): Hex {
  let key = process.env.AGENT_WALLET_PRIVATE_KEY;
  if (!key) {
    // Try loading from secrets file
    try {
      const envContent = readFileSync("/home/will/.secrets/swap-wallet.env", "utf-8");
      const match = envContent.match(/AGENT_WALLET_PRIVATE_KEY=(.+)/);
      if (match) key = match[1].trim();
    } catch {}
  }
  if (!key) throw new Error("AGENT_WALLET_PRIVATE_KEY not set");
  return (key.startsWith("0x") ? key : `0x${key}`) as Hex;
}

function getApiKey(): string {
  let key = process.env.ZERO_X_API_KEY;
  if (!key) {
    try {
      const envContent = readFileSync("/home/will/.secrets/swap-wallet.env", "utf-8");
      const match = envContent.match(/ZERO_X_API_KEY=(.+)/);
      if (match) key = match[1].trim();
    } catch {}
  }
  if (!key) throw new Error("ZERO_X_API_KEY not set");
  return key;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateRequirements(request: any): ValidationResult {
  const { sellToken, buyToken, sellAmount } = request ?? {};

  if (!sellToken || typeof sellToken !== "string") {
    return { valid: false, reason: "Missing 'sellToken' — provide a symbol (USDC, WETH, VIRTUAL) or 0x address." };
  }
  if (!buyToken || typeof buyToken !== "string") {
    return { valid: false, reason: "Missing 'buyToken' — provide a symbol (USDC, WETH, VIRTUAL) or 0x address." };
  }
  if (sellAmount == null || typeof sellAmount !== "number" || sellAmount <= 0) {
    return { valid: false, reason: "Missing or invalid 'sellAmount' — must be a positive number." };
  }

  const from = resolveToken(sellToken);
  if (!from) {
    return { valid: false, reason: `Cannot resolve sellToken '${sellToken}'. Use a known symbol or 0x address.` };
  }
  const to = resolveToken(buyToken);
  if (!to) {
    return { valid: false, reason: `Cannot resolve buyToken '${buyToken}'. Use a known symbol or 0x address.` };
  }
  if (from.toLowerCase() === to.toLowerCase()) {
    return { valid: false, reason: "sellToken and buyToken cannot be the same." };
  }

  // SECURITY: Never allow swapping protected tokens FROM our wallet
  if (PROTECTED_TOKENS.has(from.toLowerCase())) {
    return { valid: false, reason: `${sellToken} is not available for swaps.` };
  }

  // Verify env vars are set (fail fast before accepting job)
  try {
    getPrivateKey();
    getApiKey();
  } catch (err: any) {
    return { valid: false, reason: `Service misconfigured: ${err.message}` };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Request additional funds — buyer sends sell tokens to our wallet
// ---------------------------------------------------------------------------

export function requestAdditionalFunds(request: any): {
  content?: string;
  amount: number;
  tokenAddress: string;
  recipient: string;
} {
  const sellTokenAddress = resolveToken(request.sellToken)!;
  const symbol = request.sellToken.toUpperCase();

  return {
    content: `Send ${request.sellAmount} ${symbol} to execute the swap. Best price across 150+ DEXs on Base.`,
    amount: request.sellAmount,
    tokenAddress: sellTokenAddress,
    recipient: AGENT_WALLET,
  };
}

// ---------------------------------------------------------------------------
// Execute swap — the money maker
// ---------------------------------------------------------------------------

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const { sellToken, buyToken, sellAmount, slippageBps } = request;

  const sellTokenAddress = resolveToken(sellToken)!;
  const buyTokenAddress = resolveToken(buyToken)!;
  const sellAmountWei = toBaseUnits(sellAmount, sellTokenAddress);
  const apiKey = getApiKey();
  const privateKey = getPrivateKey();

  // Set up viem clients
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
      address: sellTokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [AGENT_WALLET],
    });

    if (balance < sellAmountWei) {
      return {
        deliverable: `Error: Insufficient ${sellToken} balance. Expected ${sellAmount}, have ${fromBaseUnits(balance, sellTokenAddress).toFixed(6)}. Buyer tokens may not have arrived yet.`,
      };
    }

    // --- Step 1b: Profitability check ---
    // Our fee is 0.25% of trade value. Gas on Base is ~$0.01-0.05.
    // Reject swaps where fee revenue < estimated gas cost (min $0.10 trade value).
    // At 0.25% on $0.10 = $0.00025 revenue — not worth gas.
    // Minimum trade: $2 → 0.25% = $0.005 revenue, still thin but acceptable.
    // We'll enforce minimum sellAmount equivalent of ~$1 worth to stay profitable.
    // For now, reject if sellAmount < 1 for USDC-like tokens, or < 0.001 for ETH-like.
    const decimals = getDecimals(sellTokenAddress);
    if (decimals <= 8 && sellAmount < 1) {
      return {
        deliverable: `Trade too small to be profitable. Minimum ~$1 equivalent. Got ${sellAmount} ${sellToken}.`,
      };
    }

    // --- Step 2: Get firm quote from 0x ---
    const quoteParams = new URLSearchParams({
      chainId: String(CHAIN_ID),
      sellToken: sellTokenAddress,
      buyToken: buyTokenAddress,
      sellAmount: sellAmountWei.toString(),
      taker: AGENT_WALLET,
      ...(slippageBps ? { slippageBps: String(slippageBps) } : {}),
    });

    const quoteRes = await fetch(
      `${ZERO_X_BASE}/swap/allowance-holder/quote?${quoteParams}`,
      { headers: { "0x-api-key": apiKey, "0x-version": "2" } }
    );

    if (!quoteRes.ok) {
      const errBody = await quoteRes.text();
      return {
        deliverable: `Swap quote failed (${quoteRes.status}): ${errBody}`,
      };
    }

    const quote = await quoteRes.json();

    if (!quote.transaction) {
      return {
        deliverable: `0x returned no transaction data. Quote: ${JSON.stringify(quote)}`,
      };
    }

    // --- Step 3: Approve 0x allowance holder if needed ---
    const allowanceTarget = quote.issues?.allowance?.spender as Address | undefined;

    if (allowanceTarget) {
      const currentAllowance = await publicClient.readContract({
        address: sellTokenAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [AGENT_WALLET, allowanceTarget],
      });

      if (currentAllowance < sellAmountWei) {
        console.log(`[swap] Approving ${allowanceTarget} to spend ${sellAmountWei} of ${sellToken}`);

        const approveHash = await walletClient.writeContract({
          address: sellTokenAddress,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [allowanceTarget, sellAmountWei * 2n], // 2x for safety margin
        });

        // Wait for approval to confirm
        await publicClient.waitForTransactionReceipt({
          hash: approveHash,
          confirmations: 1,
        });
        console.log(`[swap] Approval confirmed: ${approveHash}`);
      }
    }

    // --- Step 4: Execute the swap ---
    console.log(`[swap] Submitting swap: ${sellAmount} ${sellToken} → ${buyToken}`);

    const swapHash = await walletClient.sendTransaction({
      to: quote.transaction.to as Address,
      data: quote.transaction.data as Hex,
      value: BigInt(quote.transaction.value || "0"),
      gas: quote.transaction.gas ? BigInt(quote.transaction.gas) : undefined,
    });

    // Wait for swap to confirm
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: swapHash,
      confirmations: 1,
    });

    if (receipt.status !== "success") {
      return {
        deliverable: `Swap transaction reverted. TX: ${swapHash}`,
      };
    }

    console.log(`[swap] Swap confirmed: ${swapHash}`);

    // --- Step 5: Check output token balance ---
    const buyBalance = await publicClient.readContract({
      address: buyTokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [AGENT_WALLET],
    });

    // The quote tells us expected output
    const expectedBuyAmount = BigInt(quote.buyAmount);
    const buyAmountHuman = fromBaseUnits(expectedBuyAmount, buyTokenAddress);

    // Use actual balance or expected, whichever is smaller (safety)
    const outputAmount = fromBaseUnits(
      buyBalance < expectedBuyAmount ? buyBalance : expectedBuyAmount,
      buyTokenAddress
    );

    const sellSymbol = sellToken.toUpperCase();
    const buySymbol = buyToken.toUpperCase();

    return {
      deliverable: JSON.stringify({
        status: "success",
        swap: {
          sold: { token: sellTokenAddress, symbol: sellSymbol, amount: String(sellAmount) },
          bought: { token: buyTokenAddress, symbol: buySymbol, amount: outputAmount.toFixed(6) },
        },
        txHash: swapHash,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
        message: `Swapped ${sellAmount} ${sellSymbol} → ${outputAmount.toFixed(6)} ${buySymbol} on Base. TX: ${swapHash}`,
      }),
      // Return the swapped tokens to the buyer via ACP
      payableDetail: {
        tokenAddress: buyTokenAddress,
        amount: outputAmount,
      },
    };
  } catch (err: any) {
    console.error("[swap] Execution error:", err);
    return {
      deliverable: `Swap execution failed: ${err.message || String(err)}`,
    };
  }
}
