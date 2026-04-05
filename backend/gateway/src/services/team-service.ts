/**
 * Team Service - 临时组队服务
 * 支持创建团队、邀请成员、协作任务
 */

import type { PgPool } from "../db/client.js";
import { randomUUID } from "node:crypto";

export type TeamStatus = "active" | "completed" | "dissolved";
export type TeamMemberRole = "owner" | "admin" | "member";
export type TeamMemberStatus = "active" | "invited" | "left";

export interface Team {
  id: string;
  tenantId: string | null;
  name: string;
  description: string | null;
  ownerId: string;
  status: TeamStatus;
  taskId: string | null;
  maxMembers: number;
  inviteCode: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: TeamMemberRole;
  status: TeamMemberStatus;
  joinedAt: Date;
}

export interface TeamInput {
  name: string;
  description?: string;
  ownerId: string;
  taskId?: string;
  maxMembers?: number;
  tenantId?: string;
}

export interface InviteInput {
  teamId: string;
  userId: string;
  role?: TeamMemberRole;
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function createTeamService(deps: { pool: PgPool }) {
  const { pool } = deps;

  return {
    /** 创建团队 */
    async createTeam(input: TeamInput): Promise<Team> {
      const inviteCode = generateInviteCode();

      const result = await pool.query(
        `INSERT INTO teams (tenant_id, name, description, owner_id, task_id, max_members, invite_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          input.tenantId || null,
          input.name,
          input.description || null,
          input.ownerId,
          input.taskId || null,
          input.maxMembers || 10,
          inviteCode,
        ],
      );

      const team = mapTeamRow(result.rows[0]);

      // 自动添加创建者为 owner
      await pool.query(
        `INSERT INTO team_members (team_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active')`,
        [team.id, input.ownerId],
      );

      return team;
    },

    /** 通过邀请码加入团队 */
    async joinByCode(inviteCode: string, userId: string): Promise<TeamMember> {
      // 查找团队
      const teamResult = await pool.query(
        "SELECT * FROM teams WHERE invite_code = $1 AND status = 'active'",
        [inviteCode],
      );

      if (teamResult.rows.length === 0) {
        throw new Error("Invalid invite code or team not found");
      }

      const team = mapTeamRow(teamResult.rows[0]);

      // 检查是否已是成员
      const existingMember = await pool.query(
        "SELECT * FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = 'active'",
        [team.id, userId],
      );

      if (existingMember.rows.length > 0) {
        throw new Error("Already a member of this team");
      }

      // 检查成员数量
      const memberCount = await pool.query(
        "SELECT COUNT(*) FROM team_members WHERE team_id = $1 AND status = 'active'",
        [team.id],
      );

      if (parseInt(memberCount.rows[0].count, 10) >= team.maxMembers) {
        throw new Error("Team is full");
      }

      // 添加成员
      const result = await pool.query(
        `INSERT INTO team_members (team_id, user_id, role, status)
         VALUES ($1, $2, 'member', 'active')
         RETURNING *`,
        [team.id, userId],
      );

      return mapMemberRow(result.rows[0]);
    },

    /** 邀请成员 */
    async inviteMember(input: InviteInput): Promise<TeamMember> {
      // 检查权限
      const membership = await pool.query(
        "SELECT * FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = 'active' AND role IN ('owner', 'admin')",
        [input.teamId, input.userId],
      );

      if (membership.rows.length === 0) {
        throw new Error("No permission to invite members");
      }

      // 检查团队是否已满
      const teamResult = await pool.query("SELECT * FROM teams WHERE id = $1", [input.teamId]);
      if (teamResult.rows.length === 0) {
        throw new Error("Team not found");
      }
      const team = mapTeamRow(teamResult.rows[0]);

      const memberCount = await pool.query(
        "SELECT COUNT(*) FROM team_members WHERE team_id = $1 AND status = 'active'",
        [input.teamId],
      );

      if (parseInt(memberCount.rows[0].count, 10) >= team.maxMembers) {
        throw new Error("Team is full");
      }

      // 检查是否已是待处理成员
      const existing = await pool.query(
        "SELECT * FROM team_members WHERE team_id = $1 AND user_id = $2",
        [input.teamId, input.userId],
      );

      if (existing.rows.length > 0) {
        // 更新状态
        const result = await pool.query(
          `UPDATE team_members SET status = 'invited', role = $1 WHERE team_id = $2 AND user_id = $3 RETURNING *`,
          [input.role || "member", input.teamId, input.userId],
        );
        return mapMemberRow(result.rows[0]);
      }

      // 创建新成员
      const result = await pool.query(
        `INSERT INTO team_members (team_id, user_id, role, status)
         VALUES ($1, $2, $3, 'invited')
         RETURNING *`,
        [input.teamId, input.userId, input.role || "member"],
      );

      return mapMemberRow(result.rows[0]);
    },

    /** 接受邀请 */
    async acceptInvite(teamId: string, userId: string): Promise<TeamMember> {
      const result = await pool.query(
        `UPDATE team_members SET status = 'active' WHERE team_id = $1 AND user_id = $2 AND status = 'invited' RETURNING *`,
        [teamId, userId],
      );

      if (result.rows.length === 0) {
        throw new Error("No pending invitation");
      }

      return mapMemberRow(result.rows[0]);
    },

    /** 离开团队 */
    async leaveTeam(teamId: string, userId: string): Promise<void> {
      // 检查是否是 owner
      const membership = await pool.query(
        "SELECT * FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = 'active'",
        [teamId, userId],
      );

      if (membership.rows.length === 0) {
        throw new Error("Not a member of this team");
      }

      const member = mapMemberRow(membership.rows[0]);

      if (member.role === "owner") {
        // owner 不能直接离开，需要转移所有权或解散团队
        throw new Error("Owner cannot leave team. Transfer ownership or dissolve team first.");
      }

      await pool.query(
        `UPDATE team_members SET status = 'left' WHERE team_id = $1 AND user_id = $2`,
        [teamId, userId],
      );
    },

    /** 移除成员（仅 owner/admin） */
    async removeMember(teamId: string, targetUserId: string, requesterId: string): Promise<void> {
      // 检查权限
      const requesterMembership = await pool.query(
        "SELECT * FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = 'active' AND role IN ('owner', 'admin')",
        [teamId, requesterId],
      );

      if (requesterMembership.rows.length === 0) {
        throw new Error("No permission to remove members");
      }

      // 不能移除 owner
      const targetMembership = await pool.query(
        "SELECT * FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = 'active'",
        [teamId, targetUserId],
      );

      if (targetMembership.rows.length === 0) {
        throw new Error("User not found in team");
      }

      const targetMember = mapMemberRow(targetMembership.rows[0]);
      if (targetMember.role === "owner") {
        throw new Error("Cannot remove team owner");
      }

      await pool.query(
        `UPDATE team_members SET status = 'left' WHERE team_id = $1 AND user_id = $2`,
        [teamId, targetUserId],
      );
    },

    /** 解散团队（仅 owner） */
    async dissolveTeam(teamId: string, userId: string): Promise<void> {
      const membership = await pool.query(
        "SELECT * FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = 'active' AND role = 'owner'",
        [teamId, userId],
      );

      if (membership.rows.length === 0) {
        throw new Error("Only owner can dissolve the team");
      }

      await pool.query(
        `UPDATE teams SET status = 'dissolved', updated_at = NOW() WHERE id = $1`,
        [teamId],
      );

      await pool.query(
        `UPDATE team_members SET status = 'left' WHERE team_id = $1`,
        [teamId],
      );
    },

    /** 获取团队详情 */
    async getTeam(teamId: string): Promise<Team | null> {
      const result = await pool.query("SELECT * FROM teams WHERE id = $1", [teamId]);
      return result.rows.length > 0 ? mapTeamRow(result.rows[0]) : null;
    },

    /** 获取团队成员列表 */
    async listMembers(teamId: string): Promise<TeamMember[]> {
      const result = await pool.query(
        "SELECT * FROM team_members WHERE team_id = $1 AND status != 'left' ORDER BY role, joined_at",
        [teamId],
      );
      return result.rows.map(mapMemberRow);
    },

    /** 获取用户的团队列表 */
    async listUserTeams(userId: string): Promise<Team[]> {
      const result = await pool.query(
        `SELECT t.* FROM teams t
         JOIN team_members tm ON tm.team_id = t.id
         WHERE tm.user_id = $1 AND tm.status = 'active' AND t.status = 'active'
         ORDER BY t.created_at DESC`,
        [userId],
      );
      return result.rows.map(mapTeamRow);
    },

    /** 更新团队信息 */
    async updateTeam(teamId: string, updates: { name?: string; description?: string }, userId: string): Promise<Team> {
      // 检查权限
      const membership = await pool.query(
        "SELECT * FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = 'active' AND role IN ('owner', 'admin')",
        [teamId, userId],
      );

      if (membership.rows.length === 0) {
        throw new Error("No permission to update team");
      }

      const setClauses: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (updates.name) {
        setClauses.push(`name = $${idx++}`);
        params.push(updates.name);
      }
      if (updates.description !== undefined) {
        setClauses.push(`description = $${idx++}`);
        params.push(updates.description);
      }

      if (setClauses.length === 0) {
        throw new Error("No fields to update");
      }

      setClauses.push(`updated_at = NOW()`);
      params.push(teamId);

      const result = await pool.query(
        `UPDATE teams SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
        params,
      );

      if (result.rows.length === 0) {
        throw new Error("Team not found");
      }

      return mapTeamRow(result.rows[0]);
    },

    /** 转让所有权 */
    async transferOwnership(teamId: string, currentOwnerId: string, newOwnerId: string): Promise<void> {
      // 验证当前 owner
      const membership = await pool.query(
        "SELECT * FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = 'active' AND role = 'owner'",
        [teamId, currentOwnerId],
      );

      if (membership.rows.length === 0) {
        throw new Error("Not the team owner");
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // 移除原 owner 的 owner 角色
        await client.query(
          `UPDATE team_members SET role = 'admin' WHERE team_id = $1 AND user_id = $2`,
          [teamId, currentOwnerId],
        );

        // 设置新 owner
        await client.query(
          `UPDATE team_members SET role = 'owner' WHERE team_id = $1 AND user_id = $2`,
          [teamId, newOwnerId],
        );

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

function mapTeamRow(row: Record<string, unknown>): Team {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string | null,
    name: row.name as string,
    description: row.description as string | null,
    ownerId: row.owner_id as string,
    status: row.status as TeamStatus,
    taskId: row.task_id as string | null,
    maxMembers: row.max_members as number,
    inviteCode: row.invite_code as string,
    metadata: row.metadata as Record<string, unknown> || {},
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapMemberRow(row: Record<string, unknown>): TeamMember {
  return {
    id: row.id as string,
    teamId: row.team_id as string,
    userId: row.user_id as string,
    role: row.role as TeamMemberRole,
    status: row.status as TeamMemberStatus,
    joinedAt: new Date(row.joined_at as string),
  };
}