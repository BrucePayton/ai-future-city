/**
 * Skill Marketplace Methods - 技能交易平台 API
 */

import type { PgPool } from "../db/client.js";
import {
  escrowService,
  type PaymentResult
} from "../services/payment-service.js";
import type {
  Skill,
  SkillInput,
  SkillListQuery,
  Order,
  OrderInput,
  Wallet,
  Withdrawal,
  WithdrawalInput,
  Review,
  ReviewInput,
  PaginatedResponse,
  OrderStatus,
  SkillStatus,
  PlatformRevenue,
} from "../types/marketplace.js";

const DEFAULT_TENANT_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

// 默认佣金比例
const DEFAULT_COMMISSION_RATE = 0.10;

// 阶梯佣金计算
function getTieredCommissionRate(amount: number): number {
  if (amount < 0.1) return 0.15;  // < 0.1 ETH: 15%
  if (amount < 0.5) return 0.12;  // 0.1-0.5 ETH: 12%
  if (amount < 1.0) return 0.10;   // 0.5-1.0 ETH: 10%
  return 0.08;                    // > 1.0 ETH: 8%
}

// 佣金计算
function calculateCommission(amount: number, rate?: number): { commission: number; netAmount: number } {
  const effectiveRate = rate ?? getTieredCommissionRate(amount);
  const commission = Number((amount * effectiveRate).toFixed(8));
  const netAmount = Number((amount - commission).toFixed(8));
  return { commission, netAmount };
}

export type MarketplaceDeps = {
  pool: PgPool;
};

