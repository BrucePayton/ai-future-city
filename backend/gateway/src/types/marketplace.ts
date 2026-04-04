/**
 * Skill Marketplace Types - 技能交易平台类型定义
 */

// 定价类型
export type PricingType = "fixed" | "hourly" | "negotiable";

export interface SkillPricing {
  type: PricingType;
  amount?: number;      // 固定价格
  rate?: number;        // 小时费率
  minHours?: number;    // 最低小时数
  currency?: string;    // 货币，默认 ETH
  description?: string;
}

// 技能状态
export type SkillStatus = "draft" | "published" | "archived";

// 技能统计
export interface SkillStats {
  viewCount: number;
  salesCount: number;
  avgRating: number;
  totalEarnings: number;
}

// 技能/服务
export interface Skill {
  id: string;
  tenantId: string;
  ownerId: string;
  name: string;
  description: string;
  category: string;
  pricing: SkillPricing;
  commissionRate: number;
  status: SkillStatus;
  stats: SkillStats;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

// 技能创建/更新输入
export interface SkillInput {
  name: string;
  description?: string;
  category?: string;
  pricing?: SkillPricing;
  commissionRate?: number;
  tags?: string[];
}

export interface SkillListQuery {
  category?: string;
  status?: SkillStatus;
  ownerId?: string;
  search?: string;
  sortBy?: "createdAt" | "price" | "salesCount" | "avgRating";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

// 订单状态
export type OrderStatus = "pending" | "paid" | "completed" | "cancelled" | "refunded";

// 订单
export interface Order {
  id: string;
  tenantId: string;
  idempotencyKey?: string;
  skillId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  commission: number;
  netAmount: number;
  status: OrderStatus;
  milestoneId?: string;
  txHash?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// 订单创建输入
export interface OrderInput {
  skillId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

// 评价
export interface Review {
  id: string;
  tenantId: string;
  orderId: string;
  reviewerId: string;
  revieweeId: string;
  skillId?: string;
  rating: number;
  comment?: string;
  createdAt: Date;
}

// 评价输入
export interface ReviewInput {
  orderId: string;
  reviewerId: string;
  revieweeId: string;
  skillId?: string;
  rating: number;
  comment?: string;
}

// 钱包
export interface Wallet {
  id: string;
  tenantId: string;
  userId: string;
  balance: number;
  pendingBalance: number;
  totalEarned: number;
  totalWithdrawn: number;
  updatedAt: Date;
}

// 提现状态
export type WithdrawalStatus = "pending" | "processing" | "completed" | "failed";

// 提现记录
export interface Withdrawal {
  id: string;
  tenantId: string;
  walletId: string;
  amount: number;
  fee: number;
  netAmount: number;
  status: WithdrawalStatus;
  txHash?: string;
  failureReason?: string;
  createdAt: Date;
  processedAt?: Date;
}

// 提现输入
export interface WithdrawalInput {
  walletId: string;
  amount: number;
}

// 平台收入类型
export type RevenueType = "commission" | "withdrawal_fee" | "listing_fee" | "other";

// 平台收入记录
export interface PlatformRevenue {
  id: string;
  tenantId: string;
  orderId?: string;
  withdrawalId?: string;
  amount: number;
  type: RevenueType;
  createdAt: Date;
}

// API 响应类型
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}