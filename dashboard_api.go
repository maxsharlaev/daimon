package main

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

type DashboardSeverity string

const (
	DashboardSeverityInfo     DashboardSeverity = "info"
	DashboardSeverityWarning  DashboardSeverity = "warning"
	DashboardSeverityCritical DashboardSeverity = "critical"
)

type DashboardAlertDTO struct {
	ID       string            `json:"id"`
	Severity DashboardSeverity `json:"severity"`
	Title    string            `json:"title"`
	Message  string            `json:"message"`
}

type DashboardLoadDTO struct {
	Load1  float64 `json:"load1"`
	Load5  float64 `json:"load5"`
	Load15 float64 `json:"load15"`
	Cores  int     `json:"cores"`
}

type DashboardCPUStatDTO struct {
	BusyPct float64 `json:"busyPct"`
}

type DashboardMemDTO struct {
	TotalBytes     uint64  `json:"totalBytes"`
	AvailableBytes uint64  `json:"availableBytes"`
	AvailablePct   float64 `json:"availablePct"`
}

type DashboardDiskDTO struct {
	Filesystem string  `json:"filesystem"`
	FSType     string  `json:"fsType"`
	Mount      string  `json:"mount"`
	SizeBytes  uint64  `json:"sizeBytes"`
	UsedBytes  uint64  `json:"usedBytes"`
	AvailBytes uint64  `json:"availBytes"`
	UsedPct    float64 `json:"usedPct"`
}

type DashboardProcessDTO struct {
	PID      int     `json:"pid"`
	Comm     string  `json:"comm"`
	CPU      float64 `json:"cpu"`
	MEM      float64 `json:"mem"`
	RSSBytes uint64  `json:"rssBytes"`
}

type DashboardNetDevDTO struct {
	Iface   string `json:"iface"`
	RxBytes uint64 `json:"rxBytes"`
	TxBytes uint64 `json:"txBytes"`
}

type DashboardSnapshotDTO struct {
	TsUnixMs int64 `json:"tsUnixMs"`

	Load DashboardLoadDTO    `json:"load"`
	CPU  DashboardCPUStatDTO `json:"cpu"`
	Mem  DashboardMemDTO     `json:"mem"`

	Disks      []DashboardDiskDTO    `json:"disks"`
	TopCPU     []DashboardProcessDTO `json:"topCpu"`
	TopMem     []DashboardProcessDTO `json:"topMem"`
	NetDevices []DashboardNetDevDTO  `json:"netDevices"`

	Alerts []DashboardAlertDTO `json:"alerts"`
}

// SSHDashboardSnapshot collects a Linux-oriented snapshot over an existing SSH connection ID.
// This is MVP and intentionally uses /proc + df/ps for portability.
func (a *App) SSHDashboardSnapshot(sessionId string) (DashboardSnapshotDTO, error) {
	if sessionId == "" {
		return DashboardSnapshotDTO{}, errors.New("sessionId required")
	}
	if a.ssh == nil {
		return DashboardSnapshotDTO{}, errors.New("ssh manager not ready")
	}

	// Important: SSHExec returns error on non-zero exit status, so ensure the overall command exits 0.
	// Also normalize locale to parse decimals.
	cmd := `sh -lc '
export LC_ALL=C
echo "__LOAD__"; cat /proc/loadavg
echo "__CORES__"; (getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 1)
echo "__STAT1__"; head -n 1 /proc/stat
sleep 1
echo "__STAT2__"; head -n 1 /proc/stat
echo "__MEM__"; egrep "^(MemTotal|MemAvailable):" /proc/meminfo
echo "__DF__"; df -PT -B1
echo "__PSCPU__"; ps -eo pid,comm,%cpu,%mem,rss --sort=-%cpu | head -n 21
echo "__PSMEM__"; ps -eo pid,comm,%cpu,%mem,rss --sort=-%mem | head -n 21
echo "__NETDEV__"; cat /proc/net/dev
true
'`

	raw, err := a.ssh.Exec(sessionId, cmd)
	if err != nil {
		// Exec-only dashboard sessions don't have a PTY session to Wait() on,
		// so a remote disconnect may only surface as an Exec() error.
		// Best-effort: mark the session as disconnected (emits ssh:state) and
		// let the frontend show a red marker + Close action.
		_ = a.ssh.Disconnect(a.ctx, sessionId)
		return DashboardSnapshotDTO{}, err
	}
	sections := splitMarkedSections(raw)

	load1, load5, load15 := parseLoadavg(sections["__LOAD__"])
	cores := parseFirstInt(sections["__CORES__"], 1)

	cpuBusy := parseCPUBusyPct(sections["__STAT1__"], sections["__STAT2__"])
	memTotal, memAvail := parseMeminfo(sections["__MEM__"])
	memPct := pct(float64(memAvail), float64(memTotal))

	disks := parseDF(sections["__DF__"])
	topCPU := parsePS(sections["__PSCPU__"])
	topMem := parsePS(sections["__PSMEM__"])
	netDevs := parseNetDev(sections["__NETDEV__"])

	snap := DashboardSnapshotDTO{
		TsUnixMs: time.Now().UnixMilli(),
		Load: DashboardLoadDTO{
			Load1:  load1,
			Load5:  load5,
			Load15: load15,
			Cores:  cores,
		},
		CPU: DashboardCPUStatDTO{
			BusyPct: cpuBusy,
		},
		Mem: DashboardMemDTO{
			TotalBytes:     memTotal,
			AvailableBytes: memAvail,
			AvailablePct:   memPct,
		},
		Disks:      disks,
		TopCPU:     topCPU,
		TopMem:     topMem,
		NetDevices: netDevs,
	}
	snap.Alerts = computeDashboardAlerts(snap)
	return snap, nil
}

