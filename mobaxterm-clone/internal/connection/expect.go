package connection

import (
	"log"
	"regexp"
	"sync"
)

type ExpectRule struct {
	ID           string `json:"id"`
	SessionID    string `json:"sessionId"`
	Name         string `json:"name"`
	RegexTrigger string `json:"regexTrigger"`
	SendAction   string `json:"sendAction"`
	IsActive     bool   `json:"isActive"`
}

type ExpectEngine struct {
	mu     sync.RWMutex
	rules  []ExpectRule
	buffer string
	writer func(data []byte) error
}

func NewExpectEngine(writer func([]byte) error) *ExpectEngine {
	return &ExpectEngine{
		writer: writer,
	}
}

// SetRules resets the rules to the new provided list
func (e *ExpectEngine) SetRules(rules []ExpectRule) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.rules = rules
}

// AppendRule adds a single rule to the engine
func (e *ExpectEngine) AppendRule(rule ExpectRule) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.rules = append(e.rules, rule)
}

func (e *ExpectEngine) Process(data []byte) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if len(e.rules) == 0 {
		return
	}

	e.buffer += string(data)
	// Keeps the validation window to the last 4096 characters to prevent unbounded memory growth
	if len(e.buffer) > 4096 {
		e.buffer = e.buffer[len(e.buffer)-4096:]
	}

	// Iterate backwards so we can safely remove elements while checking
	for i := len(e.rules) - 1; i >= 0; i-- {
		rule := e.rules[i]
		if !rule.IsActive {
			continue
		}

		matched, err := regexp.MatchString(rule.RegexTrigger, e.buffer)
		if err == nil && matched {
			log.Printf("ExpectEngine matched rule [%s] with regex [%s]", rule.Name, rule.RegexTrigger)
			
			// Fire the action
			if e.writer != nil {
				_ = e.writer([]byte(rule.SendAction + "\r"))
			}

			// Fire-and-forget: remove the rule after execution to prevent looping
			e.rules = append(e.rules[:i], e.rules[i+1:]...)
			e.buffer = "" // Reset buffer since we acted
			break         // Only process one rule per pump cycle
		}
	}
}
