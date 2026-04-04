/**
 * Payment Gateway Service - 多币种支付网关
 *
 * 支持：
 * - 虚拟货币：ETH, BTC, USDT, USDC, BNB
 * - 法币支付：银行卡、支付宝、微信（通过第三方网关）
 * - 链下支付：余额支付
 *
 * 集成方案：
 * - 加密货币直接转账：原生支持
 * - 法币网关：Simplex, MoonPay, Mercuryo, Alchemy Pay, 币易支付(CoinEasy)
 * - CEX 充值：支持币安、OKX、火币等 API
 */

import type { PgPool } from "../db/client.js";

const DEFAULT_TENANT_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

// 支持的货币
export type Currency = "ETH" | "BTC" | "USDT" | "USDC" | "BNB" | "CNY" | "USD";

export interface PaymentMethod {
  id: string;
  type: "crypto" | "fiat" | "balance";
  name: string;
  icon: string;
  supportedCurrencies: Currency[];
  fee: number; // 手续费百分比
  minAmount: number;
  maxAmount: number;
}

// 可用的支付方式配置
export const PAYMENT_METHODS: PaymentMethod[] = [
  // 加密货币
  {
    id: "eth",
    type: "crypto",
    name: "ETH",
    icon: "Ethereum",
    supportedCurrencies: ["ETH"],
    fee: 0.001, // 0.1% 网络费
    minAmount: 0.001,
    maxAmount: 1000,
  },
  {
    id: "btc",
    type: "crypto",
    name: "BTC",
    icon: "Bitcoin",
    supportedCurrencies: ["BTC"],
    fee: 0.0001, // 约 0.1% 网络费
    minAmount: 0.0001,
    maxAmount: 100,
  },
  {
    id: "usdt",
    type: "crypto",
    name: "USDT (ERC20)",
    icon: "Tether",
    supportedCurrencies: ["USDT"],
    fee: 1, // 1 USDT 固定费用
    minAmount: 10,
    maxAmount: 100000,
  },
  // 法币支付（通过第三方网关）
  {
    id: "alipay",
    type: "fiat",
    name: "支付宝",
    icon: "Alipay",
    supportedCurrencies: ["CNY"],
    fee: 0.029, // 2.9%
    minAmount: 10,
    maxAmount: 50000,
  },
  {
    id: "wechat",
    type: "fiat",
    name: "微信支付",
    icon: "WeChat",
    supportedCurrencies: ["CNY"],
    fee: 0.029, // 2.9%
    minAmount: 10,
    maxAmount: 50000,
  },
  {
    id: "bank_card",
    type: "fiat",
    name: "银行卡",
    icon: "CreditCard",
    supportedCurrencies: ["CNY", "USD"],
    fee: 0.025, // 2.5%
    minAmount: 10,
    maxAmount: 100000,
  },
  // 余额支付
  {
    id: "balance",
    type: "balance",
    name: "余额支付",
    icon: "Wallet",
    supportedCurrencies: ["ETH", "BTC", "USDT", "CNY", "USD"],
    fee: 0,
    minAmount: 0.01,
    maxAmount: 1000000,
  },
];

// 汇率配置（实际应从 API 获取）
export interface ExchangeRate {
  currency: Currency;
  usdRate: number; // 1 单位的 USD 价值
  updatedAt: Date;
}

// 模拟汇率（实际应集成 CoinGecko 等 API）
const EXCHANGE_RATES: Record<Currency, number> = {
  ETH: 1850,
  BTC: 42500,
  USDT: 1,
  USDC: 1,
  BNB: 310,
  CNY: 0.14,
  USD: 1,
};

export interface PaymentOrder {
  id: string;
  userId: string;
  orderNo: string; // 商户订单号
  amount: number; // 原始金额
  currency: Currency;
  paymentMethod: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  txHash?: string;
  fiatProvider?: string; // 法币渠道
  fiatOrderId?: string; // 法币渠道订单号
  usdAmount: number; // USD 价值
  expiresAt: Date;
  createdAt: Date;
  completedAt?: Date;
}

export interface CreatePaymentParams {
  userId: string;
  amount: number;
  currency: Currency;
  paymentMethod: string;
  productId: string;
  productName: string;
}

/**
 * 支付网关主类
 */
export class PaymentGateway {
  private pool: PgPool;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  /**
   * 获取支持的支付方式
   */
  getPaymentMethods(currency?: Currency): PaymentMethod[] {
    if (!currency) return PAYMENT_METHODS;
    return PAYMENT_METHODS.filter((m) =>
      m.supportedCurrencies.includes(currency)
    );
  }

