package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"mobaxterm-clone/internal/config"
	"mobaxterm-clone/internal/connection"
	"mobaxterm-clone/internal/db"
	"mobaxterm-clone/internal/tftp"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.bug.st/serial"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

// CommandBuffer is a thread-safe wrapper around strings.Builder
type CommandBuffer struct {
	mu      sync.Mutex
	builder strings.Builder
}

// SessionDecoder maintains state for streaming text decoding
type SessionDecoder struct {
	mu       sync.Mutex
	decoder  transform.Transformer
	leftover []byte
}

func (s *SessionDecoder) Decode(data []byte) string {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.leftover) > 0 {
		data = append(s.leftover, data...)
		s.leftover = nil
	}

	// 1 GBK char is max 2 bytes, which decodes to max 3 bytes in UTF-8.
	// So len(data)*2 is generally enough to hold UTF-8 representation.
	dst := make([]byte, len(data)*2)
	nDst := 0
	nSrc := 0
	var err error

	// A3 Fix: Loop to handle ErrShortDst and dynamically grow buffer if needed
	for {
		nDst, nSrc, err = s.decoder.Transform(dst, data, false)

		if err == transform.ErrShortDst {
			// Destination buffer is too small, grow it and try again
			newDst := make([]byte, len(dst)*2)
			copy(newDst, dst) // Copy existing data to the new, larger buffer
			dst = newDst
			continue
		}

		break
	}

	if err == transform.ErrShortSrc {
		// Needs more bytes to complete a multi-byte character
		// Optimization: Allocate an exact-sized buffer to hold the leftover bytes instead of append-resizing
		s.leftover = make([]byte, len(data[nSrc:]))
		copy(s.leftover, data[nSrc:])
	} else if err != nil && err != transform.ErrShortDst {
		// Other errors: drop leftover to avoid infinite stuck
		s.leftover = nil // Only discard on true unrecoverable errors
	}

	return string(dst[:nDst])
}

// App struct
type App struct {
	ctx        context.Context
	manager    *connection.Manager
	db         *db.Database
	cmdBuffers sync.Map // Map[sessionID]*CommandBuffer
	decoders   sync.Map // Map[sessionID]*SessionDecoder
	macroLocks sync.Map // Map[sessionID]*sync.Mutex (E4 Fix)
	tftpServer *tftp.TFTPServer
	tunnelMgr  *connection.TunnelManager
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Initialize Database in the user configuration directory
	configDir, err := os.UserConfigDir()
	if err != nil {
		configDir = "."
	}
	dbPath := filepath.Join(configDir, "MobaXtermClone", "data", "knowledge.db")
	database, err := db.InitDB(dbPath)
	if err != nil {
		fmt.Printf("数据库初始化失败: %v\n", err)
	} else {
		a.db = database
	}

	// Initialize the connection manager
	a.manager = connection.NewManager(
		// onData callback (receives data from SSH/Telnet/Serial and sends to frontend via event)
		func(sessionID string, data []byte) {
			output := string(data)

			// Handle encoding conversion if needed
			if a.manager != nil {
				if cfg, ok := a.manager.GetConfig(sessionID); ok && cfg.Encoding == "GBK" {
					val, _ := a.decoders.LoadOrStore(sessionID, &SessionDecoder{
						decoder: simplifiedchinese.GBK.NewDecoder(),
					})
					sd := val.(*SessionDecoder)
					output = sd.Decode(data)
				}
			}

			runtime.EventsEmit(a.ctx, "terminal-output-"+sessionID, output)
		},
		// onError callback
		func(sessionID string, err error) {
			runtime.EventsEmit(a.ctx, "terminal-error-"+sessionID, err.Error())
		},
		// onClose callback
		func(sessionID string) {
			a.cmdBuffers.Delete(sessionID)
			a.decoders.Delete(sessionID)
			a.macroLocks.Delete(sessionID) // Clean up macro lock
			runtime.EventsEmit(a.ctx, "terminal-closed-"+sessionID)
		},
		// onHostKey callback
		func(hostname, fingerprint string) bool {
			resp, _ := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
				Type:          runtime.QuestionDialog,
				Title:         "未知主机密钥",
				Message:       fmt.Sprintf("警告：您正在连接到一个未知的主机 (%s)。\n密钥指纹为：\n%s\n\n是否信任该指纹并继续连接？", hostname, fingerprint),
				DefaultButton: "No",
			})
			return resp == "Yes"
		},
	)

	// Initialize TFTP Server
	a.tftpServer = tftp.NewServer(func(info tftp.TransferInfo) {
		runtime.EventsEmit(a.ctx, "tftp-transfer", info)
	})

	// Initialize SSH Tunnels Manager
	a.tunnelMgr = connection.NewTunnelManager()
}

