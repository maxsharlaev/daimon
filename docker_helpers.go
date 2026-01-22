package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/dustin/go-humanize"
)

func shellQuote(s string) string {
	if s == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}

func formatPorts(ports []types.Port) string {
	if len(ports) == 0 {
		return ""
	}
	var out []string
	for _, p := range ports {
		if p.PublicPort > 0 {
			out = append(out, fmt.Sprintf("%d:%d/%s", p.PublicPort, p.PrivatePort, p.Type))
		} else {
			out = append(out, fmt.Sprintf("%d/%s", p.PrivatePort, p.Type))
		}
	}
	return strings.Join(out, ", ")
}

func byteSize(b int64) string {
	if b <= 0 {
		return "0 B"
	}
	return humanize.Bytes(uint64(b))
}

func parseLsOutput(raw string, basePath string) []DockerFileEntryDTO {
	var out []DockerFileEntryDTO
	lines := strings.Split(strings.TrimSpace(raw), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "total ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 6 {
			continue
		}
		mode := fields[0]
		isDir := strings.HasPrefix(mode, "d")
		// With --time-style=+%s, time is a single epoch field at index len-2
		name := fields[len(fields)-1]
		epoch := fields[len(fields)-2]
		sizeField := fields[len(fields)-3]
		size := parseInt64(sizeField)
		mtimeMs := int64(0)
		if t := parseInt64(epoch); t > 0 {
			mtimeMs = time.Unix(t, 0).UnixMilli()
		}
		if name == "." || name == ".." {
			continue
		}
		path := basePath
		if !strings.HasSuffix(path, "/") {
			path += "/"
		}
		path += name
		out = append(out, DockerFileEntryDTO{
			Name:    name,
			Path:    path,
			IsDir:   isDir,
			Size:    size,
			MtimeMs: mtimeMs,
		})
	}
	return out
}

func parseInt64(s string) int64 {
	var n int64
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return 0
		}
		n = n*10 + int64(ch-'0')
	}
	return n
}

func parseSizeString(s string) int64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	if n, err := humanize.ParseBytes(s); err == nil {
		return int64(n)
	}
	// fallback: strip spaces (e.g. "12 MB")
	s = strings.ReplaceAll(s, " ", "")
	if n, err := humanize.ParseBytes(s); err == nil {
		return int64(n)
	}
	return 0
}
