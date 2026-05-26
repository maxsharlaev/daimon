package localpty

import (
	"bytes"
	"testing"
)

func TestEmitPrefix_incompleteCSI(t *testing.T) {
	buf := []byte("hello\x1b[31")
	emit, rest := emitPrefix(buf)
	if string(emit) != "hello" || !bytes.Equal(rest, []byte("\x1b[31")) {
		t.Fatalf("emit=%q rest=%q", emit, rest)
	}
}

func TestEmitPrefix_completeLine(t *testing.T) {
	buf := []byte("line one\nline two\n")
	emit, rest := emitPrefix(buf)
	if len(rest) != 0 || string(emit) != string(buf) {
		t.Fatalf("emit=%q rest=%q", emit, rest)
	}
}

func TestEmitPrefix_joinAcrossReads(t *testing.T) {
	var pending []byte
	pending = append(pending, []byte("ok\x1b[")...)
	e1, r1 := emitPrefix(pending)
	pending = r1
	if string(e1) != "ok" {
		t.Fatalf("first emit=%q", e1)
	}
	pending = append(pending, []byte("0mtext")...)
	e2, r2 := emitPrefix(pending)
	if string(e2) != "\x1b[0mtext" || len(r2) != 0 {
		t.Fatalf("second emit=%q rest=%q", e2, r2)
	}
}