// beforeClose is called when the application is about to quit,
// ensuring all connections are cleanly severed and OS resources freed.
func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	if a.manager != nil {
		a.manager.CloseAll()
	}
	if a.tunnelMgr != nil {
		a.tunnelMgr.StopAll()
	}
	// H4 Fix: Close database to flush WAL and stop logWorker goroutine
	if a.db != nil {
		a.db.Close()
	}
	return false // returning false means the closing proceeds normally
}

func (a *App) logCommand(sessionID string, data string) {
	if a.db == nil {
		return
	}

	val, _ := a.cmdBuffers.LoadOrStore(sessionID, &CommandBuffer{})
	cb := val.(*CommandBuffer)

	cb.mu.Lock()
	defer cb.mu.Unlock()

	for _, r := range data {
		if r == '\r' || r == '\n' {
			cmd := strings.TrimSpace(cb.builder.String())
			if cmd != "" {
				cfg, ok := a.manager.GetConfig(sessionID)
				if ok {
					// Use a goroutine to not block the main terminal write
					go a.db.AddCommandLog(sessionID, cfg.Name, cfg.Host, cfg.Protocol, cmd)
				}
			}
			cb.builder.Reset()
		} else if r == '\b' || r == 127 { // Handle backspace
			s := cb.builder.String()
			if len(s) > 0 {
				cb.builder.Reset()
				cb.builder.WriteString(s[:len(s)-1])
			}
		} else {
			// Hard limit of 1MB buffer per session command being typed
			if cb.builder.Len() < 1024*1024 {
				cb.builder.WriteRune(r)
			}
		}
	}
}

// Connect initiates a new terminal session (SSH/Telnet/Serial)
func (a *App) Connect(cfg config.Config) (string, error) {
	// If the config doesn't have an ID, we generate a random one
	if cfg.ID == "" {
		cfg.ID = fmt.Sprintf("session-%d", time.Now().UnixNano())
	}

	// Mask logic: if password is masked and we have an ID, load from DB
	if cfg.Password == "********" && cfg.ID != "" && a.db != nil {
		savedCfg, err := a.db.GetSession(cfg.ID)
		if err == nil {
			cfg.Password = savedCfg.Password // Restore encrypted password
		}
	} else if cfg.Password != "" {
		encrypted, err := config.EncryptPassword(cfg.Password)
		if err != nil {
			return "", fmt.Errorf("加密密码失败: %w", err)
		}
		cfg.Password = encrypted
	}

	sessionID, err := a.manager.Connect(cfg)
	if err != nil {
		return "", fmt.Errorf("连接失败: %w", err)
	}

	return sessionID, nil
}

// WriteTerminal sends input data from the frontend xterm.js to the backend session
func (a *App) WriteTerminal(sessionID string, data string) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
	// Log the command
	a.logCommand(sessionID, data)
	return a.manager.Write(sessionID, []byte(data))
}

// ResizeTerminal notifies the backend PTY that the frontend window size changed
func (a *App) ResizeTerminal(sessionID string, cols, rows int) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
	return a.manager.Resize(sessionID, cols, rows)
}

