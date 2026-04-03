package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

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

// Macro represents a sequence of commands to be executed
type Macro struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Steps       []MacroStep `json:"steps"`
	CreatedAt   string      `json:"createdAt"`
}

// MacroStep represents a single command in a macro
type MacroStep struct {
	ID        int    `json:"id"`
	MacroID   string `json:"macroId"`
	Command   string `json:"command"`
	DelayMs   int    `json:"delayMs"`
	StepOrder int    `json:"stepOrder"`
}

type SessionGroup struct {
	ID        string `json:"id"`
	ParentID  string `json:"parentId"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
}

type DBExpectRule struct {
	ID           string `json:"id"`
	SessionID    string `json:"sessionId"`
	Name         string `json:"name"`
	RegexTrigger string `json:"regexTrigger"`
	SendAction   string `json:"sendAction"`
	IsActive     bool   `json:"isActive"`
}

type DBTunnelConfig struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Type            string `json:"type"`
	LocalParam      string `json:"localParam"`
	RemoteParam     string `json:"remoteParam"`
	TargetSessionID string `json:"targetSessionId"`
	IsActive        bool   `json:"isActive"`
}

type Database struct {
	db       *sql.DB
	logQueue chan CommandLog
	stopLog  chan struct{}
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
	// 开启 foreign_keys 以支持宏 (Macro) 删除时的级联删除 (CASCADE)
	_, err = db.Exec(`
		PRAGMA journal_mode=WAL;
		PRAGMA synchronous=NORMAL;
		PRAGMA busy_timeout=5000;
		PRAGMA foreign_keys=ON;
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
	CREATE INDEX IF NOT EXISTS idx_command_logs_timestamp ON command_logs(timestamp);
	
	CREATE TABLE IF NOT EXISTS macros (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		description TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE IF NOT EXISTS macro_steps (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		macro_id TEXT NOT NULL,
		command TEXT NOT NULL,
		delay_ms INTEGER DEFAULT 100,
		step_order INTEGER NOT NULL,
		FOREIGN KEY(macro_id) REFERENCES macros(id) ON DELETE CASCADE
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("创建数据表失败: %w", err)
	}

	// Migration: Add encoding column to sessions if not exists
	_, _ = db.Exec("ALTER TABLE sessions ADD COLUMN encoding TEXT")
	_, _ = db.Exec("ALTER TABLE sessions ADD COLUMN group_id TEXT")
	_, _ = db.Exec("ALTER TABLE sessions ADD COLUMN private_key TEXT")

	// Create new tables for features 5, 2, 3
	newTablesSQL := `
	CREATE TABLE IF NOT EXISTS session_groups (
		id TEXT PRIMARY KEY,
		parent_id TEXT,
		name TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE IF NOT EXISTS expect_rules (
		id TEXT PRIMARY KEY,
		session_id TEXT NOT NULL,
		name TEXT,
		regex_trigger TEXT NOT NULL,
		send_action TEXT NOT NULL,
		is_active INTEGER DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE IF NOT EXISTS ssh_tunnels (
		id TEXT PRIMARY KEY,
		name TEXT,
		forward_type TEXT NOT NULL,
		local_param TEXT NOT NULL,
		remote_param TEXT,
		target_session_id TEXT,
		is_active INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`
	_, err = db.Exec(newTablesSQL)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("创建新增数据表失败: %w", err)
	}

	database := &Database{
		db:       db,
		logQueue: make(chan CommandLog, 1024),
		stopLog:  make(chan struct{}),
	}

	// Start the async log writer
	go database.logWorker()

	return database, nil
}

