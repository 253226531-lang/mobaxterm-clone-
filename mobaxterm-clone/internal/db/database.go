package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	"mobaxterm-clone/internal/config"

	_ "github.com/glebarez/go-sqlite"
)

// KnowledgeEntry represents a reusable network config/command case
type KnowledgeEntry struct {
	ID          int    `json:"id"`
	Title       string `json:"title"`
	DeviceType  string `json:"deviceType"` // e.g., Huawei, Cisco, H3C
	Commands    string `json:"commands"`   // The actual CLI commands
	Description string `json:"description"`
}

type Database struct {
	db *sql.DB
}

// InitDB initializes the SQLite database
func InitDB(dbPath string) (*Database, error) {
	// Ensure directory exists
	err := os.MkdirAll(filepath.Dir(dbPath), 0755)
	if err != nil {
		return nil, fmt.Errorf("创建数据库目录失败: %w", err)
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("打开数据库失败: %w", err)
	}

	// 开启 WAL 模式和设置 busy_timeout 以优化高频并发写入 (特别是 command logs)
	_, err = db.Exec(`
		PRAGMA journal_mode=WAL;
		PRAGMA synchronous=NORMAL;
		PRAGMA busy_timeout=5000;
	`)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("设置数据库PRAGMA失败: %w", err)
	}

	// Create tables if they don't exist
	createTableSQL := `CREATE TABLE IF NOT EXISTS knowledge (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		title TEXT NOT NULL,
		device_type TEXT NOT NULL,
		commands TEXT NOT NULL,
		description TEXT
	);
	CREATE TABLE IF NOT EXISTS sessions (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		protocol TEXT NOT NULL,
		host TEXT,
		port INTEGER,
		username TEXT,
		password TEXT,
		baud_rate INTEGER,
		com_port TEXT,
		description TEXT
	);
	CREATE TABLE IF NOT EXISTS command_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id TEXT NOT NULL,
		session_name TEXT,
		host TEXT,
		protocol TEXT,
		command TEXT NOT NULL,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_sessions_name ON sessions(name);
	CREATE INDEX IF NOT EXISTS idx_command_logs_session_id ON command_logs(session_id);
	CREATE INDEX IF NOT EXISTS idx_command_logs_timestamp ON command_logs(timestamp);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("创建数据表失败: %w", err)
	}

	return &Database{db: db}, nil
}

// Close closes the database connection
func (d *Database) Close() error {
	if d.db != nil {
		return d.db.Close()
	}
	return nil
}

// AddEntry inserts a new knowledge base entry
func (d *Database) AddEntry(title, deviceType, commands, description string) error {
	insertSQL := `INSERT INTO knowledge(title, device_type, commands, description) VALUES (?, ?, ?, ?)`
	_, err := d.db.Exec(insertSQL, title, deviceType, commands, description)
	return err
}

// UpdateEntry updates an existing knowledge base entry
func (d *Database) UpdateEntry(id int, title, deviceType, commands, description string) error {
	updateSQL := `UPDATE knowledge SET title = ?, device_type = ?, commands = ?, description = ? WHERE id = ?`
	_, err := d.db.Exec(updateSQL, title, deviceType, commands, description, id)
	return err
}

// DeleteEntry removes an entry from the knowledge base
func (d *Database) DeleteEntry(id int) error {
	deleteSQL := `DELETE FROM knowledge WHERE id = ?`
	_, err := d.db.Exec(deleteSQL, id)
	return err
}

// GetAllEntries retrieves all knowledge base entries
func (d *Database) GetAllEntries() ([]KnowledgeEntry, error) {
	rows, err := d.db.Query(`SELECT id, title, device_type, commands, description FROM knowledge ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []KnowledgeEntry
	for rows.Next() {
		var e KnowledgeEntry
		err = rows.Scan(&e.ID, &e.Title, &e.DeviceType, &e.Commands, &e.Description)
		if err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, nil
}