// CloseSession terminates an active session and removes its configuration
func (a *App) CloseSession(sessionID string) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
	err := a.manager.Close(sessionID)
	// 彻底清理配置映射，防止内存泄漏（仅在用户主动关闭标签页时执行）
	a.manager.RemoveSession(sessionID)
	return err
}

// GetSessionConfig returns the configuration for an active session
func (a *App) GetSessionConfig(sessionID string) (config.Config, error) {
	if a.manager == nil {
		return config.Config{}, fmt.Errorf("连接管理器未初始化")
	}
	cfg, ok := a.manager.GetConfig(sessionID)
	if !ok {
		return config.Config{}, fmt.Errorf("会话配置未找到: %s", sessionID)
	}
	// Mask password so plaintext is never sent back to the frontend
	if cfg.Password != "" {
		cfg.Password = "********"
	}
	return cfg, nil
}

// --- Knowledge Base Binding Methods ---

func (a *App) AddKnowledgeEntry(title, deviceType, commands, description string) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	return a.db.AddEntry(title, deviceType, commands, description)
}

func (a *App) UpdateKnowledgeEntry(id int, title, deviceType, commands, description string) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	return a.db.UpdateEntry(id, title, deviceType, commands, description)
}

func (a *App) DeleteKnowledgeEntry(id int) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	return a.db.DeleteEntry(id)
}

func (a *App) GetAllKnowledgeEntries() ([]db.KnowledgeEntry, error) {
	if a.db == nil {
		return nil, fmt.Errorf("数据库未初始化")
	}
	return a.db.GetAllEntries()
}

func (a *App) SearchKnowledgeBase(query string) ([]db.KnowledgeEntry, error) {
	if a.db == nil {
		return nil, fmt.Errorf("数据库未初始化")
	}
	return a.db.SearchEntries(query)
}

// --- Command Audit Logs ---

func (a *App) GetCommandLogs(query string, limit int) ([]db.CommandLog, error) {
	if a.db == nil {
		return nil, fmt.Errorf("数据库未初始化")
	}
	return a.db.GetCommandLogs(query, limit)
}

func (a *App) ClearCommandLogs() error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	return a.db.ClearCommandLogs()
}

// --- SFTP Bindings ---

func (a *App) SFTPListDirectory(sessionID string, path string) ([]connection.FileInfo, error) {
	if a.manager == nil {
		return nil, fmt.Errorf("连接管理器未初始化")
	}
	return a.manager.ListDirectory(sessionID, path)
}

func (a *App) SFTPDownload(sessionID string, remotePath string) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
	localPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "选择下载位置",
		DefaultFilename: filepath.Base(remotePath),
	})
	if err != nil || localPath == "" {
		return fmt.Errorf("已取消下载")
	}
	return a.manager.DownloadFile(sessionID, remotePath, localPath)
}

func (a *App) SFTPUpload(sessionID string, remoteDir string) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
	localPath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择要上传的文件",
	})
	if err != nil || localPath == "" {
		return fmt.Errorf("已取消上传")
	}

	fileName := filepath.Base(localPath)
	remotePath := remoteDir
	if !strings.HasSuffix(remotePath, "/") {
		remotePath += "/"
	}
	remotePath += fileName

	return a.manager.UploadFile(sessionID, localPath, remotePath)
}

func (a *App) SFTPDelete(sessionID string, path string, isDir bool) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
	return a.manager.DeletePath(sessionID, path, isDir)
}

func (a *App) SFTPRename(sessionID string, oldPath, newPath string) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
	return a.manager.Rename(sessionID, oldPath, newPath)
}

func (a *App) SFTPMkdir(sessionID string, path string) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
	return a.manager.Mkdir(sessionID, path)
}

