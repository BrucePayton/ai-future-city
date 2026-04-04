/**
 * Payment Service - 支付与托管服务
 *
 * 职责：
 * 1. 与智能合约交互（充值、释放、退款）
 * 2. 支付回调处理
 * 3. 区块链交易管理
 */

import type { PgPool } from "../db/client.js";

const DEFAULT_TENANT_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

// 合约地址（部署后配置）
const ESCROW_CONTRACT_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS || "";
const ESCROW_PRIVATE_KEY = process.env.ESCROW_PRIVATE_KEY || "";
const ESCROW_RPC_URL = process.env.ESCROW_RPC_URL || "http://localhost:8545";

export type PaymentResult = {
  success: boolean;
  txHash?: string;
  orderId?: string;
  error?: string;
};

export type PaymentStatus = "pending" | "funded" | "claimed" | "released" | "cancelled" | "completed";

export type EscrowStatus = {
  status: PaymentStatus;
  totalAmount: number;
  releasedAmount: number;
};

class EscrowService {
  private isConfigured: boolean = false;
  private provider: import("ethers").JsonRpcProvider | null = null;
  private wallet: import("ethers").Wallet | null = null;
  private contract: import("ethers").Contract | null = null;

  constructor() {
    this.init();
  }

  private async init() {
    if (!ESCROW_CONTRACT_ADDRESS || !ESCROW_PRIVATE_KEY || !ESCROW_RPC_URL) {
      console.log("[PaymentService] 未配置智能合约，跳过初始化");
      return;
    }

    try {
      const { ethers } = await import("ethers");
      this.provider = new ethers.JsonRpcProvider(ESCROW_RPC_URL);
      this.wallet = new ethers.Wallet(ESCROW_PRIVATE_KEY, this.provider);

      // ABI 片段
      const ABI = [
        "function createEscrow(bytes32 orderId, address seller, address token, uint256[] milestoneAmounts, string[] milestoneDescriptions) external",
        "function fund(bytes32 orderId) external payable",
        "function claimMilestone(bytes32 orderId, uint256 milestoneIndex) external",
        "function releaseMilestone(bytes32 orderId, uint256 milestoneIndex) external",
        "function cancelOrder(bytes32 orderId) external",
        "function getOrderStatus(bytes32 orderId) external view returns (uint8 status, uint256 totalAmount, uint256 releasedAmount)"
      ];

      this.contract = new ethers.Contract(ESCROW_CONTRACT_ADDRESS, ABI, this.wallet);
      this.isConfigured = true;
      console.log("[PaymentService] 智能合约服务已初始化");
    } catch (error) {
      console.error("[PaymentService] 初始化失败:", error);
    }
  }

  isEnabled(): boolean {
    return this.isConfigured;
  }

  /**
   * 创建托管订单（链上）
   */
  async createEscrow(
    orderId: string,
    sellerAddress: string,
    milestoneAmounts: number[],
    milestoneDescriptions: string[]
  ): Promise<PaymentResult> {
    if (!this.isEnabled()) {
      return { success: false, error: "Payment service not configured" };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contract: any = this.contract as any;
      const { ethers } = await import("ethers");

      const tx = await contract.createEscrow(
        orderId,
        sellerAddress,
        "0x0000000000000000000000000000000000000000", // ETH
        milestoneAmounts.map((a: number) => ethers.parseEther(a.toString())),
        milestoneDescriptions
      );

      const receipt = await tx.wait();
      return {
        success: true,
        txHash: receipt.hash,
        orderId
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 充值到托管
   */
  async fundEscrow(orderId: string, amount: number): Promise<PaymentResult> {
    if (!this.isEnabled()) {
      return { success: false, error: "Payment service not configured" };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contract: any = this.contract as any;
      const { ethers } = await import("ethers");

      const tx = await contract.fund(orderId, {
        value: ethers.parseEther(amount.toString())
      });

      const receipt = await tx.wait();
      return {
        success: true,
        txHash: receipt.hash,
        orderId
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 申领里程碑
   */
  async claimMilestone(orderId: string, milestoneIndex: number): Promise<PaymentResult> {
    if (!this.isEnabled()) {
      return { success: false, error: "Payment service not configured" };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contract: any = this.contract as any;

      const tx = await contract.claimMilestone(orderId, milestoneIndex);
      const receipt = await tx.wait();
      return {
        success: true,
        txHash: receipt.hash,
        orderId
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 释放里程碑（平台操作）
   */
  async releaseMilestone(orderId: string, milestoneIndex: number): Promise<PaymentResult> {
    if (!this.isEnabled()) {
      return { success: false, error: "Payment service not configured" };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contract: any = this.contract as any;

      const tx = await contract.releaseMilestone(orderId, milestoneIndex);
      const receipt = await tx.wait();
      return {
        success: true,
        txHash: receipt.hash,
        orderId
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 取消订单并退款
   */
  async cancelOrder(orderId: string): Promise<PaymentResult> {
    if (!this.isEnabled()) {
      return { success: false, error: "Payment service not configured" };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contract: any = this.contract as any;

      const tx = await contract.cancelOrder(orderId);
      const receipt = await tx.wait();
      return {
        success: true,
        txHash: receipt.hash,
        orderId
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 获取托管状态
   */
  async getEscrowStatus(orderId: string): Promise<EscrowStatus | null> {
    if (!this.isEnabled()) {
      return null;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contract: any = this.contract as any;
      const { ethers } = await import("ethers");

      const [status, totalAmount, releasedAmount] = await contract.getOrderStatus(orderId);

      const statusMap: Record<number, PaymentStatus> = {
        0: "pending",
        1: "funded",
        2: "claimed",
        3: "released",
        4: "cancelled",
        5: "completed"
      };

      return {
        status: statusMap[Number(status)] || "pending",
        totalAmount: Number(ethers.formatEther(totalAmount)),
        releasedAmount: Number(ethers.formatEther(releasedAmount))
      };
    } catch {
      return null;
    }
  }

  /**
   * 验证支付（回调处理）
   */
  async verifyPayment(txHash: string): Promise<boolean> {
    if (!this.provider) {
      return false;
    }

    try {
      const tx = await this.provider.getTransaction(txHash);
      return tx !== null && tx.from !== undefined;
    } catch {
      return false;
    }
  }
}

// 单例
export const escrowService = new EscrowService();

/**
 * 交易记录服务
 */
export class TransactionService {
  constructor(private pool: PgPool) {}

  /**
   * 记录链上交易
   */
  async recordTransaction(params: {
    orderId: string;
    type: "fund" | "release" | "refund";
    txHash: string;
    amount: number;
    status: "pending" | "confirmed" | "failed";
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO orders (id, tenant_id, tx_hash, metadata, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO UPDATE SET
         tx_hash = COALESCE($3, orders.tx_hash),
         metadata = jsonb_set(orders.metadata, '{transactions}', (
           COALESCE(orders.metadata->'transactions', '[]'::jsonb) || $5::jsonb
         )),
         updated_at = NOW()`,
      [
        params.orderId,
        DEFAULT_TENANT_ID,
        params.txHash,
        JSON.stringify({ lastTransaction: params.type }),
        JSON.stringify([{
          type: params.type,
          txHash: params.txHash,
          amount: params.amount,
          status: params.status,
          timestamp: new Date().toISOString()
        }])
      ]
    );
  }

  /**
   * 更新交易状态
   */
  async updateTransactionStatus(
    txHash: string,
    status: "pending" | "confirmed" | "failed"
  ): Promise<void> {
    console.log(`[TransactionService] 更新交易 ${txHash} 状态为 ${status}`);
  }
}