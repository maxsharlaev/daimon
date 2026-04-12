package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"daimon/internal/ai"
	"daimon/internal/secrets"
	"daimon/internal/storage"
)

// AiChatRequest is one user turn in a conversation.
type AiChatRequest struct {
	ConversationID string            `json:"conversationId"`
	UserText       string            `json:"userText"`
	AgentContext   AgentContextDTO   `json:"agentContext"`
}

// AiPendingCommandDTO is returned when the model requested a shell command.
type AiPendingCommandDTO struct {
	AssistantMessageID string `json:"assistantMessageId"`
	Command            string `json:"command"`
}

// AiChatResponse is the outcome of AiChat (or continuation).
type AiChatResponse struct {
	AssistantMessage *AiMessageDTO         `json:"assistantMessage,omitempty"`
	PendingCommand   *AiPendingCommandDTO  `json:"pendingCommand,omitempty"`
	Error            string                `json:"error,omitempty"`
}

// AiResolveCommandRequest completes or cancels a pending command from a prior assistant message.
type AiResolveCommandRequest struct {
	ConversationID       string          `json:"conversationId"`
	AssistantMessageID   string          `json:"assistantMessageId"`
	Approved             bool            `json:"approved"`
	AgentContext         AgentContextDTO `json:"agentContext"`
}

type aiParsedReply struct {
	ReplyText string              `json:"replyText"`
	Service   []aiServiceItemJSON `json:"service"`
	Tasks     []aiTaskItemJSON    `json:"tasks"`
}

type aiServiceItemJSON struct {
	Type string         `json:"type"`
	Meta map[string]any `json:"meta"`
}

type aiTaskItemJSON struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

func (a *App) buildAgentContextHintText(ag AgentContextDTO) string {
	if a.db == nil || a.db.DB == nil {
		return ""
	}
	var b strings.Builder
	b.WriteString("Current connection context (sanitized; no secrets): ")
	b.WriteString("mode=" + strings.TrimSpace(ag.Mode))
	if pid := strings.TrimSpace(ag.ProfileID); pid != "" {
		b.WriteString("; profileId=" + pid)
		var p storage.Profile
		if err := a.db.DB.First(&p, "id = ?", pid).Error; err == nil {
			b.WriteString("; host=" + p.Host)
			b.WriteString(fmt.Sprintf("; port=%d", p.Port))
			b.WriteString("; sshUser=" + p.Username)
		}
	}
	if strings.TrimSpace(ag.SessionID) != "" {
		b.WriteString("; hasActiveTerminalSession=true")
	} else {
		b.WriteString("; hasActiveTerminalSession=false")
	}
	if cid := strings.TrimSpace(ag.ContainerID); cid != "" {
		b.WriteString("; containerId=" + cid)
	}
	if ds := strings.TrimSpace(ag.DockerScope); ds != "" {
		b.WriteString("; dockerScope=" + ds)
	}
	b.WriteString("\n\nWhen the user asks about security, audit, or concrete host diagnostics and hasActiveTerminalSession is true, you MUST output a concrete task list in the `tasks` field (see protocol) and use service tools to gather facts — not generic advice alone. When all tasks are done or skipped, use replyText as a concise closing summary.")
	return b.String()
}

// buildAgentContextShortLabel returns a one-line label for UI (tool run context, etc.).
func (a *App) buildAgentContextShortLabel(ag AgentContextDTO) string {
	mode := strings.TrimSpace(ag.Mode)
	if a.db == nil || a.db.DB == nil {
		if mode == "" {
			return "App"
		}
		return mode
	}
	switch mode {
	case "connections":
		if pid := strings.TrimSpace(ag.ProfileID); pid != "" {
			var p storage.Profile
			if err := a.db.DB.First(&p, "id = ?", pid).Error; err == nil {
				return fmt.Sprintf("%s — %s@%s:%d", p.Name, p.Username, p.Host, p.Port)
			}
			return "SSH profile " + pid
		}
		return "SSH (no profile)"
	case "docker":
		cid := strings.TrimSpace(ag.ContainerID)
		ds := strings.TrimSpace(ag.DockerScope)
		if cid != "" {
			if ds != "" {
				return "Docker (" + ds + ") · " + cid
			}
			return "Docker · " + cid
		}
		return "Docker"
	default:
		if mode == "" {
			return "App"
		}
		return mode
	}
}

