package main

import (
	"reflect"
	"testing"
)

func TestParseMySQLTSV(t *testing.T) {
	cols, rows, err := parseMySQLTSV("")
	if err != nil || cols != nil || rows != nil {
		t.Errorf("empty: err=%v cols=%v rows=%v", err, cols, rows)
	}
	cols, rows, err = parseMySQLTSV("  \n")
	if err != nil || cols != nil || rows != nil {
		t.Errorf("whitespace: err=%v cols=%v rows=%v", err, cols, rows)
	}
	cols, rows, err = parseMySQLTSV("a\tb")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cols, []string{"a", "b"}) || len(rows) != 0 {
		t.Errorf("header only: cols=%q rows=%v", cols, rows)
	}
	cols, rows, err = parseMySQLTSV("a\tb\n1\t2")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cols, []string{"a", "b"}) || !reflect.DeepEqual(rows, [][]string{{"1", "2"}}) {
		t.Errorf("two lines: cols=%q rows=%v", cols, rows)
	}
	// UTF-8 column names and cells (mysql -B with first line = real headers)
	utf8 := "имя\tкод\nПривет\t42"
	cols, rows, err = parseMySQLTSV(utf8)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cols, []string{"имя", "код"}) || !reflect.DeepEqual(rows, [][]string{{"Привет", "42"}}) {
		t.Errorf("utf8: cols=%q rows=%v", cols, rows)
	}
}
