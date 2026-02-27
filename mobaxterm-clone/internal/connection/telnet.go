package connection

import (
	"fmt"
	"time"

	"mobaxterm-clone/internal/config"

	"github.com/ziutek/telnet"
)

// telnetSession is our implementation of the Session interface for Telnet
type telnetSession struct {
	ID     string
	conn   *telnet.Conn
	onData func(string)
}

func (s *telnetSession) Write(data []byte) (int, error) {
	return s.conn.Write(data)
}

func (s *telnetSession) Close() error {
	if s.conn != nil {
		return s.conn.Close()
	}
	return nil
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

	// Basic telnet negotiation
	conn.SetUnixWriteMode(true)

	// Notify server that we are willing to negotiate window size (NAWS)
	// Sequence: IAC WILL NAWS (255 251 31)
	conn.Write([]byte{255, 251, 31})

	// Also suggest terminal type if asked (WILL TERMINAL-TYPE: 255 251 24)
	conn.Write([]byte{255, 251, 24})

	session := &telnetSession{
		ID:   cfg.ID,
		conn: conn,
	}

	// Start reading from the connection
	go m.pump(cfg.ID, conn)

	return session, nil
}
