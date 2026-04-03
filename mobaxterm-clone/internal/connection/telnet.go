package connection

import (
	"fmt"
	"sync"
	"time"

	"mobaxterm-clone/internal/config"

	"github.com/ziutek/telnet"
)

// telnetSession is our implementation of the Session interface for Telnet
type telnetSession struct {
	ID        string
	conn      *telnet.Conn
	closeOnce sync.Once
}

func (s *telnetSession) Write(data []byte) (int, error) {
	s.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	n, err := s.conn.Write(data)
	s.conn.SetWriteDeadline(time.Time{}) // reset
	return n, err
}

// M5 Fix: Use sync.Once to prevent double-close race
func (s *telnetSession) Close() error {
	var err error
	s.closeOnce.Do(func() {
		if s.conn != nil {
			err = s.conn.Close()
		}
	})
	return err
}

func (s *telnetSession) Resize(cols, rows int) error {
	// Implement NAWS (Negotiate About Window Size) - RFC 1073
	// Sequence: IAC SB NAWS <WIDTH_HI> <WIDTH_LO> <HEIGHT_HI> <HEIGHT_LO> IAC SE
	// bytes: 255 250 31 <HI> <LO> <HI> <LO> 255 240
	payload := []byte{
		255, 250, 31,
		byte(cols >> 8), byte(cols & 0xff),
		byte(rows >> 8), byte(rows & 0xff),
		255, 240,
	}
	_, err := s.conn.Write(payload)
	return err
}

// connectTelnet initiates a Telnet connection based on the given configuration
func (m *Manager) connectTelnet(cfg config.Config) (Session, error) {
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	if cfg.Port == 0 {
		addr = fmt.Sprintf("%s:23", cfg.Host)
	}

	conn, err := telnet.DialTimeout("tcp", addr, 10*time.Second)
	if err != nil {
		return nil, fmt.Errorf("无法连接到 Telnet 服务器: %w", err)
	}

	conn.SetUnixWriteMode(true)
	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	conn.SetWriteDeadline(time.Now().Add(10 * time.Second))

	// Notify server that we are willing to negotiate window size (NAWS)
	// Sequence: IAC WILL NAWS (255 251 31)
	conn.Write([]byte{255, 251, 31})

	// Also suggest terminal type if asked (WILL TERMINAL-TYPE: 255 251 24)
	conn.Write([]byte{255, 251, 24})

	conn.SetReadDeadline(time.Time{})
	conn.SetWriteDeadline(time.Time{})

	session := &telnetSession{
		ID:   cfg.ID,
		conn: conn,
	}

	// Start reading from the connection with an auto-resetting deadline wrapper
	go m.pump(cfg.ID, &deadlineReader{conn: conn, timeout: 5 * time.Minute})

	return session, nil
}

// deadlineReader wraps the telnet.Conn to reset the read deadline on every read.
type deadlineReader struct {
	conn    *telnet.Conn
	timeout time.Duration
}

func (r *deadlineReader) Read(p []byte) (n int, err error) {
	r.conn.SetReadDeadline(time.Now().Add(r.timeout))
	n, err = r.conn.Read(p)
	// Do not reset to zero immediately, keep the rolling deadline.
	return n, err
}