// Close closes the database connection and workers
func (d *Database) Close() error {
	if d.stopLog != nil {
		close(d.stopLog)
	}
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
	upsertSQL := `INSERT OR REPLACE INTO sessions(id, name, protocol, host, port, username, password, baud_rate, com_port, description, encoding, group_id, private_key)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	_, err := d.db.Exec(upsertSQL, cfg.ID, cfg.Name, cfg.Protocol, cfg.Host, cfg.Port, cfg.Username, cfg.Password, cfg.BaudRate, cfg.ComPort, cfg.Description, cfg.Encoding, cfg.GroupID, cfg.PrivateKey)
	return err
}

func (d *Database) GetAllSessions() ([]config.Config, error) {
	rows, err := d.db.Query(`SELECT id, name, protocol, COALESCE(host,''), COALESCE(port,0), COALESCE(username,''), COALESCE(password,''), COALESCE(baud_rate,0), COALESCE(com_port,''), COALESCE(description,''), COALESCE(encoding,'UTF-8'), COALESCE(group_id,''), COALESCE(private_key,'') FROM sessions ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []config.Config
	for rows.Next() {
		var s config.Config
		err = rows.Scan(&s.ID, &s.Name, &s.Protocol, &s.Host, &s.Port, &s.Username, &s.Password, &s.BaudRate, &s.ComPort, &s.Description, &s.Encoding, &s.GroupID, &s.PrivateKey)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, s)
	}
	return sessions, nil
}

func (d *Database) GetSession(id string) (config.Config, error) {
	var s config.Config
	err := d.db.QueryRow(`SELECT id, name, protocol, COALESCE(host,''), COALESCE(port,0), COALESCE(username,''), COALESCE(password,''), COALESCE(baud_rate,0), COALESCE(com_port,''), COALESCE(description,''), COALESCE(encoding,'UTF-8'), COALESCE(group_id,''), COALESCE(private_key,'') FROM sessions WHERE id = ?`, id).Scan(
		&s.ID, &s.Name, &s.Protocol, &s.Host, &s.Port, &s.Username, &s.Password, &s.BaudRate, &s.ComPort, &s.Description, &s.Encoding, &s.GroupID, &s.PrivateKey)
	return s, err
}

func (d *Database) DeleteSession(id string) error {
	_, err := d.db.Exec(`DELETE FROM sessions WHERE id = ?`, id)
	return err
}

// --- Session Groups Persistence ---

func (d *Database) SaveSessionGroup(g SessionGroup) error {
	upsertSQL := `INSERT OR REPLACE INTO session_groups(id, parent_id, name) VALUES (?, ?, ?)`
	_, err := d.db.Exec(upsertSQL, g.ID, g.ParentID, g.Name)
	return err
}

