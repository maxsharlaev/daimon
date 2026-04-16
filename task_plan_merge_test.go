package main

import (
	"testing"
)

func TestMergeTaskPlans_missingIDsBecomeDone(t *testing.T) {
	prev := []aiTaskItemJSON{
		{ID: "a", Title: "A", Status: "in_progress"},
		{ID: "b", Title: "B", Status: "pending"},
	}
	incoming := []aiTaskItemJSON{
		{ID: "a", Title: "A", Status: "done"},
	}
	out := mergeTaskPlans(prev, incoming, true)
	if len(out) != 2 {
		t.Fatalf("len=%d want 2", len(out))
	}
	var seenB bool
	for _, x := range out {
		if x.ID == "b" {
			seenB = true
			if x.Status != "done" {
				t.Fatalf("b status=%q want done", x.Status)
			}
		}
	}
	if !seenB {
		t.Fatal("missing b")
	}
}

func TestMergeTaskPlans_emptyIncomingKeepsPrev(t *testing.T) {
	prev := []aiTaskItemJSON{{ID: "a", Title: "A", Status: "pending"}}
	out := mergeTaskPlans(prev, nil, true)
	if len(out) != 1 || out[0].ID != "a" {
		t.Fatalf("%+v", out)
	}
}

func TestMergeTaskPlans_omittedTasksKeyKeepsPrev(t *testing.T) {
	prev := []aiTaskItemJSON{{ID: "a", Title: "A", Status: "pending"}}
	out := mergeTaskPlans(prev, []aiTaskItemJSON{{ID: "x", Title: "X", Status: "done"}}, false)
	if len(out) != 1 || out[0].ID != "a" {
		t.Fatalf("%+v", out)
	}
}

func TestMergeTaskPlans_stableOrderNewTasksAtEnd(t *testing.T) {
	prev := []aiTaskItemJSON{
		{ID: "1", Title: "Проверка логов cron", Status: "done"},
		{ID: "2", Title: "Проверка файла cron", Status: "done"},
	}
	// Model lists the new active step first (wrong order).
	incoming := []aiTaskItemJSON{
		{ID: "3", Title: "Проверка конфигурации Nginx", Status: "in_progress"},
		{ID: "1", Title: "Проверка логов cron", Status: "done"},
		{ID: "2", Title: "Проверка файла cron", Status: "done"},
	}
	out := mergeTaskPlans(prev, incoming, true)
	if len(out) != 3 {
		t.Fatalf("len=%d want 3: %+v", len(out), out)
	}
	if out[0].ID != "1" || out[1].ID != "2" || out[2].ID != "3" {
		t.Fatalf("order want 1,2,3 got %q %q %q", out[0].ID, out[1].ID, out[2].ID)
	}
	if out[2].Status != "in_progress" {
		t.Fatalf("task 3 status=%q", out[2].Status)
	}
}

func TestUnfinishedTasks_filtersDoneAndSkipped(t *testing.T) {
	in := []aiTaskItemJSON{
		{ID: "a", Title: "A", Status: "done"},
		{ID: "b", Title: "B", Status: "in_progress"},
		{ID: "c", Title: "C", Status: "pending"},
		{ID: "d", Title: "D", Status: "skipped"},
	}
	out := unfinishedTasks(in)
	if len(out) != 2 {
		t.Fatalf("len=%d want 2", len(out))
	}
	if out[0].ID != "b" || out[1].ID != "c" {
		t.Fatalf("unexpected ids: %+v", out)
	}
}

func TestUserMessagePrefixIfUnfinishedPlan_disabledForOrganicTurns(t *testing.T) {
	rows := []AiMessageDTO{
		{Role: "assistant", PayloadJSON: `{"replyText":"x","tasks":[{"id":"a","title":"A","status":"in_progress"}]}`},
		{Role: "user", PayloadJSON: `{"text":"new request"}`},
	}
	if p := userMessagePrefixIfUnfinishedPlan(rows); p != "" {
		t.Fatalf("prefix must be empty, got: %q", p)
	}
}
