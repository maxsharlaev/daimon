package main

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"regexp"
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

var tempNameSanitizeRe = regexp.MustCompile(`[^a-z0-9]+`)

var tempNameWordA = []string{
	"amber", "ancient", "aqua", "arctic", "ashen", "autumn", "brave", "bright", "calm", "candid",
	"celestial", "chill", "cinder", "clean", "cobalt", "cosmic", "crimson", "crisp", "daring", "dawn",
	"deep", "drift", "dusty", "ember", "faint", "frost", "gentle", "golden", "grand", "hollow",
	"icy", "iron", "jolly", "kind", "lunar", "mellow", "misty", "modern", "muted", "navy",
	"noble", "plain", "proud", "quiet", "rapid", "royal", "sandy", "silent", "silver", "soft",
	"solar", "spring", "steel", "storm", "sunny", "swift", "tidal", "timber", "vivid", "warm",
	"wild", "wispy", "young", "zen",
}

var tempNameWordB = []string{
	"archive", "atlas", "bay", "beam", "breeze", "brook", "canyon", "cascade", "cave", "cliff",
	"cloud", "comet", "creek", "dawn", "delta", "dune", "field", "fjord", "flare", "forest",
	"glade", "glow", "harbor", "haze", "hill", "island", "lake", "leaf", "light", "meadow",
	"mesa", "mist", "moon", "north", "ocean", "pine", "plain", "plateau", "point", "ridge",
	"river", "rock", "sail", "shade", "sky", "spark", "stone", "storm", "summit", "surf",
	"swamp", "tide", "trail", "vale", "wave", "wind", "wood", "zenith",
}

func tempContainerName(_ string) string {
	wordA := tempNameWordA[randomWordIndex(len(tempNameWordA))]
	wordB := tempNameWordB[randomWordIndex(len(tempNameWordB))]
	return fmt.Sprintf("daimon_temp_%s-%s", wordA, wordB)
}

func randomWordIndex(max int) int {
	if max <= 0 {
		return 0
	}
	n, err := rand.Int(rand.Reader, big.NewInt(int64(max)))
	if err != nil {
		return int(time.Now().UnixNano() % int64(max))
	}
	return int(n.Int64())
}

func tempContainerLabels(volumeName string) map[string]string {
	return map[string]string{
		"daimon.temp":        "true",
		"daimon.temp.kind":   "volume",
		"daimon.temp.volume": volumeName,
	}
}

func parseLsOutput(raw string, basePath string) []DockerFileEntryDTO {
	var out []DockerFileEntryDTO
	lines := strings.Split(strings.TrimSpace(raw), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "total ") {
			continue
		}
		linkTarget := ""
		namePart := line
		if strings.Contains(line, " -> ") {
			parts := strings.SplitN(line, " -> ", 2)
			namePart = parts[0]
			linkTarget = strings.TrimSpace(parts[1])
		}
		fields := strings.Fields(namePart)
		if len(fields) < 6 {
			continue
		}
		mode := fields[0]
		isDir := strings.HasPrefix(mode, "d")
		isSymlink := strings.HasPrefix(mode, "l")
		// With --time-style=+%s, time is a single epoch field at index len-2
		name := fields[len(fields)-1]
		epoch := ""
		sizeField := ""
		if len(fields) >= 3 && isDigits(fields[len(fields)-2]) {
			epoch = fields[len(fields)-2]
			sizeField = fields[len(fields)-3]
		} else if len(fields) >= 5 && isDigits(fields[4]) {
			// Fallback for BusyBox ls (no --time-style); size is usually field 5
			sizeField = fields[4]
		} else if len(fields) >= 5 && isDigits(fields[len(fields)-5]) {
			sizeField = fields[len(fields)-5]
		}
		size := parseInt64(sizeField)
		mtimeMs := int64(0)
		if epoch != "" {
			t := parseInt64(epoch)
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
			Name:       name,
			Path:       path,
			IsDir:      isDir,
			Size:       size,
			MtimeMs:    mtimeMs,
			IsSymlink:  isSymlink,
			LinkTarget: linkTarget,
		})
	}
	return out
}

func resolveSymlinkDirs(entries []DockerFileEntryDTO, exec func(cmd string) (string, error)) []DockerFileEntryDTO {
	var symlinks []DockerFileEntryDTO
	for _, e := range entries {
		if e.IsSymlink {
			symlinks = append(symlinks, e)
		}
	}
	if len(symlinks) == 0 {
		return entries
	}
	var checks []string
	for _, e := range symlinks {
		p := shellQuote(e.Path)
		checks = append(checks, fmt.Sprintf("if [ -d %s ]; then printf '%%s\\t%%s\\n' %s dir; else printf '%%s\\t%%s\\n' %s file; fi", p, p, p))
	}
	out, err := exec(strings.Join(checks, "; "))
	if err != nil {
		return entries
	}
	dirByPath := map[string]bool{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) != 2 {
			continue
		}
		dirByPath[parts[0]] = parts[1] == "dir"
	}
	for i := range entries {
		if !entries[i].IsSymlink {
			continue
		}
		if isDir, ok := dirByPath[entries[i].Path]; ok {
			entries[i].IsDir = isDir
		}
	}
	return entries
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

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return true
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
