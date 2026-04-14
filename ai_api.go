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

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const aiSettingsKey = "ai:settings"

// AiSettingsDTO is persisted (except api key; ApiKeySet indicates a stored key exists).
type AiSettingsDTO struct {
	IntegrationType         string `json:"integrationType"` // none | openai_compatible
	BaseURL                 string `json:"baseURL"`
	Model                   string `json:"model"`
	PreferredLanguage       string `json:"preferredLanguage"`
	MaxTokensPerRequest     int    `json:"maxTokensPerRequest"`
	ContextTokenLimit       int    `json:"contextTokenLimit"`
	SummaryKeepLastMessages int    `json:"summaryKeepLastMessages"`
	ApiKeySet               bool   `json:"apiKeySet"`
}

// SaveAiSettingsRequest updates AI settings; ApiKey is optional (empty = leave unchanged).
type SaveAiSettingsRequest struct {
	Settings AiSettingsDTO `json:"settings"`
	ApiKey   string        `json:"apiKey"`
}

func defaultAiSettings() AiSettingsDTO {
	return AiSettingsDTO{
		IntegrationType:         "none",
		BaseURL:                 "https://api.openai.com/v1",
		Model:                   "gpt-4o-mini",
		PreferredLanguage:       "",
		MaxTokensPerRequest:     4096,
		ContextTokenLimit:       ai.DefaultContextTokenLimit,
		SummaryKeepLastMessages: ai.DefaultSummaryKeepLastMessages,
	}
}

func (a *App) loadAiSettingsDTO() (AiSettingsDTO, error) {
	out := defaultAiSettings()
	if a.db == nil || a.db.DB == nil {
		return out, errors.New("db not ready")
	}
	var st storage.AppSetting
	err := a.db.DB.First(&st, "key = ?", aiSettingsKey).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if strings.TrimSpace(st.ValueJSON) == "" || st.ValueJSON == "{}" {
		return out, nil
	}
	if err := json.Unmarshal([]byte(st.ValueJSON), &out); err != nil {
		return defaultAiSettings(), err
	}
	// merge defaults for zero fields
	d := defaultAiSettings()
	if out.BaseURL == "" {
		out.BaseURL = d.BaseURL
	}
	if out.Model == "" {
		out.Model = d.Model
	}
	if out.MaxTokensPerRequest <= 0 {
		out.MaxTokensPerRequest = d.MaxTokensPerRequest
	}
	if out.ContextTokenLimit <= 0 {
		out.ContextTokenLimit = d.ContextTokenLimit
	}
	if out.SummaryKeepLastMessages <= 0 {
		out.SummaryKeepLastMessages = d.SummaryKeepLastMessages
	}
	return out, nil
}

func (a *App) aiSettingsApiKeyPresent() bool {
	if a.secrets == nil {
		return false
	}
	sr, err := a.secrets.GetSecretRef(ai.AppSecretsProfileID, secrets.KindAIAPIKey)
	if err != nil || sr.Storage == string(secrets.StorageNone) {
		return false
	}
	return strings.TrimSpace(sr.Ref) != "" || sr.Storage == string(secrets.StorageKeyring) || sr.Storage == string(secrets.StorageInternal)
}

// GetAiSettings returns current AI integration settings (never returns the API key).
func (a *App) GetAiSettings() (AiSettingsDTO, error) {
	st, err := a.loadAiSettingsDTO()
	if err != nil {
		return AiSettingsDTO{}, err
	}
	st.ApiKeySet = a.aiSettingsApiKeyPresent()
	return st, nil
}

// SaveAiSettings persists settings and optionally updates the API key in the OS keyring / vault.
func (a *App) SaveAiSettings(req SaveAiSettingsRequest) error {
	if a.db == nil || a.db.DB == nil {
		return errors.New("db not ready")
	}
	if a.secrets == nil {
		return errors.New("secrets not ready")
	}
	s := req.Settings
	if s.IntegrationType != "none" && s.IntegrationType != "openai_compatible" {
		return errors.New("invalid integrationType")
	}
	if s.IntegrationType == "openai_compatible" {
		if strings.TrimSpace(s.BaseURL) == "" {
			return errors.New("baseURL required")
		}
		if strings.TrimSpace(s.Model) == "" {
			return errors.New("model required")
		}
	}
	s.PreferredLanguage = strings.TrimSpace(s.PreferredLanguage)
	if len([]rune(s.PreferredLanguage)) > 80 {
		s.PreferredLanguage = string([]rune(s.PreferredLanguage)[:80])
	}
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	var st storage.AppSetting
	err = a.db.DB.First(&st, "key = ?", aiSettingsKey).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		st = storage.AppSetting{Key: aiSettingsKey, ValueJSON: string(b)}
		if err := a.db.DB.Create(&st).Error; err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else {
		st.ValueJSON = string(b)
		if err := a.db.DB.Save(&st).Error; err != nil {
			return err
		}
	}
	if strings.TrimSpace(req.ApiKey) != "" {
		if err := a.secrets.PutSecretValue(ai.AppSecretsProfileID, secrets.KindAIAPIKey, secrets.StorageKeyring, "", secrets.SecretValue{Password: req.ApiKey}, "{}"); err != nil {
			return fmt.Errorf("store api key: %w", err)
		}
	}
	return nil
}

