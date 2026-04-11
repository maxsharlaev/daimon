package ai

import (
	"encoding/json"
	"regexp"
	"strings"
)

var fenceRE = regexp.MustCompile("(?s)^```(?:json)?\\s*\\n?(.*?)\\n?```\\s*$")

// ParseModelJSON extracts the assistant JSON object from raw model output (handles ```json fences).
func ParseModelJSON(raw string) (map[string]json.RawMessage, error) {
	s := strings.TrimSpace(raw)
	if m := fenceRE.FindStringSubmatch(s); len(m) == 2 {
		s = strings.TrimSpace(m[1])
	}
	var out map[string]json.RawMessage
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil, err
	}
	return out, nil
}
