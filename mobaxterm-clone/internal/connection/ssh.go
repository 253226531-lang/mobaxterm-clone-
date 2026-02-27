package connection

import (
	"fmt"
	"io"
	"log"
	"os"

	// Added time import as per instruction
	"mobaxterm-clone/internal/config"

	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// sshSession is our implementation of the Session interface for SSH
type sshSession struct {
	ID      string
	client  *ssh.Client
	session *ssh.Session
	sftp    *sftp.Client
	stdin   io.WriteCloser
	stdout  io.Reader
	// stderr    io.Reader // Removed stderr as it's not in the provided SSHConnection struct
	connected bool
	onData    func(string)
}

func (s *sshSession) Write(data []byte) (int, error) {
	return s.stdin.Write(data)
}

func (s *sshSession) Close() error {
	if s.session != nil {
		s.session.Close()
	}
	if s.sftp != nil { // Close sftp client
		s.sftp.Close()
	}
	if s.client != nil {
		s.client.Close()
	}
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
	sshConfig := &ssh.ClientConfig{
		User:            cfg.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // For a real app, you should prompt to accept the host key
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
		ssh.ECHO:          1,     // enable echoing
		ssh.TTY_OP_ISPEED: 14400, // input speed = 14.4kbaud
		ssh.TTY_OP_OSPEED: 14400, // output speed = 14.4kbaud
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
		onData:    func(data string) { m.onData(cfg.ID, []byte(data)) },
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
		for range ticker.C {
			// Send a global request to check if the connection is still alive
			_, _, err := client.SendRequest("keepalive@openssh.com", true, nil)
			if err != nil {
				return // Connection lost
			}
		}
	}()

	return sshSess, nil
}

// DownloadFile downloads a file from the remote server to the local machine.
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

	_, err = io.Copy(localFile, remoteFile)
	if err != nil {
		return fmt.Errorf("从远程复制文件到本地失败: %w", err)
	}

	return nil
}

// UploadFile uploads a file from the local machine to the remote server.
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

	_, err = io.Copy(remoteFile, localFile)
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
