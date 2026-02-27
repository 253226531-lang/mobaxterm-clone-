package connection

import (
	"fmt"
	"io"
	"sync"
	"time"

	"mobaxterm-clone/internal/config"
)

// Session represents an active terminal connection
type Session interface {
	Write(data []byte) (int, error)
	Close() error
	Resize(cols, rows int) error
}

// Manager handles active connections
type Manager struct {
	sessions map[string]Session
	configs  map[string]config.Config
	mu       sync.RWMutex
	onData   func(sessionID string, data []byte)
	onError  func(sessionID string, err error)
	onClose  func(sessionID string)
}

func NewManager(
	onData func(sessionID string, data []byte),
	onError func(sessionID string, err error),
	onClose func(sessionID string),
) *Manager {
	return &Manager{
		sessions: make(map[string]Session),
		configs:  make(map[string]config.Config),
		onData:   onData,
		onError:  onError,
		onClose:  onClose,
	}
}

// Connect delegates to the specific protocol implementation
func (m *Manager) Connect(cfg config.Config) (string, error) {
	var session Session
	var err error

	switch cfg.Protocol {
	case "ssh":
		session, err = m.connectSSH(cfg)
	case "telnet":
		session, err = m.connectTelnet(cfg)
	case "serial":
		session, err = m.connectSerial(cfg)
	default:
		return "", fmt.Errorf("不支持的协议: %s", cfg.Protocol)
	}

	if err != nil {
		return "", err
	}

	m.mu.Lock()
	m.sessions[cfg.ID] = session
	m.configs[cfg.ID] = cfg
	m.mu.Unlock()

	return cfg.ID, nil
}

func (m *Manager) GetConfig(sessionID string) (config.Config, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	cfg, exists := m.configs[sessionID]
	return cfg, exists
}

func (m *Manager) Write(sessionID string, data []byte) error {
	m.mu.RLock()
	session, exists := m.sessions[sessionID]
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("会话未找到: %s", sessionID)
	}

	_, err := session.Write(data)
	return err
}

func (m *Manager) Resize(sessionID string, cols, rows int) error {
	m.mu.RLock()
	session, exists := m.sessions[sessionID]
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("会话未找到: %s", sessionID)
	}

	return session.Resize(cols, rows)
}

func (m *Manager) Close(sessionID string) error {
	m.mu.Lock()
	session, exists := m.sessions[sessionID]
	if exists {
		delete(m.sessions, sessionID)
		delete(m.configs, sessionID)
	}
	m.mu.Unlock()

	if !exists {
		return fmt.Errorf("会话未找到: %s", sessionID)
	}

	err := session.Close()
	if m.onClose != nil {
		m.onClose(sessionID)
	}
	return err
}

// CloseAll terminates all active sessions safely (useful during app shutdown)
func (m *Manager) CloseAll() {
	m.mu.Lock()
	var sessionsToClose []Session
	for id, sess := range m.sessions {
		sessionsToClose = append(sessionsToClose, sess)
		delete(m.sessions, id)
		delete(m.configs, id)
	}
	m.mu.Unlock()

	// 在锁外调用 Close，避免在网络卡顿时死锁
	for _, sess := range sessionsToClose {
		// 为了简便忽略全局清理时的单独错误
		sess.Close()
	}
}

// pump reads from the reader and sends it to the Wails frontend via the onData callback
func (m *Manager) pump(sessionID string, r io.Reader) {
	buf := make([]byte, 8192)

	for {
		n, err := r.Read(buf)
		if n > 0 {
			if m.onData != nil {
				// 直接传递 buf[:n] 给负责派发的 onData。在 app.go 中它会被转为 string 进而做一次安全拷贝。
				m.onData(sessionID, buf[:n])
			}
		}
		if err != nil {
			if err != io.EOF && m.onError != nil {
				m.onError(sessionID, fmt.Errorf("连接异常中断: %w", err))
			}
			m.Close(sessionID)
			break
		}
	}
}

// --- SFTP Bindings ---

type FileInfo struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	Mode    string `json:"mode"`
	ModTime string `json:"modTime"`
	IsDir   bool   `json:"isDir"`
}

func (m *Manager) ListDirectory(sessionID string, path string) ([]FileInfo, error) {
	m.mu.RLock()
	session, exists := m.sessions[sessionID]
	m.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("会话未找到: %s", sessionID)
	}

	sshSess, ok := session.(*sshSession)
	if !ok {
		return nil, fmt.Errorf("该会话不是SSH连接")
	}

	if sshSess.sftp == nil {
		return nil, fmt.Errorf("该会话的SFTP不可用")
	}

	entries, err := sshSess.sftp.ReadDir(path)
	if err != nil {
		return nil, err
	}

	var files []FileInfo
	for _, e := range entries {
		files = append(files, FileInfo{
			Name:    e.Name(),
			Size:    e.Size(),
			Mode:    e.Mode().String(),
			ModTime: e.ModTime().Format(time.RFC3339),
			IsDir:   e.IsDir(),
		})
	}

	return files, nil
}

func (m *Manager) DownloadFile(sessionID string, remotePath string, localPath string) error {
	m.mu.RLock()
	session, exists := m.sessions[sessionID]
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("会话未找到: %s", sessionID)
	}

	sshSess, ok := session.(*sshSession)
	if !ok {
		return fmt.Errorf("该会话不是SSH连接")
	}

	return sshSess.DownloadFile(remotePath, localPath)
}

func (m *Manager) UploadFile(sessionID string, localPath string, remotePath string) error {
	m.mu.RLock()
	session, exists := m.sessions[sessionID]
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("会话未找到: %s", sessionID)
	}

	sshSess, ok := session.(*sshSession)
	if !ok {
		return fmt.Errorf("该会话不是SSH连接")
	}

	return sshSess.UploadFile(localPath, remotePath)
}

func (m *Manager) DeletePath(sessionID string, path string, isDir bool) error {
	m.mu.RLock()
	session, exists := m.sessions[sessionID]
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("会话未找到: %s", sessionID)
	}

	sshSess, ok := session.(*sshSession)
	if !ok {
		return fmt.Errorf("该会话不是SSH连接")
	}

	return sshSess.DeletePath(path, isDir)
}
