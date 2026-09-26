package main

import (
	"encoding/json"
	"strings"

	"daimon/internal/ai"
)

func normTaskStatusGo(s string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(s), " ", "_"))
}

// extractTasksFromAssistantPayload parses tasks from a persisted assistant payload.
// Returns (tasks, tasksKeyPresent, usable). usable is false for parse-error assistant rows.
func extractTasksFromAssistantPayload(payloadJSON string) (tasks []aiTaskItemJSON, tasksKeyPresent bool, usable bool) {
	var m map[string]json.RawMessage
	if err := json.Unmarshal([]byte(payloadJSON), &m); err != nil {
		return nil, false, false
	}
	if pe, ok := m["parseError"]; ok {
		var es string
		_ = json.Unmarshal(pe, &es)
		if strings.TrimSpace(es) != "" {
			return nil, false, false
		}
	}
	raw, ok := m["tasks"]
	if !ok {
		return nil, false, true
	}
	if len(raw) == 0 || string(raw) == "null" {
		return nil, true, true
	}
	if err := json.Unmarshal(raw, &tasks); err != nil {
		return nil, true, false
	}
	return tasks, true, true
}

// lastAssistantTasksForMerge walks from the newest message and returns tasks from the
// latest assistant row that includes a JSON "tasks" key (array may be empty).
func lastAssistantTasksForMerge(rows []AiMessageDTO) []aiTaskItemJSON {
	for i := len(rows) - 1; i >= 0; i-- {
		if rows[i].Role != "assistant" {
			continue
		}
		tasks, hadKey, usable := extractTasksFromAssistantPayload(rows[i].PayloadJSON)
		if !usable {
			continue
		}
		if hadKey {
			if tasks == nil {
				return []aiTaskItemJSON{}
			}
			return tasks
		}
	}
	return nil
}

// mergeTaskPlans merges the previous plan with the model's new tasks array.
// If tasksKeyPresent is false, the previous plan is kept unchanged.
// If tasksKeyPresent is true and incoming is empty, the previous plan is kept (no wipe).
// Otherwise, every id from prev missing in incoming is treated as done.
//
// Task order is stable: ids that already existed in prev keep prev's order; new ids (only in incoming)
// are appended at the end in incoming order. This avoids a wrong UI when the model lists the active
// step first or permutes rows.
func mergeTaskPlans(prev, incoming []aiTaskItemJSON, tasksKeyPresent bool) []aiTaskItemJSON {
	if len(prev) == 0 {
		if incoming == nil {
			return nil
		}
		out := make([]aiTaskItemJSON, len(incoming))
		copy(out, incoming)
		return out
	}
	if !tasksKeyPresent {
		out := make([]aiTaskItemJSON, len(prev))
		copy(out, prev)
		return out
	}
	if len(incoming) == 0 {
		out := make([]aiTaskItemJSON, len(prev))
		copy(out, prev)
		return out
	}

	incomingByID := make(map[string]aiTaskItemJSON, len(incoming))
	for _, t := range incoming {
		id := strings.TrimSpace(t.ID)
		if id != "" {
			incomingByID[id] = t
		}
	}

	prevIDOrder := make([]string, 0, len(prev))
	prevIDSeen := make(map[string]struct{}, len(prev))
	for _, t := range prev {
		id := strings.TrimSpace(t.ID)
		if id == "" {
			continue
		}
		if _, ok := prevIDSeen[id]; ok {
			continue
		}
		prevIDSeen[id] = struct{}{}
		prevIDOrder = append(prevIDOrder, id)
	}

	prevIDSet := make(map[string]struct{}, len(prevIDOrder))
	for _, id := range prevIDOrder {
		prevIDSet[id] = struct{}{}
	}

	out := make([]aiTaskItemJSON, 0, len(incoming)+len(prev))

	for _, id := range prevIDOrder {
		if t, ok := incomingByID[id]; ok {
			out = append(out, t)
			continue
		}
		var title string
		for _, p := range prev {
			if strings.TrimSpace(p.ID) == id {
				title = p.Title
				break
			}
		}
		out = append(out, aiTaskItemJSON{ID: id, Title: title, Status: "done"})
	}

	newSeen := make(map[string]struct{})
	for _, t := range incoming {
		id := strings.TrimSpace(t.ID)
		if id == "" {
			continue
		}
		if _, ok := prevIDSet[id]; ok {
			continue
		}
		if _, ok := newSeen[id]; ok {
			continue
		}
		newSeen[id] = struct{}{}
		out = append(out, t)
	}

	for _, t := range incoming {
		if strings.TrimSpace(t.ID) != "" {
			continue
		}
		if strings.TrimSpace(t.Title) == "" {
			continue
		}
		out = append(out, t)
	}

	return out
}