func (a *App) SyncTerminalPath(sessionID string, path string) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
	// H2 Note: This cd command uses Bash single-quote escaping.
	// It is only compatible with Bash/sh/zsh shells on Unix-like systems.
	// It will NOT work correctly on network device CLIs (Huawei VRP, Cisco IOS, etc.).
	escapedPath := filepath.ToSlash(path)
	escapedPath = strings.ReplaceAll(escapedPath, "'", "'\\''") // Safe way to escape single quotes inside single quotes

	cdCmd := fmt.Sprintf("cd '%s'\r", escapedPath)
	return a.manager.Write(sessionID, []byte(cdCmd))
}

func (a *App) SFTPChmod(sessionID string, path string, modeStr string) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
	// Parse octal string like "755"
	mode, err := strconv.ParseUint(modeStr, 8, 32)
	if err != nil {
		return fmt.Errorf("无效的权限格式: %w", err)
	}
	return a.manager.Chmod(sessionID, path, os.FileMode(mode))
}

func (a *App) SFTPDownloadDir(sessionID string, remoteDir string) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
	localDir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择下载目录",
	})
	if err != nil || localDir == "" {
		return fmt.Errorf("已取消下载")
	}
	return a.manager.DownloadDirectory(sessionID, remoteDir, localDir)
}

func (a *App) SFTPUploadDir(sessionID string, remoteDir string) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
	localDir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择要上传的目录",
	})
	if err != nil || localDir == "" {
		return fmt.Errorf("已取消上传")
	}

	dirName := filepath.Base(localDir)
	remotePath := remoteDir
	if !strings.HasSuffix(remotePath, "/") {
		remotePath += "/"
	}
	remotePath += dirName

	return a.manager.UploadDirectory(sessionID, localDir, remotePath)
}

func (a *App) SFTPUploadDropped(sessionID string, localPath string, remotePath string) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
	log.Printf("Security [INFO]: Processing dropped file upload: %s -> %s", localPath, remotePath)
	return a.manager.UploadFile(sessionID, localPath, remotePath)
}

func (a *App) SFTPUploadDirDropped(sessionID string, localDir string, remoteDir string) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
	log.Printf("Security [INFO]: Processing dropped directory upload: %s -> %s", localDir, remoteDir)
	return a.manager.UploadDirectory(sessionID, localDir, remoteDir)
}

// --- Serial Port Detection ---

func (a *App) GetSerialPorts() ([]string, error) {
	ports, err := serial.GetPortsList()
	if err != nil {
		return nil, fmt.Errorf("获取串口列表失败: %w", err)
	}
	if len(ports) == 0 {
		return []string{}, nil
	}
	return ports, nil
}

// --- Session Persistence ---

func (a *App) SaveSession(cfg config.Config) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}

	if cfg.Password == "********" && cfg.ID != "" {
		savedCfg, err := a.db.GetSession(cfg.ID)
		if err == nil {
			cfg.Password = savedCfg.Password
		}
	} else if cfg.Password != "" {
		encrypted, err := config.EncryptPassword(cfg.Password)
		if err != nil {
			return fmt.Errorf("保存会话失败 (加密失败): %w", err)
		}
		cfg.Password = encrypted
	}

	return a.db.SaveSession(cfg)
}

func (a *App) GetAllSessions() ([]config.Config, error) {
	if a.db == nil {
		return nil, fmt.Errorf("数据库未初始化")
	}
	sessions, err := a.db.GetAllSessions()
	if err != nil {
		return nil, err
	}

	// Mask passwords instead of returning plaintext IPC
	for i := range sessions {
		if sessions[i].Password != "" {
			sessions[i].Password = "********"
		}
	}

	return sessions, nil
}

func (a *App) DeleteSession(id string) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	return a.db.DeleteSession(id)
}

// --- Knowledge Base Import/Export ---