func splitMarkedSections(raw string) map[string]string {
	out := map[string]string{}
	var cur string
	var b strings.Builder

	flush := func() {
		if cur == "" {
			return
		}
		out[cur] = strings.TrimSpace(b.String())
		b.Reset()
	}

	for _, line := range strings.Split(raw, "\n") {
		l := strings.TrimSpace(line)
		if strings.HasPrefix(l, "__") && strings.HasSuffix(l, "__") && len(l) <= 64 {
			flush()
			cur = l
			continue
		}
		if cur == "" {
			continue
		}
		b.WriteString(line)
		b.WriteString("\n")
	}
	flush()
	return out
}

func parseLoadavg(s string) (float64, float64, float64) {
	f := strings.Fields(strings.TrimSpace(s))
	if len(f) < 3 {
		return 0, 0, 0
	}
	return parseFloat(f[0]), parseFloat(f[1]), parseFloat(f[2])
}

func parseFirstInt(s string, fallback int) int {
	f := strings.Fields(strings.TrimSpace(s))
	if len(f) == 0 {
		return fallback
	}
	n, err := strconv.Atoi(strings.TrimSpace(f[0]))
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}

func parseCPUBusyPct(stat1 string, stat2 string) float64 {
	a := parseProcStatCPU(stat1)
	b := parseProcStatCPU(stat2)
	if a.total == 0 || b.total == 0 || b.total <= a.total {
		return 0
	}
	dTotal := float64(b.total - a.total)
	dIdle := float64(b.idle - a.idle)
	if dTotal <= 0 {
		return 0
	}
	busy := (dTotal - dIdle) / dTotal * 100.0
	if busy < 0 {
		busy = 0
	}
	if busy > 100 {
		busy = 100
	}
	return round1(busy)
}

type procCPU struct {
	total uint64
	idle  uint64
}

func parseProcStatCPU(line string) procCPU {
	// line: cpu  3357 0 4313 1362393 0 0 0 0 0 0
	f := strings.Fields(strings.TrimSpace(line))
	if len(f) < 5 || f[0] != "cpu" {
		return procCPU{}
	}
	vals := make([]uint64, 0, len(f)-1)
	for _, x := range f[1:] {
		u, err := strconv.ParseUint(x, 10, 64)
		if err != nil {
			return procCPU{}
		}
		vals = append(vals, u)
	}
	var total uint64
	for _, u := range vals {
		total += u
	}
	// idle is field 4; keep iowait as busy to align with top's "100 - id".
	idle := vals[3]
	return procCPU{total: total, idle: idle}
}