// AiConversationListDTO is one row for UI / Privacy lists.
type AiConversationListDTO struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	UpdatedAt string `json:"updatedAt"`
	ByteSize  int64  `json:"byteSize"`
}

// ListAiConversations returns all AI conversations with approximate total byte size.
func (a *App) ListAiConversations() ([]AiConversationListDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return nil, errors.New("db not ready")
	}
	var rows []storage.AiConversation
	if err := a.db.DB.Order("updated_at DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]AiConversationListDTO, 0, len(rows))
	for _, c := range rows {
		var sum int64
		_ = a.db.DB.Model(&storage.AiMessage{}).Where("conversation_id = ?", c.ID).Select("COALESCE(SUM(byte_size),0)").Scan(&sum).Error
		out = append(out, AiConversationListDTO{
			ID:        c.ID,
			Title:     c.Title,
			UpdatedAt: c.UpdatedAt.UTC().Format(time.RFC3339),
			ByteSize:  sum,
		})
	}
	return out, nil
}

// CreateAiConversation starts a new empty conversation.
func (a *App) CreateAiConversation(title string) (string, error) {
	if a.db == nil || a.db.DB == nil {
		return "", errors.New("db not ready")
	}
	t := strings.TrimSpace(title)
	c := storage.AiConversation{Title: t}
	if err := a.db.DB.Create(&c).Error; err != nil {
		return "", err
	}
	return c.ID, nil
}

// DeleteAiConversation removes a conversation and its messages.
func (a *App) DeleteAiConversation(conversationId string) error {
	if a.db == nil || a.db.DB == nil {
		return errors.New("db not ready")
	}
	if conversationId == "" {
		return errors.New("conversationId required")
	}
	return a.db.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("conversation_id = ?", conversationId).Delete(&storage.AiMessage{}).Error; err != nil {
			return err
		}
		return tx.Delete(&storage.AiConversation{}, "id = ?", conversationId).Error
	})
}

// AiMessageDTO is stored message shape for the frontend.
type AiMessageDTO struct {
	ID             string `json:"id"`
	ConversationID string `json:"conversationId"`
	Role           string `json:"role"`
	PayloadJSON    string `json:"payloadJson"`
	CreatedAt      string `json:"createdAt"`
}

// GetAiMessages loads messages for a conversation (chronological).
func (a *App) GetAiMessages(conversationId string) ([]AiMessageDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return nil, errors.New("db not ready")
	}
	var rows []storage.AiMessage
	if err := a.db.DB.Where("conversation_id = ?", conversationId).Order("created_at ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]AiMessageDTO, 0, len(rows))
	for _, m := range rows {
		out = append(out, AiMessageDTO{
			ID:             m.ID,
			ConversationID: m.ConversationID,
			Role:           m.Role,
			PayloadJSON:    m.PayloadJSON,
			CreatedAt:      m.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	return out, nil
}

// AiUsagePointDTO is one bucket for the usage chart (e.g. one day).
type AiUsagePointDTO struct {
	Day         string `json:"day"` // YYYY-MM-DD
	TotalTokens int    `json:"totalTokens"`
}

// AiUsageSeries returns per-day total token sums for the last `days` days.
func (a *App) AiUsageSeries(days int) ([]AiUsagePointDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return nil, errors.New("db not ready")
	}
	if days <= 0 {
		days = 30
	}
	if days > 366 {
		days = 366
	}
	since := time.Now().UTC().AddDate(0, 0, -days)
	var rows []struct {
		Day   string
		Total int
	}
	// SQLite: date(created_at)
	err := a.db.DB.Raw(`
SELECT date(created_at) AS day, COALESCE(SUM(total_tokens), 0) AS total
FROM ai_usage_events
WHERE created_at >= ?
GROUP BY date(created_at)
ORDER BY day ASC
`, since).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]AiUsagePointDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, AiUsagePointDTO{Day: r.Day, TotalTokens: r.Total})
	}
	return out, nil
}

func (a *App) appendAiMessage(convID, role, payloadJSON string) (string, error) {
	payloadJSON = strings.TrimSpace(payloadJSON)
	if payloadJSON == "" {
		payloadJSON = "{}"
	}
	m := storage.AiMessage{
		ConversationID: convID,
		Role:           role,
		PayloadJSON:    payloadJSON,
		ByteSize:       len(payloadJSON),
	}
	m.ID = uuid.NewString()
	if err := a.db.DB.Create(&m).Error; err != nil {
		return "", err
	}
	_ = a.db.DB.Model(&storage.AiConversation{}).Where("id = ?", convID).Update("updated_at", time.Now().UTC()).Error
	return m.ID, nil
}

func (a *App) recordAiUsage(model string, convID string, prompt, completion, total int, errStr string) {
	if a.db == nil || a.db.DB == nil {
		return
	}
	ev := storage.AiUsageEvent{
		Model:            model,
		PromptTokens:     prompt,
		CompletionTokens: completion,
		TotalTokens:      total,
		ConversationID:   convID,
		Error:            errStr,
	}
	ev.ID = uuid.NewString()
	_ = a.db.DB.Create(&ev).Error
}
