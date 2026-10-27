import http, { authHttp } from './https';
import type { ApiError } from './index';

export type TeamRole = 'owner' | 'admin' | 'member';
export interface Team {
  team_key: string;
  team_code: string;
  name: string;
  kind: 'personal' | 'standard';
  role: TeamRole;
  owner_id: string;
  member_count: number;
  created_at: string;
  privileges: { mode: 'members' };
  permissions: {
    create_project: boolean;
    read: boolean;
    write: boolean;
    manage: boolean;
    transfer: boolean;
    delete: boolean;
  };
}
export interface TeamMember {
  user_id: string;
  name: string;
  avator: string;
  role: TeamRole;
  joined_at: string;
}
export interface JoinRequest {
  id: string;
  team_key: string;
  team_name: string;
  user_id: string;
  name: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  reviewed_at: string | null;
}
export interface TeamInvite {
  id: string;
  created_at: string;
  revoked_at: string | null;
}
export interface InviteTeam {
  team_key: string;
  team_code: string;
  name: string;
  kind: Team['kind'];
}
const path = (key: string) => `/teams/${encodeURIComponent(key)}`;
export const teamRoleLabels: Record<TeamRole, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
};
export const joinStatusLabels: Record<JoinRequest['status'], string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
};
export function getTeams(signal?: AbortSignal) {
  return http.get<ApiError, Team[]>('/teams', { signal });
}
export function createTeam(name: string) {
  return http.post<ApiError, Team>('/teams', { name });
}
export function getTeam(key: string, signal?: AbortSignal) {
  return http.get<ApiError, Team>(path(key), { signal });
}
export function renameTeam(key: string, name: string) {
  return http.patch<ApiError, Team>(path(key), { name });
}
export function deleteTeam(key: string) {
  return http.delete<ApiError, { success: true }>(path(key));
}
export function transferTeam(key: string, user_id: string) {
  return http.post<ApiError, { success: true }>(`${path(key)}/transfer`, { user_id });
}
export function getTeamMembers(key: string, signal?: AbortSignal) {
  return http.get<ApiError, TeamMember[]>(`${path(key)}/members`, { signal });
}
export function setTeamRole(key: string, id: string, role: 'admin' | 'member') {
  return http.patch<ApiError, { success: true }>(`${path(key)}/members/${encodeURIComponent(id)}`, {
    role,
  });
}
export function removeTeamMember(key: string, id: string) {
  return http.delete<ApiError, { success: true }>(`${path(key)}/members/${encodeURIComponent(id)}`);
}
export function getTeamInvites(key: string, signal?: AbortSignal) {
  return http.get<ApiError, TeamInvite[]>(`${path(key)}/invites`, { signal });
}
export function createTeamInvite(key: string) {
  return http.post<ApiError, { id: string; token: string }>(`${path(key)}/invites`);
}
export function revokeTeamInvite(key: string, id: string) {
  return http.delete<ApiError, { success: true }>(`${path(key)}/invites/${encodeURIComponent(id)}`);
}
export async function inspectTeamInvite(token: string, signal?: AbortSignal) {
  return (await authHttp.post<InviteTeam>('/team-invites/inspect', { token }, { signal })).data;
}
export function applyToTeam(data: { team_code?: string; invite_token?: string; message: string }) {
  return http.post<ApiError, JoinRequest>('/team-join-requests', data);
}
export function getMyJoinRequests(signal?: AbortSignal) {
  return http.get<ApiError, JoinRequest[]>('/team-join-requests', { signal });
}
export function getTeamJoinRequests(key: string, signal?: AbortSignal) {
  return http.get<ApiError, JoinRequest[]>(`${path(key)}/join-requests`, { signal });
}
export function reviewJoinRequest(key: string, id: string, status: 'approved' | 'rejected') {
  return http.patch<ApiError, JoinRequest>(`${path(key)}/join-requests/${encodeURIComponent(id)}`, {
    status,
  });
}
