package main

import (
	"io"
	"net"
	"strconv"
	"sync"

	"golang.org/x/crypto/ssh"
)

// sshTunnel implements local TCP listen -> ssh.Client.Dial to remote host:port (ssh -L semantics).
type sshTunnel struct {
	listener net.Listener
	wg       sync.WaitGroup
	once     sync.Once
}

func startSSHTunnel(client *ssh.Client, remoteHost string, remotePort int) (*sshTunnel, error) {
	if remoteHost == "" {
		remoteHost = "127.0.0.1"
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	t := &sshTunnel{listener: ln}
	t.wg.Add(1)
	go t.acceptLoop(client, remoteHost, remotePort)
	return t, nil
}

func (t *sshTunnel) acceptLoop(client *ssh.Client, remoteHost string, remotePort int) {
	defer t.wg.Done()
	for {
		conn, err := t.listener.Accept()
		if err != nil {
			return
		}
		t.wg.Add(1)
		go func(c net.Conn) {
			defer t.wg.Done()
			defer c.Close()
			raddr := net.JoinHostPort(remoteHost, strconv.Itoa(remotePort))
			rconn, err := client.Dial("tcp", raddr)
			if err != nil {
				return
			}
			defer rconn.Close()
			var wg sync.WaitGroup
			wg.Add(2)
			go func() {
				defer wg.Done()
				_, _ = io.Copy(rconn, c)
			}()
			go func() {
				defer wg.Done()
				_, _ = io.Copy(c, rconn)
			}()
			wg.Wait()
		}(conn)
	}
}

func (t *sshTunnel) LocalAddr() net.Addr {
	if t == nil || t.listener == nil {
		return nil
	}
	return t.listener.Addr()
}

func (t *sshTunnel) Close() error {
	var err error
	t.once.Do(func() {
		if t.listener != nil {
			err = t.listener.Close()
		}
	})
	t.wg.Wait()
	return err
}