func (a *App) ExportKnowledgeBase() error {
	// H5 Fix: nil check
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	entries, err := a.db.GetAllEntries()
	if err != nil {
		return fmt.Errorf("获取知识库失败: %w", err)
	}

	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "导出知识库",
		DefaultFilename: "knowledge_base.json",
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON Files (*.json)", Pattern: "*.json"},
		},
	})
	if err != nil || path == "" {
		return err
	}

	jsonData, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return fmt.Errorf("解析JSON失败: %w", err)
	}

	err = os.WriteFile(path, jsonData, 0644)
	if err != nil {
		return fmt.Errorf("保存文件失败: %w", err)
	}

	return nil
}

func (a *App) ImportKnowledgeBase() error {
	// H5 Fix: nil check
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "导入知识库",
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON Files (*.json)", Pattern: "*.json"},
		},
	})
	if err != nil || path == "" {
		return err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("读取文件失败: %w", err)
	}

	var entries []db.KnowledgeEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return fmt.Errorf("解析JSON失败: %w", err)
	}

	for _, entry := range entries {
		// Insert or update (upsert logic depends on implementation)
		// For now, let's just add them
		err := a.db.AddEntry(entry.Title, entry.DeviceType, entry.Commands, entry.Description)
		if err != nil {
			log.Printf("Import entry failed: %v", err)
		}
	}

	return nil
}

func (a *App) SaveTerminalLog(content string) error {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "保存终端日志",
		DefaultFilename: "terminal_log_" + time.Now().Format("20060102_150405") + ".txt",
		Filters: []runtime.FileFilter{
			{DisplayName: "Text Files (*.txt)", Pattern: "*.txt"},
		},
	})
	if err != nil || path == "" {
		return err
	}

	err = os.WriteFile(path, []byte(content), 0644)
	if err != nil {
		return fmt.Errorf("保存文件失败: %w", err)
	}

	return nil
}

// WriteTerminalSequence sends a sequence of commands to the terminal with optional delays between lines.
// Fix A1: Execute in a goroutine so it doesn't block the frontend Wails thread.
func (a *App) WriteTerminalSequence(sessionId string, content string, delayMs int) error {
	// H3 Fix: Cap delay at 60 seconds to prevent resource starvation
	if delayMs > 60000 {
		delayMs = 60000
	}

	// E4 Fix: Prevent concurrent macro/sequence executions on the same session messing up the terminal
	val, _ := a.macroLocks.LoadOrStore(sessionId, &sync.Mutex{})
	mu := val.(*sync.Mutex)

	go func() {
		mu.Lock()
		defer mu.Unlock()

		lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
		for _, line := range lines {
			// Pre-check: Stop if the session has been closed since last step
			if _, exists := a.manager.GetConfig(sessionId); !exists {
				return
			}

			if strings.TrimSpace(line) == "" {
				continue
			}
			cmd := line + "\r"
			a.logCommand(sessionId, cmd) // Log command inside the goroutine
			err := a.manager.Write(sessionId, []byte(cmd))
			if err != nil {
				runtime.EventsEmit(a.ctx, "terminal-error-"+sessionId, fmt.Sprintf("序列执行失败: %v", err))
				break
			}
			if delayMs > 0 {
				// We don't want to use time.Sleep directly for large delays because it ignores cancellation.
				// For simplicity here, sleep in smaller chunks to remain responsive to session close.
				chunks := delayMs / 100
				rem := delayMs % 100
				for i := 0; i < chunks; i++ {
					if _, exists := a.manager.GetConfig(sessionId); !exists {
						return
					}
					time.Sleep(100 * time.Millisecond)
				}
				time.Sleep(time.Duration(rem) * time.Millisecond)
			}
		}
	}()

	return nil
}

func (a *App) WriteMultipleTerminals(sessionIds []string, data string) error {
	for _, id := range sessionIds {
		err := a.manager.Write(id, []byte(data))
		if err != nil {
			log.Printf("Broadcast to %s failed: %v", id, err)
		}
	}
	return nil
}

// --- TFTP Bindings ---

func (a *App) StartTFTPServer(rootPath string, port int) error {
	if a.tftpServer == nil {
		return fmt.Errorf("TFTP 服务器未初始化")
	}
	return a.tftpServer.Start(rootPath, port)
}