// normalizeSingleInProgress keeps at most one in_progress (last wins); others become done.
func normalizeSingleInProgress(tasks []aiTaskItemJSON) []aiTaskItemJSON {
	if len(tasks) == 0 {
		return tasks
	}
	var inProgIdx []int
	for i, t := range tasks {
		if normTaskStatusGo(t.Status) == "in_progress" {
			inProgIdx = append(inProgIdx, i)
		}
	}
	if len(inProgIdx) <= 1 {
		out := make([]aiTaskItemJSON, len(tasks))
		copy(out, tasks)
		return out
	}
	keep := inProgIdx[len(inProgIdx)-1]
	out := make([]aiTaskItemJSON, len(tasks))
	for i, t := range tasks {
		if normTaskStatusGo(t.Status) == "in_progress" && i != keep {
			out[i] = aiTaskItemJSON{ID: t.ID, Title: t.Title, Status: "done"}
		} else {
			out[i] = t
		}
	}
	return out
}

func mergeTasksIntoModelRawJSON(raw string, merged []aiTaskItemJSON) (string, error) {
	m, err := ai.ParseModelJSON(raw)
	if err != nil {
		return "", err
	}
	if len(merged) > 0 {
		tb, err := json.Marshal(merged)
		if err != nil {
			return "", err
		}
		m["tasks"] = tb
	} else {
		delete(m, "tasks")
	}
	out, err := json.Marshal(m)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// mergeAssistantPayloadExtras merges extra top-level keys into a model JSON string (e.g. pendingCommand).
func mergeAssistantPayloadExtras(baseJSON string, extra map[string]any) (string, error) {
	m, err := ai.ParseModelJSON(baseJSON)
	if err != nil {
		return "", err
	}
	for k, v := range extra {
		vb, err := json.Marshal(v)
		if err != nil {
			return "", err
		}
		m[k] = json.RawMessage(vb)
	}
	out, err := json.Marshal(m)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// finalizeAssistantReplyJSON merges tasks with the last persisted plan for this conversation,
// normalizes in_progress, writes merged tasks into parsed, and returns full JSON to store.
func (a *App) finalizeAssistantReplyJSON(convID, raw string, parsed *aiParsedReply) (string, error) {
	rows, err := a.GetAiMessages(convID)
	if err != nil {
		return "", err
	}
	prev := lastAssistantTasksForMerge(rows)
	merged := mergeTaskPlans(prev, parsed.Tasks, parsed.TasksKeyPresent)
	merged = normalizeSingleInProgress(merged)
	parsed.Tasks = merged
	if len(merged) == 0 {
		if parsed.TasksKeyPresent {
			return mergeTasksIntoModelRawJSON(raw, nil)
		}
		return raw, nil
	}
	return mergeTasksIntoModelRawJSON(raw, merged)
}

// planInjectionText returns a block to append to a synthetic user message so the model
// sees the current task ids when the plan is not finished.
func planInjectionText(tasks []aiTaskItemJSON) string {
	active := unfinishedTasks(tasks)
	if len(active) == 0 {
		return ""
	}
	b, err := json.Marshal(active)
	if err != nil {
		return ""
	}
	return "\n\nCurrent task plan (you MUST return the full tasks array in your JSON with the same ids; add new steps only with new unique ids at the end; do not drop an id without setting it to done or skipped first):\n" + string(b)
}

func unfinishedTasks(tasks []aiTaskItemJSON) []aiTaskItemJSON {
	if len(tasks) == 0 {
		return nil
	}
	out := make([]aiTaskItemJSON, 0, len(tasks))
	for _, t := range tasks {
		st := normTaskStatusGo(t.Status)
		if st == "pending" || st == "in_progress" {
			out = append(out, t)
		}
	}
	return out
}

// userMessagePrefixIfUnfinishedPlan returns text to prepend to the last user message when
// loading history, if the plan before that user turn was still active.
func userMessagePrefixIfUnfinishedPlan(rows []AiMessageDTO) string {
	// Do not inject unfinished-plan reminders into organic user turns.
	// The assistant already sees prior messages; injecting stale plan context into every
	// new user prompt causes cross-incident contamination and noisy historical tasks.
	// We only inject plan context in synthetic follow-ups via planInjectionText().
	return ""
}