  /**
   * 获取当前汇率
   */
  async getExchangeRates(): Promise<ExchangeRate[]> {
    // 实际应调用 CoinGecko 等 API 获取实时汇率
    const rates: ExchangeRate[] = [];
    const now = new Date();

    for (const [currency, usdRate] of Object.entries(EXCHANGE_RATES)) {
      rates.push({
        currency: currency as Currency,
        usdRate,
        updatedAt: now,
      });
    }

    return rates;
  }

  /**
   * 汇率转换
   */
  convertCurrency(
    amount: number,
    from: Currency,
    to: Currency
  ): number {
    const fromRate = EXCHANGE_RATES[from];
    const toRate = EXCHANGE_RATES[to];
    const usdAmount = amount * fromRate;
    return usdAmount / toRate;
  }

  /**
   * 计算支付手续费
   */
  calculateFee(amount: number, paymentMethodId: string): number {
    const method = PAYMENT_METHODS.find((m) => m.id === paymentMethodId);
    if (!method) return 0;

    if (method.type === "crypto" && method.id === "usdt") {
      // USDT 固定费用
      return method.fee;
    }

    return amount * method.fee;
  }

  /**
   * 创建支付订单
   */
  async createPaymentOrder(
    params: CreatePaymentParams
  ): Promise<PaymentOrder> {
    const { userId, amount, currency, paymentMethod, productId, productName } = params;

    // 验证支付方式
    const method = PAYMENT_METHODS.find((m) => m.id === paymentMethod);
    if (!method) {
      throw new Error("Unsupported payment method");
    }

    if (!method.supportedCurrencies.includes(currency)) {
      throw new Error(`Currency ${currency} not supported by ${paymentMethod}`);
    }

    if (amount < method.minAmount || amount > method.maxAmount) {
      throw new Error(
        `Amount must be between ${method.minAmount} and ${method.maxAmount}`
      );
    }

    // 计算手续费和实际到账
    const fee = this.calculateFee(amount, paymentMethod);
    const netAmount = amount - fee;

    // 计算 USD 价值
    const usdAmount = this.convertCurrency(amount, currency, "USD");

    // 生成订单号
    const orderNo = `PAY${Date.now()}${Math.random().toString(36).substr(2, 9)}`;

    // 创建支付订单记录
    const order: PaymentOrder = {
      id: crypto.randomUUID(),
      userId,
      orderNo,
      amount: netAmount,
      currency,
      paymentMethod,
      status: "pending",
      usdAmount,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 分钟过期
      createdAt: new Date(),
    };

    // 保存到数据库
    await this.pool.query(
      `INSERT INTO payment_orders
       (id, tenant_id, user_id, order_no, amount, currency, payment_method, usd_amount, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        order.id,
        DEFAULT_TENANT_ID,
        order.userId,
        order.orderNo,
        order.amount,
        order.currency,
        order.paymentMethod,
        order.usdAmount,
        order.status,
        order.expiresAt,
      ]
    );

    return order;
  }

  /**
   * 处理加密货币支付
   */
  async processCryptoPayment(
    orderId: string,
    txHash: string
  ): Promise<{ success: boolean; error?: string }> {
    // 验证交易hash格式
    if (!txHash || txHash.length < 10) {
      return { success: false, error: "Invalid transaction hash" };
    }

    // 更新订单状态
    await this.pool.query(
      `UPDATE payment_orders
       SET status = 'processing', tx_hash = $1, updated_at = NOW()
       WHERE id = $2`,
      [txHash, orderId]
    );

    // 这里可以添加区块链确认逻辑
    // 实际应监听链上确认

    return { success: true };
  }

  /**
   * 处理法币支付（跳转到第三方网关）
   */
  async processFiatPayment(
    orderId: string,
    provider: string
  ): Promise<{
    paymentUrl: string;
    providerOrderId: string;
  }> {
    // 获取订单信息
    const result = await this.pool.query(
      "SELECT * FROM payment_orders WHERE id = $1",
      [orderId]
    );

    if (result.rows.length === 0) {
      throw new Error("Order not found");
    }

    const order = result.rows[0];

    // 根据不同提供商调用相应 API
    let paymentUrl = "";
    let providerOrderId = "";

    switch (provider) {
      case "alipay":
      case "wechat":
      case "bank_card":
        // 调用法币网关 API（Simplex, MoonPay 等）
        // 实际需要集成相应 SDK
        paymentUrl = `https://payment-gateway.com/pay/${orderId}`;
        providerOrderId = `PROV${Date.now()}`;
        break;
      default:
        throw new Error("Unknown payment provider");
    }

    // 更新订单
    await this.pool.query(
      `UPDATE payment_orders
       SET fiat_provider = $1, fiat_order_id = $2, status = 'processing', updated_at = NOW()
       WHERE id = $3`,
      [provider, providerOrderId, orderId]
    );

    return { paymentUrl, providerOrderId };
  }