func (a *App) StopTFTPServer() {
	if a.tftpServer != nil {
		a.tftpServer.Stop()
	}
}

func (a *App) GetTFTPStatus() map[string]interface{} {
	if a.tftpServer == nil {
		return map[string]interface{}{"isRunning": false}
	}
	return map[string]interface{}{
		"isRunning": a.tftpServer.IsRunning(),
		"rootPath":  a.tftpServer.GetRootPath(),
	}
}

func (a *App) TFTPClientDownload(serverIP string, port int, remoteFile string) error {
	localFile, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "选择下载位置",
		DefaultFilename: filepath.Base(remoteFile),
	})
	if err != nil || localFile == "" {
		return fmt.Errorf("已取消下载")
	}
	addr := fmt.Sprintf("%s:%d", serverIP, port)
	return tftp.DownloadFile(addr, remoteFile, localFile)
}

func (a *App) TFTPClientUpload(serverIP string, port int, remoteFile string) error {
	localFile, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择要上传的文件",
	})
	if err != nil || localFile == "" {
		return fmt.Errorf("已取消上传")
	}
	addr := fmt.Sprintf("%s:%d", serverIP, port)
	if remoteFile == "" {
		remoteFile = filepath.Base(localFile)
	}
	return tftp.UploadFile(addr, localFile, remoteFile)
}

// OpenFolderDialog opens a directory selection dialog
func (a *App) OpenFolderDialog() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择目录",
	})
}

// OpenFileDialog opens a file selection dialog
func (a *App) OpenFileDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择要上传的文件",
	})
}

// OpenSaveDialog opens a save file dialog
func (a *App) OpenSaveDialog(filename string) (string, error) {
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "选择保存位置",
		DefaultFilename: filename,
	})
}

// --- Macros Integration ---

func (a *App) SaveMacro(m db.Macro) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	return a.db.SaveMacro(m)
}

func (a *App) GetAllMacros() []db.Macro {
	if a.db == nil {
		return []db.Macro{}
	}
	macros, err := a.db.GetAllMacros()
	if err != nil {
		log.Printf("Failed to get macros: %v", err)
		return []db.Macro{}
	}
	return macros
}

func (a *App) DeleteMacro(id string) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	return a.db.DeleteMacro(id)
}

func (a *App) ExecuteMacro(sessionId string, macroId string) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}

	steps, err := a.db.GetMacroSteps(macroId)
	if err != nil {
		return err
	}

	if len(steps) == 0 {
		return nil
	}

	// E4 Fix: Prevent concurrent macro executions on the same session
	val, _ := a.macroLocks.LoadOrStore(sessionId, &sync.Mutex{})
	mu := val.(*sync.Mutex)

	go func() {
		mu.Lock()
		defer mu.Unlock()

		for _, step := range steps {
			// Pre-check: Stop if the session has been closed
			if _, exists := a.manager.GetConfig(sessionId); !exists {
				return
			}

			cmd := step.Command + "\r"

			// Log macro execution command
			a.logCommand(sessionId, step.Command)

			err := a.manager.Write(sessionId, []byte(cmd))
			if err != nil {
				break
			}
			// H3 Fix: Cap delay at 60 seconds
			delay := step.DelayMs
			if delay > 60000 {
				delay = 60000
			}
			if delay > 0 {
				// Chunked sleep to remain responsive to session closes
				chunks := delay / 100
				rem := delay % 100
				for i := 0; i < chunks; i++ {
					if _, exists := a.manager.GetConfig(sessionId); !exists {
						return
					}
					time.Sleep(100 * time.Millisecond)
				}
				time.Sleep(time.Duration(rem) * time.Millisecond)
			}
		}
	}()

	return nil
}

// OpenDirectoryDialog opens a directory picker dialog and returns the selected local path.
func (a *App) OpenDirectoryDialog() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择目录",
	})
}