func parseMeminfo(s string) (totalBytes uint64, availBytes uint64) {
	for _, line := range strings.Split(s, "\n") {
		l := strings.TrimSpace(line)
		if l == "" {
			continue
		}
		// MemTotal:       16384000 kB
		parts := strings.Fields(l)
		if len(parts) < 2 {
			continue
		}
		key := strings.TrimSuffix(parts[0], ":")
		vKB, err := strconv.ParseUint(parts[1], 10, 64)
		if err != nil {
			continue
		}
		v := vKB * 1024
		switch key {
		case "MemTotal":
			totalBytes = v
		case "MemAvailable":
			availBytes = v
		}
	}
	return totalBytes, availBytes
}

func parseDF(s string) []DashboardDiskDTO {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) <= 1 {
		return nil
	}
	var out []DashboardDiskDTO
	for i := 1; i < len(lines); i++ {
		l := strings.TrimSpace(lines[i])
		if l == "" {
			continue
		}
		f := strings.Fields(l)
		// Filesystem Type 1B-blocks Used Available Use% Mounted_on
		if len(f) < 7 {
			continue
		}
		fs := f[0]
		fst := f[1]
		size := parseUint(f[2])
		used := parseUint(f[3])
		avail := parseUint(f[4])
		mount := f[6]

		// filter pseudo FS
		switch fst {
		case "tmpfs", "devtmpfs", "overlay", "squashfs":
			continue
		}
		if size == 0 {
			continue
		}
		// df "Use%" is based on used / (used + available) to exclude reserved blocks.
		denom := float64(used + avail)
		if denom <= 0 {
			denom = float64(size)
		}
		usedPct := pct(float64(used), denom)
		out = append(out, DashboardDiskDTO{
			Filesystem: fs,
			FSType:     fst,
			Mount:      mount,
			SizeBytes:  size,
			UsedBytes:  used,
			AvailBytes: avail,
			UsedPct:    usedPct,
		})
	}
	return out
}

func parsePS(s string) []DashboardProcessDTO {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) <= 1 {
		return nil
	}
	var out []DashboardProcessDTO
	for i := 1; i < len(lines); i++ {
		l := strings.TrimSpace(lines[i])
		if l == "" {
			continue
		}
		f := strings.Fields(l)
		if len(f) < 4 {
			continue
		}
		pid, err := strconv.Atoi(f[0])
		if err != nil {
			continue
		}
		var rssBytes uint64
		if len(f) >= 5 {
			// rss is reported in KB by ps
			rssBytes = parseUint(f[4]) * 1024
		}
		out = append(out, DashboardProcessDTO{
			PID:      pid,
			Comm:     f[1],
			CPU:      parseFloat(f[2]),
			MEM:      parseFloat(f[3]),
			RSSBytes: rssBytes,
		})
	}
	return out
}

func parseNetDev(s string) []DashboardNetDevDTO {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) < 3 {
		return nil
	}
	var out []DashboardNetDevDTO
	for i := 2; i < len(lines); i++ {
		l := strings.TrimSpace(lines[i])
		if l == "" {
			continue
		}
		parts := strings.SplitN(l, ":", 2)
		if len(parts) != 2 {
			continue
		}
		iface := strings.TrimSpace(parts[0])
		fields := strings.Fields(strings.TrimSpace(parts[1]))
		// 16 fields expected
		if len(fields) < 16 {
			continue
		}
		rxBytes := parseUint(fields[0])
		txBytes := parseUint(fields[8])
		out = append(out, DashboardNetDevDTO{Iface: iface, RxBytes: rxBytes, TxBytes: txBytes})
	}
	return out
}