  /**
   * 处理余额支付
   */
  async processBalancePayment(
    orderId: string,
    userId: string
  ): Promise<{ success: boolean; error?: string }> {
    const result = await this.pool.query(
      "SELECT * FROM payment_orders WHERE id = $1 AND user_id = $2",
      [orderId, userId]
    );

    if (result.rows.length === 0) {
      return { success: false, error: "Order not found" };
    }

    const order = result.rows[0];

    // 检查钱包余额
    const walletResult = await this.pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [userId]
    );

    if (walletResult.rows.length === 0) {
      return { success: false, error: "Wallet not found" };
    }

    const wallet = walletResult.rows[0];
    const balance = parseFloat(wallet.balance);

    if (balance < order.amount) {
      return { success: false, error: "Insufficient balance" };
    }

    // 扣除余额
    await this.pool.query(
      "UPDATE wallets SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2",
      [order.amount, userId]
    );

    // 更新订单状态
    await this.pool.query(
      `UPDATE payment_orders
       SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [orderId]
    );

    return { success: true };
  }

  /**
   * 确认支付完成（回调处理）
   */
  async confirmPayment(
    orderId: string,
    txHash?: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE payment_orders
       SET status = 'completed',
           tx_hash = COALESCE($2, tx_hash),
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [orderId, txHash || null]
    );
  }

  /**
   * 取消支付
   */
  async cancelPayment(orderId: string): Promise<void> {
    await this.pool.query(
      `UPDATE payment_orders
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND status = 'pending'`,
      [orderId]
    );
  }

  /**
   * 获取支付订单状态
   */
  async getPaymentStatus(orderId: string): Promise<PaymentOrder | null> {
    const result = await this.pool.query(
      "SELECT * FROM payment_orders WHERE id = $1",
      [orderId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      orderNo: row.order_no,
      amount: parseFloat(row.amount),
      currency: row.currency,
      paymentMethod: row.payment_method,
      status: row.status,
      txHash: row.tx_hash,
      fiatProvider: row.fiat_provider,
      fiatOrderId: row.fiat_order_id,
      usdAmount: parseFloat(row.usd_amount),
      expiresAt: new Date(row.expires_at),
      createdAt: new Date(row.created_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    };
  }

  /**
   * 验证支付回调签名
   */
  verifyCallback(
    provider: string,
    params: Record<string, string>,
    signature: string
  ): boolean {
    // 不同提供商有不同的签名验证逻辑
    // 这里应实现对应提供商的签名验证
    const secret = process.env[`${provider.toUpperCase()}_SECRET`];
    if (!secret) return false;

    // 示例：验证 HMAC-SHA256 签名
    const data = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const crypto = require("crypto");
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(data)
      .digest("hex");

    return signature === expectedSignature;
  }
}

/**
 * 充值服务 - 用户充值到平台钱包
 */
export class TopUpService {
  private pool: PgPool;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  /**
   * 创建充值订单
   */
  async createTopUpOrder(params: {
    userId: string;
    amount: number;
    currency: Currency;
    paymentMethod: string;
  }): Promise<{
    orderId: string;
    paymentUrl?: string;
    walletAddress?: string;
    expiresAt: Date;
  }> {
    const { userId, amount, currency, paymentMethod } = params;

    const orderId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    // 如果是加密货币充值，返回充值地址
    let walletAddress: string | undefined;
    let paymentUrl: string | undefined;

    if (["eth", "btc", "usdt"].includes(paymentMethod)) {
      // 生成用户专属充值地址（实际应调用币商 API）
      walletAddress = this.generateDepositAddress(userId, paymentMethod);
    } else if (["alipay", "wechat", "bank_card"].includes(paymentMethod)) {
      // 法币支付跳转链接
      paymentUrl = `https://payment-gateway.com/topup/${orderId}`;
    }

    // 记录充值订单
    await this.pool.query(
      `INSERT INTO topup_orders
       (id, tenant_id, user_id, amount, currency, payment_method, status, wallet_address, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, NOW())`,
      [
        orderId,
        DEFAULT_TENANT_ID,
        userId,
        amount,
        currency,
        paymentMethod,
        walletAddress || null,
        expiresAt,
      ]
    );

