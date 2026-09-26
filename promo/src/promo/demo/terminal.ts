type OutputHandler = (data: string) => void;

export type TerminalMeta = {
  user: string;
  host: string;
};

type SessionState = {
  meta: TerminalMeta;
  timer: number;
  line: string;
  scriptIdx: number;
  /** Pause auto-demo while the visitor is typing or shortly after a command. */
  userActiveUntil: number;
};

const outputSubs = new Map<string, Set<OutputHandler>>();
const sessions = new Map<string, SessionState>();

const scriptLines = [
  "uname -a",
  "uptime",
  "df -h /",
  "free -m",
  "systemctl status myapp --no-pager",
  "tail -n 20 /var/log/app/app.log",
  "ps aux | head -n 6",
  "journalctl -u nginx -n 10 --no-pager",
  "ip addr show eth0 | head -n 5",
];

const outputsByCommand: Record<string, string[]> = {
  help: [
    "Demo terminal — try: uptime, df -h /, free -m, ls, pwd, whoami",
    "Auto-demo keeps running when idle. Type any listed command and press Enter.",
  ],
  ls: [
    "app.log  bin  config.yml  deploy  logs  myapp  nginx.conf  releases  tmp",
  ],
  pwd: ["/home/deploy"],
  whoami: ["deploy"],
  clear: [],
  "uname -a": ["Linux web-01 6.6.12 #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux"],
  uptime: [" 11:26:18 up 13 days,  4:52,  2 users,  load average: 0.21, 0.18, 0.24"],
  "df -h /": [
    "Filesystem      Size  Used Avail Use% Mounted on",
    "/dev/sda1        96G   34G   58G  37% /",
  ],
  "free -m": [
    "              total        used        free      shared  buff/cache   available",
    "Mem:           15974        5412        2780         312        7781       10021",
    "Swap:           2047           0        2047",
  ],
  "systemctl status myapp --no-pager": [
    "● myapp.service - MyApp API",
    "     Loaded: loaded (/etc/systemd/system/myapp.service; enabled; vendor preset: enabled)",
    "     Active: active (running) since Thu 2026-01-22 10:02:41 UTC; 1h 23min ago",
    "   Main PID: 1824 (myapp)",
    "     Tasks: 12 (limit: 18915)",
    "     Memory: 142.4M",
    "        CPU: 1min 21.355s",
  ],
  "tail -n 20 /var/log/app/app.log": [
    "2026-01-22T11:25:51Z INFO  request completed status=200 latency=42ms route=/api/health",
    "2026-01-22T11:25:56Z INFO  request completed status=200 latency=61ms route=/api/users",
    "2026-01-22T11:26:01Z WARN  cache miss key=user:1023",
  ],
  "ps aux | head -n 6": [
    "USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND",
    "root         1  0.0  0.1 169052  8160 ?        Ss   Jan08   0:09 /sbin/init",
    "deploy    1824  0.8  0.8 823544 142400 ?       Sl   10:02   1:21 /srv/myapp",
    "nginx     2031  0.1  0.1  45112  8212 ?        Ss   10:04   0:02 nginx: worker process",
    "postgres  2270  0.4  0.6 410832 102212 ?       Ss   10:05   0:31 postgres: writer process",
  ],
  "journalctl -u nginx -n 10 --no-pager": [
    "Jan 22 11:24:02 web-01 nginx[2030]: 200 GET /static/app.css",
    "Jan 22 11:24:10 web-01 nginx[2030]: 200 GET /api/health",
    "Jan 22 11:24:11 web-01 nginx[2030]: 200 GET /api/users",
  ],
  "ip addr show eth0 | head -n 5": [
    "2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default",
    "    link/ether 02:42:ac:11:00:02 brd ff:ff:ff:ff:ff:ff",
    "    inet 10.0.1.10/24 brd 10.0.1.255 scope global eth0",
  ],
};

