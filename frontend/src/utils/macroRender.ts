import type { MacroDTO } from "../types/models";

const secretMarkerRe = /(private\s*key|password\s*=|authorization:|token|secret)/i;

export function isLikelySecretKey(s: string): boolean {
  return /(password|secret|token|key)/i.test(s ?? "");
}

function shellEscape(s: string): string {
  const v = String(s ?? "");
  return `'${v.replace(/'/g, `'\"'\"'`)}'`;
}

function replaceParams(text: string, params: Record<string, string>): string {
  return text.replace(/##([a-zA-Z0-9_-]+)##/g, (_m, name) => params[name] ?? "");
}

export function renderMacro(macro: MacroDTO, paramValues: Record<string, string>): { script: string; warnings: string[] } {
  const params = Object.fromEntries(Object.entries(paramValues ?? {}).map(([k, v]) => [k, String(v ?? "")]));

  const dataByKey: Record<string, string> = {};
  (macro.dataItems ?? []).forEach((d) => {
    dataByKey[d.key] = replaceParams(d.value ?? "", params);
  });

  const warnings: string[] = [];
  const warnIfSecret = (label: string, val: string) => {
    if (secretMarkerRe.test(val)) warnings.push(`Possible secret marker in ${label}`);
  };
  Object.entries(dataByKey).forEach(([k, v]) => warnIfSecret(`data:${k}`, v));

  let heredocCounter = 0;
  const lines = (macro.script ?? "").split(/\r?\n/);
  const outLines: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*\?\?([a-zA-Z0-9_.-]+)\?\?\s*(>>|>)\s*(.+?)\s*$/);
    if (m) {
      const key = m[1];
      const op = m[2];
      const target = m[3];
      const val = dataByKey[key] ?? "";
      const marker = `__DAIMON_EOF_${heredocCounter++}__`;
      outLines.push(`cat <<'${marker}' ${op} ${shellEscape(target)}`);
      outLines.push(val);
      outLines.push(marker);
      continue;
    }
    outLines.push(line);
  }

  let script = outLines.join("\n");
  script = script.replace(/\?\?([a-zA-Z0-9_.-]+)\?\?/g, (_m, key) => dataByKey[key] ?? "");
  script = replaceParams(script, params);

  warnIfSecret("script", script);
  return { script, warnings };
}
