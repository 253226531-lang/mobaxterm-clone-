package connection

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"sync"

	"github.com/armon/go-socks5"
	"golang.org/x/crypto/ssh"
	"mobaxterm-clone/internal/config"
)

type TunnelConfig struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"`        // "Local", "Remote", "Dynamic"
	LocalParam  string `json:"localParam"`  // e.g., "127.0.0.1:8080"
	RemoteParam string `json:"remoteParam"` // e.g., "10.0.0.2:80"
	
	// SSH Server Config
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	PrivateKey  string `json:"privateKey"`
}

type TunnelInstance struct {
	Config   TunnelConfig
	Client   *ssh.Client
	Listener net.Listener
	StopChan chan struct{}
}

type TunnelManager struct {
	mu      sync.RWMutex
	tunnels map[string]*TunnelInstance
}

func NewTunnelManager() *TunnelManager {
	return &TunnelManager{
		tunnels: make(map[string]*TunnelInstance),
	}
}

func (tm *TunnelManager) createSSHClient(cfg TunnelConfig) (*ssh.Client, error) {
	var authMethods []ssh.AuthMethod

	if cfg.PrivateKey != "" {
		decryptedKeyPath, err := config.DecryptPassword(cfg.PrivateKey)
		if err == nil {
			keyData, err := os.ReadFile(decryptedKeyPath)
			if err != nil {
				keyData = []byte(decryptedKeyPath)
			}
			var signer ssh.Signer
			if cfg.Password != "" {
				decryptedPass, _ := config.DecryptPassword(cfg.Password)
				signer, _ = ssh.ParsePrivateKeyWithPassphrase(keyData, []byte(decryptedPass))
			} else {
				signer, _ = ssh.ParsePrivateKey(keyData)
			}
			if signer != nil {
				authMethods = append(authMethods, ssh.PublicKeys(signer))
			}
		}
	}

	if cfg.Password != "" {
		decrypted, err := config.DecryptPassword(cfg.Password)
		if err == nil {
			authMethods = append(authMethods, ssh.Password(decrypted))
			authMethods = append(authMethods, ssh.KeyboardInteractive(func(user, instruction string, questions []string, echos []bool) ([]string, error) {
				answers := make([]string, len(questions))
				for i := range questions {
					answers[i] = decrypted
				}
				return answers, nil
			}))
		}
	}

	sshConfig := &ssh.ClientConfig{
		User:            cfg.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // For tunnels, we skip tofu for simplicity in this version
	}

	address := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	return ssh.Dial("tcp", address, sshConfig)
}

func (tm *TunnelManager) StartTunnel(cfg TunnelConfig) error {
	tm.mu.Lock()
	if _, exists := tm.tunnels[cfg.ID]; exists {
		tm.mu.Unlock()
		return fmt.Errorf("隧道已存在且正在运行")
	}
	tm.mu.Unlock()

	client, err := tm.createSSHClient(cfg)
	if err != nil {
		return fmt.Errorf("无法连接到 SSH 宿主机: %w", err)
	}

	instance := &TunnelInstance{
		Config:   cfg,
		Client:   client,
		StopChan: make(chan struct{}),
	}

	errChan := make(chan error, 1)

	switch cfg.Type {
	case "Local":
		go func() {
			errChan <- tm.startLocalForwarding(instance)
		}()
	case "Remote":
		go func() {
			errChan <- tm.startRemoteForwarding(instance)
		}()
	case "Dynamic":
		go func() {
			errChan <- tm.startDynamicForwarding(instance)
		}()
	default:
		client.Close()
		return fmt.Errorf("不支持的隧道类型: %s", cfg.Type)
	}

	// Wait briefly to see if listener failed immediately
	select {
	case err := <-errChan:
		client.Close()
		return fmt.Errorf("隧道启动失败: %w", err)
	case <-instance.StopChan:
	}

	tm.mu.Lock()
	tm.tunnels[cfg.ID] = instance
	tm.mu.Unlock()

	return nil
}

func (tm *TunnelManager) startLocalForwarding(inst *TunnelInstance) error {
	listener, err := net.Listen("tcp", inst.Config.LocalParam)
	if err != nil {
		return err
	}
	inst.Listener = listener
	close(inst.StopChan) // Signal that startup succeeded
	inst.StopChan = make(chan struct{}) // Recreate for teardown

	go func() {
		<-inst.StopChan
		listener.Close()
	}()

	for {
		localConn, err := listener.Accept()
		if err != nil {
			return err
		}
		go func() {
			defer localConn.Close()
			remoteConn, err := inst.Client.Dial("tcp", inst.Config.RemoteParam)
			if err != nil {
				log.Printf("Local Forward Dial failed: %v", err)
				return
			}
			defer remoteConn.Close()

			go io.Copy(localConn, remoteConn)
			io.Copy(remoteConn, localConn)
		}()
	}
}

func (tm *TunnelManager) startRemoteForwarding(inst *TunnelInstance) error {
	listener, err := inst.Client.Listen("tcp", inst.Config.RemoteParam)
	if err != nil {
		return err
	}
	inst.Listener = listener
	close(inst.StopChan)
	inst.StopChan = make(chan struct{})

	go func() {
		<-inst.StopChan
		listener.Close()
	}()

	for {
		remoteConn, err := listener.Accept()
		if err != nil {
			return err
		}
		go func() {
			defer remoteConn.Close()
			localConn, err := net.Dial("tcp", inst.Config.LocalParam)
			if err != nil {
				log.Printf("Remote Forward Local Dial failed: %v", err)
				return
			}
			defer localConn.Close()

			go io.Copy(remoteConn, localConn)
			io.Copy(localConn, remoteConn)
		}()
	}
}

func (tm *TunnelManager) startDynamicForwarding(inst *TunnelInstance) error {
	listener, err := net.Listen("tcp", inst.Config.LocalParam)
	if err != nil {
		return err
	}
	inst.Listener = listener
	close(inst.StopChan)
	inst.StopChan = make(chan struct{})

	go func() {
		<-inst.StopChan
		listener.Close()
	}()

	// Create a SOCKS5 server using go-socks5 that dials through SSH client
	conf := &socks5.Config{
		Dial: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return inst.Client.Dial(network, addr)
		},
	}
	server, err := socks5.New(conf)
	if err != nil {
		return err
	}

	return server.Serve(listener)
}

func (tm *TunnelManager) StopTunnel(id string) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	if inst, exists := tm.tunnels[id]; exists {
		if inst.StopChan != nil {
			close(inst.StopChan)
		}
		if inst.Client != nil {
			inst.Client.Close()
		}
		delete(tm.tunnels, id)
	}
}

func (tm *TunnelManager) StopAll() {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	for id, inst := range tm.tunnels {
		if inst.StopChan != nil {
			close(inst.StopChan)
		}
		if inst.Client != nil {
			inst.Client.Close()
		}
		delete(tm.tunnels, id)
	}
}
