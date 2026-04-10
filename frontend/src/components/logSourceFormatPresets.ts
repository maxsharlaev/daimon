/** Suggested log paths for built-in formats (Linux). Key = format id */

export const LOG_FORMAT_PATH_PRESETS: Record<string, string> = {
  "builtin:nginx_access": "/var/log/nginx/access.log",
  "builtin:nginx_error": "/var/log/nginx/error.log",
  "builtin:syslog": "/var/log/syslog",
  "builtin:php_error": "/var/log/php_errors.log",
  "builtin:php_fpm": "/var/log/php-fpm.log",
  "builtin:generic_plain": "/var/log/syslog",
};

export function presetPathForFormat(formatId: string): string | undefined {
  const p = LOG_FORMAT_PATH_PRESETS[formatId];
  return p?.trim() ? p : undefined;
}
