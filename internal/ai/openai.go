package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ChatMessage is one message for OpenAI-compatible chat completions.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatCompletionRequest is sent to POST {base}/chat/completions.
type ChatCompletionRequest struct {
	Model       string          `json:"model"`
	Messages    []ChatMessage   `json:"messages"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
	Temperature float64         `json:"temperature,omitempty"`
}

type chatCompletionResponse struct {
	ID      string `json:"id"`
	Choices []struct {
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error"`
}

// ChatCompletion calls an OpenAI-compatible API. baseURL should be like https://api.openai.com/v1 (no trailing slash).
func ChatCompletion(httpClient *http.Client, apiKey, baseURL, model string, messages []ChatMessage, maxTokens int, temperature float64) (content string, promptTokens, completionTokens, totalTokens int, err error) {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		return "", 0, 0, 0, fmt.Errorf("base URL required")
	}
	url := base + "/chat/completions"
	body := ChatCompletionRequest{
		Model:       model,
		Messages:    messages,
		MaxTokens:   maxTokens,
		Temperature: temperature,
	}
	if body.Temperature == 0 {
		body.Temperature = 0.2
	}
	b, err := json.Marshal(body)
	if err != nil {
		return "", 0, 0, 0, err
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return "", 0, 0, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", 0, 0, 0, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", 0, 0, 0, fmt.Errorf("openai http %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var out chatCompletionResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", 0, 0, 0, fmt.Errorf("decode response: %w", err)
	}
	if out.Error != nil && out.Error.Message != "" {
		return "", 0, 0, 0, fmt.Errorf("api error: %s", out.Error.Message)
	}
	if len(out.Choices) == 0 {
		return "", 0, 0, 0, fmt.Errorf("no choices in response")
	}
	content = strings.TrimSpace(out.Choices[0].Message.Content)
	pt := out.Usage.PromptTokens
	ct := out.Usage.CompletionTokens
	tt := out.Usage.TotalTokens
	return content, pt, ct, tt, nil
}

// NewHTTPClient returns a client with timeout for LLM calls.
func NewHTTPClient(timeout time.Duration) *http.Client {
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	return &http.Client{Timeout: timeout}
}
