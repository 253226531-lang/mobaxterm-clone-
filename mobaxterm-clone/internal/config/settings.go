package config

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"io"
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
}

// A 32-byte hardcoded key for AES-256 (In a real production app, this should be derived from a user master password or OS keychain)
var encryptionKey = []byte("A7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2")

func EncryptPassword(plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		return "", err
	}

	ciphertext := make([]byte, aes.BlockSize+len(plaintext))
	iv := ciphertext[:aes.BlockSize]
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return "", err
	}

	stream := cipher.NewCFBEncrypter(block, iv)
	stream.XORKeyStream(ciphertext[aes.BlockSize:], []byte(plaintext))

	return hex.EncodeToString(ciphertext), nil
}

func DecryptPassword(encryptedHex string) (string, error) {
	if encryptedHex == "" {
		return "", nil
	}
	ciphertext, err := hex.DecodeString(encryptedHex)
	if err != nil {
		// If it's not valid hex, it's likely a legacy plaintext password
		return encryptedHex, nil
	}

	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		return "", err
	}

	if len(ciphertext) < aes.BlockSize {
		// Too short to be our AES-CFB ciphertext (which is IV + plaintext)
		return encryptedHex, nil
	}
	iv := ciphertext[:aes.BlockSize]
	ciphertext = ciphertext[aes.BlockSize:]

	stream := cipher.NewCFBDecrypter(block, iv)
	stream.XORKeyStream(ciphertext, ciphertext)

	return string(ciphertext), nil
}