func (d *Database) GetAllSessionGroups() ([]SessionGroup, error) {
	rows, err := d.db.Query(`SELECT id, COALESCE(parent_id,''), name, created_at FROM session_groups ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groups []SessionGroup
	for rows.Next() {
		var g SessionGroup
		if err := rows.Scan(&g.ID, &g.ParentID, &g.Name, &g.CreatedAt); err != nil {
			return nil, err
		}
		groups = append(groups, g)
	}
	return groups, nil
}

func (d *Database) DeleteSessionGroup(id string) error {
	_, err := d.db.Exec(`DELETE FROM session_groups WHERE id = ?`, id)
	return err
}

// --- Protocol & Automations Persistence ---

func (d *Database) SaveExpectRule(r DBExpectRule) error {
	activeInt := 0
	if r.IsActive {
		activeInt = 1
	}
	upsertSQL := `INSERT OR REPLACE INTO expect_rules(id, session_id, name, regex_trigger, send_action, is_active) VALUES (?, ?, ?, ?, ?, ?)`
	_, err := d.db.Exec(upsertSQL, r.ID, r.SessionID, r.Name, r.RegexTrigger, r.SendAction, activeInt)
	return err
}

func (d *Database) GetExpectRules(sessionID string) ([]DBExpectRule, error) {
	rows, err := d.db.Query(`SELECT id, session_id, name, regex_trigger, send_action, is_active FROM expect_rules WHERE session_id = ?`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []DBExpectRule
	for rows.Next() {
		var r DBExpectRule
		var activeInt int
		if err := rows.Scan(&r.ID, &r.SessionID, &r.Name, &r.RegexTrigger, &r.SendAction, &activeInt); err != nil {
			return nil, err
		}
		r.IsActive = (activeInt == 1)
		rules = append(rules, r)
	}
	return rules, nil
}

func (d *Database) DeleteExpectRule(id string) error {
	_, err := d.db.Exec(`DELETE FROM expect_rules WHERE id = ?`, id)
	return err
}

// --- Tunnel Persistence ---

func (d *Database) SaveTunnelConfig(t DBTunnelConfig) error {
	activeInt := 0
	if t.IsActive {
		activeInt = 1
	}
	upsertSQL := `INSERT OR REPLACE INTO ssh_tunnels(id, name, forward_type, local_param, remote_param, target_session_id, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)`
	_, err := d.db.Exec(upsertSQL, t.ID, t.Name, t.Type, t.LocalParam, t.RemoteParam, t.TargetSessionID, activeInt)
	return err
}

func (d *Database) GetAllTunnels() ([]DBTunnelConfig, error) {
	rows, err := d.db.Query(`SELECT id, name, forward_type, local_param, COALESCE(remote_param,''), COALESCE(target_session_id,''), is_active FROM ssh_tunnels`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tunnels []DBTunnelConfig
	for rows.Next() {
		var t DBTunnelConfig
		var activeInt int
		if err := rows.Scan(&t.ID, &t.Name, &t.Type, &t.LocalParam, &t.RemoteParam, &t.TargetSessionID, &activeInt); err != nil {
			return nil, err
		}
		t.IsActive = (activeInt == 1)
		tunnels = append(tunnels, t)
	}
	return tunnels, nil
}

func (d *Database) DeleteTunnel(id string) error {
	_, err := d.db.Exec(`DELETE FROM ssh_tunnels WHERE id = ?`, id)
	return err
}

// --- Macro Persistence ---

func (d *Database) SaveMacro(m Macro) error {
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Upsert macro info
	_, err = tx.Exec(`INSERT OR REPLACE INTO macros(id, name, description) VALUES (?, ?, ?)`,
		m.ID, m.Name, m.Description)
	if err != nil {
		return err
	}

	// Delete existing steps
	_, err = tx.Exec(`DELETE FROM macro_steps WHERE macro_id = ?`, m.ID)
	if err != nil {
		return err
	}

	// Insert new steps
	for _, step := range m.Steps {
		_, err = tx.Exec(`INSERT INTO macro_steps(macro_id, command, delay_ms, step_order) VALUES (?, ?, ?, ?)`,
			m.ID, step.Command, step.DelayMs, step.StepOrder)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (d *Database) GetAllMacros() ([]Macro, error) {
	// Optimal approach: Get everything in one query using a join
	query := `
		SELECT m.id, m.name, COALESCE(m.description,''), m.created_at,
		       s.id, s.macro_id, s.command, s.delay_ms, s.step_order
		FROM macros m
		LEFT JOIN macro_steps s ON m.id = s.macro_id
		ORDER BY m.name, s.step_order`

	rows, err := d.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	macroMap := make(map[string]*Macro)
	var order []string

	for rows.Next() {
		var mid, mname, mdesc, mcreated string
		var sid sql.NullInt64
		var smid, scmd sql.NullString
		var sdelay, sorder sql.NullInt64

		err = rows.Scan(&mid, &mname, &mdesc, &mcreated, &sid, &smid, &scmd, &sdelay, &sorder)
		if err != nil {
			return nil, err
		}

		m, ok := macroMap[mid]
		if !ok {
			m = &Macro{
				ID:          mid,
				Name:        mname,
				Description: mdesc,
				CreatedAt:   mcreated,
				Steps:       []MacroStep{},
			}
		macroMap[mid] = m
		order = append(order, mid)
		}

		if sid.Valid {
			m.Steps = append(m.Steps, MacroStep{
				ID:        int(sid.Int64),
				MacroID:   smid.String,
				Command:   scmd.String,
				DelayMs:   int(sdelay.Int64),
				StepOrder: int(sorder.Int64),
			})
		}
	}

	// Finalize results from map to maintain pointers/updates
	finalResult := make([]Macro, 0, len(macroMap))
	for _, id := range order {
		finalResult = append(finalResult, *macroMap[id])
	}

	return finalResult, nil
}

func (d *Database) GetMacroSteps(macroID string) ([]MacroStep, error) {
	rows, err := d.db.Query(`SELECT id, macro_id, command, delay_ms, step_order FROM macro_steps WHERE macro_id = ? ORDER BY step_order`, macroID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var steps []MacroStep
	for rows.Next() {
		var s MacroStep
		err = rows.Scan(&s.ID, &s.MacroID, &s.Command, &s.DelayMs, &s.StepOrder)
		if err != nil {
			return nil, err
		}
		steps = append(steps, s)
	}
	return steps, nil
}

func (d *Database) DeleteMacro(id string) error {
	_, err := d.db.Exec(`DELETE FROM macros WHERE id = ?`, id)
	return err
}

// --- Command Logging ---

// logWorker processes the asynchronous log queue to prevent SQLite 'database is locked' errors.
// It uses a buffered approach: write either when we reach a batch size limit, or when 1 second passes.
func (d *Database) logWorker() {
	var batch []CommandLog
	// Flush timer
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	flush := func() {
		if len(batch) == 0 {
			return
		}
		
		// Use a transaction for batch insert to drastically improve SQLite performance
		tx, err := d.db.Begin()
		if err != nil {
			return // Skip this batch on unexpected begin error
		}

		stmt, err := tx.Prepare(`INSERT INTO command_logs(session_id, session_name, host, protocol, command) VALUES (?, ?, ?, ?, ?)`)
		if err == nil {
			for _, logItem := range batch {
				stmt.Exec(logItem.SessionID, logItem.SessionName, logItem.Host, logItem.Protocol, logItem.Command)
			}
			stmt.Close()
		}

		tx.Commit()
		batch = batch[:0] // Reset batch slice
	}

	for {
		select {
		case logItem := <-d.logQueue:
			batch = append(batch, logItem)
			if len(batch) >= 50 { // flush at 50 logs
				flush()
			}
		case <-ticker.C:
			flush()
		case <-d.stopLog:
			flush() // One final flush before exiting
			return
		}
	}
}

func (d *Database) AddCommandLog(sessionID, sessionName, host, protocol, command string) error {
	if command == "" {
		return nil
	}
	// E3 Fix: Push to channel non-blocking to avoid freezing during high frequency
	select {
	case d.logQueue <- CommandLog{
		SessionID:   sessionID,
		SessionName: sessionName,
		Host:        host,
		Protocol:    protocol,
		Command:     command,
	}:
		// Successfully queued
	default:
		// Queue is full (very rare), drop log to prefer terminal latency
	}

	return nil
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
	// H1 Fix: renamed from 'sql' to avoid shadowing the database/sql package import
	queryStr := `SELECT id, session_id, COALESCE(session_name,''), COALESCE(host,''), COALESCE(protocol,''), command, datetime(timestamp, 'localtime') 
	        FROM command_logs`
	var args []interface{}
	if query != "" {
		queryStr += " WHERE command LIKE ? OR session_name LIKE ? OR host LIKE ?"
		q := "%" + query + "%"
		args = append(args, q, q, q)
	}
	queryStr += " ORDER BY id DESC"
	if limit > 0 {
		queryStr += " LIMIT ?"
		args = append(args, limit)
	} else {
		queryStr += " LIMIT 1000"
	}

	rows, err := d.db.Query(queryStr, args...)
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
