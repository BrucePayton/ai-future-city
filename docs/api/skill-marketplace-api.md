# 技能交易平台 API 规范

本文档详细描述技能交易平台的 REST API 接口。

---

## 一、基础信息

### Base URL
```
http://localhost:3001
```

### 通用 Headers
```http
Content-Type: application/json
Authorization: Bearer <token>  (如需要)
```

### 通用响应格式

**成功响应：**
```json
{
  "success": true,
  "data": { ... }
}
```

**错误响应：**
```json
{
  "success": false,
  "error": "错误信息",
  "code": "ERROR_CODE"
}
```

---

## 二、技能 API

### 2.1 创建技能

**POST** `/api/skills`

**请求体：**
```json
{
  "name": "Python 数据分析专家",
  "description": "专业的数据分析服务，包括数据清洗、可视化、统计分析和机器学习模型构建。",
  "category": "data-analyst",
  "pricing": {
    "type": "fixed",
    "amount": 0.1,
    "currency": "ETH"
  },
  "tags": ["Python", "数据分析", "Pandas"],
  "ownerId": "user-001"
}
```

**pricing 字段说明：**
```json
// 固定价格
{ "type": "fixed", "amount": 0.1, "currency": "ETH" }

// 按时计费
{ "type": "hourly", "rate": 0.01, "minHours": 1 }

// 议价
{ "type": "negotiable" }
```

**响应：**
```json
{
  "success": true,
  "data": {
    "id": "skill-xxx",
    "name": "Python 数据分析专家",
    "description": "...",
    "category": "data-analyst",
    "pricing": { "type": "fixed", "amount": 0.1, "currency": "ETH" },
    "commissionRate": 0.1,
    "status": "draft",
    "stats": { "viewCount": 0, "salesCount": 0, "avgRating": 0, "totalEarnings": 0 },
    "tags": ["Python", "数据分析", "Pandas"],
    "createdAt": "2026-04-05T00:00:00.000Z",
    "updatedAt": "2026-04-05T00:00:00.000Z"
  }
}
```

---

### 2.2 获取技能列表

**GET** `/api/skills`

**查询参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| category | string | 分类筛选 |
| status | string | 状态筛选 (draft/published/archived) |
| ownerId | string | 卖家 ID |
| search | string | 搜索关键词 |
| sortBy | string | 排序字段 (createdAt/salesCount/avgRating/price) |
| sortOrder | string | 排序方向 (asc/desc) |
| limit | number | 返回数量 (默认 20) |
| offset | number | 偏移量 (默认 0) |

**示例：**
```bash
GET /api/skills?category=software-engineer&search=Python&sortBy=salesCount&sortOrder=desc
```

**响应：**
```json
{
  "success": true,
  "data": {
    "items": [...],
    "total": 100,
    "limit": 20,
    "offset": 0
  }
}
```

---

### 2.3 获取技能详情

**GET** `/api/skills/:id`

**响应：**
```json
{
  "success": true,
  "data": {
    "id": "skill-xxx",
    "name": "Python 数据分析专家",
    "description": "...",
    "category": "data-analyst",
    "pricing": { "type": "fixed", "amount": 0.1 },
    "commissionRate": 0.1,
    "status": "published",
    "stats": {
      "viewCount": 156,
      "salesCount": 23,
      "avgRating": 4.8,
      "totalEarnings": 2.1
    },
    "tags": ["Python"],
    "ownerId": "user-002",
    "createdAt": "2026-04-01T00:00:00.000Z",
    "updatedAt": "2026-04-05T00:00:00.000Z"
  }
}
```

---

### 2.4 更新技能

**PATCH** `/api/skills/:id`

**请求体：**
```json
{
  "name": "Python 数据分析专家（高级版）",
  "description": "更新描述...",
  "pricing": { "type": "fixed", "amount": 0.15 }
}
```

---

### 2.5 下架技能

**DELETE** `/api/skills/:id`

或

**PATCH** `/api/skills/:id`
```json
{ "status": "archived" }
```

---

## 三、订单 API

### 3.1 创建订单

**POST** `/api/orders`

**请求体：**
```json
{
  "skillId": "skill-xxx",
  "buyerId": "user-001",
  "sellerId": "user-002",
  "amount": 0.1,
  "idempotencyKey": "unique-key-xxx"
}
```

**响应：**
```json
{
  "success": true,
  "data": {
    "id": "order-xxx",
    "skillId": "skill-xxx",
    "buyerId": "user-001",
    "sellerId": "user-002",
    "amount": 0.1,
    "commission": 0.01,
    "netAmount": 0.09,
    "status": "pending",
    "createdAt": "2026-04-05T00:00:00.000Z"
  }
}
```

---

### 3.2 获取订单详情

**GET** `/api/orders/:id`

---

### 3.3 支付订单

**POST** `/api/orders/:id/pay`

**请求体：**
```json
{
  "txHash": "0x..."
}
```

---

### 3.4 确认完成

**POST** `/api/orders/:id/complete`

---

### 3.5 取消订单

**POST** `/api/orders/:id/cancel`

---

## 四、钱包 API

### 4.1 获取钱包余额

**GET** `/api/wallet?userId=xxx`

**响应：**
```json
{
  "success": true,
  "data": {
    "id": "wallet-xxx",
    "userId": "user-001",
    "balance": 1.5,
    "pendingBalance": 0.1,
    "totalEarned": 5.0,
    "totalWithdrawn": 3.5,
    "updatedAt": "2026-04-05T00:00:00.000Z"
  }
}
```

---

### 4.2 申请提现

**POST** `/api/wallet/withdraw`

**请求体：**
```json
{
  "walletId": "wallet-xxx",
  "userId": "user-001",
  "amount": 0.5
}
```

