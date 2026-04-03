package connection

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"sync"

	// Added time import as per instruction
	"mobaxterm-clone/internal/config"

	"time"

	"path/filepath"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// sshSession is our implementation of the Session interface for SSH
type sshSession struct {
	ID      string
	client  *ssh.Client
	session *ssh.Session
	sftp    *sftp.Client
	stdin     io.WriteCloser
	stdout    io.Reader
	connected bool
	stopKeep  chan struct{}
	closeOnce sync.Once
}

func (s *sshSession) Write(data []byte) (int, error) {
	return s.stdin.Write(data)
}

func (s *sshSession) Close() error {
	s.closeOnce.Do(func() {
		if s.session != nil {
			s.session.Close()
		}
		if s.sftp != nil { // Close sftp client
			s.sftp.Close()
		}
		if s.client != nil {
			close(s.stopKeep) // Stop the keepalive goroutine
			s.client.Close()
		}
	})
	return nil
}

func (s *sshSession) Resize(cols, rows int) error {
	if s.session != nil {
		return s.session.WindowChange(rows, cols)
	}
	return nil
}

// connectSSH initiates an SSH connection based on the given configuration
func (m *Manager) connectSSH(cfg config.Config) (Session, error) {
	// 1. Decrypt password if present
	var authMethods []ssh.AuthMethod

	// 1a. Load Private Key if present
	if cfg.PrivateKey != "" {
		decryptedKeyPath, err := config.DecryptPassword(cfg.PrivateKey)
		if err != nil {
			return nil, fmt.Errorf("解密私钥记录失败: %w", err)
		}
		
		keyData, err := os.ReadFile(decryptedKeyPath)
		if err != nil {
			keyData = []byte(decryptedKeyPath) // Fallback: it might be the raw PEM content instead of path
		}

		var signer ssh.Signer
		var parseErr error

		if cfg.Password != "" {
			decryptedPass, err := config.DecryptPassword(cfg.Password)
			if err == nil {
				signer, parseErr = ssh.ParsePrivateKeyWithPassphrase(keyData, []byte(decryptedPass))
			}
		} else {
			signer, parseErr = ssh.ParsePrivateKey(keyData)
		}

		if parseErr == nil && signer != nil {
			authMethods = append(authMethods, ssh.PublicKeys(signer))
		} else {
			log.Printf("SSH Key parse error: %v, falling back to password...", parseErr)
		}
	}

	// 1b. Decrypt password if present
	if cfg.Password != "" {
		decrypted, err := config.DecryptPassword(cfg.Password)
		if err != nil {
			return nil, fmt.Errorf("解密密码失败: %w", err)
		}
		// Standard password auth
		authMethods = append(authMethods, ssh.Password(decrypted))

		// Fallback for KeyboardInteractive (some servers/network devices require this)
		authMethods = append(authMethods, ssh.KeyboardInteractive(func(user, instruction string, questions []string, echos []bool) ([]string, error) {
			answers := make([]string, len(questions))
			for i := range questions {
				answers[i] = decrypted
			}
			return answers, nil
		}))
	}

	// 2. Setup SSH client configuration
	configDir, _ := os.UserConfigDir()
	if configDir == "" {
		configDir = "."
	}
	knownHostsPath := filepath.Join(configDir, "MobaXtermClone", "known_hosts")
	os.MkdirAll(filepath.Dir(knownHostsPath), 0755)
	if _, err := os.Stat(knownHostsPath); os.IsNotExist(err) {
		os.WriteFile(knownHostsPath, []byte(""), 0600)
	}

	hostKeyCallback, err := knownhosts.New(knownHostsPath)
	if err != nil {
		// Fallback to strict manual prompt for all keys if known_hosts cannot be read
		hostKeyCallback = func(hostname string, remote net.Addr, key ssh.PublicKey) error {
			fingerprint := ssh.FingerprintSHA256(key)
			if m.onHostKey != nil && m.onHostKey(hostname, fingerprint) {
				// Don't try to write to known_hosts since it previously failed
				return nil
			}
			log.Printf("SSH [SECURITY ERROR]: User rejected unknown host key for %s (%s) (Fallback Mode)", hostname, fingerprint)
			return fmt.Errorf("host key rejected by user")
		}
	} else {
		fallback := hostKeyCallback
		hostKeyCallback = func(hostname string, remote net.Addr, key ssh.PublicKey) error {
			err := fallback(hostname, remote, key)
			if err != nil {
				var keyErr *knownhosts.KeyError
				if errors.As(err, &keyErr) && len(keyErr.Want) == 0 {
					fingerprint := ssh.FingerprintSHA256(key)

					// Use the interactive Wails prompt instead of silent TOFU
					if m.onHostKey != nil && m.onHostKey(hostname, fingerprint) {
						f, openErr := os.OpenFile(knownHostsPath, os.O_APPEND|os.O_WRONLY, 0600)
						if openErr == nil {
							defer f.Close()
							line := knownhosts.Line([]string{knownhosts.Normalize(hostname)}, key)
							f.WriteString(line + "\n")
						}
						return nil
					}

					log.Printf("SSH [SECURITY ERROR]: User rejected unknown host key for %s (%s)", hostname, fingerprint)
					return fmt.Errorf("host key rejected by user")
				}

				log.Printf("SSH [SECURITY ERROR]: Host key mismatch for %s. MITM attack possible!", hostname)
				return err
			}
			return nil
		}
	}

	sshConfig := &ssh.ClientConfig{
		User:            cfg.Username,
		Auth:            authMethods,
		HostKeyCallback: hostKeyCallback,
	}

	address := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)

	// 3. Dial the host
	client, err := ssh.Dial("tcp", address, sshConfig)
	if err != nil {
		return nil, fmt.Errorf("连接SSH服务器失败: %w", err)
	}

	// 4. Create a new session
	session, err := client.NewSession()
	if err != nil {
		client.Close()
		return nil, fmt.Errorf("创建SSH会话失败: %w", err)
	}

	// 5. Setup standard I/O pipes
	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		client.Close()
		return nil, fmt.Errorf("设置标准输入管道失败: %w", err)
	}

	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		client.Close()
		return nil, fmt.Errorf("设置标准输出管道失败: %w", err)
	}

	stderr, err := session.StderrPipe()
	if err != nil {
		session.Close()
		client.Close()
		return nil, fmt.Errorf("设置错误输出管道失败: %w", err)
	}

	// 6. Request a pseudo-terminal (PTY)
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,      // enable echoing
		ssh.VERASE:        8,      // BS (\b / 0x08) 匹配安忨/山鷹等设备退格键期望字符
		ssh.ICRNL:         1,      // translate CR to NL on input
		ssh.IUTF8:         1,      // enable UTF-8 mode
		ssh.TTY_OP_ISPEED: 115200, // input speed
		ssh.TTY_OP_OSPEED: 115200, // output speed
	}

	if err := session.RequestPty("xterm-256color", 24, 80, modes); err != nil {
		session.Close()
		client.Close()
		return nil, fmt.Errorf("请求PTY失败: %w", err)
	}

	// 7. Start the remote shell
	if err := session.Shell(); err != nil {
		session.Close()
		client.Close()
		return nil, fmt.Errorf("启动远程Shell失败: %w", err)
	}

	// Create our session wrapper
	sshSess := &sshSession{
		ID:        cfg.ID,
		client:    client,
		session:   session,
		stdin:     stdin,
		stdout:    stdout,
		connected: true,
		stopKeep:  make(chan struct{}),
	}

	// Initialize SFTP Subsystem
	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		log.Printf("Warning: Failed to start SFTP subsystem for %s: %v", cfg.ID, err)
	} else {
		sshSess.sftp = sftpClient
	}

	// Start pumping output from stdout/stderr to the manager's callbacks
	go m.pump(cfg.ID, stdout)
	go m.pump(cfg.ID, stderr)

	// Start SSH keepalive goroutine
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				// Send a global request to check if the connection is still alive
				_, _, err := client.SendRequest("keepalive@openssh.com", true, nil)
				if err != nil {
					return // Connection lost
				}
			case <-sshSess.stopKeep:
				return // Session closed voluntarily
			}
		}
	}()

	return sshSess, nil
}

