package main

import "testing"

func TestMutationDeletePreviewSQL(t *testing.T) {
	c, s, ok := mutationDeletePreviewSQL("DELETE FROM users WHERE id > 10", 100)
	if !ok {
		t.Fatal("expected ok")
	}
	if c != "SELECT COUNT(*) FROM users WHERE id > 10" {
		t.Errorf("count: %q", c)
	}
	if s != "SELECT * FROM users WHERE id > 10 LIMIT 100" {
		t.Errorf("sample: %q", s)
	}
}

func TestMutationUpdatePreviewSQL(t *testing.T) {
	c, s, ok := mutationUpdatePreviewSQL("UPDATE t SET a = 1 WHERE b = 2", 50)
	if !ok {
		t.Fatal("expected ok")
	}
	if c != "SELECT COUNT(*) FROM t WHERE b = 2" {
		t.Errorf("count: %q", c)
	}
	if s != "SELECT * FROM t WHERE b = 2 LIMIT 50" {
		t.Errorf("sample: %q", s)
	}
}