func computeDashboardAlerts(s DashboardSnapshotDTO) []DashboardAlertDTO {
	var alerts []DashboardAlertDTO

	// Memory
	if s.Mem.TotalBytes > 0 {
		if s.Mem.AvailablePct < 8 {
			alerts = append(alerts, DashboardAlertDTO{
				ID:       "mem_low_critical",
				Severity: DashboardSeverityCritical,
				Title:    "Memory is critically low",
				Message:  fmt.Sprintf("MemAvailable %.1f%%", s.Mem.AvailablePct),
			})
		} else if s.Mem.AvailablePct < 15 {
			alerts = append(alerts, DashboardAlertDTO{
				ID:       "mem_low_warning",
				Severity: DashboardSeverityWarning,
				Title:    "Memory is low",
				Message:  fmt.Sprintf("MemAvailable %.1f%%", s.Mem.AvailablePct),
			})
		}
	}

	// CPU
	if s.CPU.BusyPct > 95 {
		alerts = append(alerts, DashboardAlertDTO{
			ID:       "cpu_high_critical",
			Severity: DashboardSeverityCritical,
			Title:    "CPU usage is very high",
			Message:  fmt.Sprintf("CPU busy %.1f%%", s.CPU.BusyPct),
		})
	} else if s.CPU.BusyPct > 85 {
		alerts = append(alerts, DashboardAlertDTO{
			ID:       "cpu_high_warning",
			Severity: DashboardSeverityWarning,
			Title:    "CPU usage is high",
			Message:  fmt.Sprintf("CPU busy %.1f%%", s.CPU.BusyPct),
		})
	}

	// Load
	if s.Load.Cores > 0 && s.Load.Load1 > 0 {
		w := 1.25 * float64(s.Load.Cores)
		c := 2.0 * float64(s.Load.Cores)
		if s.Load.Load1 > c {
			alerts = append(alerts, DashboardAlertDTO{
				ID:       "load_high_critical",
				Severity: DashboardSeverityCritical,
				Title:    "Load average is very high",
				Message:  fmt.Sprintf("load1 %.2f (cores %d)", s.Load.Load1, s.Load.Cores),
			})
		} else if s.Load.Load1 > w {
			alerts = append(alerts, DashboardAlertDTO{
				ID:       "load_high_warning",
				Severity: DashboardSeverityWarning,
				Title:    "Load average is high",
				Message:  fmt.Sprintf("load1 %.2f (cores %d)", s.Load.Load1, s.Load.Cores),
			})
		}
	}

	// Disk
	for _, d := range s.Disks {
		if d.SizeBytes == 0 {
			continue
		}
		freePct := pct(float64(d.AvailBytes), float64(d.SizeBytes))
		freeGiB := float64(d.AvailBytes) / (1024 * 1024 * 1024)
		if freePct < 5 || freeGiB < 2 {
			alerts = append(alerts, DashboardAlertDTO{
				ID:       "disk_low_critical:" + d.Mount,
				Severity: DashboardSeverityCritical,
				Title:    "Disk space is critically low",
				Message:  fmt.Sprintf("%s free %.1f%% (%.1f GiB)", d.Mount, freePct, freeGiB),
			})
		} else if freePct < 10 || freeGiB < 5 {
			alerts = append(alerts, DashboardAlertDTO{
				ID:       "disk_low_warning:" + d.Mount,
				Severity: DashboardSeverityWarning,
				Title:    "Disk space is low",
				Message:  fmt.Sprintf("%s free %.1f%% (%.1f GiB)", d.Mount, freePct, freeGiB),
			})
		}
	}

	// Top process (CPU)
	if len(s.TopCPU) > 0 {
		p := s.TopCPU[0]
		if p.CPU > 90 || p.MEM > 40 {
			alerts = append(alerts, DashboardAlertDTO{
				ID:       fmt.Sprintf("topproc_critical:%d", p.PID),
				Severity: DashboardSeverityCritical,
				Title:    "A process is consuming a lot of resources",
				Message:  fmt.Sprintf("%s (pid %d) cpu %.1f%% mem %.1f%%", p.Comm, p.PID, p.CPU, p.MEM),
			})
		} else if p.CPU > 70 || p.MEM > 25 {
			alerts = append(alerts, DashboardAlertDTO{
				ID:       fmt.Sprintf("topproc_warning:%d", p.PID),
				Severity: DashboardSeverityWarning,
				Title:    "A process is consuming high resources",
				Message:  fmt.Sprintf("%s (pid %d) cpu %.1f%% mem %.1f%%", p.Comm, p.PID, p.CPU, p.MEM),
			})
		}
	}

	return alerts
}

func parseUint(s string) uint64 {
	u, _ := strconv.ParseUint(strings.TrimSpace(s), 10, 64)
	return u
}

func parseFloat(s string) float64 {
	// allow "12.3" and "12,3" (just in case)
	s = strings.TrimSpace(strings.ReplaceAll(s, ",", "."))
	f, _ := strconv.ParseFloat(s, 64)
	return f
}

func pct(n float64, d float64) float64 {
	if d <= 0 {
		return 0
	}
	return round1((n / d) * 100)
}

func round1(v float64) float64 {
	if !isFinite(v) {
		return 0
	}
	return math.Round(v*10) / 10
}

func isFinite(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}
