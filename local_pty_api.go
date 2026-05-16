package main

import "fmt"

func (a *App) LocalShellStart(cols int, rows int, cwd string) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("app context not ready")
	}
	if a.localPTY == nil {
		return "", fmt.Errorf("local shell not ready")
	}
	return a.localPTY.Start(a.ctx, cols, rows, cwd)
}

func (a *App) LocalShellSend(id string, data string) error {
	if a.localPTY == nil {
		return fmt.Errorf("local shell not ready")
	}
	return a.localPTY.Send(id, data)
}

func (a *App) LocalShellResize(id string, cols int, rows int) error {
	if a.localPTY == nil {
		return fmt.Errorf("local shell not ready")
	}
	return a.localPTY.Resize(id, cols, rows)
}

func (a *App) LocalShellStop(id string) error {
	if a.localPTY == nil {
		return fmt.Errorf("local shell not ready")
	}
	return a.localPTY.Stop(id)
}
