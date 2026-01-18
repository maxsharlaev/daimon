export type SSHAuthType = "password" | "privateKey";

export type SSHConfig = {
  host: string;
  port: number;
  username: string;

  authType: SSHAuthType;
  password?: string;

  privateKeyPath?: string;
  privateKeyPem?: string;
  passphrase?: string;

  insecureIgnoreHostKey: boolean;

  cols?: number;
  rows?: number;

  timeoutMs?: number;
};

export type SSHOutputEvent = {
  id: string;
  data: string;
  isErr: boolean;
};

export type SSHStateEvent = {
  id: string;
  state: "connected" | "disconnected";
  error?: string;
};