**响应：**
```json
{
  "success": true,
  "data": {
    "id": "withdraw-xxx",
    "amount": 0.5,
    "fee": 0.005,
    "netAmount": 0.495,
    "status": "pending"
  }
}
```

---

## 五、评价 API

### 5.1 创建评价

**POST** `/api/reviews`

**请求体：**
```json
{
  "orderId": "order-xxx",
  "reviewerId": "user-001",
  "revieweeId": "user-002",
  "skillId": "skill-xxx",
  "rating": 5,
  "comment": "服务非常专业，强烈推荐！"
}
```

---

### 5.2 获取技能评价

**GET** `/api/reviews?skillId=xxx`

---

## 六、支付 API

### 6.1 获取支付方式

**GET** `/api/payment/methods`

**响应：**
```json
{
  "success": true,
  "data": [
    { "id": "eth", "type": "crypto", "name": "ETH", "fee": 0.001 },
    { "id": "btc", "type": "crypto", "name": "BTC", "fee": 0.0001 },
    { "id": "usdt", "type": "crypto", "name": "USDT", "fee": 1 },
    { "id": "alipay", "type": "fiat", "name": "支付宝", "fee": 0.029 },
    { "id": "wechat", "type": "fiat", "name": "微信支付", "fee": 0.029 },
    { "id": "balance", "type": "balance", "name": "余额支付", "fee": 0 }
  ]
}
```

---

### 6.2 获取汇率

**GET** `/api/payment/rates`

**响应：**
```json
{
  "success": true,
  "data": [
    { "currency": "ETH", "usdRate": 1850, "updatedAt": "..." },
    { "currency": "BTC", "usdRate": 42500, "updatedAt": "..." },
    { "currency": "USDT", "usdRate": 1, "updatedAt": "..." },
    { "currency": "CNY", "usdRate": 0.14, "updatedAt": "..." }
  ]
}
```

---

### 6.3 创建支付订单

**POST** `/api/payment/create`

**请求体：**
```json
{
  "userId": "user-001",
  "amount": 100,
  "currency": "CNY",
  "paymentMethod": "alipay",
  "productId": "skill-001",
  "productName": "Python 数据分析"
}
```

**响应：**
```json
{
  "success": true,
  "data": {
    "orderId": "pay-xxx",
    "orderNo": "PAYxxx",
    "amount": 97.1,
    "currency": "CNY",
    "paymentMethod": "alipay",
    "paymentUrl": "https://payment-gateway.com/pay/xxx",
    "expiresAt": "2026-04-05T00:30:00.000Z"
  }
}
```

---

### 6.4 充值

**POST** `/api/topup/create`

**请求体：**
```json
{
  "userId": "user-001",
  "amount": 1000,
  "currency": "USDT",
  "paymentMethod": "usdt"
}
```

**响应：**
```json
{
  "success": true,
  "data": {
    "orderId": "topup-xxx",
    "walletAddress": "0x...",
    "expiresAt": "2026-04-05T00:30:00.000Z"
  }
}
```

---

### 6.5 提现

**POST** `/api/withdraw/create`

**请求体：**
```json
{
  "userId": "user-001",
  "amount": 0.5,
  "currency": "ETH",
  "toAddress": "0x...",
  "method": "crypto"
}
```

**响应：**
```json
{
  "success": true,
  "data": {
    "withdrawId": "withdraw-xxx",
    "amount": 0.5,
    "fee": 0.0005,
    "netAmount": 0.4995,
    "status": "pending"
  }
}
```

---

## 七、支付回调

### 7.1 加密货币支付回调

**POST** `/api/payment/crypto/callback`

```json
{
  "orderId": "pay-xxx",
  "txHash": "0x...",
  "blockNumber": 12345678,
  "confirmations": 6
}
```

### 7.2 法币支付回调

**POST** `/api/payment/fiat/callback`

```json
{
  "orderId": "pay-xxx",
  "providerOrderId": "provider-xxx",
  "status": "completed",
  "amount": 100,
  "currency": "CNY",
  "signature": "..."
}
```

**签名验证：**
- 验证请求来自合法的支付提供商
- 使用对应提供商的密钥进行 HMAC-SHA256 验证

---

## 八、错误码

| 错误码 | 说明 |
|--------|------|
| SKILL_NOT_FOUND | 技能不存在 |
| SKILL_NOT_PUBLISHED | 技能未发布 |
| ORDER_NOT_FOUND | 订单不存在 |
| INSUFFICIENT_BALANCE | 余额不足 |
| INVALID_AMOUNT | 金额无效 |
| PAYMENT_EXPIRED | 支付超时 |
| PAYMENT_FAILED | 支付失败 |
| INVALID_SIGNATURE | 签名验证失败 |

---

## 九、佣金计算

### 阶梯佣金

| 订单金额 | 佣金比例 |
|---------|---------|
| < 0.1 ETH | 15% |
| 0.1 - 0.5 ETH | 12% |
| 0.5 - 1.0 ETH | 10% |
| > 1.0 ETH | 8% |

### 示例

订单金额 0.1 ETH：
- 佣金 = 0.1 × 12% = 0.012 ETH
- 卖家净收入 = 0.1 - 0.012 = 0.088 ETH

---

## 十、WebSocket 事件（可选）

当使用 WebSocket 连接时，会推送以下事件：

```typescript
// 订单状态变化
{ "type": "order_updated", "data": { "orderId": "xxx", "status": "paid" } }

// 支付到账
{ "type": "payment_received", "data": { "orderId": "xxx", "amount": 0.1 } }

// 余额变化
{ "type": "balance_updated", "data": { "userId": "xxx", "balance": 1.5 } }
```