export function createMarketplaceMethods(deps: MarketplaceDeps) {
  const { pool } = deps;

  return {
    // ========================================
    // Skill Methods (技能管理)
    // ========================================

    /** 创建技能 */
    "skills.create": async (params: unknown) => {
      const input = params as SkillInput & { ownerId: string };

      if (!input.name || !input.ownerId) {
        throw new Error("name and ownerId are required");
      }

      const result = await pool.query(
        `INSERT INTO skills (tenant_id, owner_id, name, description, category, pricing, commission_rate, tags, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft')
         RETURNING *`,
        [
          DEFAULT_TENANT_ID,
          input.ownerId,
          input.name,
          input.description || "",
          input.category || "general",
          JSON.stringify(input.pricing || { type: "fixed", amount: 0 }),
          input.commissionRate ?? DEFAULT_COMMISSION_RATE,
          input.tags || [],
        ],
      );

      return mapSkillRow(result.rows[0]);
    },

    /** 获取技能列表 */
    "skills.list": async (params: unknown) => {
      const query = params as SkillListQuery;

      let sql = "SELECT * FROM skills WHERE tenant_id = $1 AND status != 'archived'";
      const queryParams: unknown[] = [DEFAULT_TENANT_ID];
      let paramIndex = 2;

      if (query.category) {
        sql += ` AND category = $${paramIndex++}`;
        queryParams.push(query.category);
      }

      if (query.status) {
        sql += ` AND status = $${paramIndex++}`;
        queryParams.push(query.status);
      }

      if (query.ownerId) {
        sql += ` AND owner_id = $${paramIndex++}`;
        queryParams.push(query.ownerId);
      }

      if (query.search) {
        sql += ` AND (name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
        queryParams.push(`%${query.search}%`);
        paramIndex++;
      }

      // 排序
      const sortColumn = {
        createdAt: "created_at",
        price: "(pricing->>'amount')::numeric",
        salesCount: "(stats->>'salesCount')::int",
        avgRating: "(stats->>'avgRating')::numeric",
      }[query.sortBy || "createdAt"] || "created_at";

      const sortOrder = query.sortOrder === "asc" ? "ASC" : "DESC";
      sql += ` ORDER BY ${sortColumn} ${sortOrder}`;

      // 分页
      const limit = query.limit || 20;
      const offset = query.offset || 0;
      sql += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      queryParams.push(limit, offset);

      const result = await pool.query(sql, queryParams);

      // 获取总数
      let countSql = "SELECT COUNT(*) FROM skills WHERE tenant_id = $1";
      const countParams: unknown[] = [DEFAULT_TENANT_ID];
      let countIndex = 2;

      if (query.category) {
        countSql += ` AND category = $${countIndex++}`;
        countParams.push(query.category);
      }
      if (query.status) {
        countSql += ` AND status = $${countIndex++}`;
        countParams.push(query.status);
      }
      if (query.ownerId) {
        countSql += ` AND owner_id = $${countIndex++}`;
        countParams.push(query.ownerId);
      }
      if (query.search) {
        countSql += ` AND (name ILIKE $${countIndex} OR description ILIKE $${countIndex})`;
        countParams.push(`%${query.search}%`);
      }

      const countResult = await pool.query(countSql, countParams);
      const total = parseInt(countResult.rows[0].count, 10);

      return {
        items: result.rows.map(mapSkillRow),
        total,
        limit,
        offset,
      };
    },

    /** 获取技能详情 */
    "skills.get": async (params: unknown) => {
      const { id } = params as { id: string };

      if (!id) {
        throw new Error("skill id is required");
      }

      const result = await pool.query(
        "SELECT * FROM skills WHERE id = $1 AND tenant_id = $2",
        [id, DEFAULT_TENANT_ID],
      );

      if (result.rows.length === 0) {
        throw new Error("Skill not found");
      }

      // 增加浏览量
      await pool.query(
        "UPDATE skills SET stats = jsonb_set(stats, '{viewCount}', (COALESCE(stats->>'viewCount', '0')::int + 1)::text::jsonb) WHERE id = $1",
        [id],
      );

      return mapSkillRow(result.rows[0]);
    },

    /** 更新技能 */
    "skills.update": async (params: unknown) => {
      const { id, ...updates } = params as SkillInput & { id: string };

      if (!id) {
        throw new Error("skill id is required");
      }

      const setClauses: string[] = [];
      const queryParams: unknown[] = [];
      let paramIndex = 1;

      if (updates.name !== undefined) {
        setClauses.push(`name = $${paramIndex++}`);
        queryParams.push(updates.name);
      }
      if (updates.description !== undefined) {
        setClauses.push(`description = $${paramIndex++}`);
        queryParams.push(updates.description);
      }
      if (updates.category !== undefined) {
        setClauses.push(`category = $${paramIndex++}`);
        queryParams.push(updates.category);
      }
      if (updates.pricing !== undefined) {
        setClauses.push(`pricing = $${paramIndex++}`);
        queryParams.push(JSON.stringify(updates.pricing));
      }
      if (updates.commissionRate !== undefined) {
        setClauses.push(`commission_rate = $${paramIndex++}`);
        queryParams.push(updates.commissionRate);
      }
      if (updates.tags !== undefined) {
        setClauses.push(`tags = $${paramIndex++}`);
        queryParams.push(updates.tags);
      }

      if (setClauses.length === 0) {
        throw new Error("No fields to update");
      }

      setClauses.push(`updated_at = NOW()`);
      queryParams.push(id);

      const result = await pool.query(
        `UPDATE skills SET ${setClauses.join(", ")} WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1} RETURNING *`,
        [...queryParams, DEFAULT_TENANT_ID],
      );

      if (result.rows.length === 0) {
        throw new Error("Skill not found");
      }

      return mapSkillRow(result.rows[0]);
    },

    /** 发布/下架技能 */
    "skills.setStatus": async (params: unknown) => {
      const { id, status } = params as { id: string; status: SkillStatus };

      if (!id || !status) {
        throw new Error("id and status are required");
      }

      if (!["draft", "published", "archived"].includes(status)) {
        throw new Error("Invalid status");
      }

      const result = await pool.query(
        "UPDATE skills SET status = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3 RETURNING *",
        [status, id, DEFAULT_TENANT_ID],
      );

      if (result.rows.length === 0) {
        throw new Error("Skill not found");
      }

      return mapSkillRow(result.rows[0]);
    },

    // ========================================
    // Order Methods (订单管理)
    // ========================================

    /** 创建订单 */
    "orders.create": async (params: unknown) => {
      const input = params as OrderInput & { withEscrow?: boolean };

      if (!input.skillId || !input.buyerId || !input.sellerId || !input.amount) {
        throw new Error("skillId, buyerId, sellerId, and amount are required");
      }

      // 检查幂等性
      if (input.idempotencyKey) {
        const existing = await pool.query(
          "SELECT * FROM orders WHERE idempotency_key = $1",
          [input.idempotencyKey],
        );
        if (existing.rows.length > 0) {
          return mapOrderRow(existing.rows[0]);
        }
      }

      // 获取技能信息以计算佣金
      const skillResult = await pool.query(
        "SELECT * FROM skills WHERE id = $1 AND tenant_id = $2",
        [input.skillId, DEFAULT_TENANT_ID],
      );

      if (skillResult.rows.length === 0) {
        throw new Error("Skill not found");
      }

      const skill = mapSkillRow(skillResult.rows[0]);
      const { commission, netAmount } = calculateCommission(input.amount, skill.commissionRate);

      // 如果启用托管，尝试创建链上托管订单
      let escrowResult = null;
      if (input.withEscrow && escrowService.isEnabled()) {
        try {
          escrowResult = await escrowService.createEscrow(
            input.idempotencyKey || `order-${Date.now()}`,
            input.sellerId,
            [input.amount],
            ["Service payment"]
          );
        } catch (e) {
          console.error("[orders.create] Escrow creation failed:", e);
        }
      }

      const result = await pool.query(
        `INSERT INTO orders (tenant_id, idempotency_key, skill_id, buyer_id, seller_id, amount, commission, net_amount, status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
         RETURNING *`,
        [
          DEFAULT_TENANT_ID,
          input.idempotencyKey || null,
          input.skillId,
          input.buyerId,
          input.sellerId,
          input.amount,
          commission,
          netAmount,
          JSON.stringify(input.metadata || {}),
        ],
      );

      return mapOrderRow(result.rows[0]);
    },

    /** 获取订单详情 */
    "orders.get": async (params: unknown) => {
      const { id } = params as { id: string };

      if (!id) {
        throw new Error("order id is required");
      }

      const result = await pool.query(
        "SELECT * FROM orders WHERE id = $1 AND tenant_id = $2",
        [id, DEFAULT_TENANT_ID],
      );

      if (result.rows.length === 0) {
        throw new Error("Order not found");
      }

      return mapOrderRow(result.rows[0]);
    },

    /** 买家订单列表 */
    "orders.listByBuyer": async (params: unknown) => {
      const { buyerId, status, limit = 20, offset = 0 } = params as {
        buyerId: string;
        status?: OrderStatus;
        limit?: number;
        offset?: number;
      };

      let sql = "SELECT * FROM orders WHERE buyer_id = $1 AND tenant_id = $2";
      const queryParams: unknown[] = [buyerId, DEFAULT_TENANT_ID];
      let paramIndex = 3;

      if (status) {
        sql += ` AND status = $${paramIndex++}`;
        queryParams.push(status);
      }

      sql += " ORDER BY created_at DESC LIMIT $" + paramIndex++ + " OFFSET $" + paramIndex++;
      queryParams.push(limit, offset);

      const result = await pool.query(sql, queryParams);

      return result.rows.map(mapOrderRow);
    },

    /** 卖家订单列表 */
    "orders.listBySeller": async (params: unknown) => {
      const { sellerId, status, limit = 20, offset = 0 } = params as {
        sellerId: string;
        status?: OrderStatus;
        limit?: number;
        offset?: number;
      };

      let sql = "SELECT * FROM orders WHERE seller_id = $1 AND tenant_id = $2";
      const queryParams: unknown[] = [sellerId, DEFAULT_TENANT_ID];
      let paramIndex = 3;

      if (status) {
        sql += ` AND status = $${paramIndex++}`;
        queryParams.push(status);
      }

      sql += " ORDER BY created_at DESC LIMIT $" + paramIndex++ + " OFFSET $" + paramIndex++;
      queryParams.push(limit, offset);

      const result = await pool.query(sql, queryParams);

      return result.rows.map(mapOrderRow);
    },

    /** 支付订单 */
    "orders.pay": async (params: unknown) => {
      const { id, txHash } = params as { id: string; txHash?: string };

      if (!id) {
        throw new Error("order id is required");
      }

      // 使用事务确保原子性
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // 锁定订单
        const orderResult = await client.query(
          "SELECT * FROM orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
          [id, DEFAULT_TENANT_ID],
        );

        if (orderResult.rows.length === 0) {
          throw new Error("Order not found");
        }

        const order = mapOrderRow(orderResult.rows[0]);

        if (order.status !== "pending") {
          throw new Error(`Cannot pay order with status: ${order.status}`);
        }

        // 更新订单状态
        await client.query(
          "UPDATE orders SET status = 'paid', tx_hash = $1, updated_at = NOW() WHERE id = $2",
          [txHash || null, id],
        );

        // 冻结金额到卖家 pending_balance
        await client.query(
          `INSERT INTO wallets (tenant_id, user_id, pending_balance)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET
             pending_balance = wallets.pending_balance + $3,
             updated_at = NOW()`,
          [DEFAULT_TENANT_ID, order.sellerId, order.netAmount],
        );

        await client.query("COMMIT");

        const updatedResult = await pool.query(
          "SELECT * FROM orders WHERE id = $1",
          [id],
        );

        return mapOrderRow(updatedResult.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    /** 确认完成订单 */
    "orders.complete": async (params: unknown) => {
      const { id } = params as { id: string };

      if (!id) {
        throw new Error("order id is required");
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const orderResult = await client.query(
          "SELECT * FROM orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
          [id, DEFAULT_TENANT_ID],
        );

        if (orderResult.rows.length === 0) {
          throw new Error("Order not found");
        }

        const order = mapOrderRow(orderResult.rows[0]);

        if (order.status !== "paid") {
          throw new Error(`Cannot complete order with status: ${order.status}`);
        }

        // 更新订单状态
        await client.query(
          "UPDATE orders SET status = 'completed', updated_at = NOW() WHERE id = $1",
          [id],
        );

        // 从 pending 转入 balance
        await client.query(
          `UPDATE wallets SET
             balance = balance + pending_balance,
             total_earned = total_earned + pending_balance,
             pending_balance = 0,
             updated_at = NOW()
           WHERE user_id = $1`,
          [order.sellerId],
        );

        // 记录平台收入
        await client.query(
          `INSERT INTO platform_revenue (tenant_id, order_id, amount, type)
           VALUES ($1, $2, $3, 'commission')`,
          [DEFAULT_TENANT_ID, id, order.commission],
        );

        // 更新技能销量
        await client.query(
          `UPDATE skills SET
             stats = jsonb_set(stats, '{salesCount}', (COALESCE(stats->>'salesCount', '0')::int + 1)::text::jsonb),
             stats = jsonb_set(stats, '{totalEarnings}', (COALESCE(stats->>'totalEarnings', '0')::numeric + $1)::text::jsonb)
           WHERE id = $2`,
          [order.netAmount, order.skillId],
        );

        await client.query("COMMIT");

        const updatedResult = await pool.query(
          "SELECT * FROM orders WHERE id = $1",
          [id],
        );

        return mapOrderRow(updatedResult.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    /** 取消订单 */
    "orders.cancel": async (params: unknown) => {
      const { id } = params as { id: string };

      if (!id) {
        throw new Error("order id is required");
      }

      const result = await pool.query(
        "UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status = 'pending' AND tenant_id = $2 RETURNING *",
        [id, DEFAULT_TENANT_ID],
      );

      if (result.rows.length === 0) {
        throw new Error("Order not found or cannot be cancelled");
      }

      return mapOrderRow(result.rows[0]);
    },

    // ========================================
    // Wallet Methods (钱包管理)
    // ========================================

    /** 获取钱包余额 */
    "wallet.get": async (params: unknown) => {
      const { userId } = params as { userId: string };

      if (!userId) {
        throw new Error("userId is required");
      }

      // 确保钱包存在
      await pool.query(
        `INSERT INTO wallets (tenant_id, user_id, balance, pending_balance, total_earned, total_withdrawn)
         VALUES ($1, $2, 0, 0, 0, 0)
         ON CONFLICT (user_id) DO NOTHING`,
        [DEFAULT_TENANT_ID, userId],
      );

      const result = await pool.query(
        "SELECT * FROM wallets WHERE user_id = $1 AND tenant_id = $2",
        [userId, DEFAULT_TENANT_ID],
      );

      if (result.rows.length === 0) {
        throw new Error("Wallet not found");
      }

      return mapWalletRow(result.rows[0]);
    },

    /** 获取交易历史 */
    "wallet.transactions": async (params: unknown) => {
      const { userId, limit = 20, offset = 0 } = params as {
        userId: string;
        limit?: number;
        offset?: number;
      };

      // 获取订单收入
      const ordersResult = await pool.query(
        `SELECT id, amount, commission, net_amount as net_amount, status, created_at, 'order' as type
         FROM orders
         WHERE seller_id = $1 AND tenant_id = $2 AND status IN ('completed', 'paid')
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [userId, DEFAULT_TENANT_ID, limit, offset],
      );

      // 获取提现记录
      const withdrawalsResult = await pool.query(
        `SELECT id, amount, fee, net_amount, status, created_at, 'withdrawal' as type
         FROM withdrawals
         WHERE wallet_id = (SELECT id FROM wallets WHERE user_id = $1)
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
      );

      return {
        orders: ordersResult.rows,
        withdrawals: withdrawalsResult.rows,
      };
    },

    /** 申请提现 */
    "wallet.withdraw": async (params: unknown) => {
      const input = params as WithdrawalInput & { userId: string };

      if (!input.walletId || !input.amount || !input.userId) {
        throw new Error("walletId, amount, and userId are required");
      }

      if (input.amount <= 0) {
        throw new Error("Amount must be positive");
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // 锁定钱包
        const walletResult = await client.query(
          "SELECT * FROM wallets WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
          [input.walletId, DEFAULT_TENANT_ID],
        );

        if (walletResult.rows.length === 0) {
          throw new Error("Wallet not found");
        }

        const wallet = mapWalletRow(walletResult.rows[0]);

        if (wallet.balance < input.amount) {
          throw new Error("Insufficient balance");
        }

        const fee = Number((input.amount * 0.01).toFixed(8)); // 1% 提现手续费
        const netAmount = Number((input.amount - fee).toFixed(8));

        // 扣减余额
        await client.query(
          "UPDATE wallets SET balance = balance - $1, updated_at = NOW() WHERE id = $2",
          [input.amount, input.walletId],
        );

        // 创建提现记录
        const withdrawalResult = await client.query(
          `INSERT INTO withdrawals (tenant_id, wallet_id, amount, fee, net_amount, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')
           RETURNING *`,
          [DEFAULT_TENANT_ID, input.walletId, input.amount, fee, netAmount],
        );

        // 记录平台收入（提现手续费）
        await client.query(
          `INSERT INTO platform_revenue (tenant_id, withdrawal_id, amount, type)
           VALUES ($1, $2, $3, 'withdrawal_fee')`,
          [DEFAULT_TENANT_ID, withdrawalResult.rows[0].id, fee],
        );

        await client.query("COMMIT");

        return mapWithdrawalRow(withdrawalResult.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    // ========================================
    // Review Methods (评价管理)
    // ========================================

    /** 创建评价 */
    "reviews.create": async (params: unknown) => {
      const input = params as ReviewInput;

      if (!input.orderId || !input.reviewerId || !input.revieweeId || !input.rating) {
        throw new Error("orderId, reviewerId, revieweeId, and rating are required");
      }

      if (input.rating < 1 || input.rating > 5) {
        throw new Error("Rating must be between 1 and 5");
      }

      // 检查订单是否已完成
      const orderResult = await pool.query(
        "SELECT * FROM orders WHERE id = $1 AND tenant_id = $2",
        [input.orderId, DEFAULT_TENANT_ID],
      );

      if (orderResult.rows.length === 0) {
        throw new Error("Order not found");
      }

      const order = mapOrderRow(orderResult.rows[0]);

      if (order.status !== "completed") {
        throw new Error("Can only review completed orders");
      }

      const result = await pool.query(
        `INSERT INTO reviews (tenant_id, order_id, reviewer_id, reviewee_id, skill_id, rating, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          DEFAULT_TENANT_ID,
          input.orderId,
          input.reviewerId,
          input.revieweeId,
          input.skillId || order.skillId,
          input.rating,
          input.comment || "",
        ],
      );

      // 更新技能平均评分
      if (input.skillId) {
        const avgResult = await pool.query(
          `SELECT AVG(rating) as avg_rating FROM reviews WHERE skill_id = $1`,
          [input.skillId],
        );
        const avgRating = parseFloat(avgResult.rows[0].avg_rating) || 0;

        await pool.query(
          "UPDATE skills SET stats = jsonb_set(stats, '{avgRating}', $1::text::jsonb) WHERE id = $2",
          [avgRating.toFixed(2), input.skillId],
        );
      }

      return mapReviewRow(result.rows[0]);
    },

    /** 获取技能评价列表 */
    "reviews.listBySkill": async (params: unknown) => {
      const { skillId, limit = 20, offset = 0 } = params as {
        skillId: string;
        limit?: number;
        offset?: number;
      };

      const result = await pool.query(
        `SELECT * FROM reviews WHERE skill_id = $1 AND tenant_id = $2
         ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
        [skillId, DEFAULT_TENANT_ID, limit, offset],
      );

      return result.rows.map(mapReviewRow);
    },

    // ========================================
    // Payment Methods (支付集成)
    // ========================================

    /** 检查支付服务是否可用 */
    "payment.isEnabled": async () => {
      return {
        enabled: escrowService.isEnabled()
      };
    },

    /** 创建托管订单（链上） */
    "payment.createEscrow": async (params: unknown) => {
      const { orderId, sellerAddress, milestoneAmounts, milestoneDescriptions } = params as {
        orderId: string;
        sellerAddress: string;
        milestoneAmounts: number[];
        milestoneDescriptions: string[];
      };

      if (!escrowService.isEnabled()) {
        throw new Error("Payment service not configured");
      }

      const result = await escrowService.createEscrow(
        orderId,
        sellerAddress,
        milestoneAmounts,
        milestoneDescriptions
      );

      if (!result.success) {
        throw new Error(result.error || "Failed to create escrow");
      }

      return result;
    },

    /** 充值到托管 */
    "payment.fund": async (params: unknown) => {
      const { orderId, amount } = params as {
        orderId: string;
        amount: number;
      };

      if (!escrowService.isEnabled()) {
        throw new Error("Payment service not configured");
      }

      const result = await escrowService.fundEscrow(orderId, amount);

      if (!result.success) {
        throw new Error(result.error || "Failed to fund escrow");
      }

      // 记录交易
      await pool.query(
        `UPDATE orders SET tx_hash = $1, metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{escrowFunded}', 'true'::jsonb)
         WHERE id = $2`,
        [result.txHash, orderId]
      );

      return result;
    },

    /** 申领里程碑 */
    "payment.claimMilestone": async (params: unknown) => {
      const { orderId, milestoneIndex } = params as {
        orderId: string;
        milestoneIndex: number;
      };

      if (!escrowService.isEnabled()) {
        throw new Error("Payment service not configured");
      }

      const result = await escrowService.claimMilestone(orderId, milestoneIndex);

      if (!result.success) {
        throw new Error(result.error || "Failed to claim milestone");
      }

      return result;
    },

    /** 释放里程碑 */
    "payment.releaseMilestone": async (params: unknown) => {
      const { orderId, milestoneIndex } = params as {
        orderId: string;
        milestoneIndex: number;
      };

      if (!escrowService.isEnabled()) {
        throw new Error("Payment service not configured");
      }

      const result = await escrowService.releaseMilestone(orderId, milestoneIndex);

      if (!result.success) {
        throw new Error(result.error || "Failed to release milestone");
      }

      // 更新订单状态并记录交易
      await pool.query(
        `UPDATE orders SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{milestonesReleased}', to_jsonb(coalesce(metadata->'milestonesReleased', '0'::jsonb)::int + 1))
         WHERE id = $1`,
        [orderId]
      );

      return result;
    },

    /** 获取托管状态 */
    "payment.getEscrowStatus": async (params: unknown) => {
      const { orderId } = params as { orderId: string };

      if (!escrowService.isEnabled()) {
        return null;
      }

      return await escrowService.getEscrowStatus(orderId);
    },

    /** 验证支付 */
    "payment.verify": async (params: unknown) => {
      const { txHash } = params as { txHash: string };

      return await escrowService.verifyPayment(txHash);
    },
  };
}

// ========================================
// Row Mappers
// ========================================

function mapSkillRow(row: Record<string, unknown>): Skill {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    ownerId: row.owner_id as string,
    name: row.name as string,
    description: row.description as string,
    category: row.category as string,
    pricing: row.pricing as unknown as Skill["pricing"],
    commissionRate: parseFloat(row.commission_rate as string),
    status: row.status as SkillStatus,
    stats: row.stats as unknown as Skill["stats"],
    tags: row.tags as unknown as string[],
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapOrderRow(row: Record<string, unknown>): Order {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    idempotencyKey: row.idempotency_key as string | undefined,
    skillId: row.skill_id as string,
    buyerId: row.buyer_id as string,
    sellerId: row.seller_id as string,
    amount: parseFloat(row.amount as string),
    commission: parseFloat(row.commission as string),
    netAmount: parseFloat(row.net_amount as string),
    status: row.status as OrderStatus,
    milestoneId: row.milestone_id as string | undefined,
    txHash: row.tx_hash as string | undefined,
    metadata: row.metadata as unknown as Record<string, unknown>,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapWalletRow(row: Record<string, unknown>): Wallet {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    userId: row.user_id as string,
    balance: parseFloat(row.balance as string),
    pendingBalance: parseFloat(row.pending_balance as string),
    totalEarned: parseFloat(row.total_earned as string),
    totalWithdrawn: parseFloat(row.total_withdrawn as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapWithdrawalRow(row: Record<string, unknown>): Withdrawal {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    walletId: row.wallet_id as string,
    amount: parseFloat(row.amount as string),
    fee: parseFloat(row.fee as string),
    netAmount: parseFloat(row.net_amount as string),
    status: row.status as Withdrawal["status"],
    txHash: row.tx_hash as string | undefined,
    failureReason: row.failure_reason as string | undefined,
    createdAt: new Date(row.created_at as string),
    processedAt: row.processed_at ? new Date(row.processed_at as string) : undefined,
  };
}

function mapReviewRow(row: Record<string, unknown>): Review {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    orderId: row.order_id as string,
    reviewerId: row.reviewer_id as string,
    revieweeId: row.reviewee_id as string,
    skillId: row.skill_id as string | undefined,
    rating: row.rating as number,
    comment: row.comment as string | undefined,
    createdAt: new Date(row.created_at as string),
  };
}