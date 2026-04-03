package config

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
)

// Config represents a saved connection session
type Config struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Protocol    string `json:"protocol"` // ssh, telnet, serial
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username,omitempty"`
	Password    string `json:"password,omitempty"`    // stored encrypted
	BaudRate    int    `json:"baudRate,omitempty"`    // for serial
	DataBits    int    `json:"dataBits,omitempty"`    // for serial (5,6,7,8)
	StopBits    string `json:"stopBits,omitempty"`    // for serial (1, 1.5, 2)
	Parity      string `json:"parity,omitempty"`      // for serial (N, E, O, M, S)
	FlowControl string `json:"flowControl,omitempty"` // for serial (None, Hardware, Software)
	ComPort     string `json:"comPort,omitempty"`     // for serial
	Description string `json:"description,omitempty"`
	Encoding    string `json:"encoding,omitempty"`    // for terminal encoding (e.g., "GBK", "UTF-8")
	GroupID     string `json:"groupId,omitempty"`     // folder / group ID
	PrivateKey  string `json:"privateKey,omitempty"`  // path to PEM file or encrypted key string
}

var (
	encryptionKey []byte
	keyOnce       sync.Once
)

// initEncryptionKey loads or generates a machine-specific key
func initEncryptionKey() error {
	configDir, err := os.UserConfigDir()
	if err != nil {
		configDir = "."
	}
	keyPath := filepath.Join(configDir, "MobaXtermClone", ".secret.key")

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(keyPath), 0700); err != nil {
		return err
	}

	keyData, err := os.ReadFile(keyPath)
	if err == nil && len(keyData) == 32 {
		encryptionKey = keyData
		return nil
	}

	// Generate new key
	newKey := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, newKey); err != nil {
		return err
	}

	if err := os.WriteFile(keyPath, newKey, 0600); err != nil {
		return err
	}
	protectKeyFile(keyPath)

	encryptionKey = newKey
	return nil
}

func getEncryptionKey() ([]byte, error) {
	var err error
	keyOnce.Do(func() {
		err = initEncryptionKey()
	})
	if err != nil {
		return nil, fmt.Errorf("failed to init encryption key: %w", err)
	}
	if len(encryptionKey) != 32 {
		return nil, fmt.Errorf("invalid encryption key length")
	}
	return encryptionKey, nil
}

// protectKeyFile restricts access to the key file on Windows using icacls.
// On Unix/macOS, file mode 0600 already provides adequate protection.
func protectKeyFile(path string) {
	if runtime.GOOS != "windows" {
		return
	}
	username := os.Getenv("USERNAME")
	if username == "" {
		return
	}
	// Remove inherited permissions and grant only current user full control
	cmd := exec.Command("icacls", path, "/inheritance:r", "/grant:r", username+":(F)")
	if err := cmd.Run(); err != nil {
		log.Printf("Warning: Failed to restrict key file permissions: %v", err)
	}
}

// EncryptPassword encrypts a plaintext password using AES-256-GCM (authenticated encryption).
func EncryptPassword(plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	key, err := getEncryptionKey()
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	// AES-GCM Seal appends authenticated ciphertext + tag after nonce
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return "v2:" + hex.EncodeToString(ciphertext), nil
}

// DecryptPassword decrypts an encrypted password.
// Tries AES-GCM first, then falls back to legacy AES-CFB for backward compatibility.
func DecryptPassword(encryptedHex string) (string, error) {
	if encryptedHex == "" {
		return "", nil
	}

	// 提取版本号和密文主体
	isV2 := false
	if len(encryptedHex) > 3 && encryptedHex[:3] == "v2:" {
		isV2 = true
		encryptedHex = encryptedHex[3:]
	}

	data, err := hex.DecodeString(encryptedHex)
	if err != nil {
		return "", fmt.Errorf("invalid hex encoding")
	}

	key, err := getEncryptionKey()
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	// If it has explicitly "v2:" prefix, MUST use AES-GCM
	if isV2 {
		gcm, gcmErr := cipher.NewGCM(block)
		if gcmErr != nil {
			return "", gcmErr
		}
		if len(data) < gcm.NonceSize()+gcm.Overhead() {
			return "", fmt.Errorf("ciphertext too short for v2 GCM")
		}
		nonce := data[:gcm.NonceSize()]
		ciphertext := data[gcm.NonceSize():]
		// Explicit verification. Will fail if tampered
		plaintext, openErr := gcm.Open(nil, nonce, ciphertext, nil)
		if openErr != nil {
			return "", fmt.Errorf("v2 authentication failed: %w", openErr)
		}
		return string(plaintext), nil
	}

	// Fallback: Legacy passwords without v2 prefix
	// First try decoding as GCM (in case they were saved with new logic but lacked prefix originally somehow)
	gcm, gcmErr := cipher.NewGCM(block)
	if gcmErr == nil && len(data) >= gcm.NonceSize()+gcm.Overhead() {
		nonce := data[:gcm.NonceSize()]
		ciphertext := data[gcm.NonceSize():]
		plaintext, openErr := gcm.Open(nil, nonce, ciphertext, nil)
		if openErr == nil {
			return string(plaintext), nil
		}
	}

	// Legacy AES-CFB decryption
	if len(data) >= aes.BlockSize {
		iv := data[:aes.BlockSize]
		cfbData := make([]byte, len(data)-aes.BlockSize)
		copy(cfbData, data[aes.BlockSize:])
		stream := cipher.NewCFBDecrypter(block, iv)
		stream.XORKeyStream(cfbData, cfbData)
		return string(cfbData), nil
	}

	return "", fmt.Errorf("ciphertext too short")
}