    return {
      orderId,
      paymentUrl,
      walletAddress,
      expiresAt,
    };
  }

  /**
   * 生成充值地址（示例）
   * 实际应使用节点或第三方服务生成
   */
  private generateDepositAddress(userId: string, cryptoType: string): string {
    // 这里应该是实际的地址生成逻辑
    // 可以使用 HD Wallet 或第三方 API
    const prefix = cryptoType === "btc" ? "bc1" : "0x";
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const random = globalThis.crypto.randomUUID().replace(/-/g, "").substring(0, 40);
    return `${prefix}${random}`;
  }

  /**
   * 确认充值到账
   */
  async confirmTopUp(
    orderId: string,
    txHash: string,
    actualAmount: number
  ): Promise<void> {
    const result = await this.pool.query(
      "SELECT * FROM topup_orders WHERE id = $1 AND status = 'pending'",
      [orderId]
    );

    if (result.rows.length === 0) {
      throw new Error("Top-up order not found or already processed");
    }

    const order = result.rows[0];

    // 更新充值订单状态
    await this.pool.query(
      `UPDATE topup_orders
       SET status = 'completed', tx_hash = $1, confirmed_amount = $2, completed_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [txHash, actualAmount, orderId]
    );

    // 充值到用户钱包
    await this.pool.query(
      `INSERT INTO wallets (tenant_id, user_id, balance)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         balance = wallets.balance + $3,
         updated_at = NOW()`,
      [DEFAULT_TENANT_ID, order.user_id, actualAmount]
    );
  }
}

/**
 * 提现服务 - 用户从平台提现
 */
export class WithdrawService {
  private pool: PgPool;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  /**
   * 创建提现请求
   */
  async createWithdrawRequest(params: {
    userId: string;
    amount: number;
    currency: Currency;
    toAddress: string; // 钱包地址或银行卡号
    method: "crypto" | "bank";
  }): Promise<{ withdrawId: string; fee: number; netAmount: number }> {
    const { userId, amount, currency, toAddress, method } = params;

    // 计算手续费
    const feeRate = method === "crypto" ? 0.001 : 0.01; // 加密 0.1%, 法币 1%
    const fee = Math.max(amount * feeRate, method === "crypto" ? 0.001 : 1);
    const netAmount = amount - fee;

    // 检查余额
    const walletResult = await this.pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [userId]
    );

    if (walletResult.rows.length === 0) {
      throw new Error("Wallet not found");
    }

    const wallet = walletResult.rows[0];
    if (parseFloat(wallet.balance) < amount) {
      throw new Error("Insufficient balance");
    }

    const withdrawId = crypto.randomUUID();

    // 冻结余额
    await this.pool.query(
      "UPDATE wallets SET balance = balance - $1, pending_balance = pending_balance + $1, updated_at = NOW() WHERE user_id = $2",
      [amount, userId]
    );

    // 创建提现记录
    await this.pool.query(
      `INSERT INTO withdraw_orders
       (id, tenant_id, user_id, amount, fee, net_amount, currency, to_address, method, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW())`,
      [
        withdrawId,
        DEFAULT_TENANT_ID,
        userId,
        amount,
        fee,
        netAmount,
        currency,
        toAddress,
        method,
      ]
    );

    // 记录平台收入
    await this.pool.query(
      `INSERT INTO platform_revenue (tenant_id, withdrawal_id, amount, type)
       VALUES ($1, $2, $3, 'withdrawal_fee')`,
      [DEFAULT_TENANT_ID, withdrawId, fee]
    );

    return { withdrawId, fee, netAmount };
  }

  /**
   * 确认提现（发送加密货币或打款）
   */
  async confirmWithdraw(
    withdrawId: string,
    txHash: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE withdraw_orders
       SET status = 'completed', tx_hash = $1, completed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [txHash, withdrawId]
    );

    // 从 pending 扣除
    const result = await this.pool.query(
      "SELECT * FROM withdraw_orders WHERE id = $1",
      [withdrawId]
    );

    if (result.rows.length > 0) {
      const order = result.rows[0];
      await this.pool.query(
        "UPDATE wallets SET pending_balance = pending_balance - $1, total_withdrawn = total_withdrawn + $1, updated_at = NOW() WHERE user_id = $2",
        [order.amount, order.user_id]
      );
    }
  }

  /**
   * 拒绝提现并退款
   */
  async rejectWithdraw(withdrawId: string, reason: string): Promise<void> {
    const result = await this.pool.query(
      "SELECT * FROM withdraw_orders WHERE id = $1",
      [withdrawId]
    );

    if (result.rows.length === 0) {
      throw new Error("Withdraw order not found");
    }

    const order = result.rows[0];

    // 恢复余额
    await this.pool.query(
      "UPDATE wallets SET balance = balance + $1, pending_balance = pending_balance - $1, updated_at = NOW() WHERE user_id = $2",
      [order.amount, order.user_id]
    );

    // 更新状态
    await this.pool.query(
      `UPDATE withdraw_orders
       SET status = 'rejected', failure_reason = $1, updated_at = NOW()
       WHERE id = $2`,
      [reason, withdrawId]
    );
  }
}