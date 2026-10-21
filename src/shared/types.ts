export interface ShareInput {
  name: string;
  path: string;
  comment: string;
  browseable: boolean;
  readOnly: boolean;
  guestOk: boolean;
  validUsers: string[];
  writeList: string[];
  forceUser: string;
  forceGroup: string;
  createMask: string;
  directoryMask: string;
  hideDotFiles: boolean;
  recycleBin: boolean;
  inheritPermissions: boolean;
}

export interface ShareView extends ShareInput {
  /** False for shares from smb.conf. Those are read only here. */
  managed: boolean;
}

export interface CreateShareBody extends ShareInput {
  /** Make the folder and set its owner, group and mode. */
  makeFolder?: boolean;
  owner?: string;
  group?: string;
  mode?: string;
}

export interface SambaStatus {
  root: boolean;
  os: string;
  packageManager: string;
  installed: boolean;
  version: string;
  init: string;
  service: string;
  active: boolean;
  enabled: boolean;
  firewall: string;
  selinux: string;
  included: boolean;
  acl: boolean;
}

export interface SambaUser {
  name: string;
  fullName: string;
  disabled: boolean;
}

export interface SambaGroup {
  name: string;
  gid: number;
  members: string[];
}

export interface UsersView {
  samba: SambaUser[];
  system: string[];
  groups: SambaGroup[];
}

export interface AclEntry {
  type: "user" | "group";
  name: string;
  perms: string;
}

export interface PermissionsView {
  path: string;
  exists: boolean;
  owner: string;
  group: string;
  mode: string;
  acl: AclEntry[];
}

export interface SessionRow {
  pid: number;
  user: string;
  group: string;
  machine: string;
  protocol: string;
}

export interface ConnectionRow {
  pid: number;
  share: string;
  machine: string;
  since: string;
}

export interface OpenFileRow {
  pid: number;
  share: string;
  user: string;
  file: string;
}

export interface SessionsView {
  json: boolean;
  sessions: SessionRow[];
  connections: ConnectionRow[];
  files: OpenFileRow[];
  raw: string;
}

export interface ConfigView {
  /** The drop-in file this plugin owns. */
  managed: string;
  /** The main smb.conf, read only. */
  main: string;
}

export interface TestResult {
  ok: boolean;
  output: string;
}
