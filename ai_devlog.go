package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"daimon/internal/ai"
)

type aiDebugLogEntry struct {
	Timestamp        time.Time        `json:"timestamp"`
	Model            string           `json:"model"`
	Kind             string           `json:"kind"`
	Phase            string           `json:"phase"`
	ConversationID   string           `json:"conversationId"`
	PromptTokens     int              `json:"promptTokens"`
	CompletionTokens int              `json:"completionTokens"`
	TotalTokens      int              `json:"totalTokens"`
	MessageCount     int              `json:"messageCount"`
	PromptChars      int              `json:"promptChars"`
	Error            string           `json:"error,omitempty"`
	Messages         []ai.ChatMessage `json:"messages,omitempty"`
}

func aiDebugLogRootDir() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(dir) == "" {
		return "", fmt.Errorf("user config dir not found")
	}
	return filepath.Join(dir, "daimon", "debug", "ai-logs"), nil
}

func trimMessagesForDebug(messages []ai.ChatMessage) []ai.ChatMessage {
	if len(messages) == 0 {
		return nil
	}
	const maxMessageChars = 4000
	out := make([]ai.ChatMessage, 0, len(messages))
	for _, m := range messages {
		c := strings.TrimSpace(m.Content)
		rs := []rune(c)
		if len(rs) > maxMessageChars {
			c = string(rs[:maxMessageChars]) + "…"
		}
		out = append(out, ai.ChatMessage{Role: m.Role, Content: c})
	}
	return out
}

func writeAiDebugLogFile(entry aiDebugLogEntry) (string, error) {
	root, err := aiDebugLogRootDir()
	if err != nil {
		return "", err
	}
	ts := entry.Timestamp.UTC()
	day := ts.Format("2006-01-02")
	dir := filepath.Join(root, day)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	entry.Messages = trimMessagesForDebug(entry.Messages)
	body, err := json.MarshalIndent(entry, "", "  ")
	if err != nil {
		return "", err
	}
	fileName := fmt.Sprintf("%s_%s_%s.json", ts.Format("150405.000"), sanitizeKind(entry.Kind), sanitizeKind(entry.Phase))
	fileName = strings.TrimSuffix(fileName, "_.json") + ".json"
	fullPath := filepath.Join(dir, fileName)
	if err := os.WriteFile(fullPath, body, 0o644); err != nil {
		return "", err
	}
	rel := filepath.Join(day, fileName)
	return filepath.ToSlash(rel), nil
}

func sanitizeKind(s string) string {
	v := strings.ToLower(strings.TrimSpace(s))
	if v == "" {
		return "event"
	}
	v = strings.ReplaceAll(v, " ", "_")
	var b strings.Builder
	for _, r := range v {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "event"
	}
	return b.String()
}
