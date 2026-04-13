package main

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"daimon/internal/ai"
	"daimon/internal/storage"

	"gorm.io/gorm"
)

const aiExplainOutputMaxRunes = 24000

// AiAgentExplainRequest asks the model to explain a command or output without persisting to the chat DB.
type AiAgentExplainRequest struct {
	Kind         string          `json:"kind"` // tool_output | pending_command
	Command      string          `json:"command"`
	Output       string          `json:"output"`
	AgentContext AgentContextDTO `json:"agentContext"`
}

// AiAgentExplainResponse carries plain-text explanation only.
type AiAgentExplainResponse struct {
	ReplyText string `json:"replyText"`
	Error     string `json:"error,omitempty"`
}

// AiAgentExplain runs a single non-persisted completion for on-demand explanations.
func (a *App) AiAgentExplain(req AiAgentExplainRequest) (AiAgentExplainResponse, error) {
	if a.db == nil || a.db.DB == nil {
		return AiAgentExplainResponse{}, errors.New("db not ready")
	}
	st, err := a.loadAiSettingsDTO()
	if err != nil {
		return AiAgentExplainResponse{}, err
	}
	if st.IntegrationType != "openai_compatible" {
		return AiAgentExplainResponse{}, errors.New("AI integration is disabled")
	}
	key, err := a.getOpenAIAPIKey()
	if err != nil {
		return AiAgentExplainResponse{}, err
	}
	kind := strings.TrimSpace(strings.ToLower(req.Kind))
	if kind != "tool_output" && kind != "pending_command" {
		return AiAgentExplainResponse{}, errors.New("kind must be tool_output or pending_command")
	}
	cmd := strings.TrimSpace(req.Command)
	if cmd == "" {
		return AiAgentExplainResponse{}, errors.New("command required")
	}

	out := strings.TrimSpace(req.Output)
	if len([]rune(out)) > aiExplainOutputMaxRunes {
		out = string([]rune(out)[:aiExplainOutputMaxRunes]) + "…"
	}

	ctx := a.buildAgentContextShortLabel(req.AgentContext)
	system := `You are a senior ops/SRE assistant embedded in a desktop SSH terminal app.
The user clicked "Explain" on a shell command or its output. Reply in plain language only (no JSON, no tool calls).
Be concise but useful: what the command does, what notable lines in the output mean, exit implications if obvious, and safety notes if relevant.
Match the user's language when the command or output is clearly Russian; otherwise English is fine.`

	var user strings.Builder
	user.WriteString("Connection context (for orientation only): ")
	user.WriteString(ctx)
	user.WriteString("\n\n")
	switch kind {
	case "pending_command":
		user.WriteString("The AI agent proposed this command and is waiting for user approval (not executed yet).\nExplain what it would do and any risks.\n\nCommand:\n```\n")
		user.WriteString(cmd)
		user.WriteString("\n```")
	default:
		user.WriteString("Explain the following executed command and its captured stdout/stderr.\n\nCommand:\n```\n")
		user.WriteString(cmd)
		user.WriteString("\n```\n\nOutput:\n```\n")
		if out == "" {
			user.WriteString("(no output captured)")
		} else {
			user.WriteString(out)
		}
		user.WriteString("\n```")
	}

	client := ai.NewHTTPClient(90 * time.Second)
	maxTok := st.MaxTokensPerRequest
	if maxTok > 2048 {
		maxTok = 2048
	}
	raw, pt, ct, tt, err := ai.ChatCompletion(client, key, st.BaseURL, st.Model, []ai.ChatMessage{
		{Role: "system", Content: system},
		{Role: "user", Content: user.String()},
	}, maxTok, 0.25)
	a.recordAiUsage(st.Model, "explain", pt, ct, tt, errString(err))
	if err != nil {
		return AiAgentExplainResponse{Error: err.Error()}, nil
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return AiAgentExplainResponse{Error: "empty model response"}, nil
	}
	return AiAgentExplainResponse{ReplyText: raw}, nil
}

// SaveAiToolExplainRequest merges cached explain text into an existing tool message payload.
type SaveAiToolExplainRequest struct {
	ConversationID string `json:"conversationId"`
	MessageID      string `json:"messageId"`
	ExplainText    string `json:"explainText"`
}

// SaveAiToolExplain persists explain text on a tool row so the UI does not call the model again.
func (a *App) SaveAiToolExplain(req SaveAiToolExplainRequest) error {
	if a.db == nil || a.db.DB == nil {
		return errors.New("db not ready")
	}
	convID := strings.TrimSpace(req.ConversationID)
	msgID := strings.TrimSpace(req.MessageID)
	text := strings.TrimSpace(req.ExplainText)
	if convID == "" || msgID == "" {
		return errors.New("conversationId and messageId required")
	}
	if text == "" {
		return errors.New("explainText required")
	}
	var m storage.AiMessage
	err := a.db.DB.First(&m, "id = ? AND conversation_id = ?", msgID, convID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errors.New("message not found")
	}
	if err != nil {
		return err
	}
	if m.Role != "tool" {
		return errors.New("message is not a tool row")
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(m.PayloadJSON), &payload); err != nil {
		return err
	}
	payload["explainText"] = text
	payload["explainAt"] = time.Now().UTC().Format(time.RFC3339)
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	js := string(b)
	if err := a.db.DB.Model(&storage.AiMessage{}).Where("id = ? AND conversation_id = ?", msgID, convID).Updates(map[string]any{
		"payload_json": js,
		"byte_size":    len(js),
	}).Error; err != nil {
		return err
	}
	_ = a.db.DB.Model(&storage.AiConversation{}).Where("id = ?", convID).Update("updated_at", time.Now().UTC()).Error
	return nil
}