func assistantPayloadMap(parsed aiParsedReply, extra map[string]any) map[string]any {
	out := map[string]any{"replyText": parsed.ReplyText, "service": parsed.Service}
	if len(parsed.Tasks) > 0 {
		out["tasks"] = parsed.Tasks
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

func (a *App) getOpenAIAPIKey() (string, error) {
	if a.secrets == nil {
		return "", errors.New("secrets not ready")
	}
	v, mode, err := a.secrets.GetSecretValue(ai.AppSecretsProfileID, secrets.KindAIAPIKey)
	if err != nil {
		return "", err
	}
	if mode == secrets.StorageNone || strings.TrimSpace(v.Password) == "" {
		return "", errors.New("OpenAI API key not configured")
	}
	return v.Password, nil
}

func (a *App) buildOpenAIMessages(convID string, st AiSettingsDTO, ag AgentContextDTO) ([]ai.ChatMessage, error) {
	rows, err := a.GetAiMessages(convID)
	if err != nil {
		return nil, err
	}
	msgs := []ai.ChatMessage{{Role: "system", Content: ai.SystemPrompt()}}
	if hint := a.buildAgentContextHintText(ag); hint != "" {
		msgs = append(msgs, ai.ChatMessage{Role: "system", Content: hint})
	}
	for _, m := range rows {
		switch m.Role {
		case "user":
			var p struct {
				Text string `json:"text"`
			}
			_ = json.Unmarshal([]byte(m.PayloadJSON), &p)
			if strings.TrimSpace(p.Text) == "" {
				continue
			}
			msgs = append(msgs, ai.ChatMessage{Role: "user", Content: p.Text})
		case "assistant":
			msgs = append(msgs, ai.ChatMessage{Role: "assistant", Content: m.PayloadJSON})
		case "tool":
			msgs = append(msgs, ai.ChatMessage{Role: "user", Content: "[tool_result]\n" + m.PayloadJSON})
		default:
			continue
		}
	}
	msgs = truncateChatMessages(msgs, st.ContextTokenLimit)
	return msgs, nil
}

func estimateTokens(s string) int {
	if s == "" {
		return 0
	}
	return len(s)/4 + 1
}

func truncateChatMessages(msgs []ai.ChatMessage, limit int) []ai.ChatMessage {
	if limit <= 0 {
		limit = ai.DefaultContextTokenLimit
	}
	total := 0
	for _, m := range msgs {
		total += estimateTokens(m.Content) + estimateTokens(m.Role)
	}
	if total <= limit {
		return msgs
	}
	// Keep system + drop oldest non-system until under budget
	if len(msgs) == 0 {
		return msgs
	}
	prefixLen := 0
	for prefixLen < len(msgs) && msgs[prefixLen].Role == "system" {
		prefixLen++
	}
	out := append([]ai.ChatMessage(nil), msgs[:prefixLen]...)
	rest := append([]ai.ChatMessage(nil), msgs[prefixLen:]...)
	for len(rest) > 0 {
		t := 0
		for _, m := range append(out, rest...) {
			t += estimateTokens(m.Content) + 1
		}
		if t <= limit {
			out = append(out, rest...)
			break
		}
		rest = rest[1:]
	}
	return out
}

// aiTestOpenAIConnectionDraft runs a minimal completion using the given settings (may differ from saved DB state).
// If req.ApiKey is empty, the stored key from secrets is used (same rule as Save).
func (a *App) aiTestOpenAIConnectionDraft(req SaveAiSettingsRequest) error {
	if a.db == nil || a.db.DB == nil {
		return errors.New("db not ready")
	}
	s := req.Settings
	if s.IntegrationType != "openai_compatible" {
		return errors.New("AI integration is disabled")
	}
	baseURL := strings.TrimSpace(s.BaseURL)
	model := strings.TrimSpace(s.Model)
	if baseURL == "" {
		return errors.New("baseURL required")
	}
	if model == "" {
		return errors.New("model required")
	}
	var key string
	var err error
	if strings.TrimSpace(req.ApiKey) != "" {
		key = strings.TrimSpace(req.ApiKey)
	} else {
		key, err = a.getOpenAIAPIKey()
		if err != nil {
			return err
		}
	}
	client := ai.NewHTTPClient(45 * time.Second)
	_, _, _, _, err = ai.ChatCompletion(client, key, baseURL, model, []ai.ChatMessage{
		{Role: "user", Content: "Reply with exactly: ok"},
	}, 16, 0)
	return err
}

// AiTestOpenAIConnection verifies saved base URL, model, and API key with a minimal completion.
func (a *App) AiTestOpenAIConnection() error {
	st, err := a.loadAiSettingsDTO()
	if err != nil {
		return err
	}
	return a.aiTestOpenAIConnectionDraft(SaveAiSettingsRequest{Settings: st, ApiKey: ""})
}

// AiTestOpenAIConnectionWithSettings verifies using current form values (unsaved OK). Uses draft API key when non-empty.
func (a *App) AiTestOpenAIConnectionWithSettings(req SaveAiSettingsRequest) error {
	return a.aiTestOpenAIConnectionDraft(req)
}

// AiChat appends the user message, runs the model, executes non-interactive tools, and may return a pending command.
func (a *App) AiChat(req AiChatRequest) (AiChatResponse, error) {
	if a.db == nil || a.db.DB == nil {
		return AiChatResponse{}, errors.New("db not ready")
	}
	st, err := a.loadAiSettingsDTO()
	if err != nil {
		return AiChatResponse{}, err
	}
	if st.IntegrationType != "openai_compatible" {
		return AiChatResponse{}, errors.New("AI integration is disabled (set to OpenAI Compatible in Settings)")
	}
	key, err := a.getOpenAIAPIKey()
	if err != nil {
		return AiChatResponse{}, err
	}
	convID := strings.TrimSpace(req.ConversationID)
	if convID == "" {
		return AiChatResponse{}, errors.New("conversationId required")
	}
	ut := strings.TrimSpace(req.UserText)
	if ut == "" {
		return AiChatResponse{}, errors.New("message is empty")
	}

	uj, _ := json.Marshal(map[string]string{"text": ut})
	if _, err := a.appendAiMessage(convID, "user", string(uj)); err != nil {
		return AiChatResponse{}, err
	}
	_ = a.maybeSetConversationTitle(convID, ut)

	return a.aiRunModelTurn(convID, key, st, req.AgentContext)
}

func (a *App) maybeSetConversationTitle(convID, firstUser string) error {
	var c storage.AiConversation
	if err := a.db.DB.First(&c, "id = ?", convID).Error; err != nil {
		return err
	}
	if strings.TrimSpace(c.Title) != "" {
		return nil
	}
	t := firstUser
	if len([]rune(t)) > 80 {
		t = string([]rune(t)[:80]) + "…"
	}
	return a.db.DB.Model(&storage.AiConversation{}).Where("id = ?", convID).Update("title", t).Error
}

func (a *App) aiRunModelTurn(convID, apiKey string, st AiSettingsDTO, ag AgentContextDTO) (AiChatResponse, error) {
	client := ai.NewHTTPClient(120 * time.Second)
	for round := 0; round < 4; round++ {
		msgs, err := a.buildOpenAIMessages(convID, st, ag)
		if err != nil {
			return AiChatResponse{}, err
		}
		raw, pt, ct, tt, err := ai.ChatCompletion(client, apiKey, st.BaseURL, st.Model, msgs, st.MaxTokensPerRequest, 0.2)
		a.recordAiUsage(st.Model, convID, pt, ct, tt, errString(err))
		if err != nil {
			return AiChatResponse{Error: err.Error()}, nil
		}

		parsed, perr := parseAiReply(raw)
		if perr != nil {
			em := fmt.Sprintf("Invalid model JSON: %v\nRaw:\n%s", perr, truncateStr(raw, 4000))
			b, _ := json.Marshal(map[string]string{"replyText": em, "parseError": perr.Error(), "raw": raw})
			mid, _ := a.appendAiMessage(convID, "assistant", string(b))
			dto, _ := a.messageDTOByID(mid)
			return AiChatResponse{AssistantMessage: dto}, nil
		}

		toolTexts, pendingCmd, _ := a.aiExecuteServiceItems(ag, parsed.Service)

		if pendingCmd != "" {
			payload := assistantPayloadMap(parsed, map[string]any{
				"toolTrace":      toolTexts,
				"phase":          "awaiting_command",
				"pendingCommand": pendingCmd,
			})
			b, err := json.Marshal(payload)
			if err != nil {
				return AiChatResponse{}, err
			}
			mid, err := a.appendAiMessage(convID, "assistant", string(b))
			if err != nil {
				return AiChatResponse{}, err
			}
			dto, _ := a.messageDTOByID(mid)
			return AiChatResponse{
				AssistantMessage: dto,
				PendingCommand:   &AiPendingCommandDTO{AssistantMessageID: mid, Command: pendingCmd},
			}, nil
		}

		if len(toolTexts) == 0 {
			b, err := json.Marshal(assistantPayloadMap(parsed, nil))
			if err != nil {
				return AiChatResponse{}, err
			}
			mid, err := a.appendAiMessage(convID, "assistant", string(b))
			if err != nil {
				return AiChatResponse{}, err
			}
			dto, _ := a.messageDTOByID(mid)
			return AiChatResponse{AssistantMessage: dto}, nil
		}

		// Persist model turn, then feed tool results as the next user message and loop.
		if _, err := a.appendAiMessage(convID, "assistant", raw); err != nil {
			return AiChatResponse{}, err
		}
		follow := "Tool results (JSON/text):\n" + strings.Join(toolTexts, "\n---\n") +
			"\n\nAnswer in JSON with replyText, service (empty array if nothing else is needed), and tasks when you are using a task plan (keep stable task ids; update each status: pending, in_progress, done, or skipped). When no further tools are needed and every task is done or skipped, make replyText a concise closing summary of the whole investigation. If you include tasks and service is empty and you are not proposing a new shell command, do not leave any task in in_progress."
		uj, _ := json.Marshal(map[string]string{"text": follow})
		if _, err := a.appendAiMessage(convID, "user", string(uj)); err != nil {
			return AiChatResponse{}, err
		}
	}
	return AiChatResponse{Error: "too many tool rounds"}, nil
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func parseAiReply(raw string) (aiParsedReply, error) {
	m, err := ai.ParseModelJSON(raw)
	if err != nil {
		return aiParsedReply{}, err
	}
	var out aiParsedReply
	if rt, ok := m["replyText"]; ok {
		_ = json.Unmarshal(rt, &out.ReplyText)
	}
	if sv, ok := m["service"]; ok {
		_ = json.Unmarshal(sv, &out.Service)
	}
	if tv, ok := m["tasks"]; ok && len(tv) > 0 {
		_ = json.Unmarshal(tv, &out.Tasks)
	}
	return out, nil
}

// aiExecuteServiceItems runs file/logs tools; returns trace strings and first pending shell command (if any).
func (a *App) aiExecuteServiceItems(ctx AgentContextDTO, items []aiServiceItemJSON) (traces []string, pendingCmd string, err error) {
	for _, it := range items {
		t := strings.TrimSpace(strings.ToLower(it.Type))
		meta := it.Meta
		if meta == nil {
			meta = map[string]any{}
		}
		switch t {
		case "file":
			s, e := a.aiExecFile(ctx, meta)
			if e != nil {
				traces = append(traces, fmt.Sprintf("[file error] %v", e))
			} else {
				traces = append(traces, fmt.Sprintf("[file]\n%s", truncateStr(s, 120000)))
			}
		case "logs":
			s, e := a.aiExecLogs(ctx, meta)
			if e != nil {
				traces = append(traces, fmt.Sprintf("[logs error] %v", e))
			} else {
				traces = append(traces, fmt.Sprintf("[logs]\n%s", truncateStr(s, 120000)))
			}
		case "command":
			cmd := ""
			if meta != nil {
				if c, ok := meta["command"].(string); ok {
					cmd = strings.TrimSpace(c)
				}
			}
			if cmd != "" && pendingCmd == "" {
				pendingCmd = cmd
			}
		default:
			traces = append(traces, fmt.Sprintf("[unknown service type] %q", it.Type))
		}
	}
	return traces, pendingCmd, nil
}

func (a *App) messageDTOByID(id string) (*AiMessageDTO, error) {
	var m storage.AiMessage
	if err := a.db.DB.First(&m, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &AiMessageDTO{
		ID:             m.ID,
		ConversationID: m.ConversationID,
		Role:           m.Role,
		PayloadJSON:    m.PayloadJSON,
		CreatedAt:      m.CreatedAt.UTC().Format(time.RFC3339),
	}, nil
}

// AiResolveCommand runs or cancels a pending command and appends a tool message, then asks the model for a follow-up reply.
func (a *App) AiResolveCommand(req AiResolveCommandRequest) (AiChatResponse, error) {
	if a.db == nil || a.db.DB == nil {
		return AiChatResponse{}, errors.New("db not ready")
	}
	st, err := a.loadAiSettingsDTO()
	if err != nil {
		return AiChatResponse{}, err
	}
	if st.IntegrationType != "openai_compatible" {
		return AiChatResponse{}, errors.New("AI integration is disabled")
	}
	key, err := a.getOpenAIAPIKey()
	if err != nil {
		return AiChatResponse{}, err
	}
	convID := strings.TrimSpace(req.ConversationID)
	amID := strings.TrimSpace(req.AssistantMessageID)
	if convID == "" || amID == "" {
		return AiChatResponse{}, errors.New("conversationId and assistantMessageId required")
	}

	ctxLabel := a.buildAgentContextShortLabel(req.AgentContext)
	var am storage.AiMessage
	if err := a.db.DB.First(&am, "id = ? AND conversation_id = ?", amID, convID).Error; err != nil {
		return AiChatResponse{}, err
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(am.PayloadJSON), &payload); err != nil {
		return AiChatResponse{}, err
	}
	cmd, _ := payload["pendingCommand"].(string)
	cmd = strings.TrimSpace(cmd)
	if cmd == "" {
		return AiChatResponse{}, errors.New("no pending command on assistant message")
	}

	var toolPayload map[string]any
	if req.Approved {
		out, err := a.aiExecCommand(req.AgentContext, cmd)
		if err != nil {
			toolPayload = map[string]any{"tool": "command", "command": cmd, "error": err.Error(), "output": "", "contextLabel": ctxLabel}
		} else {
			toolPayload = map[string]any{"tool": "command", "command": cmd, "output": truncateStr(out, 200000), "contextLabel": ctxLabel}
		}
	} else {
		toolPayload = map[string]any{"tool": "command", "command": cmd, "cancelled": true, "contextLabel": ctxLabel}
	}
	tb, _ := json.Marshal(toolPayload)
	if _, err := a.appendAiMessage(convID, "tool", string(tb)); err != nil {
		return AiChatResponse{}, err
	}

	return a.aiRunModelTurn(convID, key, st, req.AgentContext)
}
