package tftp

import (
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
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

// Server handles the built-in TFTP server
type Server struct {
	rootPath   string
	port       int
	server     *tftp.Server
	conn       *net.UDPConn
	isRunning  bool
	mu         sync.Mutex
	onTransfer func(info TransferInfo)
	transfers  []TransferInfo
}

// NewServer creates a new TFTP server instance
func NewServer(onTransfer func(info TransferInfo)) *Server {
	return &Server{
		port:       69,
		onTransfer: onTransfer,
		transfers:  make([]TransferInfo, 0),
	}
}

// Start starts the TFTP server
func (s *Server) Start(rootPath string, port int) error {
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
	s.conn = conn
	s.isRunning = true
	s.mu.Unlock()

	s.server = tftp.NewServer(s.readHandler, s.writeHandler)

	// Start serving in a goroutine
	go func() {
		s.server.Serve(conn)
		log.Printf("TFTP Server stopped")
		s.mu.Lock()
		s.isRunning = false
		s.conn = nil
		s.mu.Unlock()
	}()

	return nil
}

// Stop stops the TFTP server
func (s *Server) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.isRunning || s.conn == nil {
		return
	}

	// Closing the connection will cause Serve to return
	s.conn.Close()
	s.isRunning = false
	s.conn = nil
}

// IsRunning returns the server status
func (s *Server) IsRunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.isRunning
}

// GetRootPath returns the current root path
func (s *Server) GetRootPath() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.rootPath
}

func (s *Server) readHandler(filename string, rf io.ReaderFrom) error {
	s.mu.Lock()
	root := s.rootPath
	s.mu.Unlock()

	path := filepath.Join(root, filename)
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	fi, _ := file.Stat()

	info := TransferInfo{
		Filename:  filename,
		Type:      "READ",
		Status:    "IN_PROGRESS",
		Size:      fi.Size(),
		StartTime: time.Now(),
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

func (s *Server) writeHandler(filename string, wt io.WriterTo) error {
	s.mu.Lock()
	root := s.rootPath
	s.mu.Unlock()

	path := filepath.Join(root, filename)
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()

	info := TransferInfo{
		Filename:  filename,
		Type:      "WRITE",
		Status:    "IN_PROGRESS",
		StartTime: time.Now(),
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
