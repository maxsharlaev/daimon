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
