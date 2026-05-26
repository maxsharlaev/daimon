package localpty

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var osc7Re = regexp.MustCompile(`\033\]7;[^/]*(/[^\007\x1b]*)\007`)

// ParseOSC7Cwd extracts a filesystem path from an OSC 7 (file://) sequence in terminal output.
func ParseOSC7Cwd(data string) string {
	m := osc7Re.FindStringSubmatch(data)
	if len(m) < 2 {
		return ""
	}
	p := strings.TrimSpace(m[1])
	if p == "" {
		return ""
	}
	return filepath.Clean(p)
}

// ApplyCdLine updates cwd after a shell "cd" command line (Unix + Windows cmd).
func ApplyCdLine(cwd string, line string) string {
	line = strings.TrimSpace(line)
	if line == "" {
		return cwd
	}
	if line == "cd" {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Clean(home)
		}
		return cwd
	}
	lower := strings.ToLower(line)
	if strings.HasPrefix(lower, "cd /d ") {
		arg := strings.TrimSpace(line[6:])
		arg = strings.Trim(arg, `"'`)
		return resolveCdTarget(cwd, arg)
	}
	if strings.HasPrefix(lower, "cd ") {
		arg := strings.TrimSpace(line[3:])
		if arg == "" {
			if home, err := os.UserHomeDir(); err == nil {
				return filepath.Clean(home)
			}
			return cwd
		}
		arg = strings.Trim(arg, `"'`)
		return resolveCdTarget(cwd, arg)
	}
	return cwd
}

func resolveCdTarget(cwd string, arg string) string {
	arg = strings.TrimSpace(arg)
	if arg == "" {
		return cwd
	}
	if arg == "~" || strings.HasPrefix(arg, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return cwd
		}
		if arg == "~" {
			return filepath.Clean(home)
		}
		return filepath.Clean(filepath.Join(home, arg[2:]))
	}
	if filepath.IsAbs(arg) {
		return filepath.Clean(arg)
	}
	if cwd == "" {
		return filepath.Clean(arg)
	}
	return filepath.Clean(filepath.Join(cwd, arg))
}