// DownloadFile downloads a file from the remote server to the local machine with optimized buffer.
func (s *sshSession) DownloadFile(remotePath, localPath string) error {
	if s.sftp == nil {
		return fmt.Errorf("SFTP客户端未初始化")
	}

	remoteFile, err := s.sftp.Open(remotePath)
	if err != nil {
		return fmt.Errorf("打开远程文件失败 %s: %w", remotePath, err)
	}
	defer remoteFile.Close()

	localFile, err := os.Create(localPath)
	if err != nil {
		return fmt.Errorf("创建本地文件失败 %s: %w", localPath, err)
	}
	defer localFile.Close()

	// Use a 1MB buffer for faster transfers
	buf := make([]byte, 1024*1024)
	_, err = io.CopyBuffer(localFile, remoteFile, buf)
	if err != nil {
		return fmt.Errorf("从远程复制文件到本地失败: %w", err)
	}

	return nil
}

// UploadFile uploads a file from the local machine to the remote server with optimized buffer.
func (s *sshSession) UploadFile(localPath, remotePath string) error {
	if s.sftp == nil {
		return fmt.Errorf("SFTP客户端未初始化")
	}

	localFile, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("打开本地文件失败 %s: %w", localPath, err)
	}
	defer localFile.Close()

	remoteFile, err := s.sftp.Create(remotePath)
	if err != nil {
		return fmt.Errorf("创建远程文件失败 %s: %w", remotePath, err)
	}
	defer remoteFile.Close()

	// Use a 1MB buffer for faster transfers
	buf := make([]byte, 1024*1024)
	_, err = io.CopyBuffer(remoteFile, localFile, buf)
	if err != nil {
		return fmt.Errorf("从本地复制文件到远程失败: %w", err)
	}

	return nil
}