const USER_IDLE_MS = 20_000;
const AUTO_DEMO_INTERVAL_MS = 2800;

function prompt(meta: TerminalMeta): string {
  return `${meta.user}@${meta.host}:~$ `;
}

function emit(sessionId: string, data: string) {
  const set = outputSubs.get(sessionId);
  if (!set) return;
  set.forEach((fn) => fn(data));
}

function runMockCommand(sessionId: string, state: SessionState, cmd: string) {
  const trimmed = cmd.trim();
  if (!trimmed) {
    emit(sessionId, `\r\n${prompt(state.meta)}`);
    return;
  }

  if (trimmed === "clear") {
    emit(sessionId, "\x1b[2J\x1b[H");
    emit(sessionId, prompt(state.meta));
    return;
  }

  const lines = outputsByCommand[trimmed];
  if (lines) {
    lines.forEach((line) => emit(sessionId, `${line}\r\n`));
  } else {
    emit(sessionId, `${trimmed}: command not found (demo)\r\n`);
    emit(sessionId, "Try: help\r\n");
  }
  emit(sessionId, prompt(state.meta));
}

function runAutoDemoTick(sessionId: string) {
  const state = sessions.get(sessionId);
  if (!state) return;
  if (Date.now() < state.userActiveUntil) return;
  if (state.line.length > 0) return;

  const cmd = scriptLines[state.scriptIdx % scriptLines.length];
  state.scriptIdx += 1;
  emit(sessionId, `\r\n${prompt(state.meta)}${cmd}\r\n`);
  (outputsByCommand[cmd] ?? []).forEach((line) => emit(sessionId, `${line}\r\n`));
  emit(sessionId, prompt(state.meta));
}

export function registerTerminalSession(sessionId: string, meta: TerminalMeta) {
  if (sessions.has(sessionId)) return;

  const timer = window.setInterval(() => runAutoDemoTick(sessionId), AUTO_DEMO_INTERVAL_MS);
  sessions.set(sessionId, { meta, timer, line: "", scriptIdx: 0, userActiveUntil: 0 });

  emit(sessionId, `\r\n[daimon] connected to ${meta.user}@${meta.host}\r\n`);
  emit(sessionId, "Type help for demo commands.\r\n");
  emit(sessionId, prompt(meta));
}

export function unregisterTerminalSession(sessionId: string) {
  const state = sessions.get(sessionId);
  if (state) window.clearInterval(state.timer);
  sessions.delete(sessionId);
  outputSubs.delete(sessionId);
}

export function onTerminalOutput(sessionId: string, cb: OutputHandler) {
  const set = outputSubs.get(sessionId) ?? new Set<OutputHandler>();
  set.add(cb);
  outputSubs.set(sessionId, set);
  return () => {
    const cur = outputSubs.get(sessionId);
    cur?.delete(cb);
  };
}

export function emitTerminalLine(sessionId: string, line: string) {
  const state = sessions.get(sessionId);
  if (!state) return;
  state.userActiveUntil = Date.now() + USER_IDLE_MS;
  emit(sessionId, `\r\n${prompt(state.meta)}${line}\r\n`);
  runMockCommand(sessionId, state, line);
}

/** Handle keystrokes from xterm — echo locally and run mock commands on Enter. */
export function handleTerminalInput(sessionId: string, data: string) {
  const state = sessions.get(sessionId);
  if (!state) return;

  state.userActiveUntil = Date.now() + USER_IDLE_MS;

  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    const code = ch.charCodeAt(0);

    if (ch === "\r" || ch === "\n") {
      emit(sessionId, "\r\n");
      runMockCommand(sessionId, state, state.line);
      state.line = "";
      continue;
    }

    if (code === 127 || code === 8) {
      if (state.line.length === 0) continue;
      state.line = state.line.slice(0, -1);
      emit(sessionId, "\b \b");
      continue;
    }

    if (code < 32) continue;

    state.line += ch;
    emit(sessionId, ch);
  }
}
