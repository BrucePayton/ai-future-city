/**
 * Tenant Context - 多租户上下文解析
 * 从请求中提取租户信息
 */

export const TENANT_HEADER = "x-tenant-id";
export const TENANT_SLUG_HEADER = "x-tenant-slug";
export const USER_HEADER = "x-user-id";

/**
 * 从请求 headers 中提取 tenantId
 * 优先级：
 * 1. x-tenant-id header (UUID)
 * 2. x-tenant-slug header (slug)
 * 3. 默认租户
 */
export function extractTenantId(headers: Record<string, string | undefined>): string {
  // 直接的 tenant ID
  const tenantId = headers[TENANT_HEADER];
  if (tenantId && isValidUUID(tenantId)) {
    return tenantId;
  }

  // Tenant slug - 需要通过 DB 查找（这里返回 nil 让调用方处理）
  const tenantSlug = headers[TENANT_SLUG_HEADER];
  if (tenantSlug) {
    return tenantSlug; // 返回 slug，由服务层解析为 ID
  }

  // 默认租户
  return DEFAULT_TENANT_ID;
}

/**
 * 从请求 headers 中提取 userId
 */
export function extractUserId(headers: Record<string, string | undefined>): string | null {
  const userId = headers[USER_HEADER];
  return userId || null;
}

/**
 * 从请求 URL 或 body 中提取 tenantId
 * 用于 WebSocket 和 HTTP 请求
 */
export function getTenantFromRequest(
  url: string | undefined,
  headers: Record<string, string | undefined>,
  body: Record<string, unknown> | null,
): string {
  // 1. 优先从 body 中获取（POST/PATCH 请求）
  if (body?.tenantId) {
    return body.tenantId as string;
  }
  if (body?.tenant_id) {
    return body.tenant_id as string;
  }

  // 2. 从 URL query 参数获取
  if (url) {
    const urlObj = new URL(url, "http://localhost");
    const queryTenantId = urlObj.searchParams.get("tenantId") || urlObj.searchParams.get("tenant_id");
    if (queryTenantId && isValidUUID(queryTenantId)) {
      return queryTenantId;
    }
  }

  // 3. 从 headers 获取
  return extractTenantId(headers);
}

/**
 * 检查字符串是否是有效的 UUID
 */
function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

// 默认租户 ID
export const DEFAULT_TENANT_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

/**
 * Context 对象 - 传递给每个 API 方法
 */
export interface TenantContext {
  tenantId: string;
  userId: string | null;
  tenantSlug?: string;
}

/**
 * 创建租户上下文
 */
export function createTenantContext(
  headers: Record<string, string | undefined>,
  body: Record<string, unknown> | null = null,
): TenantContext {
  return {
    tenantId: getTenantFromRequest(undefined, headers, body),
    userId: extractUserId(headers),
  };
}