// DeletePath deletes a file or directory on the remote server.
func (s *sshSession) DeletePath(path string, isDir bool) error {
	if s.sftp == nil {
		return fmt.Errorf("SFTP客户端未初始化")
	}

	if isDir {
		return s.sftp.RemoveDirectory(path)
	}
	return s.sftp.Remove(path)
}

// Rename renames a file or directory on the remote server.
func (s *sshSession) Rename(oldPath, newPath string) error {
	if s.sftp == nil {
		return fmt.Errorf("SFTP客户端未初始化")
	}
	return s.sftp.Rename(oldPath, newPath)
}

// CreateDirectory creates a new directory on the remote server.
func (s *sshSession) CreateDirectory(path string) error {
	if s.sftp == nil {
		return fmt.Errorf("SFTP客户端未初始化")
	}
	return s.sftp.Mkdir(path)
}

// Chmod changes the permissions of a file or directory on the remote server.
func (s *sshSession) Chmod(path string, mode os.FileMode) error {
	if s.sftp == nil {
		return fmt.Errorf("SFTP客户端未初始化")
	}
	return s.sftp.Chmod(path, mode)
}

// DownloadDirectory recursively downloads a directory from remote to local.
func (s *sshSession) DownloadDirectory(remoteDir, localDir string) error {
	if s.sftp == nil {
		return fmt.Errorf("SFTP客户端未初始化")
	}

	// Create local directory
	if err := os.MkdirAll(localDir, 0755); err != nil {
		return err
	}

	entries, err := s.sftp.ReadDir(remoteDir)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		remotePath := filepath.ToSlash(filepath.Join(remoteDir, entry.Name()))
		// Fix: Prevent Server-Side Directory Traversal (Zip Slip equivalent) by forcing base name
		safeLocalName := filepath.Base(entry.Name())
		if safeLocalName == "/" || safeLocalName == "." || safeLocalName == ".." {
			continue // Skip dangerous entries entirely
		}
		localPath := filepath.Join(localDir, safeLocalName)

		if entry.IsDir() {
			if err := s.DownloadDirectory(remotePath, localPath); err != nil {
				return err
			}
		} else {
			if err := s.DownloadFile(remotePath, localPath); err != nil {
				return err
			}
		}
	}
	return nil
}

// UploadDirectory recursively uploads a directory from local to remote.
func (s *sshSession) UploadDirectory(localDir, remoteDir string) error {
	if s.sftp == nil {
		return fmt.Errorf("SFTP客户端未初始化")
	}

	// Create remote directory
	if err := s.sftp.MkdirAll(remoteDir); err != nil {
		return err
	}

	entries, err := os.ReadDir(localDir)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		localPath := filepath.Join(localDir, entry.Name())
		// Fix: Prevent Client-Side Directory Traversal on upload
		safeRemoteName := filepath.Base(entry.Name())
		if safeRemoteName == "/" || safeRemoteName == "." || safeRemoteName == ".." {
			continue // Skip dangerous entries
		}
		remotePath := filepath.ToSlash(filepath.Join(remoteDir, safeRemoteName))

		if entry.IsDir() {
			if err := s.UploadDirectory(localPath, remotePath); err != nil {
				return err
			}
		} else {
			if err := s.UploadFile(localPath, remotePath); err != nil {
				return err
			}
		}
	}
	return nil
}
