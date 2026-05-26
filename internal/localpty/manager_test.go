package localpty

import "testing"

func TestAppendOutputTrim(t *testing.T) {
	m := NewManager(nil)
	id := "test"
	m.mu.Lock()
	m.shells[id] = &session{id: id, closed: make(chan struct{})}
	m.mu.Unlock()

	chunk := make([]byte, maxShellOutputBuf+1000)
	m.appendOutput(id, chunk)

	m.mu.Lock()
	got := m.shells[id].outputBuf.Len()
	m.mu.Unlock()
	if got != maxShellOutputBuf {
		t.Fatalf("buffer len %d want %d", got, maxShellOutputBuf)
	}

	out, err := m.Replay(id)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != maxShellOutputBuf {
		t.Fatalf("replay len %d want %d", len(out), maxShellOutputBuf)
	}

	outB64, err := m.ReplayB64(id)
	if err != nil {
		t.Fatal(err)
	}
	if outB64 == "" {
		t.Fatal("expected base64 replay")
	}
}
