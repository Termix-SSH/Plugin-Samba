import type { TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import type {
  AclEntry,
  ConfigView,
  CreateShareBody,
  PermissionsView,
  SambaStatus,
  SessionsView,
  ShareInput,
  ShareView,
  TestResult,
  UsersView,
} from "../shared/types";

let client: TermixApp["api"] | null = null;

export function initApi(api: TermixApp["api"]): void {
  client = api;
}

function api(): TermixApp["api"] {
  if (!client) throw new Error("Samba is not ready");
  return client;
}

/** The server's message for a failed call, or the fallback. */
export function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data?.error;
  return typeof message === "string" && message ? message : fallback;
}

export function errorCode(error: unknown): string {
  const code = (error as { response?: { data?: { code?: unknown } } })?.response
    ?.data?.code;
  return typeof code === "string" ? code : "";
}

const enc = encodeURIComponent;

export async function getStatus(host: number): Promise<SambaStatus> {
  return (await api().get<SambaStatus>(`/${host}/status`)).data;
}

export async function installSamba(host: number): Promise<void> {
  await api().post(`/${host}/install`);
}

export async function serviceAction(
  host: number,
  action: string,
): Promise<void> {
  await api().post(`/${host}/service/${action}`);
}

export async function listShares(host: number): Promise<ShareView[]> {
  return (await api().get<ShareView[]>(`/${host}/shares`)).data;
}

export async function createShare(
  host: number,
  body: CreateShareBody,
): Promise<void> {
  await api().post(`/${host}/shares`, body);
}

export async function updateShare(
  host: number,
  name: string,
  body: ShareInput,
): Promise<void> {
  await api().put(`/${host}/shares/${enc(name)}`, body);
}

export async function deleteShare(host: number, name: string): Promise<void> {
  await api().delete(`/${host}/shares/${enc(name)}`);
}

export async function getPermissions(
  host: number,
  name: string,
): Promise<PermissionsView> {
  return (
    await api().get<PermissionsView>(`/${host}/shares/${enc(name)}/permissions`)
  ).data;
}

export interface PermissionsBody {
  owner: string;
  group: string;
  mode: string;
  recursive: boolean;
  setAcl: AclEntry[];
  removeAcl: AclEntry[];
}

export async function savePermissions(
  host: number,
  name: string,
  body: PermissionsBody,
): Promise<void> {
  await api().put(`/${host}/shares/${enc(name)}/permissions`, body);
}

export async function listUsers(host: number): Promise<UsersView> {
  return (await api().get<UsersView>(`/${host}/users`)).data;
}

export async function addUser(
  host: number,
  body: { name: string; password: string; createSystem: boolean },
): Promise<void> {
  await api().post(`/${host}/users`, body);
}

export async function setUserPassword(
  host: number,
  name: string,
  password: string,
): Promise<void> {
  await api().post(`/${host}/users/${enc(name)}/password`, { password });
}

export async function setUserDisabled(
  host: number,
  name: string,
  disabled: boolean,
): Promise<void> {
  await api().post(`/${host}/users/${enc(name)}/state`, { disabled });
}

export async function removeUser(
  host: number,
  name: string,
  removeSystem: boolean,
): Promise<void> {
  await api().delete(
    `/${host}/users/${enc(name)}?removeSystem=${removeSystem}`,
  );
}

export async function addGroup(host: number, name: string): Promise<void> {
  await api().post(`/${host}/groups`, { name });
}

export async function setMember(
  host: number,
  group: string,
  user: string,
  add: boolean,
): Promise<void> {
  await api().post(`/${host}/groups/${enc(group)}/members`, { user, add });
}

export async function getSessions(host: number): Promise<SessionsView> {
  return (await api().get<SessionsView>(`/${host}/sessions`)).data;
}

export async function disconnectSession(
  host: number,
  pid: number,
): Promise<void> {
  await api().post(`/${host}/sessions/${pid}/disconnect`);
}

export async function getConfig(host: number): Promise<ConfigView> {
  return (await api().get<ConfigView>(`/${host}/config`)).data;
}

export async function saveConfig(host: number, text: string): Promise<void> {
  await api().put(`/${host}/config`, { text });
}

export async function testConfig(host: number): Promise<TestResult> {
  return (await api().post<TestResult>(`/${host}/config/test`)).data;
}

export async function getLogs(host: number, lines: number): Promise<string> {
  return (await api().get<{ text: string }>(`/${host}/logs?lines=${lines}`))
    .data.text;
}
