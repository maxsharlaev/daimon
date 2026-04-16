package main

import (
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
)

func isDataConnectionBroken(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, driver.ErrBadConn) {
		return true
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	s := strings.ToLower(err.Error())
	for _, k := range []string{
		"connection refused",
		"connection reset",
		"broken pipe",
		"server closed the connection",
		"terminating connection",
		"connection was bad",
		"invalid connection",
		"tls: use of closed connection",
		"bad connection",
		"driver: bad connection",
		"use of closed network connection",
		"unexpected eof",
		"forcibly closed",
		"wsarecv",
		"wsasend",
	} {
		if strings.Contains(s, k) {
			return true
		}
	}
	// Driver-specific TCP wrappers (pq, go-sql-driver/mysql) often include:
	if strings.Contains(s, "read tcp") || strings.Contains(s, "write tcp") {
		return true
	}
	return false
}

func (a *App) dataDropSession(sessionID string) {
	if sessionID == "" {
		return
	}
	a.dataMu.Lock()
	sess := a.dataSessions[sessionID]
	delete(a.dataSessions, sessionID)
	a.dataMu.Unlock()
	if sess != nil {
		a.dataCloseSessionLocked(sess)
	}
}

// dataErrAfterMaybeInvalidate removes the data session when err indicates a dead transport/DB connection.
func (a *App) dataErrAfterMaybeInvalidate(sessionID string, err error) error {
	if err == nil {
		return nil
	}
	if isDataConnectionBroken(err) {
		a.dataDropSession(sessionID)
		return fmt.Errorf("data connection lost: %w", err)
	}
	return err
}
