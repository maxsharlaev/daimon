package ai

// AppSecretsProfileID is a synthetic profile_id for app-wide secrets (OpenAI API key).
const AppSecretsProfileID = "00000000-0000-0000-0000-000000000001"

const MaxFileReadBytes = 65536

// Default context limits (overridable via settings JSON).
const DefaultContextTokenLimit = 12000
const DefaultSummaryKeepLastMessages = 16
const DefaultMaxTokens = 4096