// SearchEntries searches the knowledge base by title, device type, or description
func (d *Database) SearchEntries(query string) ([]KnowledgeEntry, error) {
	searchQuery := "%" + query + "%"
	rows, err := d.db.Query(`
		SELECT id, title, device_type, commands, description 
		FROM knowledge 
		WHERE title LIKE ? OR device_type LIKE ? OR description LIKE ? OR commands LIKE ?
		ORDER BY id DESC`, searchQuery, searchQuery, searchQuery, searchQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []KnowledgeEntry
	for rows.Next() {
		var e KnowledgeEntry
		err = rows.Scan(&e.ID, &e.Title, &e.DeviceType, &e.Commands, &e.Description)
		if err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, nil
}

// --- Session Persistence ---

func (d *Database) SaveSession(cfg config.Config) error {
	upsertSQL := `INSERT OR REPLACE INTO sessions(id, name, protocol, host, port, username, password, baud_rate, com_port, description)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	_, err := d.db.Exec(upsertSQL, cfg.ID, cfg.Name, cfg.Protocol, cfg.Host, cfg.Port, cfg.Username, cfg.Password, cfg.BaudRate, cfg.ComPort, cfg.Description)
	return err
}

func (d *Database) GetAllSessions() ([]config.Config, error) {
	rows, err := d.db.Query(`SELECT id, name, protocol, COALESCE(host,''), COALESCE(port,0), COALESCE(username,''), COALESCE(password,''), COALESCE(baud_rate,0), COALESCE(com_port,''), COALESCE(description,'') FROM sessions ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []config.Config
	for rows.Next() {
		var s config.Config
		err = rows.Scan(&s.ID, &s.Name, &s.Protocol, &s.Host, &s.Port, &s.Username, &s.Password, &s.BaudRate, &s.ComPort, &s.Description)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, s)
	}
	return sessions, nil
}

func (d *Database) DeleteSession(id string) error {
	_, err := d.db.Exec(`DELETE FROM sessions WHERE id = ?`, id)
	return err
}

// --- Command Logging ---

func (d *Database) AddCommandLog(sessionID, sessionName, host, protocol, command string) error {
	if command == "" {
		return nil
	}
	_, err := d.db.Exec(`INSERT INTO command_logs(session_id, session_name, host, protocol, command) VALUES (?, ?, ?, ?, ?)`,
		sessionID, sessionName, host, protocol, command)
	return err
}

type CommandLog struct {
	ID          int    `json:"id"`
	SessionID   string `json:"sessionId"`
	SessionName string `json:"sessionName"`
	Host        string `json:"host"`
	Protocol    string `json:"protocol"`
	Command     string `json:"command"`
	Timestamp   string `json:"timestamp"`
}

func (d *Database) GetCommandLogs(query string, limit int) ([]CommandLog, error) {
	sql := `SELECT id, session_id, COALESCE(session_name,''), COALESCE(host,''), COALESCE(protocol,''), command, datetime(timestamp, 'localtime') 
	        FROM command_logs`
	var args []interface{}
	if query != "" {
		sql += " WHERE command LIKE ? OR session_name LIKE ? OR host LIKE ?"
		q := "%" + query + "%"
		args = append(args, q, q, q)
	}
	sql += " ORDER BY id DESC"
	if limit > 0 {
		sql += " LIMIT ?"
		args = append(args, limit)
	} else {
		sql += " LIMIT 1000"
	}

	rows, err := d.db.Query(sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []CommandLog
	for rows.Next() {
		var l CommandLog
		err = rows.Scan(&l.ID, &l.SessionID, &l.SessionName, &l.Host, &l.Protocol, &l.Command, &l.Timestamp)
		if err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, nil
}

func (d *Database) ClearCommandLogs() error {
	_, err := d.db.Exec(`DELETE FROM command_logs`)
	return err
}