// SelectPrivateKeyFile opens a file selection dialog to choose an SSH private key (.pem/.id_rsa), etc.
func (a *App) SelectPrivateKeyFile() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择 SSH 私钥文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "SSH Keys (*.pem, *.id_rsa)", Pattern: "*.pem;*.id_rsa;*.key"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
}

// --- Session Groups Bindings ---

func (a *App) SaveSessionGroup(g db.SessionGroup) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	return a.db.SaveSessionGroup(g)
}

func (a *App) GetAllSessionGroups() []db.SessionGroup {
	if a.db == nil {
		return []db.SessionGroup{}
	}
	groups, err := a.db.GetAllSessionGroups()
	if err != nil {
		log.Printf("Failed to get session groups: %v", err)
		return []db.SessionGroup{}
	}
	return groups
}

func (a *App) DeleteSessionGroup(id string) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	return a.db.DeleteSessionGroup(id)
}

// --- Expect Automations Bindings ---

func (a *App) SaveExpectRule(rule db.DBExpectRule) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	err := a.db.SaveExpectRule(rule)
	if err != nil {
		return err
	}
	
	// Dynamically update rules for active sessions if online
	activeRules, err := a.db.GetExpectRules(rule.SessionID)
	if err == nil && a.manager != nil {
		// Attempt to apply, fail silently if session isn't running
		var expected []connection.ExpectRule
		for _, r := range activeRules {
			expected = append(expected, connection.ExpectRule{
				ID:           r.ID,
				SessionID:    r.SessionID,
				Name:         r.Name,
				RegexTrigger: r.RegexTrigger,
				SendAction:   r.SendAction,
				IsActive:     r.IsActive,
			})
		}
		a.manager.SetExpectRules(rule.SessionID, expected)
	}
	return nil
}

func (a *App) GetExpectRules(sessionID string) []db.DBExpectRule {
	if a.db == nil {
		return []db.DBExpectRule{}
	}
	rules, err := a.db.GetExpectRules(sessionID)
	if err != nil {
		return []db.DBExpectRule{}
	}
	return rules
}

func (a *App) DeleteExpectRule(sessionID string, id string) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	err := a.db.DeleteExpectRule(id)
	
	// Refresh active engine if exists
	rules, err := a.db.GetExpectRules(sessionID)
	if err == nil && a.manager != nil {
		var expected []connection.ExpectRule
		for _, r := range rules {
			expected = append(expected, connection.ExpectRule{
				ID:           r.ID,
				SessionID:    r.SessionID,
				Name:         r.Name,
				RegexTrigger: r.RegexTrigger,
				SendAction:   r.SendAction,
				IsActive:     r.IsActive,
			})
		}
		a.manager.SetExpectRules(sessionID, expected)
	}
	
	return err
}

// --- SSH Tunnels Bindings ---

func (a *App) SaveTunnelConfig(cfg db.DBTunnelConfig) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	return a.db.SaveTunnelConfig(cfg)
}

func (a *App) GetAllTunnels() []db.DBTunnelConfig {
	if a.db == nil {
		return []db.DBTunnelConfig{}
	}
	tunnels, err := a.db.GetAllTunnels()
	if err != nil {
		return []db.DBTunnelConfig{}
	}
	return tunnels
}

func (a *App) DeleteTunnelConfig(id string) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	// Stop if running
	if a.tunnelMgr != nil {
		a.tunnelMgr.StopTunnel(id)
	}
	return a.db.DeleteTunnel(id)
}

func (a *App) StartSSHTunnel(cfg connection.TunnelConfig) error {
	if a.tunnelMgr == nil {
		return fmt.Errorf("隧道管理器不可用")
	}
	return a.tunnelMgr.StartTunnel(cfg)
}

func (a *App) StopSSHTunnel(id string) {
	if a.tunnelMgr != nil {
		a.tunnelMgr.StopTunnel(id)
	}
}
