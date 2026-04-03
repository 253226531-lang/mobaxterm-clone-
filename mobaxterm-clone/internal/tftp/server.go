package tftp

import (
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/pin/tftp"
)

// TransferInfo represents a single file transfer record
type TransferInfo struct {
	Filename   string    `json:"filename"`
	RemoteAddr string    `json:"remoteAddr"`
	Type       string    `json:"type"`   // "READ" or "WRITE"
	Status     string    `json:"status"` // "IN_PROGRESS", "COMPLETED", "FAILED"
	Size       int64     `json:"size"`
	StartTime  time.Time `json:"startTime"`
}

// TFTPServer handles the built-in TFTP server
type TFTPServer struct {
	rootPath   string
	port       int
	server     *tftp.Server
	isRunning  bool
	mu         sync.Mutex
	onTransfer func(info TransferInfo)
}

// NewServer creates a new TFTP server instance
func NewServer(onTransfer func(info TransferInfo)) *TFTPServer {
	return &TFTPServer{
		port:       69,
		onTransfer: onTransfer,
	}
}

// Start starts the TFTP server
func (s *TFTPServer) Start(rootPath string, port int) error {
	s.mu.Lock()
	if s.isRunning {
		s.mu.Unlock()
		return fmt.Errorf("TFTP 服务器已经在运行中")
	}

	// Verify root path exists
	if _, err := os.Stat(rootPath); os.IsNotExist(err) {
		s.mu.Unlock()
		return fmt.Errorf("根目录不存在: %s", rootPath)
	}

	// Try to listen on the UDP port first
	addr, err := net.ResolveUDPAddr("udp", fmt.Sprintf(":%d", port))
	if err != nil {
		s.mu.Unlock()
		return fmt.Errorf("解析地址失败: %w", err)
	}

	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		s.mu.Unlock()
		return fmt.Errorf("无法监听 UDP 端口 %d: %w (可能需要管理员权限)", port, err)
	}

	s.rootPath = rootPath
	s.port = port
	s.isRunning = true
	s.server = tftp.NewServer(s.readHandler, s.writeHandler)
	s.mu.Unlock()

	// Start serving in a goroutine
	go func() {
		log.Printf("TFTP Server listening on :%d, root: %s", s.port, s.rootPath)
		s.server.Serve(conn) // This blocks until conn is closed or server is shut down
		log.Printf("TFTP Server stopped")

		s.mu.Lock()
		s.isRunning = false
		s.server = nil
		s.mu.Unlock()
		conn.Close() // Ensure the connection is closed
	}()

	return nil
}

// Stop stops the TFTP server
func (s *TFTPServer) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.isRunning || s.server == nil {
		return
	}

	s.server.Shutdown() // Gracefully shut down the TFTP server
	s.isRunning = false
	s.server = nil
}

// IsRunning returns the server status
func (s *TFTPServer) IsRunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.isRunning
}

// GetRootPath returns the current root path
func (s *TFTPServer) GetRootPath() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.rootPath
}

func (s *TFTPServer) readHandler(filename string, rf io.ReaderFrom) error {
	// C4 Fix: Reject request if we cannot determine remote address
	peer, ok := rf.(tftp.OutgoingTransfer)
	if !ok {
		return fmt.Errorf("TFTP Read denied: unable to determine remote address")
	}
	addr := peer.RemoteAddr()
	remoteAddr := addr.String()
	if addr.IP.String() != "127.0.0.1" && addr.IP.String() != "::1" {
		return fmt.Errorf("TFTP Read denied: Only localhost allowed, got %s", addr.IP.String())
	}

	s.mu.Lock()
	root := s.rootPath
	s.mu.Unlock()

	// C3 Fix: Path Traversal 防护 — 使用 filepath.Abs + filepath.Rel 确保目标路径在根目录内
	absRoot, err := filepath.Abs(filepath.Clean(root))
	if err != nil {
		return fmt.Errorf("无法解析根路径: %w", err)
	}
	absPath, err := filepath.Abs(filepath.Clean(filepath.Join(root, filename)))
	if err != nil {
		return fmt.Errorf("无法解析目标路径: %w", err)
	}
	relPath, err := filepath.Rel(absRoot, absPath)
	if err != nil || strings.HasPrefix(relPath, "..") || filepath.IsAbs(relPath) {
		return fmt.Errorf("非法路径访问被拒绝 (读)")
	}

	file, err := os.Open(absPath)
	if err != nil {
		return err
	}
	defer file.Close()

	fi, _ := file.Stat()

	info := TransferInfo{
		Filename:   filename,
		RemoteAddr: remoteAddr,
		Type:       "READ",
		Status:     "IN_PROGRESS",
		Size:       fi.Size(),
		StartTime:  time.Now(),
	}

	if s.onTransfer != nil {
		s.onTransfer(info)
	}

	n, err := rf.ReadFrom(file)
	if err != nil {
		return err
	}

	log.Printf("%d bytes sent", n)
	return nil
}

func (s *TFTPServer) writeHandler(filename string, wt io.WriterTo) error {
	// C4 Fix: Reject request if we cannot determine remote address
	peer, ok := wt.(tftp.IncomingTransfer)
	if !ok {
		return fmt.Errorf("TFTP Write denied: unable to determine remote address")
	}
	addr := peer.RemoteAddr()
	remoteAddr := addr.String()
	if addr.IP.String() != "127.0.0.1" && addr.IP.String() != "::1" {
		return fmt.Errorf("TFTP Write denied: Only localhost allowed, got %s", addr.IP.String())
	}

	s.mu.Lock()
	root := s.rootPath
	s.mu.Unlock()

	// C3 Fix: Path Traversal 防护 — 使用 filepath.Abs + filepath.Rel 确保目标路径在根目录内
	absRoot, err := filepath.Abs(filepath.Clean(root))
	if err != nil {
		return fmt.Errorf("无法解析根路径: %w", err)
	}
	absPath, err := filepath.Abs(filepath.Clean(filepath.Join(root, filename)))
	if err != nil {
		return fmt.Errorf("无法解析目标路径: %w", err)
	}
	relPath, err := filepath.Rel(absRoot, absPath)
	if err != nil || strings.HasPrefix(relPath, "..") || filepath.IsAbs(relPath) {
		return fmt.Errorf("非法路径访问被拒绝 (写)")
	}

	file, err := os.Create(absPath)
	if err != nil {
		return err
	}
	defer file.Close()

	info := TransferInfo{
		Filename:   filename,
		RemoteAddr: remoteAddr,
		Type:       "WRITE",
		Status:     "IN_PROGRESS",
		StartTime:  time.Now(),
	}

	if s.onTransfer != nil {
		s.onTransfer(info)
	}

	n, err := wt.WriteTo(file)
	if err != nil {
		return err
	}

	log.Printf("%d bytes received", n)
	return nil
}
