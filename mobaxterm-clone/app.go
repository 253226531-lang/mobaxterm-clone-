package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"

	"mobaxterm-clone/internal/config"
	"mobaxterm-clone/internal/connection"
	"mobaxterm-clone/internal/db"
	"mobaxterm-clone/internal/tftp"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.bug.st/serial"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

// App struct
type App struct {
	ctx        context.Context
	manager    *connection.Manager
	db         *db.Database
	cmdBuffers sync.Map // Map[sessionID]*strings.Builder
	tftpServer *tftp.Server
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Initialize Database in the user data directory
	// In a real app, you might want to put this in %APPDATA% or ~/.config
	dbPath := filepath.Join(".", "data", "knowledge.db")
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
					reader := transform.NewReader(strings.NewReader(string(data)), simplifiedchinese.GBK.NewDecoder())
					if decoded, err := io.ReadAll(reader); err == nil {
						output = string(decoded)
					}
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
			runtime.EventsEmit(a.ctx, "terminal-closed-"+sessionID)
		},
	)

	// Initialize TFTP Server
	a.tftpServer = tftp.NewServer(func(info tftp.TransferInfo) {
		runtime.EventsEmit(a.ctx, "tftp-transfer", info)
	})
}

// beforeClose is called when the application is about to quit,
// ensuring all connections are cleanly severed and OS resources freed.
func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	if a.manager != nil {
		a.manager.CloseAll()
	}
	return false // returning false means the closing proceeds normally
}

func (a *App) logCommand(sessionID string, data string) {
	if a.db == nil {
		return
	}

	val, _ := a.cmdBuffers.LoadOrStore(sessionID, &strings.Builder{})
	builder := val.(*strings.Builder)

	for _, r := range data {
		if r == '\r' || r == '\n' {
			cmd := strings.TrimSpace(builder.String())
			if cmd != "" {
				cfg, ok := a.manager.GetConfig(sessionID)
				if ok {
					// Use a goroutine to not block the main terminal write
					go a.db.AddCommandLog(sessionID, cfg.Name, cfg.Host, cfg.Protocol, cmd)
				}
			}
			builder.Reset()
		} else if r == '\b' || r == 127 { // Handle backspace
			s := builder.String()
			if len(s) > 0 {
				builder.Reset()
				builder.WriteString(s[:len(s)-1])
			}
		} else {
			// Hard limit of 1MB buffer per session command being typed
			if builder.Len() < 1024*1024 {
				builder.WriteRune(r)
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

	// ALWAYS encrypt the password before sending to manager.Connect,
	// because connection handlers (like SSH) expect an encrypted string to decrypt.
	// (This ensures consistency for both saved and non-saved sessions)
	if cfg.Password != "" {
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

// CloseSession terminates an active session
func (a *App) CloseSession(sessionID string) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
	return a.manager.Close(sessionID)
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
	// Decrypt password so the frontend can reuse it for reconnection
	if cfg.Password != "" {
		decrypted, err := config.DecryptPassword(cfg.Password)
		if err == nil {
			cfg.Password = decrypted
		}
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

func (a *App) SFTPDownload(sessionID string, remotePath string, localPath string) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
	return a.manager.DownloadFile(sessionID, remotePath, localPath)
}

func (a *App) SFTPUpload(sessionID string, localPath string, remotePath string) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
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
	// Execute cd command in the terminal
	cdCmd := fmt.Sprintf("cd \"%s\"\r", path)
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

func (a *App) SFTPDownloadDir(sessionID string, remoteDir, localDir string) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
	return a.manager.DownloadDirectory(sessionID, remoteDir, localDir)
}

func (a *App) SFTPUploadDir(sessionID string, localDir, remoteDir string) error {
	if a.manager == nil {
		return fmt.Errorf("连接管理器未初始化")
	}
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

	// Encrypt password before saving to DB
	if cfg.Password != "" {
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

	// Decrypt passwords before sending to frontend, so the frontend always has plaintext.
	// This makes the flow: Frontend(Plain) -> App(Encrypt) -> Connection(Decrypt) consistent.
	for i := range sessions {
		if sessions[i].Password != "" {
			decrypted, err := config.DecryptPassword(sessions[i].Password)
			if err == nil {
				sessions[i].Password = decrypted
			}
			// If decryption fails, we just keep the encrypted one or blank it?
			// Keeping it allows the user to see something is wrong or type over it.
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

func (a *App) WriteTerminalSequence(sessionId string, content string, delayMs int) error {
	lines := strings.Split(content, "\n")
	for i, line := range lines {
		// Use \r for most network devices (CR)
		data := line + "\r"
		a.logCommand(sessionId, data)
		err := a.manager.Write(sessionId, []byte(data))
		if err != nil {
			return err
		}

		// Don't sleep after the last line if desired, but usually fine
		if i < len(lines)-1 && delayMs > 0 {
			time.Sleep(time.Duration(delayMs) * time.Millisecond)
		}
	}
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

// OpenDirectoryDialog opens a directory selection dialog
func (a *App) OpenDirectoryDialog() (string, error) {
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

func (a *App) SaveMacro(m db.Macro) error {
	return a.db.SaveMacro(m)
}

func (a *App) GetAllMacros() ([]db.Macro, error) {
	return a.db.GetAllMacros()
}

func (a *App) DeleteMacro(id string) error {
	return a.db.DeleteMacro(id)
}

func (a *App) ExecuteMacro(sessionId string, macroId string) error {
	steps, err := a.db.GetMacroSteps(macroId)
	if err != nil {
		return err
	}

	if len(steps) == 0 {
		return fmt.Errorf("该宏没有步骤")
	}

	go func() {
		for _, step := range steps {
			data := step.Command + "\r"
			a.logCommand(sessionId, data)
			err := a.manager.Write(sessionId, []byte(data))
			if err != nil {
				return
			}

			if step.DelayMs > 0 {
				time.Sleep(time.Duration(step.DelayMs) * time.Millisecond)
			}
		}
	}()

	return nil
}
